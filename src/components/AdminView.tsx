import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  Banknote,
  Check,
  CheckCircle2,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Copy,
  Crown,
  ExternalLink,
  FolderPlus,
  Hash,
  Headphones,
  History,
  Layers,
  LogOut,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  Send,
  Settings,
  Shield,
  Trash2,
  UserCheck,
  Users,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import {
  formatAmount,
  formatDisplayDate,
  formatPlanPrice,
} from '../data/subscriptions';
import { useAuth } from '../context/AuthContext';
import {
  bootstrapSuperAdmin,
  createInvitation,
  fetchAuditLog,
  listInvitations,
  listStaffMembers,
  redeemStaffInvitation,
  revokeInvitation,
  revokeStaffRole,
  type AdminInvitationRecord,
  type AuditLogRecord,
  type StaffMemberRecord,
} from '../lib/staffAccess';
import { SupportSocialsPanel } from './SupportSocialsPanel';

/** Strips noisy Firebase prefixes so callable errors read naturally in the UI. */
function friendlyCallableError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const cleaned = raw.replace(/^Firebase:\s*Error\s*\([^)]*\):\s*/i, '').trim();
  return cleaned || 'The request could not be completed. Please try again.';
}

import type {
  GroupMember,
  GroupMemberPaymentStatus,
  PlanStatus,
  PlatformTransaction,
  PortalRole,
  SubscriptionGroup,
  SubscriptionPlan,
  SupportPermissions,
} from '../types/subscription';

/** Designated bootstrap accounts that may claim Super Admin access (server re-verifies). */
const DESIGNATED_SUPER_ADMIN_EMAILS = ['riderezzy@gmail.com', 'osiobeprovidence@gmail.com'] as const;

function isDesignatedSuperAdminEmail(email: string | null | undefined): boolean {
  const normalized = (email ?? '').trim().toLowerCase();
  return (DESIGNATED_SUPER_ADMIN_EMAILS as readonly string[]).includes(normalized);
}

interface AdminViewProps {
  plans: SubscriptionPlan[];
  groups: SubscriptionGroup[];
  transactions: PlatformTransaction[];
  supportPermissions: SupportPermissions;
  onBackToSite: () => void;
  onRequestSignIn: () => void;
  onUpdateSupportPermissions: (updater: (prev: SupportPermissions) => SupportPermissions) => void;
  onCreateGroup: (payload: {
    groupName: string;
    planId: string;
    homeAddress: string;
    maxSlots: number;
    inviteLink?: string; // NEW optional field
  }) => Promise<string>;
  onDeleteGroup: (groupId: string) => Promise<void>;
  onUpdateGroupDetails: (
    groupId: string,
    payload: { groupName: string; homeAddress: string; capacity?: number; inviteLink?: string }
  ) => void;
  onDispatchGroupToInbox: (groupId: string) => number;
  onSetGroupLeader: (groupId: string, memberId: string) => void;
  onApproveGroupMember: (memberId: string) => void;
  onToggleMemberPaymentStatus: (groupId: string, memberId: string) => void;
  onCollectMemberPayment: (groupId: string, memberId: string, collectorRole: PortalRole) => void;
  onLogMemberContact: (
    groupId: string,
    memberId: string,
    contactedBy: string,
    note: string
  ) => void;
  onRemoveGroupMember: (groupId: string, memberId: string) => void;
  onAddPlan: (payload: {
    name: string;
    category: string;
    description: string;
    priceMonthly: number;
    totalSlots: number;
    status: PlanStatus;
  }) => Promise<void>;
  onTogglePlanStatus: (planId: string) => Promise<void>;
  onMovePlan: (planId: string, direction: 'up' | 'down') => Promise<void>;
  onDeletePlan: (planId: string) => Promise<void>;
}

type AdminTab = 'groups' | 'subscriptions' | 'financials' | 'settings';
type TransactionFilter = 'all' | 'users' | 'support';

export function AdminView({
  plans,
  groups,
  transactions,
  supportPermissions,
  onBackToSite,
  onRequestSignIn,
  onUpdateSupportPermissions,
  onCreateGroup,
  onDeleteGroup,
  onUpdateGroupDetails,
  onDispatchGroupToInbox,
  onSetGroupLeader,
  onApproveGroupMember,
  onToggleMemberPaymentStatus,
  onCollectMemberPayment,
  onLogMemberContact,
  onRemoveGroupMember,
  onAddPlan,
  onTogglePlanStatus,
  onMovePlan,
  onDeletePlan,
}: AdminViewProps) {
  // Login state (claims come from backend-issued Firebase custom claims)
  const {
    currentUser,
    loading: authLoading,
    isAdmin: hasAdminClaim,
    isSuperAdmin,
    isSupport: hasSupportClaim,
    logout,
    refreshClaims,
  } = useAuth();
  const [inviteRedeemState, setInviteRedeemState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [inviteRedeemMessage, setInviteRedeemMessage] = useState<string | null>(null);
  const [claimState, setClaimState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [claimMessage, setClaimMessage] = useState<string | null>(null);

  // Effective role: superAdmin implies admin; support is support-only.
  const isAdmin = isSuperAdmin || hasAdminClaim;
  const isSupport = !isAdmin && hasSupportClaim;
  const portalRole: PortalRole | null = isAdmin ? 'admin' : isSupport ? 'support' : null;

  // Dashboard navigation & selection state
  const [activeTab, setActiveTab] = useState<AdminTab>('groups');
  const [selectedGroupId, setSelectedGroupId] = useState<string>(groups[0]?.id ?? '');
  const [adminNotice, setAdminNotice] = useState<string | null>(null);
  const [txFilter, setTxFilter] = useState<TransactionFilter>('all');

  // Clickable Member Detail Modal state
  const [inspectedRef, setInspectedRef] = useState<{ groupId: string; memberId: string } | null>(
    null
  );
  const [contactNoteInput, setContactNoteInput] = useState('');
  const [copiedField, setCopiedField] = useState<'phone' | 'email' | 'reminder' | null>(null);

  // Create group form state
  const [showCreateGroupForm, setShowCreateGroupForm] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupPlanId, setNewGroupPlanId] = useState<string>('');
  const [newGroupAddress, setNewGroupAddress] = useState('');
  const [newGroupInviteLink, setNewGroupInviteLink] = useState('');
  const [newGroupMaxSlots, setNewGroupMaxSlots] = useState('6');
  const [groupFormError, setGroupFormError] = useState<string | null>(null);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);

  // Live sellable plans come from Supabase (UUID ids). Bundled demo slugs can't be persisted.
  const sellablePlans = plans.filter((p) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.id)
  );

  useEffect(() => {
    if (!newGroupPlanId && sellablePlans.length > 0) {
      setNewGroupPlanId(sellablePlans[0].id);
    }
  }, [sellablePlans, newGroupPlanId]);

  // Edit selected group details state
  const [editGroupName, setEditGroupName] = useState('');
  const [editHomeAddress, setEditHomeAddress] = useState('');
  const [editInviteLink, setEditInviteLink] = useState('');
  const [editGroupCapacity, setEditGroupCapacity] = useState('6');
  const [editGroupError, setEditGroupError] = useState<string | null>(null);

  // Copy & inline removal confirmation state
  const [copiedCodeGroupId, setCopiedCodeGroupId] = useState<string | null>(null);
  const [confirmRemoveMemberId, setConfirmRemoveMemberId] = useState<string | null>(null);
  const [confirmDeleteGroupId, setConfirmDeleteGroupId] = useState<string | null>(null);

  // Add subscription plan form state
  const [planName, setPlanName] = useState('');
  const [planCategory, setPlanCategory] = useState('');
  const [planDescription, setPlanDescription] = useState('');
  const [planPrice, setPlanPrice] = useState('1000');
  const [planSlots, setPlanSlots] = useState('6');
  const [planInitialStatus, setPlanInitialStatus] = useState<PlanStatus>('available');
  const [planFormError, setPlanFormError] = useState<string | null>(null);
  const [isSavingPlan, setIsSavingPlan] = useState(false);

  // Ensure support users always land on groups tab
  useEffect(() => {
    if (isSupport && activeTab !== 'groups') {
      setActiveTab('groups');
    }
  }, [isSupport, activeTab]);

  // Groups visible to current role
  const visibleGroups = isSupport
    ? supportPermissions.viewScope === 'unpaid-only'
      ? groups.filter((g) => g.members.some((m) => m.paymentStatus === 'Unpaid'))
      : groups
    : groups;

  const selectedGroup =
    visibleGroups.find((g) => g.id === selectedGroupId) ?? visibleGroups[0] ?? null;

  useEffect(() => {
    if (visibleGroups.length > 0 && !visibleGroups.some((g) => g.id === selectedGroupId)) {
      setSelectedGroupId(visibleGroups[0].id);
    }
  }, [visibleGroups, selectedGroupId]);

  useEffect(() => {
    if (selectedGroup) {
      setEditGroupName(selectedGroup.groupName);
      setEditHomeAddress(selectedGroup.homeAddress);
      setEditInviteLink(selectedGroup.inviteLink || '');
      setEditGroupCapacity(String(selectedGroup.maxSlots));
      setEditGroupError(null);
      setConfirmRemoveMemberId(null);
    }
  }, [selectedGroup]);

  // Inspected member lookup (stays live when payment/contact status updates)
  const inspectedGroup = inspectedRef
    ? groups.find((g) => g.id === inspectedRef.groupId) ?? null
    : null;
  const inspectedMember: GroupMember | null =
    inspectedRef && inspectedGroup
      ? inspectedGroup.members.find((m) => m.id === inspectedRef.memberId) ?? null
      : null;
  const inspectedPlan = inspectedGroup
    ? plans.find((p) => p.id === inspectedGroup.planId) ?? plans[0]
    : plans[0];

  useEffect(() => {
    if (!inspectedRef) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setInspectedRef(null);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [inspectedRef]);

  const showNotice = (message: string) => {
    setAdminNotice(message);
  };

  const copyToClipboard = async (text: string, field: 'phone' | 'email' | 'reminder') => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API may be blocked in restricted iframes; still give visual feedback
    }
    setCopiedField(field);
    window.setTimeout(() => setCopiedField(null), 2000);
  };

  const handleOpenMemberModal = (groupId: string, member: GroupMember) => {
    setInspectedRef({ groupId, memberId: member.id });
    setContactNoteInput(member.contactNote ?? '');
    setCopiedField(null);
  };

  const handleCopyGroupCode = async (groupId: string, code: string) => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Ignore restricted clipboard contexts
    }
    setCopiedCodeGroupId(groupId);
    window.setTimeout(() => setCopiedCodeGroupId(null), 2000);
  };

  const handleCreateGroupSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = newGroupName.trim();
    const trimmedAddress = newGroupAddress.trim();
    const parsedSlots = Number(newGroupMaxSlots);

    if (trimmedName.length < 3) {
      setGroupFormError('Please enter a group name (at least 3 characters).');
      return;
    }
    if (trimmedAddress.length < 5) {
      setGroupFormError('Please enter the home address for this group.');
      return;
    }
    const planId = newGroupPlanId || sellablePlans[0]?.id;
    if (!planId) {
      setGroupFormError('No live subscription plans available yet. Add plans first.');
      return;
    }
    if (!Number.isInteger(parsedSlots) || parsedSlots < 2 || parsedSlots > 200) {
      setGroupFormError('Max slots must be a whole number between 2 and 200.');
      return;
    }

    setGroupFormError(null);
    setIsCreatingGroup(true);
    try {
      const createdGroupId = await onCreateGroup({
        groupName: trimmedName,
        planId,
        homeAddress: trimmedAddress,
        maxSlots: parsedSlots,
        inviteLink: newGroupInviteLink.trim() || undefined,
      });
      setSelectedGroupId(createdGroupId);
      setNewGroupName('');
      setNewGroupAddress('');
      setNewGroupInviteLink('');
      setNewGroupMaxSlots('6');
      setShowCreateGroupForm(false);
      showNotice(`Created group "${trimmedName}" with an auto-generated Group Code.`);
    } catch (error) {
      setGroupFormError(friendlyCallableError(error));
    } finally {
      setIsCreatingGroup(false);
    }
  };

  const handleUpdateGroupSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedGroup) return;

    const trimmedName = editGroupName.trim();
    const trimmedAddress = editHomeAddress.trim();
    const parsedCapacity = Number(editGroupCapacity);
    const activeMembers = selectedGroup.members.filter(
      (m) => m.paymentStatus !== 'Cancelled'
    ).length;

    if (trimmedName.length < 3) {
      setEditGroupError('Group name must be at least 3 characters.');
      return;
    }
    if (trimmedAddress.trim().length < 5) {
      setEditGroupError('Please provide a valid home address.');
      return;
    }
    if (
      !Number.isInteger(parsedCapacity) ||
      parsedCapacity < Math.max(2, activeMembers) ||
      parsedCapacity > 200
    ) {
      setEditGroupError(
        `Capacity must be a whole number between ${Math.max(2, activeMembers)} and 200${
          activeMembers > 0 ? ` (at least the current ${activeMembers} members)` : ''
        }.`
      );
      return;
    }

    setEditGroupError(null);
    onUpdateGroupDetails(selectedGroup.id, {
      groupName: trimmedName,
      homeAddress: trimmedAddress,
      capacity: parsedCapacity,
      inviteLink: editInviteLink.trim() || undefined,
    });
    showNotice(`Saved updated details for ${trimmedName}.`);
  };

  const handleDeleteGroup = async () => {
    if (!selectedGroup) return;
    const target = selectedGroup;
    setConfirmDeleteGroupId(null);
    try {
      await onDeleteGroup(target.id);
      setSelectedGroupId('');
      showNotice(`Group "${target.groupName}" was deleted permanently.`);
    } catch (error) {
      showNotice(friendlyCallableError(error));
    }
  };

  const handleDispatchInbox = () => {
    if (!selectedGroup) return;
    const sharedMemberCount = onDispatchGroupToInbox(selectedGroup.id);
    if (sharedMemberCount > 0) {
      showNotice(
        `Invite link copied — share it with the ${sharedMemberCount} member${
          sharedMemberCount === 1 ? '' : 's'
        } of ${selectedGroup.groupName} (${selectedGroup.groupCode}), or forward it anywhere you like.`
      );
    } else {
      showNotice(
        `Invite link for ${selectedGroup.groupName} (${selectedGroup.groupCode}) copied. Share it with anyone you want in this group.`
      );
    }
  };

  const handleAddPlanSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = planName.trim();
    const trimmedCategory = planCategory.trim();
    const trimmedDesc = planDescription.trim();
    const parsedPrice = Number(planPrice);
    const parsedSlots = Number(planSlots);

    if (trimmedName.length < 2) {
      setPlanFormError('Please enter a subscription name.');
      return;
    }
    if (trimmedCategory.length < 2) {
      setPlanFormError('Please enter a category (e.g. Music Streaming).');
      return;
    }
    if (trimmedDesc.length < 8) {
      setPlanFormError('Please enter a short description.');
      return;
    }
    if (!Number.isFinite(parsedPrice) || parsedPrice < 100) {
      setPlanFormError('Monthly price must be at least ₦100.');
      return;
    }
    if (!Number.isInteger(parsedSlots) || parsedSlots < 1 || parsedSlots > 50) {
      setPlanFormError('Total slots must be a whole number between 1 and 50.');
      return;
    }

    setPlanFormError(null);
    setIsSavingPlan(true);
    try {
      await onAddPlan({
        name: trimmedName,
        category: trimmedCategory,
        description: trimmedDesc,
        priceMonthly: parsedPrice,
        totalSlots: parsedSlots,
        status: planInitialStatus,
      });
      setPlanName('');
      setPlanCategory('');
      setPlanDescription('');
      setPlanPrice('1000');
      setPlanSlots('6');
      showNotice(`Listed "${trimmedName}" in Available Plans.`);
    } catch (error) {
      setPlanFormError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSavingPlan(false);
    }
  };

  // Aggregate Platform Metrics
  const allMembers = groups.flatMap((grp) =>
    grp.members.map((m) => ({
      group: grp,
      member: m,
      plan: plans.find((p) => p.id === grp.planId) ?? plans[0],
    }))
  );

  const totalMembersCount = allMembers.length;
  const paidMembersCount = allMembers.filter((item) => item.member.paymentStatus === 'Paid').length;
  const unpaidMembers = allMembers.filter((item) => item.member.paymentStatus === 'Unpaid');
  const unpaidMembersCount = unpaidMembers.length;

  // Support progress metrics
  const contactedMembersCount = allMembers.filter((item) => item.member.contacted).length;
  const supportTouchTargetTotal = contactedMembersCount + unpaidMembers.filter((u) => !u.member.contacted).length;
  const supportContactProgressPct =
    supportTouchTargetTotal > 0
      ? Math.round((contactedMembersCount / supportTouchTargetTotal) * 100)
      : 100;

  const supportCollectedTransactions = transactions.filter(
    (t) => t.source === 'Support Collected'
  );
  const supportCollectedAmount = supportCollectedTransactions.reduce((sum, t) => sum + t.amount, 0);

  // Financial Metrics
  const totalPlatformPaid = transactions
    .filter((t) => t.status === 'Confirmed')
    .reduce((sum, t) => sum + t.amount, 0);

  const totalOutstandingUnpaid = unpaidMembers.reduce(
    (sum, item) => sum + item.plan.priceMonthly,
    0
  );

  // Subscription Catalog Metrics
  const openPlansCount = plans.filter((p) => p.status === 'available').length;
  const waitlistPlansCount = plans.filter((p) => p.status === 'waitlist').length;
  const totalSlotsOpen = plans.reduce((sum, p) => sum + p.slotsOpen, 0);
  const totalSlotsCapacity = plans.reduce((sum, p) => sum + p.totalSlots, 0);

  const filteredTransactions = transactions.filter((t) => {
    if (txFilter === 'support') return t.source === 'Support Collected';
    if (txFilter === 'users') {
      return (
        t.source === 'User Checkout' ||
        t.source === 'Renewal' ||
        t.source === 'Paid for Somebody'
      );
    }
    return true;
  });

  // ---- Access gate: only backend-issued Firebase custom claims unlock staff views ----
  const handleRedeemInvitation = async () => {
    setInviteRedeemState('loading');
    setInviteRedeemMessage(null);
    try {
      await redeemStaffInvitation();
      await refreshClaims();
      // Staff role now flows through context; the gate below opens automatically.
      setInviteRedeemState('idle');
      setInviteRedeemMessage(null);
    } catch (e) {
      setInviteRedeemState('error');
      setInviteRedeemMessage(friendlyCallableError(e));
    }
  };

  // One-time, self-service super admin bootstrap for the two designated accounts.
  const handleClaimSuperAdmin = async () => {
    setClaimState('loading');
    setClaimMessage(null);
    try {
      const result = await bootstrapSuperAdmin();
      if (result?.granted) {
        await refreshClaims();
        // Claims now include superAdmin + admin; this view flips to the full console.
        setClaimState('success');
        setClaimMessage(null);
      } else {
        setClaimState('error');
        setClaimMessage('The claim did not complete. Please try again in a moment.');
      }
    } catch (e) {
      setClaimState('error');
      setClaimMessage(friendlyCallableError(e));
    }
  };

  // Waiting for Firebase to report auth state — show a neutral skeleton, never data.
  if (authLoading) {
    return (
      <section className="bg-black py-14 sm:py-24 min-h-[75vh] flex items-center">
        <div className="mx-auto w-full max-w-md px-4 sm:px-6">
          <div
            role="status"
            aria-label="Checking staff access"
            className="rounded-2xl border border-white/10 bg-[#181818] p-6 sm:p-8 space-y-4 animate-pulse"
          >
            <div className="h-12 w-12 rounded-xl bg-white/10" />
            <div className="h-4 w-40 rounded bg-white/10" />
            <div className="h-3 w-64 rounded bg-white/10" />
          </div>
        </div>
      </section>
    );
  }

  // Access denied: unauthenticated users, or authenticated users without a staff claim.
  if (!portalRole) {
    return (
      <section className="bg-black py-14 sm:py-24 min-h-[75vh] flex items-center">
        <div className="mx-auto w-full max-w-md px-4 sm:px-6">
          <button
            type="button"
            onClick={onBackToSite}
            className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-[#B3B3B3] hover:text-white transition-colors cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>Back to Storefront</span>
          </button>

          <div className="rounded-2xl border border-white/10 bg-[#181818] p-6 sm:p-8 shadow-2xl space-y-6">
            <div className="flex items-center gap-3.5 pb-5 border-b border-white/10">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#1DB954]/35 bg-[#1DB954]/10 text-[#1DB954] shrink-0">
                <Shield className="h-6 w-6" aria-hidden="true" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[#1DB954]">
                  Queue Operations Portal
                </p>
                <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
                  Staff Access Restricted
                </h1>
              </div>
            </div>

            {currentUser ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-white/10 bg-[#121212] p-4 text-xs space-y-1.5">
                  <p className="text-[#B3B3B3]">
                    Signed in as: <strong className="text-white">{currentUser.email}</strong>
                  </p>
                  {isDesignatedSuperAdminEmail(currentUser.email) ? (
                    <p className="text-[#1DB954] font-medium">
                      Designated Super Admin account detected — claim your access below.
                    </p>
                  ) : (
                    <p className="text-amber-400 font-medium">
                      This account does not hold staff privileges (superAdmin, admin, or support).
                    </p>
                  )}
                </div>

                {isDesignatedSuperAdminEmail(currentUser.email) ? (
                  <>
                    <p className="text-xs text-[#B3B3B3] leading-relaxed">
                      This is a designated bootstrap Super Admin account. Claiming access grants
                      your verified Google session the superAdmin + admin claims immediately.
                      One click — no invitation needed.
                    </p>

                    {claimMessage && (
                      <p className="rounded-xl border border-red-500/30 bg-red-950/40 p-3 text-xs text-red-300" role="alert">
                        {claimMessage}
                      </p>
                    )}

                    <button
                      type="button"
                      onClick={handleClaimSuperAdmin}
                      disabled={claimState === 'loading'}
                      className="w-full inline-flex items-center justify-center gap-2 min-h-[46px] rounded-full border border-[#1DB954] bg-[#1DB954]/10 px-6 py-3 text-sm font-bold text-[#1DB954] transition-colors hover:bg-[#1DB954] hover:text-black cursor-pointer disabled:opacity-70"
                    >
                      <Crown className="h-4 w-4" aria-hidden="true" />
                      {claimState === 'loading' ? 'Granting Super Admin…' : 'Claim Super Admin Access'}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-[#B3B3B3] leading-relaxed">
                      Administrative access is granted by invitation only. If you were invited to the
                      operations team, redeem your invitation below — the platform assigns the role to
                      your verified Google identity.
                    </p>

                    {inviteRedeemMessage && (
                      <p className="rounded-xl border border-red-500/30 bg-red-950/40 p-3 text-xs text-red-300" role="alert">
                        {inviteRedeemMessage}
                      </p>
                    )}

                    <button
                      type="button"
                      onClick={handleRedeemInvitation}
                      disabled={inviteRedeemState === 'loading'}
                      className="w-full inline-flex items-center justify-center gap-2 min-h-[46px] rounded-full bg-[#1DB954] px-6 py-3 text-sm font-bold text-black transition-colors hover:bg-[#15803D] hover:text-white cursor-pointer disabled:opacity-70"
                    >
                      {inviteRedeemState === 'loading' ? 'Checking invitation…' : 'Redeem Staff Invitation'}
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => {
                    void logout();
                    onRequestSignIn();
                  }}
                  className="w-full min-h-[44px] rounded-full border border-white/20 bg-white/5 px-6 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-white/10 cursor-pointer"
                >
                  Sign in with a different account
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-[#B3B3B3] leading-relaxed">
                  This area is restricted to authorized operations staff. Sign in with your staff
                  Google account to continue.
                </p>
                <button
                  type="button"
                  onClick={onRequestSignIn}
                  className="w-full flex items-center justify-center gap-3 min-h-[48px] rounded-full border border-white/20 bg-white/5 py-3 px-4 text-sm font-semibold text-white hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  Sign in with Google
                </button>
              </div>
            )}
          </div>
        </div>
      </section>
    );
  }

  // Filter members shown in the Selected Group roster when Support is in 'unpaid-only' scope
  const displayedGroupMembers = selectedGroup
    ? isSupport && supportPermissions.viewScope === 'unpaid-only'
      ? selectedGroup.members.filter((m) => m.paymentStatus === 'Unpaid')
      : selectedGroup.members
    : [];

  return (
    <section className="bg-black py-8 sm:py-12 min-h-screen">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 space-y-7">
        {/* Top Header */}
        <div className="rounded-2xl border border-white/10 bg-[#121212] p-5 sm:p-7 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <button
              type="button"
              onClick={onBackToSite}
              className="inline-flex items-center gap-2 text-sm font-medium text-[#B3B3B3] hover:text-white transition-colors cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span>Back to Storefront</span>
            </button>

            <div className="flex flex-wrap items-center gap-2.5">
              {/* Admin-only navigation tabs */}
              {isAdmin && (
                <div
                  role="tablist"
                  aria-label="Admin sections"
                  className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-white/10 bg-[#181818] p-1"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'groups'}
                    onClick={() => setActiveTab('groups')}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${
                      activeTab === 'groups'
                        ? 'bg-[#1DB954] text-black'
                        : 'text-[#B3B3B3] hover:text-white'
                    }`}
                  >
                    <Users className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Groups &amp; Members</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'subscriptions'}
                    onClick={() => setActiveTab('subscriptions')}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${
                      activeTab === 'subscriptions'
                        ? 'bg-[#1DB954] text-black'
                        : 'text-[#B3B3B3] hover:text-white'
                    }`}
                  >
                    <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Subscriptions</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'financials'}
                    onClick={() => setActiveTab('financials')}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${
                      activeTab === 'financials'
                        ? 'bg-[#1DB954] text-black'
                        : 'text-[#B3B3B3] hover:text-white'
                    }`}
                  >
                    <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Financials</span>
                  </button>
                </div>
              )}

              {/* Customer Care badge + optional Admin return */}
              {isSupport && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#1DB954]/40 bg-[#181818] px-3.5 py-2 text-xs font-bold text-[#1DB954]">
                  <Headphones className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Customer Care Desk</span>
                </span>
              )}

              {/* Admin Settings button placed right before Log Out */}
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setActiveTab('settings')}
                  aria-current={activeTab === 'settings' ? 'page' : undefined}
                  className={`inline-flex items-center gap-1.5 min-h-[40px] rounded-full border px-4 py-2 text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                    activeTab === 'settings'
                      ? 'border-[#1DB954] bg-[#1DB954] text-black'
                      : 'border-white/15 bg-[#181818] text-white hover:border-[#1DB954] hover:text-[#1DB954]'
                  }`}
                >
                  <Settings className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Admin Settings</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  void logout();
                }}
                className="inline-flex items-center gap-1.5 min-h-[40px] rounded-full border border-white/15 bg-[#181818] px-4 py-2 text-xs font-semibold text-[#B3B3B3] hover:border-white/35 hover:text-white transition-colors cursor-pointer whitespace-nowrap"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Log Out</span>
              </button>
            </div>
          </div>

          {/* Role-specific KPI Summary Header */}
          {isAdmin ? (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-end pt-4 border-t border-white/10">
              <div className="lg:col-span-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-[#1DB954]">
                  {activeTab === 'groups' && 'Admin Workspace · Groups & Members'}
                  {activeTab === 'subscriptions' && 'Admin Workspace · Subscriptions'}
                  {activeTab === 'financials' && 'Admin Workspace · Financials'}
                  {activeTab === 'settings' && 'Admin Workspace · Admin Settings'}
                </p>
                <h1 className="mt-1 text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
                  {activeTab === 'groups' && 'Groups & Member Management'}
                  {activeTab === 'subscriptions' && 'Subscription Offerings & Slots'}
                  {activeTab === 'financials' && 'Platform Revenue & Payments'}
                  {activeTab === 'settings' && 'Customer Care Permissions'}
                </h1>
                <p className="mt-1.5 text-sm text-[#B3B3B3]">
                  {activeTab === 'groups' &&
                    'Inspect groups, click any member name to view contact details, manage group leaders, and remove unpaid seats.'}
                  {activeTab === 'subscriptions' &&
                    'List new subscriptions, track open slot capacity across plans, and toggle availability or waitlist status.'}
                  {activeTab === 'financials' &&
                    'Monitor total paid on the platform, pending unpaid dues, and payments collected by Customer Care.'}
                  {activeTab === 'settings' &&
                    'Configure exactly what Customer Care staff can view, contact, and collect in their workspace.'}
                </p>
              </div>

              <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-4 gap-3">
                {activeTab === 'groups' && (
                  <>
                    <div className="rounded-xl border border-white/10 bg-[#181818] p-3.5">
                      <p className="text-xs text-[#B3B3B3]">Total Members</p>
                      <p className="mt-1 font-mono text-xl font-bold text-[#1DB954] tabular-nums">
                        {totalMembersCount}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-[#181818] p-3.5">
                      <p className="text-xs text-[#B3B3B3]">Paid Members</p>
                      <p className="mt-1 font-mono text-xl font-bold text-white tabular-nums">
                        {paidMembersCount}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-[#181818] p-3.5">
                      <p className="text-xs text-[#B3B3B3]">Unpaid Members</p>
                      <p className="mt-1 font-mono text-xl font-bold text-amber-400 tabular-nums">
                        {unpaidMembersCount}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-[#181818] p-3.5">
                      <p className="text-xs text-[#B3B3B3]">Groups</p>
                      <p className="mt-1 font-mono text-xl font-bold text-white tabular-nums">
                        {groups.length}
                      </p>
                    </div>
                  </>
                )}

                {activeTab === 'subscriptions' && (
                  <>
                    <div className="rounded-xl border border-white/10 bg-[#181818] p-3.5">
                      <p className="text-xs text-[#B3B3B3]">Total Subscriptions</p>
                      <p className="mt-1 font-mono text-xl font-bold text-[#1DB954] tabular-nums">
                        {plans.length}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-[#181818] p-3.5">
                      <p className="text-xs text-[#B3B3B3]">Open Plans</p>
                      <p className="mt-1 font-mono text-xl font-bold text-white tabular-nums">
                        {openPlansCount}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-[#181818] p-3.5">
                      <p className="text-xs text-[#B3B3B3]">Waitlist Plans</p>
                      <p className="mt-1 font-mono text-xl font-bold text-amber-400 tabular-nums">
                        {waitlistPlansCount}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-[#181818] p-3.5">
                      <p className="text-xs text-[#B3B3B3]">Open Slots</p>
                      <p className="mt-1 font-mono text-xl font-bold text-white tabular-nums">
                        {totalSlotsOpen}/{totalSlotsCapacity}
                      </p>
                    </div>
                  </>
                )}

                {activeTab === 'financials' && (
                  <>
                    <div className="rounded-xl border border-white/10 bg-[#181818] p-3.5">
                      <p className="text-xs text-[#B3B3B3]">Confirmed Payments</p>
                      <p className="mt-1 font-mono text-lg sm:text-xl font-bold text-[#1DB954] tabular-nums">
                        {formatAmount(totalPlatformPaid)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-[#181818] p-3.5">
                      <p className="text-xs text-[#B3B3B3]">Pending Unpaid</p>
                      <p className="mt-1 font-mono text-lg sm:text-xl font-bold text-amber-400 tabular-nums">
                        {formatAmount(totalOutstandingUnpaid)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-[#181818] p-3.5">
                      <p className="text-xs text-[#B3B3B3]">Support Collected</p>
                      <p className="mt-1 font-mono text-lg sm:text-xl font-bold text-white tabular-nums">
                        {formatAmount(supportCollectedAmount)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-[#181818] p-3.5">
                      <p className="text-xs text-[#B3B3B3]">Transactions</p>
                      <p className="mt-1 font-mono text-xl font-bold text-white tabular-nums">
                        {transactions.length}
                      </p>
                    </div>
                  </>
                )}

                {activeTab === 'settings' && (
                  <>
                    <div className="rounded-xl border border-white/10 bg-[#181818] p-3.5">
                      <p className="text-xs text-[#B3B3B3]">Support View</p>
                      <p className="mt-1 text-sm sm:text-base font-bold text-[#1DB954] truncate">
                        {supportPermissions.viewScope === 'unpaid-only'
                          ? 'Unpaid Only'
                          : 'All Members'}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-[#181818] p-3.5">
                      <p className="text-xs text-[#B3B3B3]">Collect Payments</p>
                      <p className="mt-1 text-sm sm:text-base font-bold text-white">
                        {supportPermissions.canCollectPayments ? 'Enabled' : 'Disabled'}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-[#181818] p-3.5">
                      <p className="text-xs text-[#B3B3B3]">Outreach Log</p>
                      <p className="mt-1 text-sm sm:text-base font-bold text-white">
                        {supportPermissions.canLogOutreach ? 'Enabled' : 'Disabled'}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-[#181818] p-3.5">
                      <p className="text-xs text-[#B3B3B3]">Contacted</p>
                      <p className="mt-1 font-mono text-xl font-bold text-white tabular-nums">
                        {contactedMembersCount}
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-end pt-4 border-t border-white/10">
              <div className="lg:col-span-6 space-y-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#1DB954]">
                    Customer Care Outreach
                  </p>
                  <h1 className="mt-1 text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
                    {supportPermissions.viewScope === 'unpaid-only'
                      ? 'Unpaid Members Follow-Up Queue'
                      : 'Groups & Member Follow-Up'}
                  </h1>
                  <p className="mt-1.5 text-sm text-[#B3B3B3]">
                    Click any member&apos;s name to view their contact details, send payment reminders, and record collected payments.
                  </p>
                </div>

                {/* Outreach Progress Bar */}
                <div className="rounded-xl border border-white/10 bg-[#181818] p-3.5 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-white">Outreach Follow-Up Progress</span>
                    <span className="font-mono font-bold text-[#1DB954] tabular-nums">
                      {contactedMembersCount} contacted · {supportContactProgressPct}%
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-black overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#1DB954] transition-all duration-300"
                      style={{ width: `${supportContactProgressPct}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="lg:col-span-6 grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="rounded-xl border border-white/10 bg-[#181818] p-3.5">
                  <p className="text-xs text-[#B3B3B3]">Awaiting Payment</p>
                  <p className="mt-1 font-mono text-xl font-bold text-amber-400 tabular-nums">
                    {unpaidMembersCount}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#181818] p-3.5">
                  <p className="text-xs text-[#B3B3B3]">Contacted</p>
                  <p className="mt-1 font-mono text-xl font-bold text-white tabular-nums">
                    {contactedMembersCount}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#181818] p-3.5 col-span-2 sm:col-span-1">
                  <p className="text-xs text-[#B3B3B3]">Collected (Support)</p>
                  <p className="mt-1 font-mono text-lg sm:text-xl font-bold text-[#1DB954] tabular-nums">
                    {supportCollectedTransactions.length} ({formatAmount(supportCollectedAmount)})
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Feedback Notice */}
        {adminNotice && (
          <div
            role="status"
            className="flex items-center justify-between gap-4 rounded-2xl border border-[#1DB954]/50 bg-[#181818] px-5 py-3.5 text-sm"
          >
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-[#1DB954] shrink-0" aria-hidden="true" />
              <span className="text-white font-medium">{adminNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setAdminNotice(null)}
              aria-label="Dismiss notification"
              className="text-[#B3B3B3] hover:text-white p-1 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* TAB 1: GROUPS & MEMBERS (Admin gets full controls; Support gets scoped view) */}
        {(activeTab === 'groups' || isSupport) && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-white">
                  {isSupport && supportPermissions.viewScope === 'unpaid-only'
                    ? 'Groups with Unpaid Members'
                    : 'Subscription Groups & Members'}
                </h2>
                <p className="text-xs sm:text-sm text-[#B3B3B3]">
                  Click a member&apos;s name (e.g. Joy Emeka) to open their profile, contact them, or collect payment.
                </p>
              </div>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setShowCreateGroupForm((prev) => !prev)}
                  className="inline-flex items-center gap-2 min-h-[44px] rounded-full bg-[#1DB954] px-5 py-2.5 text-sm font-bold text-black transition-colors hover:bg-[#15803D] hover:text-white cursor-pointer"
                >
                  {showCreateGroupForm ? (
                    <>
                      <X className="h-4 w-4" aria-hidden="true" />
                      <span>Close Form</span>
                    </>
                  ) : (
                    <>
                      <FolderPlus className="h-4 w-4" aria-hidden="true" />
                      <span>Create New Group</span>
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Admin-only Create Group Form */}
            {isAdmin && showCreateGroupForm && (
              <form
                onSubmit={handleCreateGroupSubmit}
                noValidate
                className="rounded-2xl border border-[#1DB954]/40 bg-[#181818] p-5 sm:p-7 space-y-4"
              >
                <div className="flex items-center justify-between gap-3 pb-3 border-b border-white/10">
                  <div>
                    <h3 className="text-base font-bold text-white">Create Subscription Group</h3>
                    <p className="text-xs text-[#B3B3B3]">
                      A unique Group Code (e.g. GFT-4820) is automatically generated when you save.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label
                      htmlFor="new-group-name"
                      className="block text-sm font-medium text-white mb-1.5"
                    >
                      Group name
                    </label>
                    <input
                      id="new-group-name"
                      type="text"
                      placeholder="e.g. Spotify Queue Group 02"
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      className="w-full min-h-[46px] rounded-xl border border-white/15 bg-[#121212] px-4 py-2.5 text-sm text-white placeholder:text-[#B3B3B3]/50 focus:border-[#1DB954] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="new-group-plan"
                      className="block text-sm font-medium text-white mb-1.5"
                    >
                      Subscription plan
                    </label>
                    <select
                      id="new-group-plan"
                      value={newGroupPlanId}
                      onChange={(e) => setNewGroupPlanId(e.target.value)}
                      className="w-full min-h-[46px] rounded-xl border border-white/15 bg-[#121212] px-3.5 py-2.5 text-sm font-medium text-white focus:border-[#1DB954] focus:outline-none"
                    >
                      {sellablePlans.length === 0 ? (
                        <option value="">No live plans available</option>
                      ) : (
                        sellablePlans.map((plan) => (
                          <option key={plan.id} value={plan.id}>
                            {plan.name} ({formatPlanPrice(plan)})
                          </option>
                        ))
                      )}
                    </select>
                    {sellablePlans.length === 0 && (
                      <p className="mt-1.5 text-[11px] text-amber-400">
                        Add live plans in the Subscriptions tab first.
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="new-group-slots"
                      className="block text-sm font-medium text-white mb-1.5"
                    >
                      Max slots in group
                    </label>
                    <input
                      id="new-group-slots"
                      type="number"
                      min={2}
                      max={200}
                      value={newGroupMaxSlots}
                      onChange={(e) => setNewGroupMaxSlots(e.target.value)}
                      className="w-full min-h-[46px] rounded-xl border border-white/15 bg-[#121212] px-4 py-2.5 text-sm font-mono text-white focus:border-[#1DB954] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="new-group-address"
                      className="block text-sm font-medium text-white mb-1.5"
                    >
                      Home address
                    </label>
                    <input
                      id="new-group-address"
                      type="text"
                      placeholder="e.g. 22 Bourdillon Road, Ikoyi, Lagos"
                      value={newGroupAddress}
                      onChange={(e) => setNewGroupAddress(e.target.value)}
                      className="w-full min-h-[46px] rounded-xl border border-white/15 bg-[#121212] px-4 py-2.5 text-sm text-white placeholder:text-[#B3B3B3]/50 focus:border-[#1DB954] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="new-group-invite"
                      className="block text-sm font-medium text-white mb-1.5"
                    >
                      Invite Link (optional)
                    </label>
                    <input
                      id="new-group-invite"
                      type="url"
                      placeholder="Leave blank for auto-generated link"
                      value={newGroupInviteLink}
                      onChange={(e) => setNewGroupInviteLink(e.target.value)}
                      className="w-full min-h-[46px] rounded-xl border border-white/15 bg-[#121212] px-4 py-2.5 text-sm text-white placeholder:text-[#B3B3B3]/50 focus:border-[#1DB954] focus:outline-none"
                    />
                  </div>
                </div>

                {groupFormError && (
                  <p className="text-xs text-red-400" role="alert">
                    {groupFormError}
                  </p>
                )}

                <div className="pt-1 flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={isCreatingGroup || (sellablePlans.length === 0 && newGroupPlanId === '')}
                    className="inline-flex items-center justify-center gap-2 min-h-[46px] rounded-full bg-[#1DB954] px-7 py-2.5 text-sm font-bold text-black hover:bg-[#15803D] hover:text-white transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {isCreatingGroup ? (
                      <span>Creating group…</span>
                    ) : (
                      <>
                        <Plus className="h-4 w-4" aria-hidden="true" />
                        <span>Create Group &amp; Generate Code</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}

            {visibleGroups.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-[#181818] p-10 text-center space-y-4">
                <Layers className="h-10 w-10 text-[#1DB954] mx-auto" aria-hidden="true" />
                <div>
                  <h3 className="text-lg font-bold text-white">
                    {isSupport && supportPermissions.viewScope === 'unpaid-only'
                      ? 'No Unpaid Members Found'
                      : 'No subscription groups have been created yet.'}
                  </h3>
                  <p className="mt-1.5 text-sm text-[#B3B3B3] max-w-md mx-auto">
                    {isSupport && supportPermissions.viewScope === 'unpaid-only'
                      ? 'There are currently no groups with members who have not paid yet.'
                      : 'Groups created from the admin workspace are stored permanently. Everyone in a group shares its unique code, address, and invite link.'}
                  </p>
                </div>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setShowCreateGroupForm(true)}
                    className="inline-flex items-center gap-2 min-h-[44px] rounded-full bg-[#1DB954] px-6 py-2.5 text-sm font-bold text-black transition-colors hover:bg-[#15803D] hover:text-white cursor-pointer"
                  >
                    <FolderPlus className="h-4 w-4" aria-hidden="true" />
                    <span>Create Your First Group</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left Column: Groups */}
                <div className="lg:col-span-4 space-y-3">
                  {visibleGroups.map((grp) => {
                    const isSelected = grp.id === selectedGroup?.id;
                    const leader = grp.members.find((m) => m.isLeader);
                    const unpaidCount = grp.members.filter(
                      (m) => m.paymentStatus === 'Unpaid' && (m.approvalStatus ?? 'approved') === 'approved'
                    ).length;
                    const activeCount = grp.members.filter(
                      (m) => m.paymentStatus !== 'Cancelled' && (m.approvalStatus ?? 'approved') === 'approved'
                    ).length;

                    return (
                      <button
                        key={grp.id}
                        type="button"
                        onClick={() => setSelectedGroupId(grp.id)}
                        className={`w-full rounded-2xl border p-4 text-left transition-colors cursor-pointer ${
                          isSelected
                            ? 'border-[#1DB954] bg-[#181818]'
                            : 'border-white/10 bg-[#121212] hover:border-white/25'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            {(isAdmin || supportPermissions.showGroupCodes) && (
                              <p className="font-mono text-xs font-extrabold text-[#1DB954] tabular-nums">
                                Code {grp.groupCode}
                              </p>
                            )}
                            <h3 className="mt-1 text-base font-bold text-white truncate">
                              {grp.groupName}
                            </h3>
                            <p className="text-xs text-[#B3B3B3] truncate">{grp.planName}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {activeCount >= grp.maxSlots && (
                              <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-amber-400">
                                FULL
                              </span>
                            )}
                            <span className="font-mono text-xs font-semibold text-white tabular-nums">
                              {activeCount}/{grp.maxSlots}
                            </span>
                          </div>
                        </div>

                        <div className="mt-3 pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="inline-flex items-center gap-1.5 text-[#B3B3B3] truncate">
                            <Crown
                              className="h-3.5 w-3.5 text-[#1DB954] shrink-0"
                              aria-hidden="true"
                            />
                            <span className="truncate">
                              {leader ? leader.fullName : 'No leader set'}
                            </span>
                          </span>
                          {unpaidCount > 0 && (
                            <span className="font-semibold text-amber-400 tabular-nums">
                              {unpaidCount} unpaid
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Right Column: Selected Group Inspector & Member Roster */}
                {selectedGroup && (
                  <div className="lg:col-span-8 space-y-6">
                    {/* Admin-only Group Home Address & Invite Link Config Card */}
                    {isAdmin && (
                      <div className="rounded-2xl border border-white/10 bg-[#181818] p-5 sm:p-7 space-y-5">
                        <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-white/10">
                          <div>
                            <div className="flex flex-wrap items-center gap-2.5 text-xs">
                              <span className="font-semibold uppercase tracking-wider text-[#1DB954]">
                                {selectedGroup.planName}
                              </span>
                              <span className="text-white/25">·</span>
                              <span className="font-mono text-[#B3B3B3] tabular-nums">
                                Created {formatDisplayDate(selectedGroup.createdAt)}
                              </span>
                              <span className="text-white/25">·</span>
                              <span className="font-mono font-semibold text-white tabular-nums">
                                {selectedGroup.members.filter((m) => m.paymentStatus !== 'Cancelled' && (m.approvalStatus ?? 'approved') === 'approved').length}/{selectedGroup.maxSlots} approved seats
                              </span>
                              {selectedGroup.members.filter((m) => m.paymentStatus !== 'Cancelled' && (m.approvalStatus ?? 'approved') === 'approved').length >= selectedGroup.maxSlots && (
                                <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-amber-400">
                                  FULL
                                </span>
                              )}
                            </div>
                            <h3 className="mt-1 text-xl font-extrabold text-white">
                              {selectedGroup.groupName}
                            </h3>
                          </div>

                          <div className="flex flex-wrap items-center gap-2.5">
                            <div className="flex items-center gap-2 rounded-xl border border-[#1DB954]/40 bg-[#121212] px-3.5 py-2">
                              <Hash className="h-4 w-4 text-[#1DB954]" aria-hidden="true" />
                              <span className="font-mono text-sm font-extrabold text-[#1DB954] tabular-nums">
                                {selectedGroup.groupCode}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  void handleCopyGroupCode(
                                    selectedGroup.id,
                                    selectedGroup.groupCode
                                  )
                                }
                                aria-label="Copy group code"
                                className="ml-1 text-[#B3B3B3] hover:text-white cursor-pointer"
                              >
                                {copiedCodeGroupId === selectedGroup.id ? (
                                  <Check className="h-3.5 w-3.5 text-[#1DB954]" />
                                ) : (
                                  <Copy className="h-3.5 w-3.5" />
                                )}
                              </button>
                            </div>

                            <button
                              type="button"
                              onClick={handleDispatchInbox}
                              className="inline-flex items-center gap-1.5 min-h-[40px] rounded-full bg-[#1DB954] px-4 py-2 text-xs font-bold text-black hover:bg-[#15803D] hover:text-white transition-colors cursor-pointer"
                            >
                              <Send className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Copy Invite Link</span>
                            </button>

                            {isAdmin && (
                              <button
                                type="button"
                                onClick={() =>
                                  confirmDeleteGroupId === selectedGroup.id
                                    ? void handleDeleteGroup()
                                    : setConfirmDeleteGroupId(selectedGroup.id)
                                }
                                title="Delete permanently (groups with member history cannot be deleted)"
                                aria-label="Delete group"
                                className="inline-flex items-center gap-1.5 min-h-[40px] rounded-full border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs font-bold text-red-300 transition-colors hover:bg-red-500/20 hover:text-white cursor-pointer"
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>
                                  {confirmDeleteGroupId === selectedGroup.id
                                    ? 'Confirm delete'
                                    : 'Delete group'}
                                </span>
                              </button>
                            )}
                          </div>
                        </div>

                        <form onSubmit={handleUpdateGroupSubmit} noValidate className="space-y-4">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <label
                                htmlFor="edit-group-name"
                                className="block text-xs font-medium text-[#B3B3B3] mb-1.5"
                              >
                                Group Name
                              </label>
                              <input
                                id="edit-group-name"
                                type="text"
                                value={editGroupName}
                                onChange={(e) => setEditGroupName(e.target.value)}
                                className="w-full min-h-[44px] rounded-xl border border-white/15 bg-[#121212] px-3.5 py-2 text-sm text-white focus:border-[#1DB954] focus:outline-none"
                              />
                            </div>

                            <div>
                              <label
                                htmlFor="edit-invite-link"
                                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#B3B3B3] mb-1.5"
                              >
                                <ExternalLink
                                  className="h-3.5 w-3.5 text-[#1DB954]"
                                  aria-hidden="true"
                                />
                                <span>Invite Link</span>
                              </label>
                              <div className="flex items-stretch gap-2">
                                <input
                                  id="edit-invite-link"
                                  type="url"
                                  value={editInviteLink}
                                  onChange={(e) => setEditInviteLink(e.target.value)}
                                  className="w-full min-h-[44px] rounded-xl border border-white/15 bg-[#121212] px-3.5 py-2 text-sm font-mono text-white focus:border-[#1DB954] focus:outline-none"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    try {
                                      void navigator.clipboard?.writeText(editInviteLink || selectedGroup.inviteLink);
                                      showNotice('Invite link copied to clipboard.');
                                    } catch {
                                      showNotice('Share the invite link manually from the field above.');
                                    }
                                  }}
                                  aria-label="Copy invite link"
                                  title="Copy invite link"
                                  className="shrink-0 inline-flex w-11 items-center justify-center rounded-xl border border-white/15 text-[#1DB954] hover:border-[#1DB954] transition-colors cursor-pointer"
                                >
                                  <Copy className="h-4 w-4" aria-hidden="true" />
                                </button>
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <label
                                htmlFor="edit-capacity"
                                className="block text-xs font-medium text-[#B3B3B3] mb-1.5"
                              >
                                Max Members (Increase only)
                              </label>
                              <input
                                id="edit-capacity"
                                type="number"
                                min={Math.max(2, selectedGroup.members.filter((m) => m.paymentStatus !== 'Cancelled').length)}
                                max={200}
                                value={editGroupCapacity}
                                onChange={(e) => setEditGroupCapacity(e.target.value)}
                                className="w-full min-h-[44px] rounded-xl border border-white/15 bg-[#121212] px-3.5 py-2 text-sm font-mono text-white focus:border-[#1DB954] focus:outline-none"
                              />
                            </div>

                            <div>
                              <label
                                htmlFor="edit-home-address"
                                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#B3B3B3] mb-1.5"
                              >
                                <MapPin className="h-3.5 w-3.5 text-[#1DB954]" aria-hidden="true" />
                                <span>Group Home Address</span>
                              </label>
                              <input
                                id="edit-home-address"
                                type="text"
                                value={editHomeAddress}
                                onChange={(e) => setEditHomeAddress(e.target.value)}
                                className="w-full min-h-[44px] rounded-xl border border-white/15 bg-[#121212] px-3.5 py-2 text-sm text-white focus:border-[#1DB954] focus:outline-none"
                              />
                            </div>
                          </div>

                          {editGroupError && (
                            <p className="text-xs text-red-400" role="alert">
                              {editGroupError}
                            </p>
                          )}

                          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                            <p className="text-xs text-[#B3B3B3]">
                              All members placed in{' '}
                              <strong className="text-white">{selectedGroup.groupCode}</strong>{' '}
                              share this address and invite link.
                            </p>
                            <button
                              type="submit"
                              className="inline-flex items-center justify-center min-h-[42px] rounded-full border border-[#1DB954] bg-[#121212] px-5 py-2 text-xs font-bold text-[#1DB954] hover:bg-[#1DB954] hover:text-black transition-colors cursor-pointer"
                            >
                              Save Group Details
                            </button>
                          </div>
                        </form>
                      </div>
                    )}

                    {/* Group Members Roster (Interactive Clickable Names) */}
                    <div className="rounded-2xl border border-white/10 bg-[#181818] p-5 sm:p-7 space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-white/10">
                        <div>
                          <h3 className="text-lg font-bold text-white">
                            {isSupport && supportPermissions.viewScope === 'unpaid-only'
                              ? `Unpaid Members in ${selectedGroup.groupName} (${displayedGroupMembers.length})`
                              : `Join Requests & Members in ${selectedGroup.groupName} (${displayedGroupMembers.length})`}
                          </h3>
                          <p className="text-xs text-[#B3B3B3]">
                            Click a member&apos;s name to view full info, contact them, or collect payment
                            {(isAdmin || supportPermissions.showGroupCodes) && (
                              <>
                                {' '}
                                · Code{' '}
                                <span className="font-mono text-[#1DB954]">
                                  {selectedGroup.groupCode}
                                </span>
                              </>
                            )}
                            .
                          </p>
                        </div>
                      </div>

                      {selectedGroup.members.some((m) => (m.approvalStatus ?? 'approved') === 'pending') && (
                        <p className="-mt-2 text-xs font-semibold text-amber-300">
                          {selectedGroup.members.filter((m) => (m.approvalStatus ?? 'approved') === 'pending').length} waiting for approval; these requests are not counted as approved seats.
                        </p>
                      )}
                      {displayedGroupMembers.length === 0 ? (
                        <div className="py-10 text-center text-sm text-[#B3B3B3]">
                          No members match this view in {selectedGroup.groupName}.
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {displayedGroupMembers.map((member) => {
                            const isConfirmingRemove = confirmRemoveMemberId === member.id;
                            const statusColorMap: Record<GroupMemberPaymentStatus, string> = {
                              Paid: 'text-[#1DB954]',
                              Unpaid: 'text-amber-400',
                              Cancelled: 'text-red-400',
                            };
                            const canSeeContact = isAdmin || supportPermissions.canViewContactDetails;
                            const canCollect =
                              member.paymentStatus === 'Unpaid' &&
                              (member.approvalStatus ?? 'approved') === 'approved' &&
                              (isAdmin || supportPermissions.canCollectPayments);
                            const canRemove =
                              isAdmin ||
                              (isSupport &&
                                supportPermissions.canRemoveUnpaidMembers &&
                                member.paymentStatus === 'Unpaid');

                            return (
                              <div
                                key={member.id}
                                className={`rounded-xl border p-4 transition-colors ${
                                  member.isLeader
                                    ? 'border-[#1DB954]/50 bg-[#121212]'
                                    : 'border-white/10 bg-[#121212]'
                                }`}
                              >
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                                  <div className="min-w-0 space-y-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleOpenMemberModal(selectedGroup.id, member)
                                        }
                                        className="group inline-flex items-center gap-1 text-base font-bold text-white hover:text-[#1DB954] transition-colors cursor-pointer text-left"
                                      >
                                        <span className="underline decoration-white/25 underline-offset-4 group-hover:decoration-[#1DB954]">
                                          {member.fullName}
                                        </span>
                                        <ChevronRight
                                          className="h-4 w-4 text-[#B3B3B3] group-hover:text-[#1DB954] transition-transform group-hover:translate-x-0.5"
                                          aria-hidden="true"
                                        />
                                      </button>

                                      {member.isLeader && (
                                        <span className="inline-flex items-center gap-1 text-xs font-bold text-[#1DB954]">
                                          <Crown className="h-3.5 w-3.5" aria-hidden="true" />
                                          <span>Group Leader</span>
                                        </span>
                                      )}
                                      <span className="text-white/25">·</span>
                                      <span className="font-mono text-xs font-semibold text-[#B3B3B3] tabular-nums">
                                        Ref {member.referenceId}
                                      </span>
                                    </div>

                                    {canSeeContact ? (
                                      <p className="text-xs text-[#B3B3B3] break-all">
                                        {member.email} ·{' '}
                                        <span className="font-mono">{member.whatsappNumber}</span>
                                      </p>
                                    ) : (
                                      <p className="text-xs text-[#B3B3B3]/70">
                                        Contact details hidden by Admin Settings
                                      </p>
                                    )}

                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs pt-0.5">
                                      <span
                                        className={`inline-flex items-center gap-1 font-semibold ${
                                          statusColorMap[member.paymentStatus]
                                        }`}
                                      >
                                        {member.paymentStatus === 'Paid' && (
                                          <CheckCircle2
                                            className="h-3.5 w-3.5"
                                            aria-hidden="true"
                                          />
                                        )}
                                        {member.paymentStatus !== 'Paid' && (
                                          <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                                        )}
                                        <span>{member.paymentStatus}</span>
                                      </span>
                                      <span className="text-white/25">·</span>
                                      <span className={member.approvalStatus === 'pending' ? 'font-semibold text-amber-300' : 'text-[#B3B3B3]'}>
                                        {member.approvalStatus === 'pending'
                                          ? 'Awaiting approval'
                                          : member.approvalStatus === 'rejected'
                                            ? 'Not approved'
                                            : 'Approved'}
                                      </span>
                                      {member.firstPaymentDueDate && member.approvalStatus === 'approved' && (
                                        <>
                                          <span className="text-white/25">·</span>
                                          <span className="text-[#B3B3B3]">
                                            First payment due {formatDisplayDate(member.firstPaymentDueDate)}
                                          </span>
                                        </>
                                      )}
                                      <span className="text-white/25">·</span>
                                      <span className="text-[#B3B3B3]">
                                        Payer: {member.payerLabel}
                                      </span>
                                      <span className="text-white/25">·</span>
                                      <span
                                        className={
                                          member.contacted
                                            ? 'text-[#1DB954] font-medium'
                                            : 'text-[#B3B3B3]'
                                        }
                                      >
                                        {member.contacted ? 'Contacted by Support' : 'Not contacted yet'}
                                      </span>
                                    </div>
                                  </div>

                                  {/* Member Row Actions */}
                                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                                    {isAdmin && member.approvalStatus === 'pending' && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          onApproveGroupMember(member.id);
                                          showNotice(`${member.fullName} approved. First payment is due the next day.`);
                                        }}
                                        className="inline-flex items-center gap-1.5 min-h-[38px] rounded-full bg-[#1DB954] px-3.5 py-1.5 text-xs font-bold text-black hover:bg-[#15803D] hover:text-white transition-colors cursor-pointer"
                                      >
                                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                                        <span>Approve Join</span>
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => handleOpenMemberModal(selectedGroup.id, member)}
                                      className="inline-flex items-center gap-1.5 min-h-[38px] rounded-full border border-white/15 bg-[#181818] px-3.5 py-1.5 text-xs font-semibold text-white hover:border-[#1DB954] hover:text-[#1DB954] transition-colors cursor-pointer"
                                    >
                                      <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                                      <span>View / Contact</span>
                                    </button>

                                    {canCollect && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          onCollectMemberPayment(
                                            selectedGroup.id,
                                            member.id,
                                            portalRole
                                          );
                                          showNotice(
                                            `Marked ${member.fullName} as paid. Verified totals include recorded payment transactions only.`
                                          );
                                        }}
                                        className="inline-flex items-center gap-1.5 min-h-[38px] rounded-full bg-[#1DB954] px-3.5 py-1.5 text-xs font-bold text-black hover:bg-[#15803D] hover:text-white transition-colors cursor-pointer"
                                      >
                                        <Banknote className="h-3.5 w-3.5" aria-hidden="true" />
                                        <span>Collect Payment</span>
                                      </button>
                                    )}

                                    {isAdmin && !member.isLeader && member.paymentStatus !== 'Cancelled' && member.approvalStatus !== 'pending' && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          onSetGroupLeader(selectedGroup.id, member.id);
                                          showNotice(
                                            `${member.fullName} is now the Group Leader for ${selectedGroup.groupName}.`
                                          );
                                        }}
                                        className="inline-flex items-center gap-1.5 min-h-[38px] rounded-full border border-white/15 bg-[#181818] px-3.5 py-1.5 text-xs font-semibold text-white hover:border-[#1DB954] hover:text-[#1DB954] transition-colors cursor-pointer"
                                      >
                                        <Crown className="h-3.5 w-3.5" aria-hidden="true" />
                                        <span>Set Leader</span>
                                      </button>
                                    )}

                                    {isAdmin && member.paymentStatus === 'Paid' && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          onToggleMemberPaymentStatus(selectedGroup.id, member.id)
                                        }
                                        className="inline-flex items-center gap-1.5 min-h-[38px] rounded-full border border-white/15 bg-[#181818] px-3.5 py-1.5 text-xs font-semibold text-white hover:border-amber-400 hover:text-amber-300 transition-colors cursor-pointer"
                                      >
                                        <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                                        <span>Mark Unpaid</span>
                                      </button>
                                    )}

                                    {canRemove &&
                                      (!isConfirmingRemove ? (
                                        <button
                                          type="button"
                                          onClick={() => setConfirmRemoveMemberId(member.id)}
                                          className="inline-flex items-center gap-1.5 min-h-[38px] rounded-full border border-red-500/40 bg-red-500/10 px-3.5 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/20 hover:text-white transition-colors cursor-pointer"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                          <span>Remove</span>
                                        </button>
                                      ) : (
                                        <div className="flex items-center gap-1.5">
                                          <button
                                            type="button"
                                            onClick={() => {
                                              onRemoveGroupMember(selectedGroup.id, member.id);
                                              setConfirmRemoveMemberId(null);
                                              showNotice(
                                                `Removed ${member.fullName} from ${selectedGroup.groupName}.`
                                              );
                                            }}
                                            className="min-h-[38px] rounded-full bg-red-500 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-red-600 transition-colors cursor-pointer"
                                          >
                                            Confirm Remove
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setConfirmRemoveMemberId(null)}
                                            className="min-h-[38px] rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-[#B3B3B3] hover:text-white transition-colors cursor-pointer"
                                          >
                                            Cancel
                                          </button>
                                        </div>
                                      ))}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: ADMIN-ONLY SUBSCRIPTIONS CATALOG */}
        {isAdmin && activeTab === 'subscriptions' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 space-y-4">
              <div>
                <h2 className="text-lg font-bold text-white">
                  Listed Subscriptions ({plans.length})
                </h2>
                <p className="text-xs sm:text-sm text-[#B3B3B3]">
                  Toggle whether a subscription is open for immediate slot joins or on waitlist.
                </p>
              </div>

              <div className="space-y-3">
                {plans.map((plan, index) => (
                  <div
                    key={plan.id}
                    className="rounded-2xl border border-white/10 bg-[#181818] p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-semibold text-[#1DB954]">{plan.category}</span>
                        <span className="text-white/25">·</span>
                        <span className="font-mono text-[#B3B3B3] tabular-nums">
                          {plan.slotsOpen}/{plan.totalSlots} slots open
                        </span>
                      </div>
                      <h3 className="text-lg font-bold text-white">{plan.name}</h3>
                      <p className="text-xs sm:text-sm text-[#B3B3B3]">{plan.description}</p>
                    </div>

                    <div className="flex flex-wrap sm:flex-col items-center sm:items-end justify-between gap-3 shrink-0">
                      <span className="font-mono text-lg font-extrabold text-[#1DB954] tabular-nums">
                        {formatPlanPrice(plan)}
                      </span>
                      <div className="flex items-center gap-2">
                        <button type="button" aria-label={`Move ${plan.name} up`} title="Move up" disabled={index === 0} onClick={() => { void onMovePlan(plan.id, 'up').catch(() => undefined); }} className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-[#121212] text-white hover:border-[#1DB954] hover:text-[#1DB954] disabled:cursor-not-allowed disabled:opacity-35"><ChevronUp className="h-4 w-4" aria-hidden="true" /></button>
                        <button type="button" aria-label={`Move ${plan.name} down`} title="Move down" disabled={index === plans.length - 1} onClick={() => { void onMovePlan(plan.id, 'down').catch(() => undefined); }} className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-[#121212] text-white hover:border-[#1DB954] hover:text-[#1DB954] disabled:cursor-not-allowed disabled:opacity-35"><ChevronDown className="h-4 w-4" aria-hidden="true" /></button>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await onTogglePlanStatus(plan.id);
                            showNotice(`Updated ${plan.name} status to ${plan.status === 'available' ? 'Waitlist' : 'Open'}.`);
                          } catch {
                            // The app reports the database error to the administrator.
                          }
                        }}
                        className={`min-h-[38px] rounded-full px-4 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
                          plan.status === 'available'
                            ? 'bg-[#1DB954]/15 border border-[#1DB954] text-[#1DB954] hover:bg-[#1DB954] hover:text-black'
                            : 'bg-[#121212] border border-white/20 text-white hover:border-[#1DB954] hover:text-[#1DB954]'
                        }`}
                      >
                        {plan.status === 'available'
                          ? 'Open · Switch to Waitlist'
                          : 'Waitlist · Open Plan'}
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${plan.name} listing`}
                        title="Delete listing"
                        onClick={async () => {
                          const confirmed = window.confirm(
                            `Remove ${plan.name} from the user marketplace? Existing groups and payment history will be kept.`
                          );
                          if (!confirmed) return;
                          try {
                            await onDeletePlan(plan.id);
                            showNotice(`${plan.name} was removed from the marketplace.`);
                          } catch {
                            // The app reports the database error to the administrator.
                          }
                        }}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-red-400/40 bg-[#121212] text-red-300 hover:border-red-400 hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-5">
              <form
                onSubmit={handleAddPlanSubmit}
                noValidate
                className="rounded-2xl border border-white/10 bg-[#181818] p-5 sm:p-7 space-y-4"
              >
                <div className="pb-3 border-b border-white/10">
                  <h2 className="text-lg font-bold text-white">List New Subscription</h2>
                  <p className="text-xs text-[#B3B3B3]">
                    Publish a new subscription option to Available Plans on the user site.
                  </p>
                </div>

                <div>
                  <label htmlFor="plan-name" className="block text-sm font-medium text-white mb-1.5">
                    Subscription name
                  </label>
                  <input
                    id="plan-name"
                    type="text"
                    placeholder="e.g. Netflix Shared Queue"
                    value={planName}
                    onChange={(e) => setPlanName(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-white/15 bg-[#121212] px-4 py-2 text-sm text-white placeholder:text-[#B3B3B3]/50 focus:border-[#1DB954] focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="plan-category"
                    className="block text-sm font-medium text-white mb-1.5"
                  >
                    Category
                  </label>
                  <input
                    id="plan-category"
                    type="text"
                    placeholder="e.g. Video Streaming"
                    value={planCategory}
                    onChange={(e) => setPlanCategory(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-white/15 bg-[#121212] px-4 py-2 text-sm text-white placeholder:text-[#B3B3B3]/50 focus:border-[#1DB954] focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="plan-description"
                    className="block text-sm font-medium text-white mb-1.5"
                  >
                    Description
                  </label>
                  <textarea
                    id="plan-description"
                    rows={3}
                    placeholder="Describe what members enjoy in this queue..."
                    value={planDescription}
                    onChange={(e) => setPlanDescription(e.target.value)}
                    className="w-full rounded-xl border border-white/15 bg-[#121212] px-4 py-2.5 text-sm text-white placeholder:text-[#B3B3B3]/50 focus:border-[#1DB954] focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="plan-price"
                      className="block text-sm font-medium text-white mb-1.5"
                    >
                      Monthly price (₦)
                    </label>
                    <input
                      id="plan-price"
                      type="number"
                      min={100}
                      step={50}
                      value={planPrice}
                      onChange={(e) => setPlanPrice(e.target.value)}
                      className="w-full min-h-[44px] rounded-xl border border-white/15 bg-[#121212] px-4 py-2 text-sm font-mono text-white focus:border-[#1DB954] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="plan-slots"
                      className="block text-sm font-medium text-white mb-1.5"
                    >
                      Total slots
                    </label>
                    <input
                      id="plan-slots"
                      type="number"
                      min={1}
                      max={50}
                      value={planSlots}
                      onChange={(e) => setPlanSlots(e.target.value)}
                      className="w-full min-h-[44px] rounded-xl border border-white/15 bg-[#121212] px-4 py-2 text-sm font-mono text-white focus:border-[#1DB954] focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="plan-status"
                    className="block text-sm font-medium text-white mb-1.5"
                  >
                    Initial availability
                  </label>
                  <select
                    id="plan-status"
                    value={planInitialStatus}
                    onChange={(e) => setPlanInitialStatus(e.target.value as PlanStatus)}
                    className="w-full min-h-[44px] rounded-xl border border-white/15 bg-[#121212] px-3.5 py-2 text-sm font-medium text-white focus:border-[#1DB954] focus:outline-none"
                  >
                    <option value="available">Available Now (Open Slots)</option>
                    <option value="waitlist">Waitlist Open</option>
                  </select>
                </div>

                {planFormError && (
                  <p className="text-xs text-red-400" role="alert">
                    {planFormError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={isSavingPlan}
                  className="w-full inline-flex items-center justify-center gap-2 min-h-[46px] rounded-full bg-[#1DB954] px-6 py-3 text-sm font-bold text-black hover:bg-[#15803D] hover:text-white transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  <span>{isSavingPlan ? 'Saving…' : `List Subscription · ${formatAmount(Number(planPrice) || 0)}/mo`}</span>
                </button>
              </form>
            </div>
          </div>
        )}

        {/* TAB 3: ADMIN-ONLY FINANCIALS OVERVIEW & LEDGER */}
        {isAdmin && activeTab === 'financials' && (
          <div className="space-y-6">
            {/* Top Financial KPIs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="rounded-2xl border border-[#1DB954]/40 bg-[#181818] p-5">
                <p className="text-xs font-medium text-[#B3B3B3]">Confirmed Payments on Platform</p>
                <p className="mt-2 font-mono text-2xl sm:text-3xl font-extrabold text-[#1DB954] tabular-nums">
                  {formatAmount(totalPlatformPaid)}
                </p>
                <p className="mt-1 text-xs text-[#B3B3B3]">
                  Across {transactions.length} recorded transactions
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-[#181818] p-5">
                <p className="text-xs font-medium text-[#B3B3B3]">Pending Unpaid Dues</p>
                <p className="mt-2 font-mono text-2xl sm:text-3xl font-extrabold text-amber-400 tabular-nums">
                  {formatAmount(totalOutstandingUnpaid)}
                </p>
                <p className="mt-1 text-xs text-[#B3B3B3]">
                  {unpaidMembersCount} {unpaidMembersCount === 1 ? 'member' : 'members'} awaiting payment
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-[#181818] p-5">
                <p className="text-xs font-medium text-[#B3B3B3]">Collected by Customer Care</p>
                <p className="mt-2 font-mono text-2xl sm:text-3xl font-extrabold text-white tabular-nums">
                  {formatAmount(supportCollectedAmount)}
                </p>
                <p className="mt-1 text-xs text-[#B3B3B3]">
                  {supportCollectedTransactions.length} payments collected by support
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-[#181818] p-5">
                <p className="text-xs font-medium text-[#B3B3B3]">Group Collection Rate</p>
                <p className="mt-2 font-mono text-2xl sm:text-3xl font-extrabold text-white tabular-nums">
                  {totalMembersCount > 0
                    ? `${Math.round((paidMembersCount / totalMembersCount) * 100)}%`
                    : '0%'}
                </p>
                <p className="mt-1 text-xs text-[#B3B3B3]">
                  {paidMembersCount} paid of {totalMembersCount} total members
                </p>
              </div>
            </div>

            {/* Group Revenue Breakdown */}
            <div className="rounded-2xl border border-white/10 bg-[#181818] p-5 sm:p-7 space-y-4">
              <div>
                <h2 className="text-lg font-bold text-white">Revenue &amp; Dues by Group</h2>
                <p className="text-xs sm:text-sm text-[#B3B3B3]">
                  See how much has been paid and what remains unpaid for each subscription group.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {groups.map((grp) => {
                  const grpPlan = plans.find((p) => p.id === grp.planId) ?? plans[0];
                  const grpPaidTotal = transactions
                    .filter((t) => t.groupCode === grp.groupCode && t.status === 'Confirmed')
                    .reduce((sum, t) => sum + t.amount, 0);
              const grpUnpaidCount = grp.members.filter(
                    (m) => m.paymentStatus === 'Unpaid' && (m.approvalStatus ?? 'approved') === 'approved'
                  ).length;
                  const grpPendingTotal = grpUnpaidCount * grpPlan.priceMonthly;

                  return (
                    <div
                      key={grp.id}
                      className="rounded-xl border border-white/10 bg-[#121212] p-4 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-mono text-xs font-bold text-[#1DB954]">
                            Code {grp.groupCode} · {grp.planName}
                          </p>
                          <h3 className="mt-0.5 text-base font-bold text-white">{grp.groupName}</h3>
                        </div>
                        <span className="font-mono text-base font-extrabold text-[#1DB954] tabular-nums">
                          {formatAmount(grpPaidTotal)}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/10 text-xs">
                        <span className="text-[#B3B3B3]">
                          {grp.members.filter((m) => m.paymentStatus === 'Paid').length} paid ·{' '}
                          {grpUnpaidCount} unpaid
                        </span>
                        <span className="font-mono text-amber-400 tabular-nums">
                          Pending: {formatAmount(grpPendingTotal)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Platform Payment Ledger Table */}
            <div className="rounded-2xl border border-white/10 bg-[#181818] p-5 sm:p-7 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-white/10">
                <div>
                  <h2 className="text-lg font-bold text-white">Platform Payment Ledger</h2>
                  <p className="text-xs sm:text-sm text-[#B3B3B3]">
                    Complete record of user checkouts, renewals, sponsored slots, and support collections.
                  </p>
                </div>

                <div
                  role="tablist"
                  aria-label="Filter platform ledger"
                  className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-[#121212] p-1 self-start sm:self-auto"
                >
                  {(
                    [
                      { id: 'all', label: 'All Payments' },
                      { id: 'users', label: 'User & Renewals' },
                      { id: 'support', label: 'Support Collected' },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={txFilter === tab.id}
                      onClick={() => setTxFilter(tab.id)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                        txFilter === tab.id
                          ? 'bg-[#1DB954] text-black'
                          : 'text-[#B3B3B3] hover:text-white'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {filteredTransactions.length === 0 ? (
                <div className="py-10 text-center text-sm text-[#B3B3B3]">
                  No transactions match this filter yet.
                </div>
              ) : (
                <>
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-white/10 text-xs font-semibold uppercase tracking-wider text-[#B3B3B3]">
                          <th className="py-3 pr-4">Reference</th>
                          <th className="py-3 px-4">Date</th>
                          <th className="py-3 px-4">Member / Payer</th>
                          <th className="py-3 px-4">Plan &amp; Group</th>
                          <th className="py-3 px-4">Source</th>
                          <th className="py-3 pl-4 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/10 text-sm">
                        {filteredTransactions.map((tx) => (
                          <tr key={tx.id} className="hover:bg-[#121212]/60 transition-colors">
                            <td className="py-3.5 pr-4 font-mono text-xs text-white tabular-nums whitespace-nowrap">
                              {tx.referenceId}
                            </td>
                            <td className="py-3.5 px-4 text-[#B3B3B3] tabular-nums whitespace-nowrap">
                              {formatDisplayDate(tx.date)}
                            </td>
                            <td className="py-3.5 px-4 font-semibold text-white">
                              {tx.memberName}
                            </td>
                            <td className="py-3.5 px-4 text-[#B3B3B3]">
                              {tx.planName}
                              {tx.groupCode ? (
                                <span className="ml-1.5 font-mono text-xs text-[#1DB954]">
                                  ({tx.groupCode})
                                </span>
                              ) : null}
                            </td>
                            <td className="py-3.5 px-4 text-xs font-medium text-[#B3B3B3] whitespace-nowrap">
                              {tx.source}
                            </td>
                            <td className="py-3.5 pl-4 text-right font-mono font-bold text-[#1DB954] tabular-nums whitespace-nowrap">
                              {formatAmount(tx.amount, tx.currencySymbol)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Transaction Cards */}
                  <div className="md:hidden space-y-3">
                    {filteredTransactions.map((tx) => (
                      <div
                        key={tx.id}
                        className="rounded-xl border border-white/10 bg-[#121212] p-4 space-y-2 text-sm"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-white">{tx.memberName}</p>
                            <p className="text-xs text-[#B3B3B3]">
                              {tx.planName}
                              {tx.groupCode ? ` · ${tx.groupCode}` : ''}
                            </p>
                          </div>
                          <span className="font-mono font-bold text-[#1DB954] tabular-nums">
                            {formatAmount(tx.amount, tx.currencySymbol)}
                          </span>
                        </div>
                        <div className="pt-2 border-t border-white/10 flex items-center justify-between text-xs text-[#B3B3B3] tabular-nums">
                          <span>
                            {tx.referenceId} · {tx.source}
                          </span>
                          <span>{formatDisplayDate(tx.date)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: ADMIN SETTINGS (Customer Care Permissions & Role Preview) */}
        {isAdmin && activeTab === 'settings' && (
          <div className="space-y-6">
            {isSuperAdmin && <SupportSocialsPanel />}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8 rounded-2xl border border-white/10 bg-[#181818] p-5 sm:p-7 space-y-6">
              <div className="pb-4 border-b border-white/10">
                <p className="text-xs font-semibold uppercase tracking-wider text-[#1DB954]">
                  Admin Settings
                </p>
                <h2 className="mt-1 text-xl font-extrabold text-white">
                  Customer Care / Support Permissions
                </h2>
                <p className="mt-1 text-sm text-[#B3B3B3]">
                  Control exactly what Customer Care staff can see and do. Financials, Subscription Listings, Group Addresses, and Admin Settings are always hidden from Customer Care.
                </p>
              </div>

              {/* View Scope Selector */}
              <div className="space-y-3">
                <p className="text-sm font-bold text-white">
                  1. What Groups &amp; Members Customer Care Can See
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateSupportPermissions((prev) => ({
                        ...prev,
                        viewScope: 'unpaid-only',
                      }))
                    }
                    className={`rounded-xl border p-4 text-left transition-colors cursor-pointer ${
                      supportPermissions.viewScope === 'unpaid-only'
                        ? 'border-[#1DB954] bg-[#1DB954]/10'
                        : 'border-white/10 bg-[#121212] hover:border-white/30'
                    }`}
                  >
                    <p className="text-sm font-bold text-white">Unpaid Members Only</p>
                    <p className="mt-1 text-xs text-[#B3B3B3]">
                      Customer Care only sees groups and members who have not paid yet so they can follow up.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      onUpdateSupportPermissions((prev) => ({
                        ...prev,
                        viewScope: 'groups-and-members',
                      }))
                    }
                    className={`rounded-xl border p-4 text-left transition-colors cursor-pointer ${
                      supportPermissions.viewScope === 'groups-and-members'
                        ? 'border-[#1DB954] bg-[#1DB954]/10'
                        : 'border-white/10 bg-[#121212] hover:border-white/30'
                    }`}
                  >
                    <p className="text-sm font-bold text-white">All Group Members</p>
                    <p className="mt-1 text-xs text-[#B3B3B3]">
                      Customer Care sees all members inside Groups &amp; Members (Paid, Unpaid, Cancelled).
                    </p>
                  </button>
                </div>
              </div>

              {/* Granular Capability Switches */}
              <div className="space-y-3 pt-2 border-t border-white/10">
                <p className="text-sm font-bold text-white">2. Customer Care Actions &amp; Visibility</p>

                {(
                  [
                    {
                      key: 'canViewContactDetails',
                      title: 'View Member Email & WhatsApp Phone',
                      desc: 'Allow Customer Care to view and copy member contact information for reminders.',
                    },
                    {
                      key: 'canLogOutreach',
                      title: 'Log Contact Outreach & Track Progress',
                      desc: 'Allow Customer Care to mark members as contacted, add call/message notes, and track follow-up progress.',
                    },
                    {
                      key: 'canCollectPayments',
                      title: 'Collect Payments (Mark Paid)',
                      desc: 'Allow Customer Care to collect payments from unpaid members and update platform totals.',
                    },
                    {
                      key: 'showGroupCodes',
                      title: 'Show Group Codes',
                      desc: 'Display the auto-generated group code (e.g. GFT-7471) to Customer Care.',
                    },
                    {
                      key: 'canRemoveUnpaidMembers',
                      title: 'Allow Removing Unpaid Members',
                      desc: 'Keep off so only Admin can remove members, or enable if Support can remove unpaid seats.',
                    },
                  ] as const
                ).map((item) => {
                  const enabled = supportPermissions[item.key];
                  return (
                    <label
                      key={item.key}
                      className="flex items-start justify-between gap-4 rounded-xl border border-white/10 bg-[#121212] p-4 cursor-pointer hover:border-white/25 transition-colors"
                    >
                      <div className="space-y-0.5">
                        <span className="block text-sm font-semibold text-white">{item.title}</span>
                        <span className="block text-xs text-[#B3B3B3]">{item.desc}</span>
                      </div>
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          onUpdateSupportPermissions((prev) => ({
                            ...prev,
                            [item.key]: checked,
                          }));
                        }}
                        className="mt-1 h-5 w-5 rounded border-white/25 bg-[#181818] accent-[#1DB954] shrink-0 cursor-pointer"
                      />
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Right Column: Team Access (Super Admin) + Administrative Audit Log */}
            <div className="lg:col-span-4 space-y-4">
              {isSuperAdmin && (
                <SuperAdminTeamPanel
                  currentEmail={(currentUser?.email ?? '').trim().toLowerCase()}
                />
              )}
              {(isSuperAdmin || isAdmin) && <AdminAuditLogPanel />}
            </div>
            </div>
          </div>
        )}
      </div>

      {/* CLICKABLE MEMBER INFORMATION & CONTACT MODAL */}
      {inspectedMember && inspectedGroup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="member-detail-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setInspectedRef(null);
            }
          }}
        >
          <div className="my-auto w-full max-w-lg rounded-2xl border border-white/15 bg-[#181818] p-5 sm:p-7 shadow-2xl space-y-5">
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-white/10">
              <div>
                <p className="font-mono text-xs font-semibold text-[#1DB954] tabular-nums">
                  Ref {inspectedMember.referenceId}
                  {(isAdmin || supportPermissions.showGroupCodes) &&
                    ` · Group ${inspectedGroup.groupCode}`}
                </p>
                <h2 id="member-detail-title" className="mt-1 text-xl font-extrabold text-white">
                  {inspectedMember.fullName}
                </h2>
                <p className="mt-0.5 text-xs text-[#B3B3B3]">
                  {inspectedGroup.groupName} · {inspectedPlan.name} (
                  {formatPlanPrice(inspectedPlan)})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectedRef(null)}
                aria-label="Close member details"
                className="flex h-9 w-9 items-center justify-center rounded-full text-[#B3B3B3] hover:bg-[#121212] hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Member Summary & Status */}
            <div className="rounded-xl border border-white/10 bg-[#121212] p-4 space-y-2.5 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[#B3B3B3]">Payment Status</span>
                <span
                  className={`font-bold ${
                    inspectedMember.paymentStatus === 'Paid'
                      ? 'text-[#1DB954]'
                      : inspectedMember.paymentStatus === 'Unpaid'
                        ? 'text-amber-400'
                        : 'text-red-400'
                  }`}
                >
                  {inspectedMember.paymentStatus}
                  {inspectedMember.paymentStatus === 'Unpaid'
                    ? ` · Due ${formatAmount(inspectedPlan.priceMonthly)}`
                    : ''}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-[#B3B3B3]">Role in Group</span>
                <span className="font-semibold text-white">
                  {inspectedMember.isLeader ? 'Group Leader' : 'Member'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-[#B3B3B3]">Payer</span>
                <span className="text-white">{inspectedMember.payerLabel}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-[#B3B3B3]">Joined Date</span>
                <span className="font-mono text-xs text-white tabular-nums">
                  {formatDisplayDate(inspectedMember.joinedAt)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-[#B3B3B3]">Outreach Status</span>
                <span
                  className={
                    inspectedMember.contacted
                      ? 'text-xs font-semibold text-[#1DB954]'
                      : 'text-xs text-[#B3B3B3]'
                  }
                >
                  {inspectedMember.contacted
                    ? `Contacted (${formatDisplayDate(
                        inspectedMember.contactedAt ?? inspectedMember.joinedAt
                      )})`
                    : 'Not contacted yet'}
                </span>
              </div>
            </div>

            {/* Contact Info Block */}
            {(isAdmin || supportPermissions.canViewContactDetails) && (
              <div className="space-y-2.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-[#B3B3B3]">
                  Contact Information
                </p>

                <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#121212] p-3.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Phone className="h-4 w-4 text-[#1DB954] shrink-0" aria-hidden="true" />
                    <span className="font-mono text-xs sm:text-sm text-white truncate">
                      {inspectedMember.whatsappNumber}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void copyToClipboard(inspectedMember.whatsappNumber, 'phone')}
                    className="inline-flex items-center gap-1 rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-white hover:border-[#1DB954] hover:text-[#1DB954] shrink-0 cursor-pointer"
                  >
                    {copiedField === 'phone' ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-[#1DB954]" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>Copy Phone</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#121212] p-3.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Mail className="h-4 w-4 text-[#1DB954] shrink-0" aria-hidden="true" />
                    <span className="text-xs sm:text-sm text-white truncate">
                      {inspectedMember.email}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void copyToClipboard(inspectedMember.email, 'email')}
                    className="inline-flex items-center gap-1 rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-white hover:border-[#1DB954] hover:text-[#1DB954] shrink-0 cursor-pointer"
                  >
                    {copiedField === 'email' ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-[#1DB954]" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>Copy Email</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Outreach Note & Actions */}
            {(isAdmin || supportPermissions.canLogOutreach) && (
              <div className="space-y-3 pt-1">
                <div>
                  <label
                    htmlFor="outreach-note"
                    className="block text-xs font-medium text-[#B3B3B3] mb-1.5"
                  >
                    Contact note (optional)
                  </label>
                  <input
                    id="outreach-note"
                    type="text"
                    placeholder="e.g. Messaged on WhatsApp about pending subscription payment"
                    value={contactNoteInput}
                    onChange={(e) => setContactNoteInput(e.target.value)}
                    className="w-full min-h-[42px] rounded-xl border border-white/15 bg-[#121212] px-3.5 py-2 text-sm text-white placeholder:text-[#B3B3B3]/50 focus:border-[#1DB954] focus:outline-none"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => {
                    const reminderText = `Hello ${inspectedMember.fullName}, this is a friendly reminder from JOIN THE QUEUE Support regarding your ${inspectedPlan.name} slot (Ref ${inspectedMember.referenceId}, Group ${inspectedGroup.groupCode}). Amount due: ${formatAmount(inspectedPlan.priceMonthly)}.`;
                    void copyToClipboard(reminderText, 'reminder');
                    onLogMemberContact(
                      inspectedGroup.id,
                      inspectedMember.id,
                      isAdmin ? 'Admin' : 'Customer Care',
                      contactNoteInput.trim() || 'Sent payment reminder'
                    );
                    showNotice(
                      `Logged outreach for ${inspectedMember.fullName} and copied reminder message.`
                    );
                  }}
                  className="w-full inline-flex items-center justify-center gap-2 min-h-[44px] rounded-full border border-[#1DB954] bg-[#121212] px-5 py-2.5 text-xs sm:text-sm font-bold text-[#1DB954] hover:bg-[#1DB954] hover:text-black transition-colors cursor-pointer"
                >
                  <MessageSquare className="h-4 w-4" aria-hidden="true" />
                  <span>
                    {copiedField === 'reminder'
                      ? 'Outreach Logged & Reminder Copied'
                      : 'Log Contact & Copy Payment Reminder'}
                  </span>
                </button>
              </div>
            )}

            {/* Collect Payment Action (when Unpaid) */}
            {inspectedMember.paymentStatus === 'Unpaid' && inspectedMember.approvalStatus !== 'pending' &&
              (isAdmin || supportPermissions.canCollectPayments) && (
                <button
                  type="button"
                  onClick={() => {
                    onCollectMemberPayment(inspectedGroup.id, inspectedMember.id, portalRole);
                    showNotice(
                      `Collected ${formatAmount(inspectedPlan.priceMonthly)} for ${
                        inspectedMember.fullName
                      } and marked as Paid.`
                    );
                  }}
                  className="w-full inline-flex items-center justify-center gap-2 min-h-[46px] rounded-full bg-[#1DB954] px-6 py-3 text-sm font-bold text-black hover:bg-[#15803D] hover:text-white transition-colors cursor-pointer"
                >
                  <Banknote className="h-4 w-4" aria-hidden="true" />
                  <span>
                    Collect Payment ({formatAmount(inspectedPlan.priceMonthly)}) · Mark Paid
                  </span>
                </button>
              )}
          </div>
        </div>
      )}
    </section>
  );
}

// ============================================================================
// SUPER ADMIN — Team Access panel (invite, list, and revoke staff roles)
// ============================================================================

interface StaffUser {
  email: string | null;
  role: 'superAdmin' | 'admin' | 'support';
}

interface AdminInvitation {
  invitationId: string;
  email: string;
  role: 'admin' | 'support';
  note: string | null;
  status: 'pending' | 'redeemed' | 'revoked';
  invitedByEmail: string | null;
  createdAt: string | null;
  redeemedAt: string | null;
}

const INVITE_STATUS_CLASSES: Record<string, string> = {
  pending: 'text-amber-400',
  redeemed: 'text-[#1DB954]',
  revoked: 'text-red-400',
};

function formatAuditTimestamp(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '—';
  return new Date(ms).toLocaleString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function mapInvitation(row: AdminInvitationRecord): AdminInvitation {
  return {
    invitationId: row.id,
    email: row.email,
    role: row.role,
    note: row.note,
    status: row.status,
    invitedByEmail: row.invited_by,
    createdAt: row.created_at,
    redeemedAt: row.redeemed_at,
  };
}

function SuperAdminTeamPanel({ currentEmail }: { currentEmail: string }) {
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'support'>('support');
  const [inviteNote, setInviteNote] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [createdInvite, setCreatedInvite] = useState<(AdminInvitation & { reused?: boolean }) | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);

  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [invitations, setInvitations] = useState<AdminInvitation[]>([]);
  const [listsLoading, setListsLoading] = useState(true);
  const [listsError, setListsError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmingRevokeId, setConfirmingRevokeId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setListsLoading(true);
    setListsError(null);
    const [staffRes, invitationsRes] = await Promise.allSettled([
      listStaffMembers(),
      listInvitations(),
    ]);
    if (staffRes.status === 'fulfilled') {
      setStaff(
        staffRes.value.map((row) => ({ email: row.email, role: row.role }))
      );
    } else {
      setListsError(friendlyCallableError(staffRes.reason));
    }
    if (invitationsRes.status === 'fulfilled') {
      setInvitations(invitationsRes.value.map(mapInvitation));
    } else {
      setListsError(friendlyCallableError(invitationsRes.reason));
    }
    setListsLoading(false);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleCreateInvitation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setInviteError(null);
    setIsCreating(true);
    void (async () => {
      try {
        const result = await createInvitation(inviteEmail.trim(), inviteRole, inviteNote.trim() || undefined);
        setCreatedInvite({ ...mapInvitation(result.invitation), reused: result.reused });
        setInviteEmail('');
        setInviteNote('');
        await loadAll();
      } catch (error) {
        setInviteError(friendlyCallableError(error));
      } finally {
        setIsCreating(false);
      }
    })();
  };

  const handleCopyInviteMessage = async () => {
    if (!createdInvite) return;
    const roleLabel = createdInvite.role === 'admin' ? 'Administrator' : 'Customer Service';
    const message =
      `You have been invited to JOIN THE QUEUE as ${roleLabel}.\n\n` +
      `1. Sign in with this invited Google account at the app.\n` +
      `2. Open your Profile and tap the staff console button.\n` +
      `3. Choose "Redeem Staff Invitation".\n\n` +
      `The invite is bound to ${createdInvite.email} — access activates the moment you redeem it.`;
    try {
      await navigator.clipboard.writeText(message);
      setInviteCopied(true);
      window.setTimeout(() => setInviteCopied(false), 2000);
    } catch {
      // Clipboard restricted — the invitation code is still visible for manual copy
    }
  };

  const handleRevokeInvitation = async (invitationId: string) => {
    setActionError(null);
    try {
      await revokeInvitation(invitationId);
      await loadAll();
    } catch (error) {
      setActionError(friendlyCallableError(error));
    }
  };

  const handleRevokeAccess = async (targetEmail: string, role: 'admin' | 'support') => {
    setActionError(null);
    try {
      await revokeStaffRole(targetEmail, role);
      setConfirmingRevokeId(null);
      await loadAll();
    } catch (error) {
      setActionError(friendlyCallableError(error));
    }
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-[#181818] p-5 sm:p-6 space-y-4">
      <div className="flex items-center gap-3 pb-3 border-b border-white/10">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#1DB954]/30 bg-[#1DB954]/10 text-[#1DB954]">
          <Shield className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h3 className="text-base font-bold text-white">Team Access</h3>
          <p className="text-xs text-[#B3B3B3]">Super Admin · invite and revoke staff</p>
        </div>
      </div>

      {/* Invite form */}
      <form onSubmit={handleCreateInvitation} className="space-y-3">
        <div>
          <label htmlFor="invite-staff-email" className="block text-xs font-medium text-white mb-1.5">
            Staff Google account email
          </label>
          <input
            id="invite-staff-email"
            type="email"
            required
            placeholder="staff@example.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            className="w-full min-h-[44px] rounded-xl border border-white/15 bg-[#121212] px-3.5 py-2 text-sm text-white placeholder:text-[#B3B3B3]/50 focus:border-[#1DB954] focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="invite-staff-role" className="block text-xs font-medium text-white mb-1.5">
              Role
            </label>
            <select
              id="invite-staff-role"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as 'admin' | 'support')}
              className="w-full min-h-[44px] rounded-xl border border-white/15 bg-[#121212] px-3.5 py-2 text-sm font-medium text-white focus:border-[#1DB954] focus:outline-none"
            >
              <option value="support">Customer Service</option>
              <option value="admin">Administrator</option>
            </select>
          </div>
          <div>
            <label htmlFor="invite-staff-note" className="block text-xs font-medium text-white mb-1.5">
              Note (optional)
            </label>
            <input
              id="invite-staff-note"
              type="text"
              maxLength={280}
              placeholder="e.g. Lagos ops desk"
              value={inviteNote}
              onChange={(e) => setInviteNote(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-white/15 bg-[#121212] px-3.5 py-2 text-sm text-white placeholder:text-[#B3B3B3]/50 focus:border-[#1DB954] focus:outline-none"
            />
          </div>
        </div>

        {inviteError && (
          <p className="text-xs text-red-400" role="alert">
            {inviteError}
          </p>
        )}

        <button
          type="submit"
          disabled={isCreating}
          className="w-full inline-flex items-center justify-center gap-2 min-h-[44px] rounded-full bg-[#1DB954] px-5 py-2.5 text-xs font-bold text-black hover:bg-[#15803D] hover:text-white transition-colors cursor-pointer disabled:opacity-70"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>{isCreating ? 'Creating invitation…' : 'Invite to Operations Team'}</span>
        </button>
      </form>

      {createdInvite && (
        <div className="rounded-xl border border-[#1DB954]/40 bg-[#1DB954]/5 p-4 space-y-2.5 text-xs">
          <p className="font-semibold text-[#1DB954]">
            {createdInvite.reused ? 'Existing pending invitation reused' : 'Invitation created'}
          </p>
          <p className="text-[#B3B3B3]">
            Share this message with <span className="text-white">{createdInvite.email}</span>. The invitation is bound to that email address.
          </p>
          <button
            type="button"
            onClick={handleCopyInviteMessage}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#1DB954]/50 px-4 py-2 text-xs font-bold text-[#1DB954] hover:bg-[#1DB954] hover:text-black transition-colors cursor-pointer"
          >
            {inviteCopied ? (
              <>
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Copied to clipboard</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Copy invitation message</span>
              </>
            )}
          </button>
        </div>
      )}

      {actionError && (
        <p className="text-xs text-red-400" role="alert">
          {actionError}
        </p>
      )}

      {listsError && (
        <p className="text-xs text-amber-400" role="alert">
          {listsError}
        </p>
      )}

      {/* Staff directory */}
      <div className="pt-2 border-t border-white/10 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#B3B3B3]">
          Staff with access
        </p>
        {listsLoading ? (
          <p className="text-xs text-[#B3B3B3] animate-pulse">Loading staff directory…</p>
        ) : staff.length === 0 ? (
          <p className="text-xs text-[#B3B3B3]">No staff accounts hold privileges yet.</p>
        ) : (
          <ul className="space-y-2">
            {staff.map((member) => (
              <li
                key={member.email ?? 'staff-unknown'}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#121212] px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white truncate">{member.email ?? 'unknown'}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide">
                    {member.role === 'superAdmin' && <span className="text-[#1DB954]">Super Admin</span>}
                    {member.role === 'admin' && <span className="text-sky-400">Admin</span>}
                    {member.role === 'support' && <span className="text-amber-400">Support</span>}
                  </p>
                </div>
                {member.role !== 'superAdmin' && member.email && member.email !== currentEmail && (
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    {member.role === 'admin' && (
                      <button
                        type="button"
                        onClick={() =>
                          confirmingRevokeId === `${member.email}:admin`
                            ? void handleRevokeAccess(member.email as string, 'admin')
                            : setConfirmingRevokeId(`${member.email}:admin`)
                        }
                        className="min-h-[30px] rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-[10px] font-bold text-red-300 hover:bg-red-500/20 hover:text-white transition-colors cursor-pointer"
                      >
                        {confirmingRevokeId === `${member.email}:admin` ? 'Confirm revoke admin' : 'Revoke admin'}
                      </button>
                    )}
                    {member.role === 'support' && (
                      <button
                        type="button"
                        onClick={() =>
                          confirmingRevokeId === `${member.email}:support`
                            ? void handleRevokeAccess(member.email as string, 'support')
                            : setConfirmingRevokeId(`${member.email}:support`)
                        }
                        className="min-h-[30px] rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-[10px] font-bold text-red-300 hover:bg-red-500/20 hover:text-white transition-colors cursor-pointer"
                      >
                        {confirmingRevokeId === `${member.email}:support` ? 'Confirm revoke support' : 'Revoke support'}
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Invitation ledger */}
      <div className="pt-2 border-t border-white/10 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#B3B3B3]">
          Invitations
        </p>
        {listsLoading ? (
          <p className="text-xs text-[#B3B3B3] animate-pulse">Loading invitations…</p>
        ) : invitations.length === 0 ? (
          <p className="text-xs text-[#B3B3B3]">No invitations sent yet.</p>
        ) : (
          <ul className="space-y-2 max-h-56 overflow-y-auto">
            {invitations.map((invite) => (
              <li
                key={invite.invitationId}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#121212] px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white truncate">{invite.email}</p>
                  <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide">
                    <span className="text-[#B3B3B3]">{invite.role}</span>
                    <span className="text-white/25"> · </span>
                    <span className={INVITE_STATUS_CLASSES[invite.status] ?? 'text-[#B3B3B3]'}>{invite.status}</span>
                  </p>
                </div>
                {invite.status === 'pending' && (
                  <button
                    type="button"
                    onClick={() => void handleRevokeInvitation(invite.invitationId)}
                    className="min-h-[30px] shrink-0 rounded-full border border-white/15 px-2.5 py-1 text-[10px] font-bold text-[#B3B3B3] hover:border-red-500/40 hover:text-red-300 transition-colors cursor-pointer"
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// ADMINISTRATIVE AUDIT LOG (read-only, super admins and admins)
// ============================================================================

interface AuditLogEntry {
  id: string;
  action: string;
  actorEmail: string | null;
  targetEmail: string | null;
  role: string | null;
  createdAt: string | null;
}

const AUDIT_TYPE_LABELS: Record<string, string> = {
  bootstrap_super_admin: 'Super admin granted',
  invitation_created: 'Invitation created',
  invitation_redeemed: 'Staff access granted',
  invitation_revoked: 'Invitation revoked',
  access_revoked: 'Staff access revoked',
};

function AdminAuditLogPanel() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    fetchAuditLog(50)
      .then((rows) => {
        if (mounted) {
          setEntries(
            rows.map((row) => {
              const details = (row.details ?? {}) as Record<string, unknown>;
              return {
                id: String(row.id),
                action: row.action,
                actorEmail: row.actor_email,
                targetEmail: typeof details.targetEmail === 'string' ? details.targetEmail : null,
                role: typeof details.role === 'string' ? details.role : null,
                createdAt: row.created_at,
              };
            })
          );
        }
      })
      .catch((err) => {
        if (mounted) {
          setError(friendlyCallableError(err));
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="rounded-2xl border border-white/10 bg-[#181818] p-5 sm:p-6 space-y-4">
      <div className="flex items-center gap-3 pb-3 border-b border-white/10">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-[#121212] text-[#B3B3B3]">
          <History className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h3 className="text-base font-bold text-white">Audit Log</h3>
          <p className="text-xs text-[#B3B3B3]">Role changes and invitations</p>
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-[#B3B3B3] animate-pulse">Loading audit log…</p>
      ) : error ? (
        <p className="text-xs text-amber-400" role="alert">
          {error}
        </p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-[#B3B3B3]">No administrative events recorded yet.</p>
      ) : (
        <ul className="space-y-2 max-h-72 overflow-y-auto">
          {entries.map((entry) => (
            <li key={entry.id} className="rounded-xl border border-white/10 bg-[#121212] px-3.5 py-2.5">
              <p className="text-xs font-semibold text-white">{AUDIT_TYPE_LABELS[entry.action] ?? entry.action}</p>
              <p className="mt-0.5 break-words text-[11px] text-[#B3B3B3]">
                {entry.actorEmail ?? 'unknown'}
                {entry.targetEmail ? ` → ${entry.targetEmail}` : ''}
                {entry.role ? ` · ${entry.role}` : ''}
              </p>
              <p className="mt-0.5 text-[10px] text-white/35 tabular-nums">{formatAuditTimestamp(entry.createdAt)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

