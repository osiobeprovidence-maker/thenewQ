/**
 * JOIN THE QUEUE — Supabase Edge Function (Deno)
 * bachs-webhook — public endpoint called BY Bachs servers (no user JWT).
 *
 * Flow (mirrors the verified Firebase implementation):
 *   1. Untouched raw body
 *   2. HMAC-SHA256 signature + 300s replay window check
 *   3. Parse event; resolve the CANONICAL checkout session from Bachs
 *   4. Hand off to public.fulfill_bachs_reservation (atomic, idempotent in Postgres)
 *
 * Fail-closed: any problem returns non-200 so Bachs retries the delivery.
 */

const BACHS_SECRET_KEY = Deno.env.get('BACHS_SECRET_KEY') ?? '';
const BACHS_WEBHOOK_SECRET = Deno.env.get('BACHS_WEBHOOK_SECRET') ?? '';
const BACHS_ENVIRONMENT = (Deno.env.get('BACHS_ENVIRONMENT') ?? 'production').toLowerCase();
const BACHS_API_BASE =
  BACHS_ENVIRONMENT === 'sandbox' || BACHS_ENVIRONMENT === 'test'
    ? 'https://sandbox-api.bachs.io/v1'
    : 'https://api.bachs.io/v1';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const textEncoder = new TextEncoder();

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(data));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function verifyWebhookSignature(
  rawBody: string,
  headers: Headers,
  secret: string
): Promise<{ isValid: boolean; error?: string }> {
  const sigHeader = headers.get('x-bachs-signature') ?? '';
  const sigV2Header = headers.get('x-bachs-signature-v2') ?? '';
  const timeHeader = headers.get('x-bachs-timestamp') ?? '';

  let timestamp = timeHeader.trim();
  let signature = sigHeader.trim();

  if (sigV2Header) {
    for (const part of sigV2Header.split(',')) {
      const [key, value] = part.split('=', 2).map((s) => s.trim());
      if (key === 't' && !timestamp) timestamp = value;
      else if (key === 'v1' && !signature) signature = value;
    }
  }

  if (!signature || !timestamp) {
    return { isValid: false, error: 'Missing signature or timestamp header' };
  }

  const tsNumber = Number.parseInt(timestamp, 10);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(tsNumber) || Math.abs(nowSeconds - tsNumber) > 300) {
    return { isValid: false, error: 'Timestamp outside 300s replay tolerance window' };
  }

  return hmacSha256Hex(secret, `${timestamp}.${rawBody}`).then((hex) => {
    if (!constantTimeEqual(hex, signature)) {
      return { isValid: false, error: 'Invalid HMAC-SHA256 signature' };
    }
    return { isValid: true };
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  if (!BACHS_WEBHOOK_SECRET) {
    console.error('BACHS_WEBHOOK_SECRET is not configured');
    return new Response('Webhook processor not configured', { status: 500 });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not available in function runtime');
    return new Response('Webhook processor not configured', { status: 500 });
  }

  const rawBody = await req.text();

  // ── 1. Signature + replay protection ───────────────────────────────────
  const verification = await verifyWebhookSignature(rawBody, req.headers, BACHS_WEBHOOK_SECRET);
  if (!verification.isValid) {
    console.warn(`Rejected webhook: ${verification.error}`);
    return new Response(verification.error ?? 'Invalid signature', { status: 400 });
  }

  // ── 2. Parse verified payload ──────────────────────────────────────────
  let event: { id?: string; type?: string; data?: Record<string, unknown> };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response('Malformed JSON', { status: 400 });
  }

  const eventId = event?.id;
  const eventType = event?.type;
  if (!eventId || !eventType) {
    return new Response('Invalid event format', { status: 400 });
  }
  console.log(`Received verified Bachs event ${eventId} (${eventType})`);

  const serviceHeaders: Record<string, string> = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };

  // ── 3. Dispatch ────────────────────────────────────────────────────────
  if (eventType !== 'checkout.completed') {
    // Unknown event type — acknowledge so Bachs stops retrying; do not fulfil.
    return new Response(JSON.stringify({ received: true, ignored: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const checkoutId = event.data?.checkout_id;
  if (!checkoutId || typeof checkoutId !== 'string') {
    return new Response('checkout.completed missing checkout_id', { status: 400 });
  }

  // ── 4. Resolve the canonical session directly from Bachs ───────────────
  const sessionRes = await fetch(
    `${BACHS_API_BASE}/checkout-sessions/${encodeURIComponent(checkoutId)}`,
    { method: 'GET', headers: { Authorization: `Bearer ${BACHS_SECRET_KEY}`, Accept: 'application/json' } }
  );
  if (!sessionRes.ok) {
    console.error(`Canonical session fetch failed for ${checkoutId}: ${sessionRes.statusText}`);
    return new Response('Unable to verify checkout session with Bachs', { status: 502 });
  }
  const session = await sessionRes.json();

  const status = session?.status;
  if (status !== 'completed' && status !== 'paid' && status !== 'succeeded') {
    console.warn(`Non-success session status for ${checkoutId}: ${status}`);
    return new Response(JSON.stringify({ received: true, status: 'unfulfilled_non_success_status' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const reference = session?.metadata?.reference;
  const amount = Number(session?.pricing?.amount);
  const currency = (session?.pricing?.currency || 'USD').toUpperCase();

  if (!reference) {
    console.error(`Checkout session ${checkoutId} missing metadata.reference`);
    return new Response('Missing reservation reference', { status: 400 });
  }

  // ── 5. Atomic, idempotent fulfilment in Postgres ───────────────────────
  const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fulfill_bachs_reservation`, {
    method: 'POST',
    headers: serviceHeaders,
    body: JSON.stringify({
      p_event_id: eventId,
      p_reference_id: reference,
      p_verified_amount: amount,
      p_verified_currency: currency,
      p_provider_checkout_id: checkoutId,
    }),
  });

  if (!rpcRes.ok) {
    const rpcError = await rpcRes.text();
    console.error(`fulfill_bachs_reservation failed for ${reference}: ${rpcError}`);
    return new Response('Fulfilment failed', { status: 502 });
  }

  const rpcResult = await rpcRes.json().catch(() => ({}));
  console.log(`Fulfilment result for ${reference}: ${JSON.stringify(rpcResult)}`);

  return new Response(JSON.stringify({ received: true, result: rpcResult }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
