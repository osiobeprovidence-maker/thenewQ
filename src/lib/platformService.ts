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

/** Verified payment ledger — real rows from payment_transactions only. */
export async function fetchPaymentTransactions(): Promise<PlatformTransaction[]> {
  const sb = requireSupabase();

  const { data: rows, error } = await sb
    .from('payment_transactions')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  const txs = (rows ?? []) as Array<Record<string, unknown>>;
  if (txs.length === 0) return [];

  // Member display names
  const userIds = [
    ...new Set(txs.map((t) => t.payer_user_id as string).filter(Boolean)),
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
      txs
        .map((t) => ((t.metadata as Record<string, unknown>)?.slot_id as string) ?? null)
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

  return txs.map((t) => {
    const metadata = (t.metadata as Record<string, unknown>) ?? {};
    const rawStatus = (t.status as string) || 'pending';
    const status: PlatformTransaction['status'] =
      rawStatus === 'success' || rawStatus === 'confirmed'
        ? 'Confirmed'
        : rawStatus === 'failed'
          ? 'Failed'
          : rawStatus === 'refunded'
            ? 'Refunded'
            : 'Pending';
    const provider = (t.provider as string) || 'verified_checkout';
    const source: PlatformTransaction['source'] =
      provider === 'bachs' ? 'bachs' : 'verified_checkout';
    const currency = (t.currency as string) || 'NGN';
    return {
      id: String(t.id ?? ''),
      referenceId: (t.provider_reference as string) || String(t.id ?? ''),
      date: (t.created_at as string) ?? new Date().toISOString(),
      memberName: profileByName.get(t.payer_user_id as string) ?? 'Member',
      planName: (metadata.product_name as string) || 'Subscription',
      groupCode: slotCode.get((metadata.slot_id as string) ?? '') || undefined,
      source,
      amount: Number(t.amount ?? 0),
      currencySymbol: currency === 'NGN' ? '₦' : '$',
      status,
    };
  });
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
