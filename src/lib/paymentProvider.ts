/**
 * Bachs checkout integration for the frontend.
 *
 * Contract matches the Supabase Edge Function `bachs-create-checkout`:
 *   input:  { productId, beneficiaryUserId?, preferredGroupCode?, successUrl?,
 *             customerEmail?, customerName? }
 *   output: { id, checkoutUrl, reference, status }
 *
 * The frontend never supplies amounts. Prices come from the database, the
 * reservation is created server-side before the checkout session, and
 * success is decided by the webhook callback + reservation status.
 */

import { auth } from './firebase.js';
import { supabase } from './supabase.js';

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
const CHECKOUT_TIMEOUT_MS = 15_000;

export interface StartCheckoutParams {
  productId: string;
  preferredGroupCode?: string;
  successUrl?: string;
  customerEmail?: string;
  customerName?: string;
  durationMonths?: number;
  recipientName?: string;
  recipientEmail?: string;
  recipientPhone?: string;
  giftNote?: string;
}

export type StartCheckoutResult =
  | {
      ok: true;
      reference: string;
      checkoutUrl: string;
      checkoutId?: string;
      status: string;
    }
  | { ok: false; error: string };

async function requireFirebaseToken(): Promise<string> {
  const user = auth?.currentUser;
  if (!user) {
    throw new Error('Sign in before starting checkout.');
  }
  return user.getIdToken();
}

/**
 * Invokes the Edge Function that creates an authoritative pending
 * reservation and a Bachs checkout session.
 */
export async function startBachsCheckout(
  params: StartCheckoutParams
): Promise<StartCheckoutResult> {
  try {
    const token = await requireFirebaseToken();
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), CHECKOUT_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(`${FUNCTIONS_BASE}/bachs-create-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          productId: params.productId,
          preferredGroupCode: params.preferredGroupCode,
          successUrl: params.successUrl,
          customerEmail: params.customerEmail,
          customerName: params.customerName,
          durationMonths: params.durationMonths ?? 1,
          recipientName: params.recipientName,
          recipientEmail: params.recipientEmail,
          recipientPhone: params.recipientPhone,
          giftNote: params.giftNote,
        }),
        signal: controller.signal,
      });
    } finally {
      window.clearTimeout(timeout);
    }

    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;

    if (!res.ok) {
      const message =
        (body?.error as string) ||
        (res.status === 404
          ? 'This payment product is not available yet. Please try again later.'
          : 'Could not start checkout. Please try again or contact support.');
      if (res.status === 401 && auth?.currentUser) {
        // Token may be stale — one forced refresh attempt is handled by callers on next try.
        console.warn('[PaymentProvider] 401 from bachs-create-checkout');
      }
      return { ok: false, error: message };
    }

    const checkoutUrl = body?.checkoutUrl;
    const reference = body?.reference;
    if (!checkoutUrl || !reference) {
      return { ok: false, error: 'Malformed response from checkout server.' };
    }

    return {
      ok: true,
      reference: String(reference),
      checkoutUrl: String(checkoutUrl),
      checkoutId: (body?.id as string) || undefined,
      status: (body?.status as string) ?? 'pending',
    };
  } catch (error: any) {
    console.error('[PaymentProvider] startBachsCheckout failed:', error);
    const message =
      error?.name === 'AbortError'
        ? 'The payment server took too long to respond. Please try again.'
        : error?.message || 'Could not start checkout. Please try again or contact support.';
    return { ok: false, error: message };
  }
}

export type ReservationStatus =
  | 'pending'
  | 'fulfilled'
  | 'expired'
  | 'failed'
  | 'not_found'
  | 'error';

/**
 * Polls the caller's own reservation row (RLS-scoped to the payer or
 * beneficiary) for its fulfillment status. Used to detect webhook-driven
 * activation after a checkout session completes.
 */
export async function fetchReservationStatus(
  referenceId: string
): Promise<{ status: ReservationStatus; updatedAt?: string }> {
  if (!supabase) {
    return { status: 'error' };
  }

  try {
    const { data, error } = await supabase
      .from('slot_reservations')
      .select('status, updated_at')
      .eq('reference_id', referenceId)
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return { status: 'not_found' };
    }

    return {
      status: (data.status as ReservationStatus) ?? 'pending',
      updatedAt: data.updated_at,
    };
  } catch (e) {
    console.warn('[PaymentProvider] reservation status poll failed:', e);
    return { status: 'error' };
  }
}

/**
 * Cancels the caller's own membership server-side (idempotent).
 * Fails closed: missing configuration or permissions return a structured error.
 */
export async function cancelMyMembership(args: {
  membershipId?: string;
  referenceId?: string;
}): Promise<{ cancelled: boolean; persisted: boolean; alreadyCancelled?: boolean; error?: string }> {
  if (!supabase || !auth?.currentUser) {
    return { cancelled: false, persisted: false, error: 'You must be signed in to cancel.' };
  }

  try {
    const { data, error } = await supabase.rpc('cancel_my_membership', {
      p_membership_id: args.membershipId ?? null,
      p_reference_id: args.referenceId ?? null,
    });
    if (error) {
      console.error('[PaymentProvider] cancelMyMembership failed:', error);
      return { cancelled: false, persisted: false, error: error.message };
    }
    const result = (data ?? {}) as {
      cancelled?: boolean;
      persisted?: boolean;
      alreadyCancelled?: boolean;
    };
    return {
      cancelled: result.cancelled ?? true,
      persisted: result.persisted ?? true,
      alreadyCancelled: result.alreadyCancelled,
    };
  } catch (error: any) {
    console.error('[PaymentProvider] cancelMyMembership failed:', error);
    return { cancelled: false, persisted: false, error: error?.message ?? 'Cancellation failed.' };
  }
}
