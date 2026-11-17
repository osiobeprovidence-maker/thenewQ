import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  Banknote,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  Crown,
  ExternalLink,
  FolderPlus,
  Hash,
  Headphones,
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

interface AdminViewProps {
  portalRole: PortalRole | null;
  plans: SubscriptionPlan[];
  groups: SubscriptionGroup[];
  transactions: PlatformTransaction[];
  supportPermissions: SupportPermissions;
  onLogin: (role: PortalRole) => void;
  onLogout: () => void;
  onBackToSite: () => void;
  onUpdateSupportPermissions: (updater: (prev: SupportPermissions) => SupportPermissions) => void;
  onCreateGroup: (payload: {
    groupName: string;
    planId: string;
    homeAddress: string;
    inviteLink: string;
    maxSlots: number;
  }) => string;
  onUpdateGroupDetails: (
    groupId: string,
    payload: { groupName: string; homeAddress: string; inviteLink: string }
  ) => void;
  onDispatchGroupToInbox: (groupId: string) => number;
  onSetGroupLeader: (groupId: string, memberId: string) => void;
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
  }) => void;
  onTogglePlanStatus: (planId: string) => void;
}

type AdminTab = 'groups' | 'subscriptions' | 'financials' | 'settings';
type TransactionFilter = 'all' | 'users' | 'support';

export function AdminView({
  portalRole,
  plans,
  groups,
  transactions,
  supportPermissions,
  onLogin,
  onLogout,
  onBackToSite,
  onUpdateSupportPermissions,
  onCreateGroup,
  onUpdateGroupDetails,
  onDispatchGroupToInbox,
  onSetGroupLeader,
  onToggleMemberPaymentStatus,
  onCollectMemberPayment,
  onLogMemberContact,
  onRemoveGroupMember,
  onAddPlan,
  onTogglePlanStatus,
}: AdminViewProps) {
  // Login state
  const [loginRoleChoice, setLoginRoleChoice] = useState<PortalRole>('admin');

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
  const [newGroupPlanId, setNewGroupPlanId] = useState<string>(plans[0]?.id ?? '');
  const [newGroupAddress, setNewGroupAddress] = useState('');
  const [newGroupLink, setNewGroupLink] = useState('');
  const [newGroupMaxSlots, setNewGroupMaxSlots] = useState('6');
  const [groupFormError, setGroupFormError] = useState<string | null>(null);

  // Edit selected group details state
  const [editGroupName, setEditGroupName] = useState('');
  const [editHomeAddress, setEditHomeAddress] = useState('');
  const [editInviteLink, setEditInviteLink] = useState('');
  const [editGroupError, setEditGroupError] = useState<string | null>(null);

  // Copy & inline removal confirmation state
  const [copiedCodeGroupId, setCopiedCodeGroupId] = useState<string | null>(null);
  const [confirmRemoveMemberId, setConfirmRemoveMemberId] = useState<string | null>(null);

  // Add subscription plan form state
  const [planName, setPlanName] = useState('');
  const [planCategory, setPlanCategory] = useState('');
  const [planDescription, setPlanDescription] = useState('');
  const [planPrice, setPlanPrice] = useState('1000');
  const [planSlots, setPlanSlots] = useState('6');
  const [planInitialStatus, setPlanInitialStatus] = useState<PlanStatus>('available');
  const [planFormError, setPlanFormError] = useState<string | null>(null);

  const isAdmin = portalRole === 'admin';
  const isSupport = portalRole === 'support';

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
      setEditInviteLink(selectedGroup.inviteLink);
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

  const handlePreviewRole = (role: PortalRole) => {
    setLoginRoleChoice(role);
    setActiveTab('groups');
    onLogin(role);
  };

  const handleCreateGroupSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = newGroupName.trim();
    const trimmedAddress = newGroupAddress.trim();
    const trimmedLink = newGroupLink.trim();
    const parsedSlots = Number(newGroupMaxSlots);

    if (trimmedName.length < 3) {
      setGroupFormError('Please enter a group name (at least 3 characters).');
      return;
    }
    if (trimmedAddress.length < 5) {
      setGroupFormError('Please enter the home address for this group.');
      return;
    }
    if (!trimmedLink.startsWith('http://') && !trimmedLink.startsWith('https://')) {
      setGroupFormError('Please enter a valid invite link starting with https:// or http://.');
      return;
    }
    if (!Number.isInteger(parsedSlots) || parsedSlots < 2 || parsedSlots > 20) {
      setGroupFormError('Max slots must be a whole number between 2 and 20.');
      return;
    }

    setGroupFormError(null);
    const createdGroupId = onCreateGroup({
      groupName: trimmedName,
      planId: newGroupPlanId || plans[0].id,
      homeAddress: trimmedAddress,
      inviteLink: trimmedLink,
      maxSlots: parsedSlots,
    });

    setSelectedGroupId(createdGroupId);
    setNewGroupName('');
    setNewGroupAddress('');
    setNewGroupLink('');
    setNewGroupMaxSlots('6');
    setShowCreateGroupForm(false);
    showNotice(`Created group "${trimmedName}" with an auto-generated Group Code.`);
  };

  const handleUpdateGroupSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedGroup) return;

    const trimmedName = editGroupName.trim();
    const trimmedAddress = editHomeAddress.trim();
    const trimmedLink = editInviteLink.trim();

    if (trimmedName.length < 3) {
      setEditGroupError('Group name must be at least 3 characters.');
      return;
    }
    if (trimmedAddress.length < 5) {
      setEditGroupError('Please provide a valid home address.');
      return;
    }
    if (!trimmedLink.startsWith('http://') && !trimmedLink.startsWith('https://')) {
      setEditGroupError('Invite link must start with https:// or http://.');
      return;
    }

    setEditGroupError(null);
    onUpdateGroupDetails(selectedGroup.id, {
      groupName: trimmedName,
      homeAddress: trimmedAddress,
      inviteLink: trimmedLink,
    });
    showNotice(`Saved updated name, home address, and invite link for ${trimmedName}.`);
  };

  const handleDispatchInbox = () => {
    if (!selectedGroup) return;
    const deliveredCount = onDispatchGroupToInbox(selectedGroup.id);
    if (deliveredCount > 0) {
      showNotice(
        `Sent ${selectedGroup.groupName} (${selectedGroup.groupCode}) invite link & home address to ${deliveredCount} user inbox ${
          deliveredCount === 1 ? 'message' : 'messages'
        }.`
      );
    } else {
      showNotice(
        `Saved ${selectedGroup.groupName} (${selectedGroup.groupCode}). Members who join from the storefront will receive this link and address automatically.`
      );
    }
  };

  const handleAddPlanSubmit = (event: FormEvent<HTMLFormElement>) => {
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
    onAddPlan({
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
    .filter((t) => t.status === 'Confirmed (Demo)')
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

  // PORTAL LOGIN SCREEN (Admin OR Customer Care / Support)
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
                {loginRoleChoice === 'admin' ? (
                  <Shield className="h-6 w-6" aria-hidden="true" />
                ) : (
                  <Headphones className="h-6 w-6" aria-hidden="true" />
                )}
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[#1DB954]">
                  Operations Portal
                </p>
                <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
                  Preview as {loginRoleChoice === 'admin' ? 'Admin' : 'Customer Care'}
                </h1>
              </div>
            </div>

            {/* Role Toggle */}
            <div
              role="tablist"
              aria-label="Choose portal role"
              className="grid grid-cols-2 gap-1.5 rounded-xl border border-white/10 bg-[#121212] p-1"
            >
              <button
                type="button"
                role="tab"
                aria-selected={loginRoleChoice === 'admin'}
                onClick={() => setLoginRoleChoice('admin')}
                className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-xs font-bold transition-colors cursor-pointer ${
                  loginRoleChoice === 'admin'
                    ? 'bg-[#1DB954] text-black'
                    : 'text-[#B3B3B3] hover:text-white'
                }`}
              >
                <Shield className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Admin</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={loginRoleChoice === 'support'}
                onClick={() => setLoginRoleChoice('support')}
                className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-xs font-bold transition-colors cursor-pointer ${
                  loginRoleChoice === 'support'
                    ? 'bg-[#1DB954] text-black'
                    : 'text-[#B3B3B3] hover:text-white'
                }`}
              >
                <Headphones className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Customer Care</span>
              </button>
            </div>

            <p className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-xs leading-relaxed text-[#B3B3B3]">
              This is a local demo preview, not a protected sign-in. There is no backend,
              authentication, or data persistence.
            </p>
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => handlePreviewRole(loginRoleChoice)}
                className="w-full inline-flex items-center justify-center gap-2 min-h-[48px] rounded-full bg-[#1DB954] px-6 py-3 text-sm font-bold text-black transition-colors hover:bg-[#15803D] hover:text-white cursor-pointer"
              >
                {loginRoleChoice === 'admin' ? (
                  <Shield className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Headphones className="h-4 w-4" aria-hidden="true" />
                )}
                <span>
                  Preview as {loginRoleChoice === 'admin' ? 'Admin' : 'Customer Care'}
                </span>
              </button>
            </div>
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
                onClick={onLogout}
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
                      <p className="text-xs text-[#B3B3B3]">Total Paid (Demo)</p>
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
                      {plans.map((plan) => (
                        <option key={plan.id} value={plan.id}>
                          {plan.name} ({formatPlanPrice(plan)})
                        </option>
                      ))}
                    </select>
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
                      max={20}
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
                      htmlFor="new-group-link"
                      className="block text-sm font-medium text-white mb-1.5"
                    >
                      Invite link
                    </label>
                    <input
                      id="new-group-link"
                      type="url"
                      placeholder="https://jointhequeue.demo/slot-invite/group-02"
                      value={newGroupLink}
                      onChange={(e) => setNewGroupLink(e.target.value)}
                      className="w-full min-h-[46px] rounded-xl border border-white/15 bg-[#121212] px-4 py-2.5 text-sm font-mono text-white placeholder:text-[#B3B3B3]/50 focus:border-[#1DB954] focus:outline-none"
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
                    className="inline-flex items-center justify-center gap-2 min-h-[46px] rounded-full bg-[#1DB954] px-7 py-2.5 text-sm font-bold text-black hover:bg-[#15803D] hover:text-white transition-colors cursor-pointer"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    <span>Create Group &amp; Generate Code</span>
                  </button>
                </div>
              </form>
            )}

            {visibleGroups.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-[#181818] p-10 text-center space-y-2">
                <CheckCircle2 className="h-8 w-8 text-[#1DB954] mx-auto" aria-hidden="true" />
                <h3 className="text-lg font-bold text-white">All Members Have Paid</h3>
                <p className="text-sm text-[#B3B3B3]">
                  There are currently no unpaid members requiring Customer Care follow-up.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left Column: Groups */}
                <div className="lg:col-span-4 space-y-3">
                  {visibleGroups.map((grp) => {
                    const isSelected = grp.id === selectedGroup?.id;
                    const leader = grp.members.find((m) => m.isLeader);
                    const unpaidCount = grp.members.filter(
                      (m) => m.paymentStatus === 'Unpaid'
                    ).length;
                    const activeCount = grp.members.filter(
                      (m) => m.paymentStatus !== 'Cancelled'
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
                          <span className="font-mono text-xs font-semibold text-white tabular-nums shrink-0">
                            {activeCount}/{grp.maxSlots}
                          </span>
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
                              <span>Send Link &amp; Address to Inbox</span>
                            </button>
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
                              <input
                                id="edit-invite-link"
                                type="url"
                                value={editInviteLink}
                                onChange={(e) => setEditInviteLink(e.target.value)}
                                className="w-full min-h-[44px] rounded-xl border border-white/15 bg-[#121212] px-3.5 py-2 text-sm font-mono text-white focus:border-[#1DB954] focus:outline-none"
                              />
                            </div>
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
                              : `Members in ${selectedGroup.groupName} (${displayedGroupMembers.length})`}
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
                                            `Collected payment for ${member.fullName} and updated platform financials.`
                                          );
                                        }}
                                        className="inline-flex items-center gap-1.5 min-h-[38px] rounded-full bg-[#1DB954] px-3.5 py-1.5 text-xs font-bold text-black hover:bg-[#15803D] hover:text-white transition-colors cursor-pointer"
                                      >
                                        <Banknote className="h-3.5 w-3.5" aria-hidden="true" />
                                        <span>Collect Payment</span>
                                      </button>
                                    )}

                                    {isAdmin && !member.isLeader && member.paymentStatus !== 'Cancelled' && (
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
                {plans.map((plan) => (
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

                    <div className="flex sm:flex-col items-center sm:items-end justify-between gap-3 shrink-0">
                      <span className="font-mono text-lg font-extrabold text-[#1DB954] tabular-nums">
                        {formatPlanPrice(plan)}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          onTogglePlanStatus(plan.id);
                          showNotice(
                            `Updated ${plan.name} status to ${
                              plan.status === 'available' ? 'Waitlist' : 'Available'
                            }.`
                          );
                        }}
                        className={`min-h-[38px] rounded-full px-4 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
                          plan.status === 'available'
                            ? 'bg-[#1DB954]/15 border border-[#1DB954] text-[#1DB954] hover:bg-[#1DB954] hover:text-black'
                            : 'bg-[#121212] border border-white/20 text-white hover:border-[#1DB954] hover:text-[#1DB954]'
                        }`}
                      >
                        {plan.status === 'available'
                          ? 'Open · Switch to Waitlist'
                          : 'Waitlist · Open Slots'}
                      </button>
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
                  className="w-full inline-flex items-center justify-center gap-2 min-h-[46px] rounded-full bg-[#1DB954] px-6 py-3 text-sm font-bold text-black hover:bg-[#15803D] hover:text-white transition-colors cursor-pointer"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  <span>List Subscription · {formatAmount(Number(planPrice) || 0)}/mo</span>
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
                <p className="text-xs font-medium text-[#B3B3B3]">Total Paid on Platform (Demo)</p>
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
                    .filter((t) => t.groupCode === grp.groupCode && t.status === 'Confirmed (Demo)')
                    .reduce((sum, t) => sum + t.amount, 0);
                  const grpUnpaidCount = grp.members.filter(
                    (m) => m.paymentStatus === 'Unpaid'
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

            {/* Right Column: Support Preview */}
            <div className="lg:col-span-4 space-y-4">
              <div className="rounded-2xl border border-white/10 bg-[#181818] p-5 sm:p-6 space-y-4">
                <div className="flex items-center gap-3 pb-3 border-b border-white/10">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#1DB954]/30 bg-[#1DB954]/10 text-[#1DB954]">
                    <Headphones className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">Customer Care Preview</h3>
                    <p className="text-xs text-[#B3B3B3]">Local demo role switch</p>
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-[#121212] p-4 text-xs leading-relaxed text-[#B3B3B3]">
                  This preview is not authentication and must not be used to protect real data.
                </div>

                <button
                  type="button"
                  onClick={() => {
                    onLogin('support');
                    setActiveTab('groups');
                  }}
                  className="w-full inline-flex items-center justify-center gap-2 min-h-[44px] rounded-full bg-[#1DB954] px-5 py-2.5 text-xs font-bold text-black hover:bg-[#15803D] hover:text-white transition-colors cursor-pointer"
                >
                  <Headphones className="h-4 w-4" aria-hidden="true" />
                  <span>Preview as Customer Care</span>
                </button>
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
            {inspectedMember.paymentStatus === 'Unpaid' &&
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
