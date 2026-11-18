import { supabase } from './supabase.js';
import type { SubscriptionPlan } from '../types/subscription';

export interface DatabaseProduct {
  id: string;
  name: string;
  description: string;
  monthly_price: number;
  currency: string;
  is_active: boolean;
  category?: string;
  icon?: string;
  highlights?: string[];
  eligibility_note?: string;
  created_at: string;
}

export interface DatabaseSlot {
  id: string;
  product_id: string;
  capacity: number;
  status: string;
  group_name?: string;
  group_code?: string;
  home_address?: string;
  invite_link?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Fetches subscription products and their real slot counts from Supabase.
 * If the database has not been seeded yet, falls back gracefully to standard catalog
 * while keeping live data binding structure.
 */
export async function fetchLiveSubscriptionPlans(): Promise<SubscriptionPlan[]> {
  try {
    let productResult = await supabase
      .from('subscription_products')
      .select('*')
        .eq('is_active', true)
        .order('display_order', { ascending: true });

    // Keep the storefront readable while the admin control migration is pending.
    if (productResult.error && /display_order|schema cache|column/i.test(productResult.error.message)) {
      productResult = await supabase
        .from('subscription_products')
        .select('*')
        .eq('is_active', true);
    }
    const { data: products, error: prodError } = productResult;

    // No bundled fallback: the catalog is whatever the admin published.
    if (prodError || !products || products.length === 0) {
      return [];
    }

    // Query slots to calculate real availability
    const { data: slots } = await supabase
      .from('slots')
      .select('*, slot_memberships(id, status, approval_status)');

    return products.map((prod: any) => {
      const productSlots = slots ? slots.filter((s: any) => s.product_id === prod.id) : [];
      let totalCapacity = 0;
      let occupiedCount = 0;

      productSlots.forEach((s: any) => {
        totalCapacity += s.capacity || 0;
        const activeMembers = Array.isArray(s.slot_memberships)
          ? s.slot_memberships.filter(
              (m: any) => m.status !== 'cancelled' && (m.approval_status ?? 'approved') === 'approved'
            ).length
          : 0;
        occupiedCount += activeMembers;
      });

      const openSlots = Math.max(0, totalCapacity - occupiedCount);
      const availabilityMode = prod.availability_mode ?? 'auto';
      const isAvailable = availabilityMode === 'open' ||
        (availabilityMode === 'auto' && totalCapacity > 0 && openSlots > 0);

      return {
        id: prod.id,
        name: prod.name,
        category: prod.category || 'Music',
        description: prod.description,
        priceMonthly: Number(prod.monthly_price),
        currencySymbol: prod.currency === 'NGN' ? '₦' : '$',
        billingCycle: 'month',
        status: isAvailable ? 'available' : 'waitlist',
        availabilityLabel: availabilityMode === 'waitlist'
          ? 'Waitlist open'
          : isAvailable
            ? `Available now · ${openSlots} ${openSlots === 1 ? 'slot' : 'slots'} remaining`
            : 'Current batch full · Waitlist open',
        slotsOpen: openSlots,
        totalSlots: totalCapacity || 6,
        eligibilityNote:
          prod.eligibility_note ||
          'Independent slot coordination listed by Admin. Verify eligibility before joining.',
        highlights: prod.highlights || [
          'Admin-coordinated subscription slot access',
          'Receive group invite link and address in your Profile Inbox',
          'Manage monthly or multi-month renewals anytime',
        ],
        icon: (prod.icon as any) || 'music-disc',
        featured: false,
        displayOrder: Number(prod.display_order ?? 0),
        availabilityMode,
      };
    });
  } catch (err) {
    console.warn('Error fetching live products from Supabase:', err);
    return [];
  }
}

/**
 * Fetches user memberships from Supabase
 */
export async function fetchUserMemberships(userId: string) {
  try {
    const { data, error } = await supabase
      .from('slot_memberships')
      .select(`
        *,
        slots (
          *,
          subscription_products (*)
        ),
        membership_bills (due_date)
      `)
      .or(`beneficiary_user_id.eq.${userId},payer_user_id.eq.${userId}`);

    if (error) {
      console.warn('Could not fetch slot memberships from Supabase:', error);
      return [];
    }
    return data ?? [];
  } catch (e) {
    console.error('Error fetching memberships:', e);
    return [];
  }
}

/** Claims any unclaimed gifts addressed to the signed-in, verified email. */
export async function claimGiftedMemberships(): Promise<number> {
  const { data, error } = await supabase.rpc('claim_my_gifted_memberships');
  if (error) throw new Error(error.message);
  return Number((data as Record<string, unknown> | null)?.claimed_count ?? 0);
}

/**
 * Fetches user transactions from Supabase
 */
export async function fetchUserTransactions(userId: string) {
  try {
    const { data, error } = await supabase
      .from('payment_transactions')
      .select('*')
      .eq('payer_user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('Could not fetch payment transactions from Supabase:', error);
      return [];
    }
    return data ?? [];
  } catch (e) {
    console.error('Error fetching transactions:', e);
    return [];
  }
}
