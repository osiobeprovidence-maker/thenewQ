/**
 * JOIN THE QUEUE — Supabase Edge Function (Deno)
 * bachs-create-checkout — authenticated endpoint.
 *
 * Contract (matches the storefront's paymentProvider):
 *   POST /functions/v1/bachs-create-checkout
 *   Authorization: Bearer <Firebase ID token>
 *   body: { productId, beneficiaryUserId?, preferredGroupCode?, successUrl?, customerEmail?, customerName? }
 *   → 200 { id, checkoutUrl, reference, status }
 *
 * Security model (identical guarantees to the retired Firebase callable):
 *   - Prices come ONLY from the database (never the client).
 *   - An authoritative pending slot_reservations row is created BEFORE the
 *     checkout session; a Bachs failure rolls the reservation back.
 *   - Fulfilment happens solely via the webhook -> fulfill_bachs_reservation RPC.
 */

import { createRemoteJWKSet, jwtVerify } from 'https://esm.sh/jose@5.9.6';

const FIREBASE_PROJECT_ID = Deno.env.get('FIREBASE_PROJECT_ID') ?? 'thenewq';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const BACHS_SECRET_KEY = Deno.env.get('BACHS_SECRET_KEY') ?? '';
const BACHS_ENVIRONMENT = (Deno.env.get('BACHS_ENVIRONMENT') ?? 'production').toLowerCase();
const BACHS_API_BASE =
  BACHS_ENVIRONMENT === 'sandbox' || BACHS_ENVIRONMENT === 'test'
    ? 'https://sandbox-api.bachs.io/v1'
    : 'https://api.bachs.io/v1';

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ??
  'https://jointhenewq.vercel.app,http://localhost:4173,http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

async function verifyFirebaseToken(token: string) {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
    audience: FIREBASE_PROJECT_ID,
  });
  return payload;
}

function randomRef(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
  return `JTQ-${ts}-${rand}`;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get('origin');

  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders(origin) });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, origin);
  }
  if (!BACHS_SECRET_KEY) {
    console.error('BACHS_SECRET_KEY missing in function secrets');
    return json({ error: 'Payment processor is not configured.' }, 500, origin);
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Supabase service credentials not available');
    return json({ error: 'Payment processor is not configured.' }, 500, origin);
  }

  // ── 1. Verify Firebase ID token ────────────────────────────────────────
  const authHeader = req.headers.get('authorization') ?? '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return json({ error: 'Sign in before starting checkout.' }, 401, origin);

  let callerUid: string;
  let callerEmail: string | undefined;
  try {
    const payload = await verifyFirebaseToken(match[1]);
    callerUid = String(payload.sub ?? '');
    callerEmail = typeof payload.email === 'string' ? payload.email : undefined;
    if (!callerUid) throw new Error('missing subject');
  } catch (err) {
    console.warn('Firebase token verification failed:', err);
    return json({ error: 'Your session expired. Please sign in again.' }, 401, origin);
  }

  // ── 2. Parse input ─────────────────────────────────────────────────────
  let input: Record<string, unknown> = {};
  try {
    input = await req.json();
  } catch {
    return json({ error: 'Malformed JSON body.' }, 400, origin);
  }

  const productId = typeof input.productId === 'string' ? input.productId.trim() : '';
  const beneficiaryUserId =
    typeof input.beneficiaryUserId === 'string' && input.beneficiaryUserId.trim()
      ? input.beneficiaryUserId.trim()
      : callerUid;
  const preferredGroupCode =
    typeof input.preferredGroupCode === 'string' && input.preferredGroupCode.trim()
      ? input.preferredGroupCode.trim()
      : null;
  const successUrl = typeof input.successUrl === 'string' ? input.successUrl.trim() : undefined;
  const customerEmail =
    typeof input.customerEmail === 'string' && input.customerEmail.trim()
      ? input.customerEmail.trim()
      : callerEmail ?? 'customer@jointhequeue.app';
  const customerName =
    typeof input.customerName === 'string' && input.customerName.trim()
      ? input.customerName.trim()
      : undefined;

  if (!productId) return json({ error: 'productId is required.' }, 400, origin);

  const serviceHeaders: Record<string, string> = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };

  // ── 3. Authoritative product lookup (service role — no client truth) ────
  const productRes = await fetch(
    `${SUPABASE_URL}/rest/v1/subscription_products?id=eq.${encodeURIComponent(
      productId
    )}&is_active=eq.true&select=id,name,monthly_price,currency`,
    { headers: { ...serviceHeaders, Accept: 'application/json' } }
  );
  if (!productRes.ok) {
    console.error('Product lookup failed:', await productRes.text());
    return json({ error: 'Unable to verify subscription product pricing.' }, 500, origin);
  }
  const products = await productRes.json();
  if (!Array.isArray(products) || products.length === 0) {
    return json({ error: 'Subscription product not found or inactive.' }, 404, origin);
  }
  const product = products[0] as {
    id: string;
    name: string;
    monthly_price: number | string;
    currency: string;
  };

  const amount = Number(product.monthly_price);
  if (!Number.isFinite(amount) || amount <= 0) {
    console.error('Invalid product price from database:', product);
    return json({ error: 'Subscription product price is invalid.' }, 500, origin);
  }
  const currency = (product.currency || 'NGN').toUpperCase();
  const reference = randomRef();

  // ── 4. Authoritative pending reservation (30-minute expiry) ─────────────
  const reservationInsert = await fetch(`${SUPABASE_URL}/rest/v1/slot_reservations`, {
    method: 'POST',
    headers: {
      ...serviceHeaders,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      product_id: product.id,
      payer_user_id: callerUid,
      beneficiary_user_id: beneficiaryUserId,
      expected_amount: amount,
      expected_currency: currency,
      reference_id: reference,
      preferred_group_code: preferredGroupCode,
      status: 'pending',
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    }),
  });

  if (!reservationInsert.ok) {
    console.error('Reservation insert failed:', await reservationInsert.text());
    return json({ error: 'Failed to lock a slot reservation. Please try again.' }, 500, origin);
  }
  const reservationRows = await reservationInsert.json();
  const reservationId: string | null = Array.isArray(reservationRows)
    ? (reservationRows[0]?.id ?? null)
    : null;

  // ── 5. Create the Bachs checkout session ───────────────────────────────
  const idempotencyKey = `chk-${reference}`;
  try {
    const bachsRes = await fetch(`${BACHS_API_BASE}/checkout-sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${BACHS_SECRET_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        Accept: 'application/json',
      },
      body: JSON.stringify({
        pricing: { amount: amount.toFixed(2), currency },
        customer: { email: customerEmail, ...(customerName ? { name: customerName } : {}) },
        success_url: successUrl || undefined,
        metadata: {
          reference,
          reservationId: reservationId ?? reference,
          payerUserId: callerUid,
          beneficiaryUserId,
          productId: product.id,
        },
      }),
    });

    const bachsBody = await bachsRes.json().catch(() => ({}));

    if (!bachsRes.ok) {
      console.error('Bachs checkout creation failed:', bachsBody);
      // Roll back the reservation so no stale pending rows linger
      if (reservationId) {
        await fetch(
          `${SUPABASE_URL}/rest/v1/slot_reservations?id=eq.${encodeURIComponent(reservationId)}`,
          { method: 'DELETE', headers: serviceHeaders }
        ).catch((err) => console.warn('Reservation rollback warning:', err));
      }
      const message =
        (bachsBody as Record<string, unknown>)?.message ??
        (bachsBody as Record<string, unknown>)?.error ??
        'Payment provider could not start checkout.';
      return json({ error: String(message) }, 502, origin);
    }

    const body = bachsBody as Record<string, unknown>;
    const checkoutUrl = (body.checkout_url ?? body.url) as string | undefined;
    if (!checkoutUrl) {
      console.error('Bachs response missing checkout_url:', body);
      return json({ error: 'Payment provider returned an invalid response.' }, 502, origin);
    }

    return json(
      { id: body.id ?? null, checkoutUrl, reference, status: body.status ?? 'pending' },
      200,
      origin
    );
  } catch (err) {
    console.error('Bachs request error:', err);
    if (reservationId) {
      await fetch(
        `${SUPABASE_URL}/rest/v1/slot_reservations?id=eq.${encodeURIComponent(reservationId)}`,
        { method: 'DELETE', headers: serviceHeaders }
      ).catch(() => undefined);
    }
    return json({ error: 'Payment provider communication failed.' }, 502, origin);
  }
});
