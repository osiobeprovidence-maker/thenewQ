/**
 * Groups & Membership — the real, database-backed group system.
 * Backed by the `slots` table (a group == a slot) and `slot_memberships`.
 * All membership/payment details are private-by-default and audit-logged server-side.
 */
import { auth } from './firebase.js';
import { normalizePhoneNumber } from '../data/subscriptions';
import { supabase } from './supabase.js';
import type {
  GroupMember,
  GroupMemberPaymentStatus,
  SubscriptionGroup,
} from '../types/subscription';

function requireSupabase() {
  if (!supabase) {
    throw new Error('Supabase client is not configured.');
  }
  return supabase;
}

async function requireFirebaseToken(): Promise<string> {
  const user = auth?.currentUser;
  if (!user) {
    throw new Error('Sign in first.');
  }
  return user.getIdToken();
}

function callerUid(): string {
  return auth?.currentUser?.uid ?? '';
}

export interface GroupPreview {
  groupId: string;
  groupName: string;
  groupCode: string;
  productName: string;
  capacity: number;
  occupied: number;
  remaining: number;
  full: boolean;
  homeAddress: string | null;
}

export interface JoinedGroup {
  membership_id: string;
  slot_id: string;
  group_name: string;
  group_code: string;
  product_name: string;
  payment_status: GroupMemberPaymentStatus;
  home_address: string | null;
}

/* ── Queries ─────────────────────────────────────────────────────────── */

/** All groups for the admin dashboard, enriched with live member + profile data. */
export async function fetchAdminGroups(): Promise<SubscriptionGroup[]> {
  const sb = requireSupabase();

  const { data: slots, error: slotsError } = await sb
    .from('slots')
    .select('id, product_id, capacity, status, group_name, group_code, home_address, invite_link, created_at')
    .order('created_at', { ascending: false });
  if (slotsError) throw new Error(slotsError.message);
  if (!slots || slots.length === 0) return [];

  const productIds = [...new Set(slots.map((s: Record<string, unknown>) => s.product_id as string))];
  const { data: products, error: prodError } = await sb
    .from('subscription_products')
    .select('id, name, monthly_price, currency')
    .in('id', productIds);
  if (prodError) throw new Error(prodError.message);
  const productById = new Map<string, { name: string }>();
  for (const p of (products ?? []) as Array<{ id: string; name: string }>) {
    productById.set(p.id, { name: p.name });
  }

  const slotIds = slots.map((s: Record<string, unknown>) => s.id as string);
  const { data: memberships, error: memError } = await sb
    .from('slot_memberships')
    .select('*')
    .order('joined_at', { ascending: true });
  if (memError) throw new Error(memError.message);

  const membershipsBySlot = new Map<string, Array<Record<string, unknown>>>();
  for (const m of (memberships ?? []) as Array<Record<string, unknown>>) {
    const slotId = m.slot_id as string;
    const list = membershipsBySlot.get(slotId) ?? [];
    list.push(m);
    membershipsBySlot.set(slotId, list);
  }

  // Enrich member profiles (display name, phone/email) in one query
  const userIds = new Set<string>();
  for (const list of membershipsBySlot.values()) {
    for (const m of list) {
      const payer = m.payer_user_id as string | null;
      const beneficiary = m.beneficiary_user_id as string | null;
      if (payer) userIds.add(payer);
      if (beneficiary) userIds.add(beneficiary);
    }
  }
  const profileByUser = new Map<string, { display_name?: string; username?: string; phone?: string; email?: string }>();
  if (userIds.size > 0) {
    const { data: profiles, error: profError } = await sb
      .from('profiles')
      .select('user_id, display_name, username, phone, email')
      .in('user_id', [...userIds]);
    if (!profError && profiles) {
      for (const p of profiles as Array<Record<string, unknown>>) {
        profileByUser.set(p.user_id as string, {
          display_name: p.display_name as string | undefined,
          username: p.username as string | undefined,
          phone: p.phone as string | undefined,
          email: p.email as string | undefined,
        });
      }
    }
  }

  return slots.map((raw: Record<string, unknown>) => {
    const s = raw as unknown as {
      id: string;
      product_id: string;
      capacity: number;
      status: string;
      group_name: string | null;
      group_code: string | null;
      home_address: string | null;
      invite_link: string | null;
      created_at: string;
    };
    const membershipsForSlot = membershipsBySlot.get(s.id) ?? [];
    const members: GroupMember[] = membershipsForSlot.map((m) => {
      const userId = (m.beneficiary_user_id ?? m.payer_user_id) as string;
      const profile = profileByUser.get(userId);
      const rawStatus = (m.payment_status as string) || 'Unpaid';
      const paymentStatus: GroupMemberPaymentStatus =
        m.status === 'cancelled'
          ? 'Cancelled'
          : rawStatus === 'Paid'
            ? 'Paid'
            : 'Unpaid';
      return {
        id: String(m.id ?? ''),
        fullName: profile?.display_name?.trim() || profile?.username?.trim() || 'Member',
        email: profile?.email ?? '',
        whatsappNumber: profile?.phone ? normalizePhoneNumber(profile.phone) : '',
        referenceId: (m.reference_id as string) || `MEM-${String(m.id ?? '').slice(0, 8).toUpperCase()}`,
        isLeader: Boolean(m.is_leader),
        paymentStatus,
        joinedAt: (m.joined_at as string) ?? new Date().toISOString(),
        payerLabel: (m.payer_user_id as string) === (m.beneficiary_user_id as string) ? 'Self' : 'Sponsor',
        amountPaid: Number(m.amount_paid ?? 0),
      };
    });

    return {
      id: s.id,
      groupName: s.group_name ?? 'Untitled Group',
      groupCode: s.group_code ?? '—',
      planId: s.product_id,
      planName: productById.get(s.product_id)?.name ?? '—',
      homeAddress: s.home_address ?? '',
      inviteLink: s.invite_link ?? '',
      maxSlots: Number(s.capacity ?? 6),
      createdAt: s.created_at,
      members,
    };
  });
}

/** Preview a group from its invite code — capacity info before committing. */
export async function previewGroupByCode(groupCode: string): Promise<GroupPreview> {
  const sb = requireSupabase();
  await requireFirebaseToken(); // auth required server-side too
  const { data, error } = await sb.rpc('preview_group_by_code', { p_group_code: groupCode.trim().toUpperCase() });
  if (error) throw new Error(error.message);
  const d = data as Record<string, unknown>;
  return {
    groupId: String(d.group_id ?? ''),
    groupName: String(d.group_name ?? ''),
    groupCode: String(d.group_code ?? ''),
    productName: String(d.product_name ?? ''),
    capacity: Number(d.capacity ?? 0),
    occupied: Number(d.occupied ?? 0),
    remaining: Number(d.remaining ?? 0),
    full: Boolean(d.full),
    homeAddress: (d.home_address as string) ?? null,
  };
}

/** Preview reset on the server side is not needed — previews are read-only. */

export async function joinGroupByCode(groupCode: string): Promise<JoinedGroup> {
  const sb = requireSupabase();
  await requireFirebaseToken();
  const { data, error } = await sb.rpc('join_group_by_code', { p_group_code: groupCode.trim().toUpperCase() });
  if (error) throw new Error(error.message);
  return data as JoinedGroup;
}

export interface MyGroupEntry {
  id: string;
  slotId: string;
  groupName: string;
  groupCode: string;
  planName: string;
  paymentStatus: GroupMemberPaymentStatus;
  homeAddress: string | null;
  inviteLink: string | null;
  isLeader: boolean;
}

/** The signed-in user's own groups — read via RLS (own memberships + public goods). */
export async function fetchMyGroups(): Promise<MyGroupEntry[]> {
  const sb = requireSupabase();
  const uid = callerUid();
  if (!uid) return [];

  const { data: memberships, error } = await sb
    .from('slot_memberships')
    .select('id, slot_id, status, payment_status, is_leader')
    .or(`payer_user_id.eq.${uid},beneficiary_user_id.eq.${uid}`);
  if (error) throw new Error(error.message);

  const rows = (memberships ?? []).filter(
    (m: Record<string, unknown>) => (m.status as string) !== 'cancelled'
  );
  if (rows.length === 0) return [];

  const slotIds = [...new Set(rows.map((r) => r.slot_id as string))];
  const { data: slots, error: slotsError } = await sb
    .from('slots')
    .select('id, group_name, group_code, home_address, invite_link, product_id')
    .in('id', slotIds);
  if (slotsError) throw new Error(slotsError.message);

  const productIds = [...new Set((slots ?? []).map((s: Record<string, unknown>) => s.product_id as string))];
  const { data: products } = productIds.length
    ? await sb.from('subscription_products').select('id, name').in('id', productIds)
    : { data: [] as Array<Record<string, unknown>> };
  const productById = new Map<string, string>();
  for (const p of (products ?? []) as Array<Record<string, unknown>>) {
    productById.set(p.id as string, p.name as string);
  }

  const slotMap = new Map<string, Record<string, unknown>>();
  for (const s of (slots ?? []) as Array<Record<string, unknown>>) {
    slotMap.set(s.id as string, s);
  }

  return rows.map((m) => {
    const s = slotMap.get(m.slot_id as string) ?? {};
    const rawStatus = (m.payment_status as string) || 'Unpaid';
    return {
      id: String(m.id ?? ''),
      slotId: m.slot_id as string,
      groupName: (s.group_name as string) ?? 'Untitled Group',
      groupCode: (s.group_code as string) ?? '—',
      planName: productById.get(s.product_id as string) ?? '—',
      paymentStatus:
        rawStatus === 'Paid' ? ('Paid' as const) : ('Unpaid' as const),
      homeAddress: (s.home_address as string) ?? null,
      inviteLink: (s.invite_link as string) ?? null,
      isLeader: Boolean(m.is_leader),
    };
  });
}

/* ── Admin mutations (security-definer RPCs, staff-admins only) ──────── */

export async function createSubscriptionGroup(args: {
  planId: string;
  groupName: string;
  maxSlots: number;
  homeAddress: string;
  inviteLink?: string;
}): Promise<{ id: string; groupCode: string; inviteLink: string }> {
  const sb = requireSupabase();
  await requireFirebaseToken();
  const { data, error } = await sb.rpc('create_subscription_group', {
    p_product_id: args.planId,
    p_group_name: args.groupName.trim(),
    p_capacity: args.maxSlots,
    p_home_address: args.homeAddress.trim(),
    p_invite_base_url: window.location.origin,
    p_invite_link: args.inviteLink?.trim() || null,
  });
  if (error) throw new Error(error.message);
  const row = data as Record<string, unknown>;
  return {
    id: String(row.id ?? ''),
    groupCode: String(row.group_code ?? ''),
    inviteLink: String(row.invite_link ?? ''),
  };
}

export async function updateSubscriptionGroup(
  groupId: string,
  args: { groupName?: string; capacity?: number; homeAddress?: string; inviteLink?: string }
): Promise<void> {
  const sb = requireSupabase();
  await requireFirebaseToken();
  const { error } = await sb.rpc('update_subscription_group', {
    p_group_id: groupId,
    p_group_name: args.groupName ?? null,
    p_capacity: args.capacity ?? null,
    p_home_address: args.homeAddress ?? null,
    p_invite_link: args.inviteLink !== undefined ? (args.inviteLink.trim() || null) : null,
  });
  if (error) throw new Error(error.message);
}

export async function deleteSubscriptionGroup(groupId: string): Promise<void> {
  const sb = requireSupabase();
  await requireFirebaseToken();
  const { error } = await sb.rpc('delete_subscription_group', { p_group_id: groupId });
  if (error) throw new Error(error.message);
}

export async function removeGroupMember(membershipId: string): Promise<void> {
  const sb = requireSupabase();
  await requireFirebaseToken();
  const { error } = await sb.rpc('remove_group_member', { p_membership_id: membershipId });
  if (error) throw new Error(error.message);
}

export async function setGroupLeader(groupId: string, membershipId: string): Promise<void> {
  const sb = requireSupabase();
  await requireFirebaseToken();
  const { error } = await sb.rpc('set_group_leader', {
    p_group_id: groupId,
    p_membership_id: membershipId,
  });
  if (error) throw new Error(error.message);
}

export async function setMembershipPayment(
  membershipId: string,
  paid: boolean
): Promise<void> {
  const sb = requireSupabase();
  await requireFirebaseToken();
  const { error } = await sb.rpc('set_membership_payment', {
    p_membership_id: membershipId,
    p_paid: paid,
  });
  if (error) throw new Error(error.message);
}

/** You cannot check your own entitlement to a group without being signed in. */
export function uidIsCurrentUser(userId: string): boolean {
  return userId === callerUid();
}
