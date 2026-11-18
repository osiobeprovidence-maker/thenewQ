import { useEffect, useState } from 'react';
import { Ticket, X } from 'lucide-react';
import { AdminView } from './components/AdminView';
import { AuthModal } from './components/AuthModal';
import { FaqSection } from './components/FaqSection';
import { Footer } from './components/Footer';
import { HeroSection } from './components/HeroSection';
import { HowItWorksSection } from './components/HowItWorksSection';
import { InfoModal } from './components/InfoModal';
import { Navbar } from './components/Navbar';
import { OrderModal } from './components/OrderModal';
import { PlansSection } from './components/PlansSection';
import { OnboardingFlow } from './components/OnboardingFlow';
import { ProfileView } from './components/ProfileView';
import { useAuth } from './context/AuthContext';
import {
  claimGiftedMemberships,
  fetchLiveSubscriptionPlans,
  fetchUserMemberships,
  fetchUserTransactions,
} from './lib/subscriptionService';
import { startBachsCheckout, fetchReservationStatus, cancelMyMembership } from './lib/paymentProvider';
import {
  DEFAULT_SUPPORT_PERMISSIONS,
  FAQ_ITEMS,
  addMonthsToIso,
  formatPlanPrice,
} from './data/subscriptions';
import {
  createSubscriptionGroup,
  approveGroupMember,
  deleteSubscriptionGroup,
  fetchAdminGroups,
  joinGroupByCode,
  previewGroupByCode,
  removeGroupMember,
  setGroupLeader,
  setMembershipPayment,
  updateSubscriptionGroup,
} from './lib/groupService';
import {
  createSubscriptionProduct,
  deleteSubscriptionProductListing,
  fetchPaymentTransactions,
  moveSubscriptionProduct,
  setSubscriptionProductAvailability,
} from './lib/platformService';
import type {
  ActiveSubscription,
  AppView,
  BillingDurationMonths,
  CompletedOrder,
  InboxMessage,
  InfoModalType,
  InvitedPerson,
  OrderFormData,
  OrderModalStep,
  PaymentRecord,
  PlanStatus,
  PlatformTransaction,
  SponsoredSlot,
  PortalRole,
  SubscriptionGroup,
  SubscriptionPlan,
  SupportPermissions,
  UserProfile,
} from './types/subscription';

const INITIAL_FORM_DATA: OrderFormData = {
  fullName: '',
  email: '',
  whatsappNumber: '',
  planId: '',
  groupCode: '',
  acceptedTerms: false,
};

function scrollToSection(sectionId: string) {
  const target = document.getElementById(sectionId);
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

export default function App() {
  const {
    currentUser,
    profile: authProfile,
    loading: authLoading,
    isAdmin,
    isSuperAdmin,
    isSupport,
    hasPendingStaffInvite,
    refreshProfile,
    updateUserProfile,
    setupPhoneRecaptcha,
    sendPhoneOtp,
    verifyAndLinkPhone,
  } = useAuth();
  const [currentView, setCurrentView] = useState<AppView>('landing');
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [inviteBannerDismissed, setInviteBannerDismissed] = useState(false);
  // Accept both current query links and older /invite/CODE links.
  const invitePathCode = (() => {
    const match = window.location.pathname.match(/^\/invite\/([^/]+)\/?$/i);
    if (!match) return null;
    try {
      return decodeURIComponent(match[1]).trim().toUpperCase();
    } catch {
      return null;
    }
  })();
  const urlParams = new URLSearchParams(window.location.search);
  const joinCodeFromUrl = (urlParams.get('join') ?? invitePathCode ?? '').trim().toUpperCase() || null;
  const referralCodeFromUrl = (urlParams.get('ref') ?? invitePathCode ?? '').trim().toUpperCase() || null;
  const isGroupInvite = Boolean(joinCodeFromUrl && /^GFT-\d{4}$/.test(joinCodeFromUrl));
  const isPersonalInvite = Boolean(referralCodeFromUrl && /^INV-[A-Z0-9]{6}$/.test(referralCodeFromUrl));
  const showInviteBanner = (isGroupInvite || isPersonalInvite) && !inviteBannerDismissed;
  const [supportPermissions, setSupportPermissions] = useState<SupportPermissions>(
    DEFAULT_SUPPORT_PERMISSIONS
  );
  const staffAccess: 'superAdmin' | 'admin' | 'support' | null = isSuperAdmin
    ? 'superAdmin'
    : isAdmin
      ? 'admin'
      : isSupport
        ? 'support'
        : null;
  // Designated bootstrap accounts may claim super admin access (server re-verifies).
  const designatedSuperAdminAvailable = ['riderezzy@gmail.com', 'osiobeprovidence@gmail.com'].includes(
    (currentUser?.email ?? '').trim().toLowerCase()
  );
  // Visible staff console only for staff, invited users, or designated bootstrap accounts.
  const canOpenStaffConsole =
    staffAccess !== null || hasPendingStaffInvite || designatedSuperAdminAvailable;
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [groups, setGroups] = useState<SubscriptionGroup[]>([]);
  const [platformTransactions, setPlatformTransactions] = useState<PlatformTransaction[]>([]);
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [orderStep, setOrderStep] = useState<OrderModalStep>('form');
  const [formData, setFormData] = useState<OrderFormData>(INITIAL_FORM_DATA);
  const [completedOrder, setCompletedOrder] = useState<CompletedOrder | null>(null);
  const [infoModalType, setInfoModalType] = useState<InfoModalType>(null);
  const [isCheckoutPending, setIsCheckoutPending] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // User Profile & Session Ledger State
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [activeSubscriptions, setActiveSubscriptions] = useState<ActiveSubscription[]>([]);
  const [inboxMessages, setInboxMessages] = useState<InboxMessage[]>([]);
  const [paymentHistory, setPaymentHistory] = useState<PaymentRecord[]>([]);
  const [invitedPeople, setInvitedPeople] = useState<InvitedPerson[]>([]);
  const [sponsoredSlots] = useState<SponsoredSlot[]>([]);

  // Track which subscription plans came from a successful live Supabase fetch.
  // A plan is only “live” if the backend supplied it and its id is a UUID.
  const [livePlanIds, setLivePlanIds] = useState<Set<string>>(new Set());

  // Reload groups from the database (admin + member views stay consistent)
  const refreshGroups = () => {
    fetchAdminGroups()
      .then((liveGroups) => setGroups(liveGroups))
      .catch((err) => console.warn('Could not load groups:', err));
  };

  // Available Plans come only from the database catalog (admin-managed).
  const refreshPlans = async () => {
    try {
      const livePlans = await fetchLiveSubscriptionPlans();
      setPlans(livePlans);
      setLivePlanIds(new Set(livePlans.map((p) => p.id)));
    } catch (err) {
      console.warn('Could not load plans:', err);
    }
  };

  // Real payment ledger — verified payment_transactions rows only.
  const refreshTransactions = () => {
    fetchPaymentTransactions()
      .then((rows) => setPlatformTransactions(rows))
      .catch((err) => console.warn('Could not load payment transactions:', err));
  };

  const refreshPaymentHistory = () => {
    if (!currentUser) {
      setPaymentHistory([]);
      return;
    }
    fetchUserTransactions(currentUser.uid)
      .then((rows) => {
        const records = (rows ?? []).map((r: Record<string, unknown>) => {
          const metadata = (r.metadata as Record<string, unknown>) ?? {};
          const rawStatus = (r.status as string) || 'pending';
          const rawMonths = Number(metadata.duration_months ?? 1);
          const months: BillingDurationMonths = [1, 3, 6, 12].includes(rawMonths)
            ? (rawMonths as BillingDurationMonths)
            : 1;
          const recipientName = typeof metadata.recipient_name === 'string'
            ? metadata.recipient_name
            : undefined;
          return {
            id: String(r.id ?? ''),
            referenceId: (r.provider_reference as string) || String(r.id ?? ''),
            date: (r.created_at as string) ?? new Date().toISOString(),
            planName: (metadata.product_name as string) || 'Subscription',
            durationLabel: `${months} ${months === 1 ? 'month' : 'months'}`,
            months,
            amount: Number(r.amount ?? 0),
            currencySymbol: (r.currency as string) === 'NGN' ? '₦' : '$',
            kind: recipientName ? ('gift' as const) : ('initial' as const),
            recipientName,
            status:
              rawStatus === 'success' || rawStatus === 'confirmed'
                ? ('Confirmed' as const)
                : rawStatus === 'failed'
                  ? ('Failed' as const)
                  : ('Pending' as const),
          };
        });
        setPaymentHistory(records);
      })
      .catch((err) => {
        console.warn('Could not load payment history:', err);
        setPaymentHistory([]);
      });
  };

  const refreshUserMemberships = async (uid: string) => {
    const rows = await fetchUserMemberships(uid);
    const mapped = (rows as Array<Record<string, any>>).flatMap((row) => {
      const slot = Array.isArray(row.slots) ? row.slots[0] : row.slots;
      const product = slot?.subscription_products;
      if (!slot || !product) return [];
      const joinedAt = String(row.joined_at ?? new Date().toISOString());
      const matchingPlan = plans.find((plan) => plan.id === product.id);
      const plan: SubscriptionPlan = matchingPlan ?? {
        id: String(product.id),
        name: String(product.name ?? 'Subscription'),
        category: String(product.category ?? 'Subscription'),
        description: String(product.description ?? ''),
        priceMonthly: Number(product.monthly_price ?? 0),
        currencySymbol: product.currency === 'NGN' ? '₦' : '$',
        billingCycle: 'month',
        status: 'available',
        availabilityLabel: 'Available',
        slotsOpen: 0,
        totalSlots: Number(slot.capacity ?? 6),
        eligibilityNote: String(product.eligibility_note ?? ''),
        highlights: Array.isArray(product.highlights) ? product.highlights : [],
        icon: product.icon === 'play-stream' || product.icon === 'spotify-wave' ? product.icon : 'music-disc',
      };
      const bills = Array.isArray(row.membership_bills) ? row.membership_bills : [];
      const dueDate = bills
        .map((bill: Record<string, unknown>) => String(bill.due_date ?? ''))
        .filter(Boolean)
        .sort((a: string, b: string) => b.localeCompare(a))[0];
      const durationValue = Number(row.duration_months ?? 1);
      const duration: BillingDurationMonths = [1, 3, 6, 12].includes(durationValue)
        ? (durationValue as BillingDurationMonths)
        : 1;
      return [{
        id: String(row.id),
        referenceId: String(row.reference_id ?? row.id),
        plan,
        status: row.status === 'cancelled' ? 'cancelled' : row.approval_status === 'pending' ? 'waitlist' : 'active',
        joinedAt,
        nextRenewalDate: dueDate ? new Date(dueDate).toISOString() : addMonthsToIso(joinedAt, duration),
        lastDurationMonths: duration,
        payerType:
          row.payer_user_id === uid &&
          row.recipient_email &&
          String(row.recipient_email).toLowerCase() !== (currentUser?.email ?? '').toLowerCase()
            ? 'recipient'
            : 'self',
        recipientName: row.recipient_name ? String(row.recipient_name) : undefined,
        recipientEmail: row.recipient_email ? String(row.recipient_email) : undefined,
        recipientWhatsapp: row.recipient_phone ? String(row.recipient_phone) : undefined,
        note: row.gift_note ? String(row.gift_note) : undefined,
        giftClaimed:
          row.beneficiary_user_id !== row.payer_user_id ||
          String(row.recipient_email ?? '').toLowerCase() === (currentUser?.email ?? '').toLowerCase(),
        groupId: String(slot.id),
        groupCode: slot.group_code ? String(slot.group_code) : undefined,
        groupName: slot.group_name ? String(slot.group_name) : undefined,
        cancelledAt: row.status === 'cancelled' ? String(row.updated_at ?? joinedAt) : undefined,
      } satisfies ActiveSubscription];
    });
    setActiveSubscriptions(mapped);
  };

  useEffect(() => {
    refreshPlans();
    refreshTransactions();
  }, []);

  useEffect(() => {
    refreshPaymentHistory();
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) {
      setActiveSubscriptions([]);
      return;
    }
    void refreshUserMemberships(currentUser.uid).catch((error) => {
      console.warn('Could not load your subscriptions:', error);
      setActiveSubscriptions([]);
    });
  }, [currentUser, plans]);

  useEffect(() => {
    let mounted = true;
    fetchAdminGroups()
      .then((liveGroups) => {
        if (mounted) setGroups(liveGroups);
      })
      .catch((err) => console.warn('Could not load groups:', err));
    return () => {
      mounted = false;
    };
  }, []);

  // Synchronize authenticated user profile
  useEffect(() => {
    if (currentUser) {
      setUserProfile({
        fullName: authProfile?.display_name || currentUser.displayName || 'Member',
        email: currentUser.email || '',
        whatsappNumber: authProfile?.phone || currentUser.phoneNumber || '',
        joinedAt: currentUser.metadata.creationTime || new Date().toISOString(),
        inviteCode: `INV-${currentUser.uid.slice(0, 6).toUpperCase()}`,
      });
    }
  }, [currentUser, authProfile]);

  // Payments are only available for signed-in users and published database plans.
  const chosenPlanForCheckout = plans.find((p) => p.id === formData.planId);
  const chosenPlanIsLive =
    chosenPlanForCheckout != null && livePlanIds.has(chosenPlanForCheckout.id);
  const isLivePlanId =
    chosenPlanForCheckout != null &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      chosenPlanForCheckout.id
    );
  const checkoutMode: 'live' | 'unavailable' =
    currentUser && chosenPlanIsLive && isLivePlanId ? 'live' : 'unavailable';
  const checkoutUnavailableReason = !currentUser
    ? 'Sign in to continue to secure checkout. No payment has been taken.'
    : 'This plan is not connected to secure checkout yet. No payment has been taken.';

  const navigateToSection = (sectionId: string) => {
    if (currentView !== 'landing') {
      setCurrentView('landing');
      window.setTimeout(() => scrollToSection(sectionId), 50);
    } else {
      scrollToSection(sectionId);
    }
  };

  const openProfileView = () => {
    setCurrentView('profile');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openAdminView = () => {
    setCurrentView('admin');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openJoinModalForPlan = (plan: SubscriptionPlan) => {
    setFormData((prev) => ({
      ...prev,
      planId: plan.id,
    }));
    setOrderStep('form');
    setOrderModalOpen(true);
  };

  const handleJoinNowFromNav = () => {
    const firstAvailablePlan = plans.find((plan) => plan.status === 'available') ?? plans[0];
    if (!firstAvailablePlan) {
      window.alert('No live subscription plans are available right now.');
      return;
    }
    openJoinModalForPlan(firstAvailablePlan);
  };

  const restoreOnePlanSlot = (planId: string) => {
    setPlans((prevPlans) =>
      prevPlans.map((plan) => {
        if (plan.id !== planId) return plan;
        const nextOpen = Math.min(plan.totalSlots, plan.slotsOpen + 1);
        return {
          ...plan,
          slotsOpen: nextOpen,
          availabilityLabel:
            nextOpen > 0
              ? `Available now · ${nextOpen} ${nextOpen === 1 ? 'slot' : 'slots'} remaining`
              : 'Current batch full · Waitlist open',
          status: nextOpen > 0 ? 'available' : plan.status,
        };
      })
    );
  };

  // Start checkout only when the published plan and signed-in account are eligible.
  const handleConfirmOrder = () => {
    if (checkoutMode !== 'live') {
      setCheckoutError(checkoutUnavailableReason);
      return;
    }

    setIsCheckoutPending(true);
    setCheckoutError(null);

    const plan = plans.find((p) => p.id === formData.planId);
    if (!plan) {
      setIsCheckoutPending(false);
      setCheckoutError('Could not resolve the selected subscription plan.');
      return;
    }

    startBachsCheckout({
      productId: plan.id,
      preferredGroupCode: formData.groupCode?.trim().toUpperCase() || undefined,
      successUrl: `${window.location.origin}/?payment-ref=PENDING`,
      customerEmail: formData.email.trim(),
      customerName: formData.fullName.trim(),
    })
      .then((result) => {
        if (!result.ok || !result.checkoutUrl) {
          setIsCheckoutPending(false);
          setCheckoutError(result.ok ? 'Malformed response from payment server.' : result.error);
          return;
        }
        // Redirect to the hosted checkout page — payment confirmed via webhook, then the
        // reservation flips to `fulfilled` and the Profile inbox + subscriptions update.
        window.location.assign(result.checkoutUrl);
      })
      .catch((error) => {
        console.error('[App] checkout failed:', error);
        setIsCheckoutPending(false);
        setCheckoutError('Could not start checkout. Please try again.');
      });
  };

  // Return path: when Bachs redirects the browser back with ?payment-ref=…, poll the reservation.
  // fetchReservationStatus reads via the caller's anon Supabase client, so RLS enforces ownership — the URL alone proves nothing.
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get('payment-ref');
    if (!ref || !currentUser) return;
    setOrderModalOpen(true);
    setOrderStep('awaiting-payment');
    const started = Date.now();
    const id = window.setInterval(() => {
      fetchReservationStatus(ref).then((s) => {
        if (s.status === 'fulfilled') {
          window.clearInterval(id);
          window.history.replaceState({}, '', window.location.pathname);
          void refreshUserMemberships(currentUser.uid);
          refreshPaymentHistory();
          refreshGroups();
          refreshPlans();
          setOrderStep('success');
          setCompletedOrder({
            referenceId: ref,
            fullName: formData.fullName.trim(),
            email: formData.email.trim(),
            whatsappNumber: formData.whatsappNumber.trim(),
            plan: plans.find((p) => p.id === formData.planId) ?? plans[0],
            totalFormatted: formatPlanPrice(plans.find((p) => p.id === formData.planId) ?? plans[0]),
            createdAt: new Date().toISOString(),
          });
        } else if (s.status === 'expired' || s.status === 'failed') {
          window.clearInterval(id);
          setCheckoutError(
            s.status === 'expired'
              ? 'Your reservation expired before payment completed.'
              : 'Payment failed or was cancelled. Please try again.'
          );
          setOrderStep('checkout');
        } else if (Date.now() - started > 90_000) {
          window.clearInterval(id);
          setCheckoutError('We could not confirm payment yet. Check your payment history in a few minutes.');
          setOrderStep('checkout');
        }
      });
    }, 3000);
    return () => window.clearInterval(id);
    // Only run on mount / user change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentUser]);

  const handleDoneToProfile = () => {
    setOrderModalOpen(false);
    openProfileView();
  };

  const handleStartNewOrder = () => {
    const defaultPlan = plans.find((p) => p.status === 'available') ?? plans[0];
    if (!defaultPlan) {
      setCheckoutError('No live subscription plans are available right now.');
      return;
    }
    setFormData((prev) => ({
      ...prev,
      planId: defaultPlan.id,
      groupCode: '',
      acceptedTerms: false,
    }));
    setOrderStep('form');
  };

  const handleCancelSubscriptionSlot = async (subscriptionId: string) => {
    const targetSub = activeSubscriptions.find((s) => s.id === subscriptionId);
    if (!targetSub || targetSub.status === 'cancelled') return;
    if (!currentUser) throw new Error('Sign in to manage this subscription.');
    const result = await cancelMyMembership({ membershipId: targetSub.id });
    if (!result.cancelled || !result.persisted) {
      throw new Error(result.error || 'Cancellation could not be saved. Please try again.');
    }
    await Promise.all([
      refreshUserMemberships(currentUser.uid),
      Promise.resolve(refreshGroups()),
      Promise.resolve(refreshPlans()),
    ]);
  };

  const handleRestartSubscription = (planId: string) => {
    const plan = plans.find((item) => item.id === planId && livePlanIds.has(item.id));
    if (!plan) {
      window.alert('This subscription plan is no longer available for secure checkout. Contact support for help.');
      return;
    }
    setFormData({
      ...INITIAL_FORM_DATA,
      planId: plan.id,
      fullName: userProfile?.fullName ?? '',
      email: userProfile?.email ?? currentUser?.email ?? '',
      whatsappNumber: userProfile?.whatsappNumber ?? '',
    });
    setOrderStep('form');
    setCheckoutError(null);
    setOrderModalOpen(true);
  };

  const handleStartGiftCheckout = async (input: {
    planId: string;
    durationMonths: BillingDurationMonths;
    recipientName: string;
    recipientEmail: string;
    recipientPhone: string;
    note: string;
  }) => {
    if (!currentUser) throw new Error('Sign in before paying for someone else.');
    if (!livePlanIds.has(input.planId)) {
      throw new Error('This plan is not available for secure checkout yet. No payment was taken.');
    }
    const result = await startBachsCheckout({
      productId: input.planId,
      durationMonths: input.durationMonths,
      recipientName: input.recipientName,
      recipientEmail: input.recipientEmail,
      recipientPhone: input.recipientPhone,
      giftNote: input.note,
      successUrl: `${window.location.origin}/?payment-ref=PENDING`,
      customerEmail: currentUser.email ?? undefined,
      customerName: currentUser.displayName ?? undefined,
    });
    if (!result.ok || !result.checkoutUrl) {
      throw new Error(result.ok ? 'Malformed response from payment server.' : result.error);
    }
    window.location.assign(result.checkoutUrl);
  };

  const handleClaimGiftedSubscriptions = async () => {
    const claimedCount = await claimGiftedMemberships();
    if (currentUser) await refreshUserMemberships(currentUser.uid);
    refreshGroups();
    return claimedCount;
  };

  const handleMarkInboxRead = (messageId: string, isRead: boolean) => {
    setInboxMessages((prev) =>
      prev.map((msg) => (msg.id === messageId ? { ...msg, isRead } : msg))
    );
  };

  const handleSendInvite = (name: string, contact: string) => {
    const newInvite: InvitedPerson = {
      id: `inv-${Date.now()}`,
      name,
      contact,
      inviteCode: userProfile?.inviteCode ?? '',
      sentAt: new Date().toISOString(),
      status: 'Invite link ready',
    };
    setInvitedPeople((prev) => [newInvite, ...prev]);
  };

  // ADMIN HANDLERS
  const handleCreateGroup = async ({
    groupName,
    planId,
    homeAddress,
    maxSlots,
    inviteLink,
  }: {
    groupName: string;
    planId: string;
    homeAddress: string;
    maxSlots: number;
    inviteLink?: string;
  }): Promise<string> => {
    const created = await createSubscriptionGroup({
      planId,
      groupName,
      maxSlots,
      homeAddress,
      inviteLink,
    });
    refreshGroups();
    return created.id;
  };

  const handleDeleteGroup = async (groupId: string) => {
    await deleteSubscriptionGroup(groupId);
    refreshGroups();
  };

  const handleUpdateGroupDetails = (
    groupId: string,
    payload: { groupName: string; homeAddress: string; capacity?: number; inviteLink?: string }
  ) => {
    const trimmed = {
      groupName: payload.groupName,
      homeAddress: payload.homeAddress,
      capacity: payload.capacity,
      inviteLink: payload.inviteLink,
    };
    void updateSubscriptionGroup(groupId, {
      groupName: trimmed.groupName,
      homeAddress: trimmed.homeAddress,
      capacity: trimmed.capacity,
      inviteLink: trimmed.inviteLink,
    })
      .then(() => refreshGroups())
      .catch((err) => console.warn('Could not update group:', err));
    setActiveSubscriptions((prev) =>
      prev.map((sub) =>
        sub.groupId === groupId ? { ...sub, groupName: trimmed.groupName } : sub
      )
    );
  };

  const handleDispatchGroupToInbox = (groupId: string): number => {
    // Share the real invite link — copied to the clipboard for the admin to forward.
    const grp = groups.find((g) => g.id === groupId);
    if (!grp) return 0;
    const link = grp.inviteLink ?? '';
    if (!link) return 0;
    try {
      void navigator.clipboard?.writeText(link);
    } catch {
      // Clipboard may be blocked — the link is still visible in the group details
    }
    return grp.members.filter((m) => m.paymentStatus !== 'Cancelled').length;
  };

  const handleSetGroupLeader = (groupId: string, memberId: string) => {
    void setGroupLeader(groupId, memberId)
      .then(() => refreshGroups())
      .catch((err: unknown) => {
        console.warn('Could not set leader:', err);
        window.alert('Could not set the group leader. Check permissions or try again.');
      });
  };

  const handleApproveGroupMember = (memberId: string) => {
    void approveGroupMember(memberId)
      .then(() => refreshGroups())
      .catch((err: unknown) => {
        console.warn('Could not approve group member:', err);
        window.alert('Could not approve this member. Check permissions or try again.');
      });
  };

  const handleToggleMemberPaymentStatus = (groupId: string, memberId: string) => {
    const targetGroup = groups.find((g) => g.id === groupId);
    const target = targetGroup?.members.find((m) => m.id === memberId);
    if (!target || target.paymentStatus === 'Cancelled') return;
    void setMembershipPayment(memberId, target.paymentStatus !== 'Paid')
      .then(() => refreshGroups())
      .catch((err: unknown) => {
        console.warn('Could not toggle payment status:', err);
        window.alert('Could not update the payment status. Check permissions or try again.');
      });
  };

  const handleCollectMemberPayment = (
    groupId: string,
    memberId: string,
    _collectorRole: PortalRole
  ) => {
    const target = groups.find((g) => g.id === groupId)?.members.find((m) => m.id === memberId);
    if (!target || target.paymentStatus === 'Paid' || target.approvalStatus === 'pending') return;
    // This is a staff-recorded/manual payment status override, not a payment transaction.
    // Verified financial transactions are loaded separately from payment_transactions.
    void setMembershipPayment(memberId, true)
      .then(() => refreshGroups())
      .catch((err: unknown) => {
        console.warn('Could not record the manual payment status:', err);
        window.alert('Could not update the payment status. Check permissions or try again.');
      });
  };

  const handleLogMemberContact = (
    groupId: string,
    memberId: string,
    contactedBy: string,
    note: string
  ) => {
    const nowIso = new Date().toISOString();
    setGroups((prev) =>
      prev.map((grp) =>
        grp.id !== groupId
          ? grp
          : {
              ...grp,
              members: grp.members.map((m) =>
                m.id !== memberId
                  ? m
                  : {
                      ...m,
                      contacted: true,
                      contactedAt: nowIso,
                      contactedBy,
                      contactNote: note,
                    }
              ),
            }
      )
    );
  };

  const handleRemoveGroupMember = (groupId: string, memberId: string) => {
    const targetGroup = groups.find((g) => g.id === groupId);
    const targetMember = targetGroup?.members.find((m) => m.id === memberId);

    void removeGroupMember(memberId)
      .then(() => refreshGroups())
      .catch((err: unknown) => {
        console.warn('Could not remove member:', err);
        window.alert('Could not remove member. Check permissions or try again.');
      });

    setGroups((prev) =>
      prev.map((grp) => {
        if (grp.id !== groupId) return grp;
        const remaining = grp.members.filter((m) => m.id !== memberId);
        // Ensure another paid/active member becomes leader if the leader was removed
        if (targetMember?.isLeader && remaining.length > 0 && !remaining.some((m) => m.isLeader)) {
          const nextLeader =
            remaining.find((m) => m.paymentStatus !== 'Cancelled') ?? remaining[0];
          return {
            ...grp,
            members: remaining.map((m) =>
              m.id === nextLeader.id ? { ...m, isLeader: true } : m
            ),
          };
        }
        return { ...grp, members: remaining };
      })
    );

    if (targetMember?.linkedSubscriptionId) {
      const linkedId = targetMember.linkedSubscriptionId;
      setActiveSubscriptions((prev) =>
        prev.map((sub) =>
          sub.id === linkedId
            ? { ...sub, status: 'cancelled', cancelledAt: new Date().toISOString() }
            : sub
        )
      );
    }

    if (targetGroup && targetMember && targetMember.paymentStatus !== 'Cancelled') {
      restoreOnePlanSlot(targetGroup.planId);
    }
  };

  const handleAddPlan = async ({
    name,
    category,
    description,
    priceMonthly,
    totalSlots,
    status,
  }: {
    name: string;
    category: string;
    description: string;
    priceMonthly: number;
    totalSlots: number;
    status: PlanStatus;
  }): Promise<void> => {
    try {
      await createSubscriptionProduct({ name, category, description, monthlyPrice: priceMonthly });
      const refreshedPlans = await fetchLiveSubscriptionPlans();
      const createdPlan = refreshedPlans.find((plan) => plan.name.trim().toLowerCase() === name.trim().toLowerCase());
      if (!createdPlan) {
        if (refreshedPlans.length > 0) {
          setPlans(refreshedPlans);
          setLivePlanIds(new Set(refreshedPlans.map((plan) => plan.id)));
        }
        throw new Error('The plan was saved, but it is not appearing in the live catalog. Check that it is active and try refreshing.');
      }
      setPlans(refreshedPlans);
      setLivePlanIds(new Set(refreshedPlans.map((plan) => plan.id)));
    } catch (err: unknown) {
      console.warn('Could not create subscription plan:', err);
      throw new Error(err instanceof Error ? err.message : 'Unexpected database error while saving the plan.');
    }
  };

  const handleTogglePlanStatus = async (planId: string): Promise<void> => {
    const plan = plans.find((item) => item.id === planId);
    if (!plan) return;
    try {
      await setSubscriptionProductAvailability(planId, plan.status === 'available' ? 'waitlist' : 'open');
      await refreshPlans();
    } catch (err: unknown) {
      console.warn('Could not update subscription plan:', err);
      window.alert(err instanceof Error ? err.message : 'Could not update the plan. Check permissions and try again.');
      throw err;
    }
  };

  const handleMovePlan = async (planId: string, direction: 'up' | 'down'): Promise<void> => {
    try {
      await moveSubscriptionProduct(planId, direction);
      await refreshPlans();
    } catch (err: unknown) {
      console.warn('Could not reorder subscription plan:', err);
      window.alert(err instanceof Error ? err.message : 'Could not move the plan. Check permissions and try again.');
      throw err;
    }
  };

  const handleDeletePlan = async (planId: string): Promise<void> => {
    try {
      await deleteSubscriptionProductListing(planId);
      await refreshPlans();
    } catch (err: unknown) {
      console.warn('Could not remove subscription listing:', err);
      window.alert(err instanceof Error ? err.message : 'Could not remove this listing. Check permissions and try again.');
      throw err;
    }
  };

  // Onboarding intercept: new Google users must complete phone + password setup before seeing the app
  if (!authLoading && currentUser && authProfile && authProfile.onboarding_completed === false) {
    return <OnboardingFlow onComplete={refreshProfile} />;
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <Navbar
        activeView={currentView}
        hasProfile={Boolean(userProfile)}
        onNavigateSection={navigateToSection}
        onOpenProfile={openProfileView}
        onJoinNow={handleJoinNowFromNav}
        onOpenAuthModal={() => setAuthModalOpen(true)}
      />

      {/* Invite landing banner — supports both group and personal invite URLs. */}
      {showInviteBanner && (
        <div className="border-b border-[#1DB954]/30 bg-[#0d2010]">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3 text-sm text-white">
              <Ticket className="h-5 w-5 text-[#1DB954] shrink-0" aria-hidden="true" />
              <span>
                {isGroupInvite ? (
                  <>
                    You were invited to group{' '}
                    <strong className="font-mono text-[#1DB954]">{joinCodeFromUrl}</strong>.{' '}
                    {currentUser
                      ? 'Accept the invitation in your profile to request a seat.'
                      : 'Sign in to accept this invitation.'}
                  </>
                ) : (
                  <>You were invited to JOIN THE QUEUE. Create an account or sign in to explore available plans.</>
                )}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => (currentUser ? openProfileView() : setAuthModalOpen(true))}
                className="inline-flex items-center min-h-[36px] rounded-full bg-[#1DB954] px-4 py-1.5 text-xs font-bold text-black transition-colors hover:bg-[#15803D] hover:text-white cursor-pointer"
              >
                {currentUser ? (isGroupInvite ? 'Accept Invitation' : 'Open My Profile') : (isGroupInvite ? 'Sign In to Accept' : 'Create Account')}
              </button>
              <button
                type="button"
                onClick={() => setInviteBannerDismissed(true)}
                aria-label="Dismiss invitation banner"
                title="Dismiss"
                className="flex h-9 w-9 items-center justify-center rounded-full text-[#B3B3B3] hover:text-white transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="flex-1">
        {currentView === 'landing' && (
          <>
            <HeroSection
              onExplorePlans={() => scrollToSection('plans')}
              onHowItWorks={() => scrollToSection('how-it-works')}
            />

            <PlansSection
              plans={plans}
              recentOrder={completedOrder}
              onSelectPlan={openJoinModalForPlan}
              onViewRecentOrder={openProfileView}
            />

            <HowItWorksSection />

            <FaqSection items={FAQ_ITEMS} />
          </>
        )}

        {currentView === 'profile' && (
          <ProfileView
            profile={userProfile}
            plans={plans}
            subscriptions={activeSubscriptions}
            inboxMessages={inboxMessages}
            paymentHistory={paymentHistory}
            invitedPeople={invitedPeople}
            sponsoredSlots={sponsoredSlots}
            onBackToPlans={() => navigateToSection('plans')}
            onJoinNewSlot={handleJoinNowFromNav}
            onSelectMarketplacePlan={openJoinModalForPlan}
            onOpenAdminConsole={currentUser && canOpenStaffConsole ? openAdminView : undefined}
            staffAccess={staffAccess}
            designatedSuperAdminAvailable={designatedSuperAdminAvailable && staffAccess === null}
            onCancelSubscriptionSlot={handleCancelSubscriptionSlot}
            onRestartSubscription={handleRestartSubscription}
            onClaimGiftedSubscriptions={handleClaimGiftedSubscriptions}
            onStartGiftCheckout={handleStartGiftCheckout}
            onMarkInboxRead={handleMarkInboxRead}
            onSendInvite={handleSendInvite}
            phoneVerified={authProfile?.phone_verified ?? false}
            onSavePhone={async (phone) => {
              await updateUserProfile({ phone, phone_verified: false });
            }}
            setupPhoneRecaptcha={setupPhoneRecaptcha}
            sendPhoneOtp={sendPhoneOtp}
            verifyAndLinkPhone={verifyAndLinkPhone}
          />
        )}

        {currentView === 'admin' && (
          <AdminView
            plans={plans}
            groups={groups}
            transactions={platformTransactions}
            supportPermissions={supportPermissions}
            onBackToSite={() => navigateToSection('home')}
            onRequestSignIn={() => setAuthModalOpen(true)}
            onUpdateSupportPermissions={setSupportPermissions}
            onCreateGroup={handleCreateGroup}
            onDeleteGroup={handleDeleteGroup}
            onUpdateGroupDetails={handleUpdateGroupDetails}
            onDispatchGroupToInbox={handleDispatchGroupToInbox}
            onSetGroupLeader={handleSetGroupLeader}
            onApproveGroupMember={handleApproveGroupMember}
            onToggleMemberPaymentStatus={handleToggleMemberPaymentStatus}
            onCollectMemberPayment={handleCollectMemberPayment}
            onLogMemberContact={handleLogMemberContact}
            onRemoveGroupMember={handleRemoveGroupMember}
            onAddPlan={handleAddPlan}
            onTogglePlanStatus={handleTogglePlanStatus}
            onMovePlan={handleMovePlan}
            onDeletePlan={handleDeletePlan}
          />
        )}
      </main>

      <Footer
        onNavigateSection={navigateToSection}
        onOpenInfoModal={(type) => setInfoModalType(type)}
      />

      <OrderModal
        isOpen={orderModalOpen}
        step={orderStep}
        plans={plans}
        groups={groups}
        formData={formData}
        completedOrder={completedOrder}
        onClose={() => setOrderModalOpen(false)}
        onChangeForm={setFormData}
        onProceedToCheckout={() => setOrderStep('checkout')}
        onBackToForm={() => setOrderStep('form')}
        onConfirmOrder={handleConfirmOrder}
        onStartNewOrder={handleStartNewOrder}
        onDoneToProfile={handleDoneToProfile}
        checkoutMode={checkoutMode}
        checkoutUnavailableReason={checkoutUnavailableReason}
        onRequestSignIn={() => setAuthModalOpen(true)}
        isCheckoutPending={isCheckoutPending}
        checkoutError={checkoutError}
      />

      <InfoModal modalType={infoModalType} onClose={() => setInfoModalType(null)} />

      <AuthModal
        isOpen={authModalOpen}
        defaultMode={isPersonalInvite && !currentUser ? 'signup' : 'login'}
        onClose={() => setAuthModalOpen(false)}
        onSuccess={() => {
          setAuthModalOpen(false);
          openProfileView();
        }}
      />
    </div>
  );
}
