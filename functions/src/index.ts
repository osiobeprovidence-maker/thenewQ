import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { defineSecret, defineString } from 'firebase-functions/params';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import * as crypto from 'crypto';

if (getApps().length === 0) {
  initializeApp();
}

const BACHS_ENVIRONMENT = defineString('BACHS_ENVIRONMENT', { default: 'sandbox' });

const firebaseAuth = getAuth();
const firestore = getFirestore();

// Server-only secrets, wired through Firebase Secret Manager.
// Set them once with: firebase functions:secrets:set <NAME>
const BACHS_SECRET_KEY_SECRET = defineSecret('BACHS_SECRET_KEY');
const BACHS_WEBHOOK_SECRET_SECRET = defineSecret('BACHS_WEBHOOK_SECRET');
const SUPABASE_SERVICE_ROLE_KEY_SECRET = defineSecret('SUPABASE_SERVICE_ROLE_KEY');
const SUPABASE_URL = defineString('SUPABASE_URL', { default: '' });

/** Secrets any of these functions depend on, regardless of path reached. */
function secretRefs() {
  return [BACHS_SECRET_KEY_SECRET, SUPABASE_SERVICE_ROLE_KEY_SECRET, BACHS_WEBHOOK_SECRET_SECRET];
}

/**
 * Returns the appropriate Bachs API base URL based on BACHS_ENVIRONMENT
 * Defaults to sandbox for security unless explicitly set to 'production' or 'live'.
 */
export function getBachsApiBase(): string {
  const env = BACHS_ENVIRONMENT.value().toLowerCase();
  if (env === 'production' || env === 'live') {
    return 'https://api.bachs.io/v1';
  }
  return 'https://sandbox-api.bachs.io/v1';
}

/**
 * Ensures standard authenticated users receive the 'role: authenticated' claim
 * so Supabase RLS can identify authenticated Firebase tokens.
 */
export const ensureAuthenticatedRole = onCall(
  { region: 'us-central1' },
  async (request) => {
    const caller = request.auth;
    if (!caller) {
      throw new HttpsError('unauthenticated', 'Sign in before syncing your access claim.');
    }

    if (caller.token.firebase?.sign_in_provider === 'anonymous') {
      throw new HttpsError(
        'permission-denied',
        'Anonymous Firebase users cannot receive the authenticated role.'
      );
    }

    const user = await firebaseAuth.getUser(caller.uid);
    if (user.disabled) {
      throw new HttpsError('permission-denied', 'Disabled Firebase users cannot receive this role.');
    }

    const existingClaims = user.customClaims ?? {};
    if (existingClaims.role === 'authenticated') {
      return { role: 'authenticated', claimUpdated: false, isAdmin: Boolean(existingClaims.admin) };
    }

    await firebaseAuth.setCustomUserClaims(user.uid, {
      ...existingClaims,
      role: 'authenticated',
    });

    logger.info(`Assigned the authenticated role claim to Firebase user ${user.uid}.`);
    return { role: 'authenticated', claimUpdated: true, isAdmin: Boolean(existingClaims.admin) };
  }
);

/**
 * Assign or revoke the 'admin: true' custom claim.
 * Only callable by verified super administrators. Ordinary admins cannot create
 * other administrators — use invitations (createAdminInvitation/redeemAdminInvitation)
 * for adding staff accounts.
 */
export const setAdminClaim = onCall(
  { region: 'us-central1' },
  async (request) => {
    const caller = request.auth;
    if (!caller) {
      throw new HttpsError('unauthenticated', 'Caller must be authenticated.');
    }

    // Top-level custom claim on the decoded token
    if (caller.token.superAdmin !== true) {
      throw new HttpsError('permission-denied', 'Only super administrators can manage admin permissions.');
    }

    const targetUid = request.data?.targetUid;
    const makeAdmin = Boolean(request.data?.admin);

    if (!targetUid || typeof targetUid !== 'string') {
      throw new HttpsError('invalid-argument', 'Valid targetUid must be provided.');
    }

    const targetUser = await firebaseAuth.getUser(targetUid);
    const existingClaims = targetUser.customClaims ?? {};

    await firebaseAuth.setCustomUserClaims(targetUid, {
      ...existingClaims,
      role: 'authenticated',
      admin: makeAdmin,
    });

    logger.info(`Admin permission updated for user ${targetUid}: admin=${makeAdmin}`);
    return { success: true, targetUid, admin: makeAdmin };
  }
);

/**
 * Creates an authoritative pending reservation in Supabase and initializes
 * a corresponding Bachs checkout session.
 */
export const createBachsCheckout = onCall(
  {
    region: 'us-central1',
    secrets: [BACHS_SECRET_KEY_SECRET, SUPABASE_SERVICE_ROLE_KEY_SECRET],
  },
  async (request) => {
    const caller = request.auth;
    if (!caller) {
      throw new HttpsError('unauthenticated', 'Sign in before initiating payment checkout.');
    }

    const apiKey = BACHS_SECRET_KEY_SECRET.value();
    if (!apiKey) {
      logger.error('BACHS_SECRET_KEY is not bound to the function.');
      throw new HttpsError('failed-precondition', 'Payment processor is not configured.');
    }

    const supabaseUrl = SUPABASE_URL.value();
    const supabaseServiceKey = SUPABASE_SERVICE_ROLE_KEY_SECRET.value();

    const {
      productId,
      beneficiaryUserId,
      preferredGroupCode,
      successUrl,
      customerEmail,
      customerName,
    } = request.data ?? {};

    if (!productId) {
      throw new HttpsError('invalid-argument', 'Valid productId is required.');
    }

    const payerUserId = caller.uid;
    const resolvedBeneficiary = beneficiaryUserId && typeof beneficiaryUserId === 'string'
      ? beneficiaryUserId.trim()
      : payerUserId;
    const resolvedEmail = customerEmail || caller.token.email || 'customer@jointhequeue.app';

    // 1. Fetch authoritative product price from Supabase using service-role
    let authoritativeProduct: { id: string; name: string; monthly_price: number; currency: string };

    if (supabaseUrl && supabaseServiceKey) {
      const prodRes = await fetch(`${supabaseUrl}/rest/v1/subscription_products?id=eq.${encodeURIComponent(productId)}&is_active=eq.true&select=*`, {
        headers: {
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
          Accept: 'application/json',
        },
      });

      if (!prodRes.ok) {
        throw new HttpsError('internal', 'Unable to verify subscription product pricing.');
      }

      const products = await prodRes.json();
      if (!products || products.length === 0) {
        throw new HttpsError('not-found', 'Active subscription product not found.');
      }
      authoritativeProduct = products[0];
    } else {
      // Never create a Bachs checkout session without an authoritative,
      // reservation-bound price pulled from the database.
      logger.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured; refusing to create checkout session.');
      throw new HttpsError('failed-precondition', 'Payment processor is not configured.');
    }

    const expectedAmount = Number(authoritativeProduct.monthly_price);
    const expectedCurrency = (authoritativeProduct.currency || 'USD').toUpperCase();
    const reference = `JTQ-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const idempotencyKey = `chk-${reference}`;

    // 2. Insert authoritative pending reservation record in Supabase.
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new HttpsError('failed-precondition', 'Payment processor is not configured.');
    }

    let reservationId: string | null = null;
    {
      const insertRes = await fetch(`${supabaseUrl}/rest/v1/slot_reservations`, {
        method: 'POST',
        headers: {
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          product_id: authoritativeProduct.id,
          payer_user_id: payerUserId,
          beneficiary_user_id: resolvedBeneficiary,
          expected_amount: expectedAmount,
          expected_currency: expectedCurrency,
          reference_id: reference,
          preferred_group_code: preferredGroupCode || null,
          status: 'pending',
          expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        }),
      });

      if (!insertRes.ok) {
        logger.error('Failed to create reservation record in Supabase:', await insertRes.text());
        throw new HttpsError('internal', 'Failed to lock slot reservation before checkout.');
      }

      const inserted = await insertRes.json();
      reservationId = inserted[0]?.id;
    }

    // 3. Create checkout session with Bachs API
    try {
      const apiBase = getBachsApiBase();
      const payload = {
        pricing: {
          amount: expectedAmount.toFixed(2),
          currency: expectedCurrency,
        },
        customer: {
          email: resolvedEmail,
          ...(customerName ? { name: customerName } : {}),
        },
        success_url: successUrl || undefined,
        metadata: {
          reference,
          reservationId: reservationId || reference,
          payerUserId,
          beneficiaryUserId: resolvedBeneficiary,
          productId: authoritativeProduct.id,
        },
      };

      const response = await fetch(`${apiBase}/checkout-sessions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const responseData = await response.json().catch(() => ({}));

      if (!response.ok) {
        logger.error('Bachs API checkout creation error:', responseData);
        // Rollback reservation on failure so stale pending records don't linger
        if (supabaseUrl && supabaseServiceKey && reservationId) {
          await fetch(`${supabaseUrl}/rest/v1/slot_reservations?id=eq.${encodeURIComponent(reservationId)}`, {
            method: 'DELETE',
            headers: {
              apikey: supabaseServiceKey,
              Authorization: `Bearer ${supabaseServiceKey}`,
            },
          }).catch((err) => logger.warn('Reservation rollback warning:', err));
        }

        throw new HttpsError(
          'internal',
          responseData.message || responseData.error || 'Failed to initialize checkout session with Bachs.'
        );
      }

      logger.info(`Bachs checkout session initialized successfully for ref ${reference}, session: ${responseData.id}`);
      return {
        id: responseData.id,
        checkoutUrl: responseData.checkout_url || responseData.url,
        reference,
        status: responseData.status,
      };
    } catch (err: any) {
      if (err instanceof HttpsError) throw err;
      logger.error('Bachs checkout unexpected failure:', err);
      throw new HttpsError('internal', err.message || 'Payment provider communication error.');
    }
  }
);

/**
 * Validates Bachs webhook signature supporting both X-Bachs-Signature (hex) and X-Bachs-Signature-V2
 */
export function verifyBachsWebhookSignature(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
  secret: string
): { isValid: boolean; timestamp: number; error?: string } {
  const sigHeader = (headers['x-bachs-signature'] || headers['X-Bachs-Signature']) as string;
  const sigV2Header = (headers['x-bachs-signature-v2'] || headers['X-Bachs-Signature-V2']) as string;
  const timeHeader = (headers['x-bachs-timestamp'] || headers['X-Bachs-Timestamp']) as string;

  let timestampStr = timeHeader;
  let signatureToVerify = sigHeader;

  // Support V2 structured header: t={timestamp},v1={signature}
  if (sigV2Header && typeof sigV2Header === 'string') {
    const parts = sigV2Header.split(',');
    for (const part of parts) {
      const [key, val] = part.split('=');
      if (key?.trim() === 't' && !timestampStr) {
        timestampStr = val?.trim();
      } else if (key?.trim() === 'v1' && !signatureToVerify) {
        signatureToVerify = val?.trim();
      }
    }
  }

  if (!signatureToVerify || !timestampStr) {
    return { isValid: false, timestamp: 0, error: 'Missing signature or timestamp header' };
  }

  const timestamp = parseInt(timestampStr, 10);
  const nowInSeconds = Math.floor(Date.now() / 1000);

  if (isNaN(timestamp) || Math.abs(nowInSeconds - timestamp) > 300) {
    return { isValid: false, timestamp, error: 'Timestamp outside 300s replay tolerance window' };
  }

  const signedPayload = `${timestampStr}.${rawBody}`;
  const computedSignature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  const expectedBuffer = Buffer.from(computedSignature, 'utf8');
  const headerBuffer = Buffer.from(signatureToVerify, 'utf8');

  if (
    expectedBuffer.length !== headerBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, headerBuffer)
  ) {
    return { isValid: false, timestamp, error: 'Invalid HMAC-SHA256 signature' };
  }

  return { isValid: true, timestamp };
}

/**
 * Secure Bachs Webhook Handler
 * Verifies HMAC-SHA256 signature, ensures idempotency, confirms payments canonically with Bachs,
 * and calls the Supabase atomic fulfillment RPC via service_role.
 */
export const bachsWebhook = onRequest(
  {
    region: 'us-central1',
    secrets: [BACHS_SECRET_KEY_SECRET, BACHS_WEBHOOK_SECRET_SECRET, SUPABASE_SERVICE_ROLE_KEY_SECRET],
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const webhookSecret = BACHS_WEBHOOK_SECRET_SECRET.value();
    if (!webhookSecret) {
      logger.error('BACHS_WEBHOOK_SECRET is not configured in backend environment.');
      res.status(500).send('Webhook processor not configured');
      return;
    }

    // 1. Untouched raw body
    const rawBody = (req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body)) || '';

    // 2. Cryptographic signature and replay protection check
    const verification = verifyBachsWebhookSignature(rawBody, req.headers as any, webhookSecret);
    if (!verification.isValid) {
      logger.warn(`Rejected webhook verification: ${verification.error}`);
      res.status(400).send(verification.error);
      return;
    }

    // 3. Parse verified JSON payload
    let event: any;
    try {
      event = JSON.parse(rawBody);
    } catch (parseError) {
      logger.error('Failed to parse webhook JSON payload:', parseError);
      res.status(400).send('Malformed JSON');
      return;
    }

    const eventId = event?.id;
    const eventType = event?.type;

    if (!eventId || !eventType) {
      res.status(400).send('Invalid event format');
      return;
    }

    logger.info(`Received verified Bachs webhook event ${eventId} of type ${eventType}`);

    // 4. Safe transaction lifecycle with Firestore lease
    const eventDocRef = firestore.collection('processed_bachs_events').doc(eventId);

    const leaseAcquired = await firestore.runTransaction(async (transaction) => {
      const doc = await transaction.get(eventDocRef);
      if (doc.exists) {
        const data = doc.data();
        if (data?.status === 'completed') {
          return { shouldProcess: false, reason: 'already_completed' };
        }
        // Concurrency lock (30s)
        if (data?.status === 'processing') {
          const updatedAt = data.updatedAt?.toMillis ? data.updatedAt.toMillis() : 0;
          if (Date.now() - updatedAt < 30000) {
            return { shouldProcess: false, reason: 'concurrency_lock' };
          }
        }
      }

      transaction.set(
        eventDocRef,
        {
          eventId,
          eventType,
          status: 'processing',
          receivedAt: doc.exists ? doc.data()?.receivedAt : Timestamp.now(),
          updatedAt: Timestamp.now(),
        },
        { merge: true }
      );

      return { shouldProcess: true };
    });

    if (!leaseAcquired.shouldProcess) {
      logger.info(`Event ${eventId} skipped (${leaseAcquired.reason}). Returning 200.`);
      res.status(200).json({ received: true, status: leaseAcquired.reason });
      return;
    }

    try {
      // 5. Event Dispatcher & Canonical Verification
      switch (eventType) {
        case 'checkout.completed': {
          const checkoutId = event.data?.checkout_id;
          if (!checkoutId) {
            throw new Error('checkout.completed event missing checkout_id');
          }

          // Retrieve definitive server-side checkout session from Bachs
          const apiKey = BACHS_SECRET_KEY_SECRET.value();
          const apiBase = getBachsApiBase();
          const checkoutRes = await fetch(`${apiBase}/checkout-sessions/${encodeURIComponent(checkoutId)}`, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              Accept: 'application/json',
            },
          });

          if (!checkoutRes.ok) {
            throw new Error(`Failed to fetch canonical checkout session from Bachs: ${checkoutRes.statusText}`);
          }

          const session = await checkoutRes.json();
          const reference = session.metadata?.reference;
          const status = session.status;
          const amount = Number(session.pricing?.amount);
          const currency = (session.pricing?.currency || 'USD').toUpperCase();

          // Reject non-success session states
          if (status !== 'completed' && status !== 'paid' && status !== 'succeeded') {
            logger.warn(`Checkout session ${checkoutId} non-successful status: ${status}`);
            await eventDocRef.update({
              status: 'failed',
              error: `Non-successful session status: ${status}`,
              updatedAt: Timestamp.now(),
            });
            res.status(200).json({ received: true, status: 'unfulfilled_non_success_status' });
            return;
          }

          // Execute atomic fulfillment RPC in Supabase via service_role.
          // Fail closed: if anything required is missing, throw so Bachs retries,
          // rather than silently marking a paid event completed.
          if (!reference) {
            throw new Error('checkout.completed missing reservation reference (session.metadata.reference).');
          }

          const supabaseUrl = SUPABASE_URL.value();
          const supabaseServiceKey = SUPABASE_SERVICE_ROLE_KEY_SECRET.value();

          if (!supabaseUrl || !supabaseServiceKey) {
            throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured; cannot fulfill payment.');
          }

          const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/fulfill_bachs_reservation`, {
            method: 'POST',
            headers: {
              apikey: supabaseServiceKey,
              Authorization: `Bearer ${supabaseServiceKey}`,
              'Content-Type': 'application/json',
            },
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
            logger.error(`Supabase fulfillment RPC failure for ${reference}:`, rpcError);
            throw new Error(`Supabase fulfillment failed: ${rpcError}`);
          }

          const rpcResult = await rpcRes.json();
          logger.info(`Supabase fulfillment success for ${reference}:`, rpcResult);

          // Mark event completed in Firestore
          await eventDocRef.update({
            status: 'completed',
            checkoutId,
            reference: reference || null,
            updatedAt: Timestamp.now(),
          });
          break;
        }

        case 'customer.subscription.created':
        case 'customer.subscription.updated': {
          logger.info(`Subscription event ${eventType} recorded:`, event.data);
          await eventDocRef.update({
            status: 'completed',
            updatedAt: Timestamp.now(),
          });
          break;
        }

        case 'customer.subscription.deleted': {
          logger.info(`Subscription cancellation recorded:`, event.data);
          await eventDocRef.update({
            status: 'completed',
            updatedAt: Timestamp.now(),
          });
          break;
        }

        default: {
          logger.info(`Unhandled event type: ${eventType}`);
          await eventDocRef.update({
            status: 'completed',
            updatedAt: Timestamp.now(),
          });
          break;
        }
      }

      res.status(200).json({ received: true, processed: true });
    } catch (handlerError: any) {
      logger.error(`Error processing webhook event ${eventId}:`, handlerError);
      await eventDocRef.update({
        status: 'failed',
        error: handlerError.message || String(handlerError),
        updatedAt: Timestamp.now(),
      });
      res.status(500).send('Webhook processing error');
    }
  }
);

/**
 * ============================================================================
 * ADMIN RBAC — superAdmin / admin / support hierarchy
 * ----------------------------------------------------------------------------
 * Custom claims (Firebase top-level JWT claims, mirrored into Supabase RLS):
 *   superAdmin: true  — full authority; bootstrap only (designated accounts)
 *   admin: true       — operational administration (invite/revoke is superAdmin-only)
 *   support: true     — restricted customer-service scope
 *   role: 'authenticated' — baseline for all signed-in users (unchanged)
 *
 * Security model:
 *   - Super Admins are bootstrapped exclusively from the two designated Google
 *     accounts below, only after cryptographically verified Google sign-in
 *     (provider === 'google.com', email_verified === true).
 *   - All other staff are granted claims only by existing super admins, either
 *     directly (setAdminClaim, superAdmin-only) or through audited invitations.
 *   - Invitation redemption re-verifies the caller's Google identity before
 *     granting any role.
 *   - Every invitation / redemption / role change / revocation is recorded in
 *     the Firestore 'admin_audit_log' collection.
 * ==========================================================================
 */

export const SUPER_ADMIN_EMAILS = ['riderezzy@gmail.com', 'osiobeprovidence@gmail.com'] as const;

const STAFF_ROLES = ['admin', 'support'] as const;
type StaffRole = (typeof STAFF_ROLES)[number];

export function normalizeEmail(email: unknown): string {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

/** True when the caller's token proves a verified Google account sign-in. */
export function isGoogleVerifiedAccount(token: any): boolean {
  const provider = token?.firebase?.sign_in_provider;
  const email = normalizeEmail(token?.email);
  const emailVerified = token?.email_verified === true;
  return provider === 'google.com' && email.length > 0 && emailVerified;
}

/** True when the (normalized) email belongs to a designated initial super admin. */
export function isBootstrapSuperAdminEmail(email: unknown): boolean {
  const normalized = normalizeEmail(email);
  return (SUPER_ADMIN_EMAILS as readonly string[]).includes(normalized);
}

export function parseStaffRole(input: unknown): StaffRole | null {
  if (input === 'admin' || input === 'support') return input;
  return null;
}

export function isValidInvitationEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;
}

/** Grant-merge: preserves unrelated claims, adds role claim + baseline role. */
export function mergeClaimsForGrant(existing: Record<string, any> | undefined, role: StaffRole | 'superAdmin') {
  const base: Record<string, any> = { ...(existing ?? {}), role: 'authenticated' };
  if (role === 'superAdmin') return { ...base, superAdmin: true, admin: true };
  if (role === 'admin') return { ...base, admin: true };
  return { ...base, support: true };
}

/** Revoke-merge: clears ONLY the requested role claim; superAdmin stays untouched. */
export function mergeClaimsForRevoke(existing: Record<string, any> | undefined, role: StaffRole) {
  const base: Record<string, any> = { ...(existing ?? {}) };
  if (role === 'admin') base.admin = false;
  if (role === 'support') base.support = false;
  return base;
}

const INVITATION_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateInvitationCode(): string {
  const random = crypto.randomBytes(8);
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += INVITATION_CODE_ALPHABET[random[i] % INVITATION_CODE_ALPHABET.length];
  }
  return `INV-${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Writes an immutable audit entry. Failures abort the calling operation. */
async function writeAdminAuditLog(entry: {
  type: string;
  actorUid: string;
  actorEmail: string;
  targetEmail?: string | null;
  targetUid?: string | null;
  role?: string | null;
  invitationId?: string | null;
  details?: Record<string, any> | null;
}) {
  const record = {
    ...entry,
    actorEmail: normalizeEmail(entry.actorEmail),
    targetEmail: entry.targetEmail ? normalizeEmail(entry.targetEmail) : null,
    createdAt: Timestamp.now(),
  };
  try {
    await firestore.collection('admin_audit_log').add(record);
  } catch (error) {
    logger.error('Failed to write admin audit log:', error);
    throw new HttpsError('internal', 'Administrative audit logging failed. The operation was aborted.');
  }
}

function requireSuperAdmin(request: any): void {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in before calling administrative functions.');
  }
  if (request.auth.token?.superAdmin !== true) {
    throw new HttpsError('permission-denied', 'Only super administrators can perform this action.');
  }
}

function requirePrivilegedStaff(request: any): void {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in before calling administrative functions.');
  }
  const token = request.auth.token ?? {};
  if (token.superAdmin !== true && token.admin !== true) {
    throw new HttpsError('permission-denied', 'Administrator privileges are required for this action.');
  }
}

/**
 * One-time, self-service bootstrap for the two designated initial super admin
 * accounts. Any caller may invoke it, but Google-verified identity with a
 * matching designated email is required to receive the claim. Everyone else
 * gets permission-denied and learns nothing about the allowlist.
 */
export const bootstrapSuperAdmin = onCall(
  { region: 'us-central1' },
  async (request) => {
    const caller = request.auth;
    if (!caller) {
      throw new HttpsError('unauthenticated', 'Sign in with Google before claiming super admin access.');
    }

    const token = caller.token as any;
    if (!isGoogleVerifiedAccount(token)) {
      throw new HttpsError('permission-denied', 'A verified Google account is required for super admin access.');
    }

    const email = normalizeEmail(token?.email);
    if (!isBootstrapSuperAdminEmail(email)) {
      throw new HttpsError('permission-denied', 'This account is not authorized for super admin access.');
    }

    const user = await firebaseAuth.getUser(caller.uid);
    const existingClaims = (user.customClaims ?? {}) as Record<string, any>;

    if (existingClaims.superAdmin === true) {
      return { granted: true, alreadyGranted: true, email };
    }

    await firebaseAuth.setCustomUserClaims(caller.uid, mergeClaimsForGrant(existingClaims, 'superAdmin'));
    await writeAdminAuditLog({
      type: 'bootstrap_super_admin',
      actorUid: caller.uid,
      actorEmail: email,
      details: { channel: 'initial_designated_accounts' },
    });

    logger.info(`Super admin bootstrap granted to designated account ${caller.uid}.`);
    return { granted: true, alreadyGranted: false, email };
  }
);

/**
 * Super admins invite staff by email + role. No email is sent by the platform;
 * the caller shares the returned invitation code out-of-band. The claim is only
 * ever granted by redeemAdminInvitation after the invitee verifies their Google
 * identity. The returned code is shown once to the inviting admin.
 */
export const createAdminInvitation = onCall(
  { region: 'us-central1' },
  async (request) => {
    requireSuperAdmin(request);

    const rawEmail = normalizeEmail(request.data?.email);
    const role = parseStaffRole(request.data?.role);
    const note = typeof request.data?.note === 'string' ? request.data.note.trim().slice(0, 280) : '';

    if (!isValidInvitationEmail(rawEmail)) {
      throw new HttpsError('invalid-argument', 'A valid email address is required.');
    }
    if (!role) {
      throw new HttpsError('invalid-argument', "Role must be either 'admin' or 'support'. Super admin cannot be granted by invitation.");
    }

    // Reuse an existing pending invitation for the same email instead of duplicating it.
    const existing = await firestore
      .collection('admin_invitations')
      .where('emailNormalized', '==', rawEmail)
      .where('status', '==', 'pending')
      .limit(1)
      .get();

    if (!existing.empty) {
      const doc = existing.docs[0];
      const data = doc.data();
      return {
        invitationId: doc.id,
        email: rawEmail,
        role: data.role,
        status: 'pending',
        code: data.code,
        expiresAt: data.expiresAt?.toMillis ? data.expiresAt.toMillis() : null,
        reused: true,
      };
    }

    const code = generateInvitationCode();
    const expiresAt = Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const docRef = await firestore.collection('admin_invitations').add({
      emailNormalized: rawEmail,
      role,
      note: note || null,
      status: 'pending',
      code,
      invitedByUid: callerUidOf(request),
      invitedByEmail: normalizeEmail(request.auth?.token?.email),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      expiresAt,
    });

    await writeAdminAuditLog({
      type: 'invitation_created',
      actorUid: callerUidOf(request),
      actorEmail: normalizeEmail(request.auth?.token?.email),
      targetEmail: rawEmail,
      role,
      invitationId: docRef.id,
    });

    return { invitationId: docRef.id, email: rawEmail, role, status: 'pending', code, expiresAt: expiresAt.toMillis(), reused: false };
  }
);

function callerUidOf(request: any): string {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Sign in before calling this function.');
  }
  return request.auth.uid;
}

/** Lists recent invitations for super admins (most recent first). */
export const listAdminInvitations = onCall(
  { region: 'us-central1' },
  async (request) => {
    requireSuperAdmin(request);

    const snapshot = await firestore
      .collection('admin_invitations')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    return {
      invitations: snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          invitationId: doc.id,
          email: data.emailNormalized,
          role: data.role,
          note: data.note ?? null,
          status: data.status,
          code: data.code ?? null,
          invitedByEmail: data.invitedByEmail ?? null,
          createdAt: data.createdAt?.toMillis ? data.createdAt.toMillis() : null,
          expiresAt: data.expiresAt?.toMillis ? data.expiresAt.toMillis() : null,
          acceptedAt: data.acceptedAt?.toMillis ? data.acceptedAt.toMillis() : null,
        };
      }),
    };
  }
);

/** Revokes a pending invitation so it can never be redeemed. Super admin only. */
export const revokeAdminInvitation = onCall(
  { region: 'us-central1' },
  async (request) => {
    requireSuperAdmin(request);

    const invitationId = typeof request.data?.invitationId === 'string' ? request.data.invitationId.trim() : '';
    if (!invitationId) {
      throw new HttpsError('invalid-argument', 'invitationId is required.');
    }

    const docRef = firestore.collection('admin_invitations').doc(invitationId);
    const doc = await docRef.get();
    if (!doc.exists) {
      throw new HttpsError('not-found', 'Invitation not found.');
    }

    const data = doc.data()!;
    if (data.status !== 'pending') {
      return { revoked: false, status: data.status, message: `Only pending invitations can be revoked (current status: ${data.status}).` };
    }

    await docRef.update({ status: 'revoked', updatedAt: Timestamp.now(), revokedByUid: callerUidOf(request) });

    await writeAdminAuditLog({
      type: 'invitation_revoked',
      actorUid: callerUidOf(request),
      actorEmail: normalizeEmail(request.auth?.token?.email),
      targetEmail: data.emailNormalized,
      role: data.role,
      invitationId,
    });

    return { revoked: true, status: 'revoked' };
  }
);

/**
 * The invited person redeems their invitation by signing in (Google, verified
 * email) with the invited address. The role claim is granted here — never from
 * the client, never from email comparison in the UI.
 */
export const redeemAdminInvitation = onCall(
  { region: 'us-central1' },
  async (request) => {
    const caller = request.auth;
    if (!caller) {
      throw new HttpsError('unauthenticated', 'Sign in with the invited Google account to redeem your invitation.');
    }

    const token = caller.token as any;
    if (!isGoogleVerifiedAccount(token)) {
      throw new HttpsError('permission-denied', 'A verified Google account is required to redeem this invitation.');
    }

    const email = normalizeEmail(token?.email);

    const snapshot = await firestore
      .collection('admin_invitations')
      .where('emailNormalized', '==', email)
      .where('status', '==', 'pending')
      .limit(1)
      .get();

    if (snapshot.empty) {
      throw new HttpsError('failed-precondition', 'No pending invitation exists for this account.');
    }

    const doc = snapshot.docs[0];
    const data = doc.data();

    if (data.expiresAt && data.expiresAt.toMillis() < Date.now()) {
      await doc.ref.update({ status: 'expired', updatedAt: Timestamp.now() });
      throw new HttpsError('failed-precondition', 'This invitation has expired. Ask a super administrator to send a new one.');
    }

    const role = parseStaffRole(data.role);
    if (!role) {
      throw new HttpsError('internal', 'The invitation carries an invalid role and cannot be redeemed.');
    }

    const user = await firebaseAuth.getUser(caller.uid);
    const existingClaims = (user.customClaims ?? {}) as Record<string, any>;

    await firebaseAuth.setCustomUserClaims(caller.uid, mergeClaimsForGrant(existingClaims, role));
    await doc.ref.update({
      status: 'accepted',
      acceptedByUid: caller.uid,
      acceptedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });

    await writeAdminAuditLog({
      type: 'invitation_redeemed',
      actorUid: caller.uid,
      actorEmail: email,
      targetEmail: email,
      role,
      invitationId: doc.id,
    });

    return { granted: true, role };
  }
);

/**
 * Member self-service cancellation of their own membership.
 * Callable by any authenticated user; membership must belong to the caller.
 * Marks payment_status = 'Cancelled' and status = 'cancelled' and writes an audit entry.
 */
export const cancelMyMembership = onCall(
  {
    region: 'us-central1',
    secrets: [SUPABASE_SERVICE_ROLE_KEY_SECRET],
  },
  async (request) => {
    const caller = request.auth;
    if (!caller) {
      throw new HttpsError('unauthenticated', 'Sign in before cancelling a membership.');
    }

    const membershipId = typeof request.data?.membershipId === 'string' ? request.data.membershipId.trim() : '';
    const referenceId = typeof request.data?.referenceId === 'string' ? request.data.referenceId.trim() : '';

    if (!membershipId && !referenceId) {
      throw new HttpsError('invalid-argument', 'Either membershipId or referenceId is required.');
    }

    const supabaseUrl = SUPABASE_URL.value();
    const supabaseServiceKey = SUPABASE_SERVICE_ROLE_KEY_SECRET.value();

    if (!supabaseUrl || !supabaseServiceKey) {
      logger.warn('Cancel membership: Supabase not configured, skipping database write.');
      return { cancelled: true, persisted: false };
    }

    // Fetch membership and verify ownership
    const query = membershipId
      ? `id=eq.${encodeURIComponent(membershipId)}`
      : `reference_id=eq.${encodeURIComponent(referenceId)}`;
    const fetchRes = await fetch(
      `${supabaseUrl}/rest/v1/slot_memberships?${query}&select=id,reference_id,payer_user_id,status,payment_status`,
      {
        headers: {
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
          Accept: 'application/json',
        },
      }
    );

    if (!fetchRes.ok) {
      throw new HttpsError('internal', 'Could not read membership record.');
    }
    const rows = await fetchRes.json();
    const membership = Array.isArray(rows) ? rows[0] : null;

    if (!membership) {
      throw new HttpsError('not-found', 'Membership not found.');
    }
    const isPayer = membership.payer_user_id === caller.uid;
    const isBeneficiary = membership.beneficiary_user_id === caller.uid;
    if (!isPayer && !isBeneficiary) {
      throw new HttpsError('permission-denied', 'This membership does not belong to your account.');
    }
    if (membership.status === 'cancelled') {
      return { cancelled: true, persisted: true, alreadyCancelled: true };
    }

    const updateRes = await fetch(
      `${supabaseUrl}/rest/v1/slot_memberships?id=eq.${encodeURIComponent(membership.id)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          status: 'cancelled',
          payment_status: 'Cancelled',
        }),
      }
    );

    if (!updateRes.ok) {
      throw new HttpsError('internal', 'Could not cancel the membership.');
    }

    const updated = await updateRes.json();

    await writeAdminAuditLog({
      type: 'membership_cancelled',
      actorUid: caller.uid,
      actorEmail: normalizeEmail(caller.token?.email),
      targetEmail: null,
      targetUid: caller.uid,
      details: {
        membership_id: membership.id,
        reference_id: membership.reference_id ?? referenceId,
      },
    });

    return { cancelled: true, persisted: true, membership: updated[0] ?? null };
  }
);

/**
 * Super admins revoke admin or support access from staff accounts.
 * Cannot target yourself, cannot target a super admin, and can never grant or
 * revoke superAdmin (that is reserved for the bootstrap process only).
 */
export const revokeAdminAccess = onCall(
  { region: 'us-central1' },
  async (request) => {
    requireSuperAdmin(request);

    const targetUid = typeof request.data?.targetUid === 'string' ? request.data.targetUid.trim() : '';
    const role = parseStaffRole(request.data?.role);

    if (!targetUid || !role) {
      throw new HttpsError('invalid-argument', "targetUid and a valid role ('admin' or 'support') are required.");
    }
    if (targetUid === callerUidOf(request)) {
      throw new HttpsError('invalid-argument', 'You cannot revoke your own access. Ask the other super administrator.');
    }

    const targetUser = await firebaseAuth.getUser(targetUid);
    const existingClaims = (targetUser.customClaims ?? {}) as Record<string, any>;

    if (existingClaims.superAdmin === true) {
      throw new HttpsError('permission-denied', 'Super administrator access cannot be revoked from this console.');
    }

    await firebaseAuth.setCustomUserClaims(targetUid, mergeClaimsForRevoke(existingClaims, role));

    await writeAdminAuditLog({
      type: 'access_revoked',
      actorUid: callerUidOf(request),
      actorEmail: normalizeEmail(request.auth?.token?.email),
      targetUid,
      targetEmail: normalizeEmail((targetUser as any)?.email) || null,
      role,
    });

    return { revoked: true, role, targetUid };
  }
);

/** Lists users that currently hold admin / support / superAdmin claims. Super admin only. */
export const listStaffUsers = onCall(
  { region: 'us-central1' },
  async (request) => {
    requireSuperAdmin(request);

    const staff: Array<Record<string, any>> = [];
    let nextPageToken: string | undefined;

    do {
      const page = await firebaseAuth.listUsers(1000, nextPageToken);
      for (const user of page.users) {
        const claims = (user.customClaims ?? {}) as Record<string, any>;
        if (claims.superAdmin === true || claims.admin === true || claims.support === true) {
          staff.push({
            uid: user.uid,
            email: normalizeEmail(user.email) || null,
            disabled: user.disabled,
            superAdmin: claims.superAdmin === true,
            admin: claims.admin === true,
            support: claims.support === true,
          });
        }
      }
      nextPageToken = page.pageToken;
    } while (nextPageToken);

    staff.sort((a, b) => Number(b.superAdmin) - Number(a.superAdmin));
    return { staff };
  }
);

/**
 * Whether the currently signed-in user has a pending staff invitation bound to their email.
 * Safe for all callers — only the caller's own record is consulted; non-pending invites are ignored.
 */
export const checkMyPendingStaffInvitation = onCall(
  { region: 'us-central1' },
  async (request) => {
    const caller = request.auth;
    if (!caller) {
      return { pending: false as const };
    }
    const email = normalizeEmail((caller.token as any)?.email);
    if (!email) {
      return { pending: false as const };
    }

    const snapshot = await firestore
      .collection('admin_invitations')
      .where('emailNormalized', '==', email)
      .where('status', '==', 'pending')
      .limit(1)
      .get();

    if (snapshot.empty) {
      return { pending: false as const };
    }
    const data = snapshot.docs[0].data();
    return {
      pending: true as const,
      role: parseStaffRole(data.role) ?? ('admin' as const),
      invitationId: snapshot.docs[0].id,
    };
  }
);

/** Reads the most recent administrative audit log entries. Super admins and admins only. */
export const listAdminAuditLog = onCall(
  { region: 'us-central1' },
  async (request) => {
    requirePrivilegedStaff(request);

    const snapshot = await firestore
      .collection('admin_audit_log')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    return {
      entries: snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          type: data.type ?? 'unknown',
          actorEmail: data.actorEmail ?? null,
          targetEmail: data.targetEmail ?? null,
          targetUid: data.targetUid ?? null,
          role: data.role ?? null,
          invitationId: data.invitationId ?? null,
          createdAt: data.createdAt?.toMillis ? data.createdAt.toMillis() : null,
        };
      }),
    };
  }
);
