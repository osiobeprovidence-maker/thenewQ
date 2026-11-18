/**
 * Platform data — everything the admin dashboard shows comes from these
 * database reads. No hardcoded figures, no demo seeds.
 *
 *   * payment_transactions  → Financials ledger & revenue KPIs
 *   * slot_memberships     → Subscription statistics (real user subscriptions)
 *   * subscription_products→ Available Plans (admin-managed catalog)
 */
import { auth } from './firebase.js';
import { supabase } from './supabase.js';
import type { PlatformTransaction } from '../types/subscription';

export interface SubscriptionStats {
  total: number;
  active: number;
  pending: number;
  cancelled: number;
  expired: number;
}

function requireSupabase() {
  if (!supabase) {
    throw new Error('Supabase client is not configured.');
  }
  return supabase;
}

async function requireFirebaseToken(): Promise<string> {
  const user = auth?.currentUser;
  if (!user) {
    throw new Error('Sign in to manage the platform catalog.');
  }
  return user.getIdToken();
}

/** Real provider payments, outstanding checkout attempts, and staff-recorded collections. */
export async function fetchPaymentTransactions(): Promise<PlatformTransaction[]> {
  const sb = requireSupabase();

  const { data: rows, error } = await sb
    .from('payment_transactions')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const txs = (rows ?? []) as Array<Record<string, unknown>>;

  // These two tables are populated by server-side checkout and staff collection flows.
  // They are queried separately so a schema/RLS rollout issue does not hide provider records.
  const manualResult = await sb
    .from('manual_payment_entries')
    .select('*')
    .order('created_at', { ascending: false });
  if (manualResult.error) console.warn('Could not load manually recorded collections:', manualResult.error.message);
  const manualRows = (manualResult.data ?? []) as Array<Record<string, unknown>>;

  const reservationResult = await sb
    .from('slot_reservations')
    .select('id, product_id, payer_user_id, expected_amount, expected_currency, reference_id, preferred_group_code, status, created_at')
    .in('status', ['pending', 'failed', 'expired'])
    .order('created_at', { ascending: false });
  if (reservationResult.error) console.warn('Could not load pending checkout reservations:', reservationResult.error.message);
  const reservationRows = (reservationResult.data ?? []) as Array<Record<string, unknown>>;

  // Member display names
  const userIds = [
    ...new Set([...txs, ...manualRows, ...reservationRows]
      .map((t) => t.payer_user_id as string)
      .filter(Boolean)),
  ];
  const profileByName = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles, error: profError } = await sb
      .from('profiles')
      .select('user_id, display_name, username')
      .in('user_id', userIds);
    if (!profError && profiles) {
      for (const p of profiles as Array<Record<string, unknown>>) {
        const name =
          (p.display_name as string) || (p.username as string) || 'Member';
        profileByName.set(p.user_id as string, name);
      }
    }
  }

  // Group codes for payments that carry a slot reference
  const slotIds = [
    ...new Set(
      [...txs, ...manualRows]
        .map((t) => ((t.metadata as Record<string, unknown>)?.slot_id as string) ?? (t.slot_id as string) ?? null)
        .filter(Boolean) as string[]
    ),
  ];
  const slotCode = new Map<string, string>();
  if (slotIds.length > 0) {
    const { data: slots, error: slotsError } = await sb
      .from('slots')
      .select('id, group_code')
      .in('id', slotIds);
    if (!slotsError && slots) {
      for (const s of slots as Array<Record<string, unknown>>) {
        slotCode.set(s.id as string, (s.group_code as string) ?? '');
      }
    }
  }

  const providerTransactions = txs.map((t) => {
    const metadata = (t.metadata as Record<string, unknown>) ?? {};
    const rawStatus = String(t.status ?? 'pending').toLowerCase();
    const status: PlatformTransaction['status'] =
      ['success', 'succeeded', 'confirmed', 'paid'].includes(rawStatus)
        ? 'Confirmed'
        : rawStatus === 'failed'
          ? 'Failed'
          : ['refunded', 'partially_refunded'].includes(rawStatus)
            ? 'Refunded'
            : rawStatus === 'voided'
              ? 'Voided'
              : 'Pending';
    const provider = (t.provider as string) || 'verified_checkout';
    const source: PlatformTransaction['source'] = provider === 'bachs' ? 'bachs' : 'verified_checkout';
    const currency = (t.currency as string) || 'NGN';
    return {
      id: `provider-${String(t.id ?? '')}`,
      referenceId: (t.provider_reference as string) || String(t.id ?? ''),
      date: (t.created_at as string) ?? new Date().toISOString(),
      memberName: profileByName.get(t.payer_user_id as string) ?? 'Member',
      planName: (metadata.product_name as string) || 'Subscription',
      groupCode: slotCode.get((metadata.slot_id as string) ?? '') || undefined,
      source,
      amount: Number(t.amount ?? 0),
      currencySymbol: currency === 'NGN' ? '₦' : currency,
      status,
    };
  });

  const manualTransactions = manualRows.map((t) => {
    const metadata = (t.metadata as Record<string, unknown>) ?? {};
    const slotId = String(t.slot_id ?? metadata.slot_id ?? '');
    const currency = String(t.currency ?? 'NGN').toUpperCase();
    return {
      id: `manual-${String(t.id ?? '')}`,
      referenceId: String(t.reference_id ?? t.id ?? ''),
      date: String(t.created_at ?? new Date().toISOString()),
      memberName: profileByName.get(String(t.payer_user_id ?? '')) ?? 'Member',
      planName: String(metadata.product_name ?? 'Subscription'),
      groupCode: slotCode.get(slotId) || undefined,
      source: t.source === 'support_collected' ? 'Support Collected' as const : 'Admin Marked Paid' as const,
      amount: Number(t.amount ?? 0),
      currencySymbol: currency === 'NGN' ? '₦' : currency,
      status: t.status === 'voided' ? 'Voided' as const : 'Confirmed' as const,
    };
  });

  const productIds = [...new Set(reservationRows.map((t) => String(t.product_id ?? '')).filter(Boolean))];
  const productNameById = new Map<string, string>();
  if (productIds.length > 0) {
    const { data: products, error: productsError } = await sb
      .from('subscription_products')
      .select('id, name')
      .in('id', productIds);
    if (!productsError && products) {
      for (const product of products as Array<Record<string, unknown>>) {
        productNameById.set(String(product.id), String(product.name ?? 'Subscription'));
      }
    }
  }
  const pendingTransactions = reservationRows.map((t) => ({
    id: `reservation-${String(t.id ?? '')}`,
    referenceId: String(t.reference_id ?? t.id ?? ''),
    date: String(t.created_at ?? new Date().toISOString()),
    memberName: profileByName.get(String(t.payer_user_id ?? '')) ?? 'Member',
    planName: productNameById.get(String(t.product_id ?? '')) ?? 'Subscription',
    groupCode: String(t.preferred_group_code ?? '') || undefined,
    source: 'Pending Checkout' as const,
    amount: Number(t.expected_amount ?? 0),
    currencySymbol: String(t.expected_currency ?? 'NGN').toUpperCase() === 'NGN'
      ? '₦'
      : String(t.expected_currency ?? 'USD').toUpperCase(),
    status: t.status === 'pending' ? 'Pending' as const : 'Failed' as const,
  }));

  return [...providerTransactions, ...manualTransactions, ...pendingTransactions]
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Real subscription statistics derived from slot_memberships rows. */
export async function fetchSubscriptionStats(): Promise<SubscriptionStats> {
  const sb = requireSupabase();

  const { data: rows, error } = await sb
    .from('slot_memberships')
    .select('status, payment_status, approval_status');
  if (error) throw new Error(error.message);

  const memberships = (rows ?? []) as Array<{
    status: string;
    payment_status: string;
    approval_status?: string;
  }>;

  const approvedMemberships = memberships.filter(
    (m) => (m.approval_status ?? 'approved') === 'approved'
  );
  const active = approvedMemberships.filter((m) => m.status === 'active');
  return {
    total: approvedMemberships.length,
    active: active.length,
    pending: active.filter((m) => m.payment_status !== 'Paid').length,
    cancelled: approvedMemberships.filter((m) => m.status === 'cancelled').length,
    expired: approvedMemberships.filter((m) => m.status === 'expired').length,
  };
}

/* ── Available Plans management (real catalog rows) ─────────────────────── */

export async function createSubscriptionProduct(args: {
  name: string;
  monthlyPrice: number;
  category?: string;
  description?: string;
  currency?: string;
}): Promise<void> {
  const sb = requireSupabase();
  await requireFirebaseToken();
  const { error } = await sb.rpc('create_subscription_product', {
    p_name: args.name,
    p_monthly_price: args.monthlyPrice,
    p_category: args.category || 'Music',
    p_description: args.description || '',
    p_currency: args.currency || 'NGN',
    p_icon: 'music-disc',
    p_eligibility_note: null,
    p_highlights: null,
  });
  if (error) throw new Error(error.message);
}

export async function setSubscriptionProductActive(
  productId: string,
  active: boolean
): Promise<void> {
  const sb = requireSupabase();
  await requireFirebaseToken();
  const { error } = await sb.rpc('set_subscription_product_active', {
    p_product_id: productId,
    p_active: active,
  });
  if (error) throw new Error(error.message);
}

export async function setSubscriptionProductAvailability(
  productId: string,
  availability: 'open' | 'waitlist'
): Promise<void> {
  const sb = requireSupabase();
  await requireFirebaseToken();
  const { error } = await sb.rpc('set_subscription_product_availability', {
    p_product_id: productId,
    p_availability: availability,
  });
  if (error) throw new Error(error.message);
}

export async function moveSubscriptionProduct(
  productId: string,
  direction: 'up' | 'down'
): Promise<void> {
  const sb = requireSupabase();
  await requireFirebaseToken();
  const { error } = await sb.rpc('move_subscription_product', {
    p_product_id: productId,
    p_direction: direction,
  });
  if (error) throw new Error(error.message);
}

export async function deleteSubscriptionProductListing(productId: string): Promise<void> {
  const sb = requireSupabase();
  await requireFirebaseToken();
  const { error } = await sb.rpc('delete_subscription_product_listing', {
    p_product_id: productId,
  });
  if (error) throw new Error(error.message);
}
