/**
 * Bachs checkout integration for the frontend.
 *
 * Contract matches the backend callable `createBachsCheckout`:
 *   input:  { productId, beneficiaryUserId?, preferredGroupCode?, successUrl?,
 *             customerEmail?, customerName? }
 *   output: { id, checkoutUrl, reference, status }
 *
 * The frontend never supplies amounts. Prices come from the database, the
 * reservation is created server-side before the checkout session, and
 * success is decided by the webhook callback + reservation status.
 */

import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from './firebase.js';
import { supabase } from './supabase.js';

export interface StartCheckoutParams {
  productId: string;
  beneficiaryUserId?: string;
  preferredGroupCode?: string;
  successUrl?: string;
  customerEmail?: string;
  customerName?: string;
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

/**
 * Invokes the backend callable that creates an authoritative pending
 * reservation and a Bachs checkout session.
 */
export async function startBachsCheckout(
  params: StartCheckoutParams
): Promise<StartCheckoutResult> {
  if (!app) {
    return { ok: false, error: 'Firebase is not configured.' };
  }

  try {
    const functions = getFunctions(app, 'us-central1');
    const createBachsCheckout = httpsCallable<
      StartCheckoutParams,
      { id: string; checkoutUrl: string; reference: string; status: string }
    >(functions, 'createBachsCheckout');

    const result = await createBachsCheckout({
      productId: params.productId,
      beneficiaryUserId: params.beneficiaryUserId,
      preferredGroupCode: params.preferredGroupCode,
      successUrl: params.successUrl,
      customerEmail: params.customerEmail,
      customerName: params.customerName,
    });

    const data = result.data;
    if (!data?.checkoutUrl || !data.reference) {
      return { ok: false, error: 'Malformed response from checkout server.' };
    }

    return {
      ok: true,
      reference: data.reference,
      checkoutUrl: data.checkoutUrl,
      checkoutId: data.id,
      status: data.status ?? 'pending',
    };
  } catch (error: any) {
    console.error('[PaymentProvider] createBachsCheckout failed:', error);
    const message =
      error?.message ||
      'Could not start checkout. Please try again or contact support.';
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
  if (!app) {
    return { cancelled: true, persisted: false, error: 'Firebase is not configured.' };
  }

  try {
    const functions = getFunctions(app, 'us-central1');
    const cancel = httpsCallable<
      { membershipId?: string; referenceId?: string },
      { cancelled: boolean; persisted: boolean; alreadyCancelled?: boolean }
    >(functions, 'cancelMyMembership');

    const result = await cancel(args);
    return result.data;
  } catch (error: any) {
    console.error('[PaymentProvider] cancelMyMembership failed:', error);
    return { cancelled: false, persisted: false, error: error?.message ?? 'Cancellation failed.' };
  }
}
