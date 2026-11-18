/**
 * Staff access, resolved entirely inside Supabase Postgres.
 *
 * Firebase Auth is the identity layer (free). The Firebase ID token is passed to
 * Supabase as the bearer token; role truth lives in public.staff_members, guarded by
 * FORCE RLS. Bootstrap: the two designated accounts call claim_super_admin() once.
 * Everyone else reaches staff access only via redeem_admin_invitation() with a
 * pending, email-bound invitation.
 */
import { auth } from './firebase.js';
import { supabase } from './supabase.js';

export type StaffRole = 'superAdmin' | 'admin' | 'support';

export interface StaffAccess {
  isSuperAdmin: boolean;
  isAdmin: boolean;
  isSupport: boolean;
  role: StaffRole | null;
}

export interface StaffMemberRecord {
  email: string;
  role: StaffRole;
  created_at: string;
}

export interface AdminInvitationRecord {
  id: string;
  email: string;
  role: 'admin' | 'support';
  note: string | null;
  invited_by: string | null;
  status: 'pending' | 'redeemed' | 'revoked';
  created_at: string;
  redeemed_at: string | null;
}

export interface AuditLogRecord {
  id: number;
  action: string;
  actor_email: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

const NO_ACCESS: StaffAccess = {
  isSuperAdmin: false,
  isAdmin: false,
  isSupport: false,
  role: null,
};

function callerEmail(): string {
  return (auth?.currentUser?.email ?? '').trim().toLowerCase();
}

function mapRole(role: string | null | undefined): StaffRole | null {
  return role === 'superAdmin' || role === 'admin' || role === 'support' ? role : null;
}

/** Fetch the caller's staff role from Supabase. Returns NO_ACCESS on any failure. */
export async function fetchStaffAccess(): Promise<StaffAccess> {
  if (!supabase || !auth?.currentUser) return NO_ACCESS;
  const email = callerEmail();
  if (!email) return NO_ACCESS;
  try {
    const { data, error } = await supabase
      .from('staff_members')
      .select('role')
      .eq('email', email)
      .maybeSingle();
    if (error || !data) return NO_ACCESS;
    const role = mapRole((data as { role?: string }).role);
    if (!role) return NO_ACCESS;
    return {
      isSuperAdmin: role === 'superAdmin',
      isAdmin: role === 'admin' || role === 'superAdmin',
      isSupport: role === 'support',
      role,
    };
  } catch (err) {
    console.warn('[staffAccess] Could not fetch staff role:', err);
    return NO_ACCESS;
  }
}

/** Pending invitation for the caller's own email, if any. */
export async function checkMyPendingStaffInvitation(): Promise<{
  pending: boolean;
  role?: 'admin' | 'support';
  invitationId?: string;
}> {
  if (!supabase || !auth?.currentUser) return { pending: false };
  const email = callerEmail();
  if (!email) return { pending: false };
  try {
    const { data, error } = await supabase
      .from('admin_invitations')
      .select('id, role')
      .eq('email', email)
      .eq('status', 'pending')
      .limit(1)
      .maybeSingle();
    if (error || !data) return { pending: false };
    const row = data as { id: string; role: string };
    return {
      pending: true,
      role: row.role === 'admin' ? 'admin' : 'support',
      invitationId: row.id,
    };
  } catch (err) {
    console.warn('[staffAccess] Pending invitation check failed:', err);
    return { pending: false };
  }
}

/** One-time self-service claim for the two designated bootstrap accounts. */
export async function bootstrapSuperAdmin(): Promise<{
  granted: boolean;
  alreadyGranted?: boolean;
  email?: string;
} | null> {
  if (!supabase) throw new Error('Supabase client is not configured.');
  const { data, error } = await supabase.rpc('claim_super_admin');
  if (error) throw new Error(error.message);
  return (data as { granted: boolean; alreadyGranted?: boolean; email?: string }) ?? null;
}

/** Redeem the caller's own pending staff invitation. */
export async function redeemStaffInvitation(): Promise<{ granted: boolean; role?: StaffRole } | null> {
  if (!supabase) throw new Error('Supabase client is not configured.');
  const { data, error } = await supabase.rpc('redeem_admin_invitation');
  if (error) throw new Error(error.message);
  return (data as { granted: boolean; role?: StaffRole }) ?? null;
}

/** Directory of staff members — visible to super admins only (RLS). */
export async function listStaffMembers(): Promise<StaffMemberRecord[]> {
  if (!supabase) throw new Error('Supabase client is not configured.');
  const { data, error } = await supabase
    .from('staff_members')
    .select('email, role, created_at')
    .order('email', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data as StaffMemberRecord[]) ?? []).map((row) => ({ ...row }));
}

/** Invitation ledger — visible to super admins only (RLS). */
export async function listInvitations(): Promise<AdminInvitationRecord[]> {
  if (!supabase) throw new Error('Supabase client is not configured.');
  const { data, error } = await supabase
    .from('admin_invitations')
    .select('id, email, role, note, invited_by, status, created_at, redeemed_at')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data as AdminInvitationRecord[]) ?? [];
}

export async function createInvitation(
  email: string,
  role: 'admin' | 'support',
  note?: string
): Promise<{ reused: boolean; invitation: AdminInvitationRecord }> {
  if (!supabase) throw new Error('Supabase client is not configured.');
  const { data, error } = await supabase.rpc('create_admin_invitation', {
    p_email: email.trim().toLowerCase(),
    p_role: role,
    p_note: note?.trim() || null,
  });
  if (error) throw new Error(error.message);
  const payload = data as { reused: boolean; invitation: AdminInvitationRecord };
  return payload;
}

export async function revokeInvitation(invitationId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase client is not configured.');
  const { error } = await supabase.rpc('revoke_admin_invitation', {
    p_invitation_id: invitationId,
  });
  if (error) throw new Error(error.message);
}

export async function revokeStaffRole(
  targetEmail: string,
  role: 'admin' | 'support'
): Promise<void> {
  if (!supabase) throw new Error('Supabase client is not configured.');
  const { error } = await supabase.rpc('revoke_staff_role', {
    p_target_email: targetEmail.trim().toLowerCase(),
    p_role: role,
  });
  if (error) throw new Error(error.message);
}

/** Administrative audit log, newest first — super admins only (RLS). */
export async function fetchAuditLog(limit = 50): Promise<AuditLogRecord[]> {
  if (!supabase) throw new Error('Supabase client is not configured.');
  const { data, error } = await supabase
    .from('admin_audit_log')
    .select('id, action, actor_email, details, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data as AuditLogRecord[]) ?? [];
}
