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
import { ProfileView } from './components/ProfileView';
import { useAuth } from './context/AuthContext';
import { fetchLiveSubscriptionPlans } from './lib/subscriptionService';
import { startBachsCheckout, fetchReservationStatus, cancelMyMembership } from './lib/paymentProvider';
import {
  BILLING_DURATIONS,
  BRAND_INFO,
  DEFAULT_SUPPORT_PERMISSIONS,
  FAQ_ITEMS,
  INITIAL_PLATFORM_TRANSACTIONS,
  SUBSCRIPTION_PLANS,
  addMonthsToIso,
  formatAmount,
  formatPlanPrice,
} from './data/subscriptions';
import {
  createSubscriptionGroup,
  deleteSubscriptionGroup,
  fetchAdminGroups,
  joinGroupByCode,
  previewGroupByCode,
  removeGroupMember,
  setGroupLeader,
  setMembershipPayment,
  updateSubscriptionGroup,
} from './lib/groupService';
import type {
  ActiveSubscription,
  AppView,
  BillingDurationMonths,
  CompletedOrder,
  GroupMember,
  InboxMessage,
  InfoModalType,
  InvitedPerson,
  OrderFormData,
  OrderModalStep,
  PaymentRecord,
  PlanStatus,
  PlatformTransaction,
  PortalRole,
  SponsoredSlot,
  SubscriptionGroup,
  SubscriptionPlan,
  SupportPermissions,
  UserProfile,
} from './types/subscription';

const INITIAL_FORM_DATA: OrderFormData = {
  fullName: '',
  email: '',
  whatsappNumber: '',
  planId: SUBSCRIPTION_PLANS[0].id,
  groupCode: '',
  acceptedTerms: false,
};

function scrollToSection(sectionId: string) {
  const target = document.getElementById(sectionId);
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function generateReferenceId(prefix = 'JTQ'): string {
  const randomCode = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${randomCode}`;
}

/** Ephemeral code for client-side demo groups only — never persisted. */
function ephemeralGroupCode(): string {
  const randomCode = Math.floor(1000 + Math.random() * 9000);
  return `GFT-${randomCode}`;
}

function buildAdminInboxMessage({
  referenceId,
  planName,
  receivedAt,
  recipientName,
  groupCode,
  groupName,
  inviteLink,
  homeAddress,
}: {
  referenceId: string;
  planName: string;
  receivedAt: string;
  recipientName?: string;
  groupCode?: string;
  groupName?: string;
  inviteLink?: string;
  homeAddress?: string;
}): InboxMessage {
  const targetText = recipientName
    ? `for ${recipientName}'s ${planName} slot`
    : `for your ${planName} slot`;
  const groupText = groupCode
    ? ` in ${groupName ?? 'your group'} (Group ${groupCode})`
    : '';

  return {
    id: `msg-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    referenceId,
    groupCode,
    sender: BRAND_INFO.demoAdminSender,
    subject: recipientName
      ? `Slot Access Details for ${recipientName} — ${planName}`
      : `Your Slot Access Details — ${planName}`,
    planName,
    recipientName,
    body: `Hello! Admin has prepared the onboarding invite link and home address ${targetText}${groupText} (Ref #${referenceId}). Use the copy buttons below whenever you are ready to complete setup.`,
    inviteLink:
      inviteLink || `https://jointhequeue.demo/slot-invite/${referenceId.toLowerCase()}`,
    homeAddress: homeAddress || BRAND_INFO.demoHomeAddress,
    receivedAt,
    isRead: false,
  };
}

export default function App() {
  const {
    currentUser,
    profile: authProfile,
    isAdmin,
    isSuperAdmin,
    isSupport,
    hasPendingStaffInvite,
  } = useAuth();
  const [currentView, setCurrentView] = useState<AppView>('landing');
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [joinBannerDismissed, setJoinBannerDismissed] = useState(false);
  // Read once — the ?join= param drives the invite-landing banner + join flow prefill
  const joinCodeFromUrl = (() => {
    const raw = new URLSearchParams(window.location.search).get('join');
    return raw ? raw.trim().toUpperCase() : null;
  })();
  const showJoinBanner = Boolean(joinCodeFromUrl) && !joinBannerDismissed;
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
  const [plans, setPlans] = useState<SubscriptionPlan[]>(SUBSCRIPTION_PLANS);
  const [groups, setGroups] = useState<SubscriptionGroup[]>([]);
  const [platformTransactions, setPlatformTransactions] = useState<PlatformTransaction[]>(
    INITIAL_PLATFORM_TRANSACTIONS
  );
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
  const [sponsoredSlots, setSponsoredSlots] = useState<SponsoredSlot[]>([]);

  // Track which subscription plans came from a successful live Supabase fetch.
  // A plan is only “live” if the backend supplied it and its id is a UUID.
  const [livePlanIds, setLivePlanIds] = useState<Set<string>>(new Set());

  // Reload groups from the database (admin + member views stay consistent)
  const refreshGroups = () => {
    fetchAdminGroups()
      .then((liveGroups) => setGroups(liveGroups))
      .catch((err) => console.warn('Could not load groups:', err));
  };

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

  // Synchronize live subscription plans from Supabase
  useEffect(() => {
    let mounted = true;
    fetchLiveSubscriptionPlans().then((livePlans) => {
      if (mounted && livePlans.length > 0) {
        setPlans(livePlans);
        setLivePlanIds(new Set(livePlans.map((p) => p.id)));
      }
    });
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

  // Live checkout only runs when:
  //   - demo mode is not forced (VITE_DEMO_MODE), and
  //   - Firebase auth produced a signed-in user, and
  //   - the selected plan came from a successful live Supabase fetch, and
  //   - its id is a UUID (never a bundled local seed slug).
  // Anything else falls back to clearly-labelled demo mode — never to a
  // phantom "successful" checkout.
  const chosenPlanForCheckout = plans.find((p) => p.id === formData.planId);
  const chosenPlanIsLive =
    chosenPlanForCheckout != null && livePlanIds.has(chosenPlanForCheckout.id);
  const isLivePlanId =
    chosenPlanForCheckout != null &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      chosenPlanForCheckout.id
    );
  const checkoutMode: 'live' | 'demo' =
    import.meta.env.VITE_DEMO_MODE === 'true'
      ? 'demo'
      : currentUser && chosenPlanIsLive && isLivePlanId
        ? 'live'
        : 'demo';

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
    const firstAvailablePlan =
      plans.find((plan) => plan.status === 'available') ?? plans[0];
    openJoinModalForPlan(firstAvailablePlan);
  };

  const assignMemberToPlanGroup = (
    chosenPlan: SubscriptionPlan,
    memberInput: Omit<GroupMember, 'isLeader'>,
    preferredGroupCode?: string
  ): SubscriptionGroup => {
    const normalizedPreferred = preferredGroupCode?.trim().toUpperCase();
    const openGroup =
      (normalizedPreferred
        ? groups.find(
            (grp) =>
              grp.planId === chosenPlan.id &&
              grp.groupCode.toUpperCase() === normalizedPreferred &&
              grp.members.filter((m) => m.paymentStatus !== 'Cancelled').length < grp.maxSlots
          )
        : undefined) ??
      groups.find(
        (grp) =>
          grp.planId === chosenPlan.id &&
          grp.members.filter((m) => m.paymentStatus !== 'Cancelled').length < grp.maxSlots
      );

    if (openGroup) {
      const hasActiveLeader = openGroup.members.some(
        (m) => m.isLeader && m.paymentStatus !== 'Cancelled'
      );
      const updatedGroup: SubscriptionGroup = {
        ...openGroup,
        members: [
          ...openGroup.members,
          {
            ...memberInput,
            isLeader: !hasActiveLeader,
          },
        ],
      };
      setGroups((prev) =>
        prev.map((grp) => (grp.id === openGroup.id ? updatedGroup : grp))
      );
      return updatedGroup;
    }

    const newGroupCode = ephemeralGroupCode();
    const planGroupCount = groups.filter((g) => g.planId === chosenPlan.id).length + 1;
    const newGroup: SubscriptionGroup = {
      id: `grp-${Date.now()}`,
      groupName: `${chosenPlan.name} Group ${String(planGroupCount).padStart(2, '0')}`,
      groupCode: newGroupCode,
      planId: chosenPlan.id,
      planName: chosenPlan.name,
      homeAddress: BRAND_INFO.demoHomeAddress,
      inviteLink: `https://jointhequeue.demo/slot-invite/${newGroupCode.toLowerCase()}`,
      maxSlots: chosenPlan.totalSlots,
      createdAt: new Date().toISOString(),
      members: [
        {
          ...memberInput,
          isLeader: true,
        },
      ],
    };
    setGroups((prev) => [newGroup, ...prev]);
    return newGroup;
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

  // Locals-only order handler — used in demo mode where no real backend exists.
  const handleConfirmOrderLocal = () => {
    const chosenPlan = plans.find((p) => p.id === formData.planId) ?? plans[0];
    const nowIso = new Date().toISOString();
    const referenceId = generateReferenceId('JTQ');
    const newSubId = `sub-${Date.now()}`;
    const trimmedName = formData.fullName.trim();
    const trimmedEmail = formData.email.trim();
    const trimmedWhatsapp = formData.whatsappNumber.trim();

    const targetGroup = assignMemberToPlanGroup(
      chosenPlan,
      {
        id: `mem-${Date.now()}`,
        fullName: trimmedName,
        email: trimmedEmail,
        whatsappNumber: trimmedWhatsapp,
        referenceId,
        paymentStatus: 'Paid',
        joinedAt: nowIso,
        payerLabel: 'Self',
        linkedSubscriptionId: newSubId,
        amountPaid: chosenPlan.priceMonthly,
        contacted: false,
      },
      formData.groupCode
    );

    const newOrder: CompletedOrder = {
      referenceId,
      fullName: trimmedName,
      email: trimmedEmail,
      whatsappNumber: trimmedWhatsapp,
      plan: chosenPlan,
      totalFormatted: formatPlanPrice(chosenPlan),
      createdAt: nowIso,
      groupCode: targetGroup.groupCode,
      groupName: targetGroup.groupName,
    };

    if (chosenPlan.status === 'available' && chosenPlan.slotsOpen > 0) {
      setPlans((prevPlans) =>
        prevPlans.map((plan) => {
          if (plan.id !== chosenPlan.id) return plan;
          const nextOpen = Math.max(0, plan.slotsOpen - 1);
          return {
            ...plan,
            slotsOpen: nextOpen,
            availabilityLabel:
              nextOpen > 0
                ? `Available now · ${nextOpen} ${nextOpen === 1 ? 'slot' : 'slots'} remaining`
                : 'Current batch full · Waitlist open',
            status: nextOpen > 0 ? 'available' : 'waitlist',
          };
        })
      );
    }

    // Create or update user profile with latest contact details
    setUserProfile((prev) => ({
      fullName: newOrder.fullName,
      email: newOrder.email,
      whatsappNumber: newOrder.whatsappNumber,
      joinedAt: prev?.joinedAt ?? nowIso,
      inviteCode: prev?.inviteCode ?? referenceId,
    }));

    // Add joined subscription to profile
    const newSubscription: ActiveSubscription = {
      id: newSubId,
      referenceId,
      plan: chosenPlan,
      status: chosenPlan.status === 'waitlist' ? 'waitlist' : 'active',
      joinedAt: nowIso,
      nextRenewalDate: addMonthsToIso(nowIso, 1),
      lastDurationMonths: 1,
      payerType: 'self',
      groupId: targetGroup.id,
      groupCode: targetGroup.groupCode,
      groupName: targetGroup.groupName,
    };
    setActiveSubscriptions((prev) => [newSubscription, ...prev]);

    // Deliver initial admin inbox message with group invite link & home address
    const adminMsg = buildAdminInboxMessage({
      referenceId,
      planName: chosenPlan.name,
      receivedAt: nowIso,
      groupCode: targetGroup.groupCode,
      groupName: targetGroup.groupName,
      inviteLink: targetGroup.inviteLink,
      homeAddress: targetGroup.homeAddress,
    });
    setInboxMessages((prev) => [adminMsg, ...prev]);

    // Record initial transaction in payment history
    const newPayment: PaymentRecord = {
      id: `pay-${Date.now()}`,
      referenceId,
      date: nowIso,
      planName: chosenPlan.name,
      durationLabel: '1 Month',
      months: 1,
      amount: chosenPlan.priceMonthly,
      currencySymbol: chosenPlan.currencySymbol,
      kind: 'initial',
      status: chosenPlan.status === 'waitlist' ? 'Waitlist Recorded' : 'Confirmed (Demo)',
    };
    setPaymentHistory((prev) => [newPayment, ...prev]);

    setPlatformTransactions((prev) => [
      {
        id: `tx-${Date.now()}`,
        referenceId,
        date: nowIso,
        memberName: trimmedName,
        planName: chosenPlan.name,
        groupCode: targetGroup.groupCode,
        source: 'User Checkout',
        amount: chosenPlan.priceMonthly,
        currencySymbol: chosenPlan.currencySymbol,
        status: chosenPlan.status === 'waitlist' ? 'Waitlist Recorded' : 'Confirmed (Demo)',
      },
      ...prev,
    ]);

    setCompletedOrder(newOrder);
    setOrderStep('success');
  };

  // Dispatch: real checkout (live mode) hooks up to Bachs via the backend callable.
  // Demo mode keeps the pre-wired local flow.
  const handleConfirmOrder = () => {
    if (checkoutMode === 'demo') {
      handleConfirmOrderLocal();
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
      beneficiaryUserId: currentUser?.uid,
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
        // Redirect to sandbox checkout page — payment confirmed via webhook, then the
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
    setFormData((prev) => ({
      ...prev,
      planId: defaultPlan.id,
      groupCode: '',
      acceptedTerms: false,
    }));
    setOrderStep('form');
  };

  const handleTriggerNextPayment = (subscriptionId: string, months: BillingDurationMonths) => {
    const targetSub = activeSubscriptions.find((s) => s.id === subscriptionId);
    if (!targetSub || targetSub.status === 'cancelled') return;

    const durationObj =
      BILLING_DURATIONS.find((d) => d.months === months) ?? BILLING_DURATIONS[0];
    const amount = targetSub.plan.priceMonthly * months;
    const referenceId = generateReferenceId('PAY');
    const nowIso = new Date().toISOString();

    setActiveSubscriptions((prev) =>
      prev.map((sub) => {
        if (sub.id !== subscriptionId) return sub;
        return {
          ...sub,
          status: 'active',
          nextRenewalDate: addMonthsToIso(sub.nextRenewalDate, months),
          lastDurationMonths: months,
        };
      })
    );

    if (targetSub.groupId) {
      setGroups((prev) =>
        prev.map((grp) =>
          grp.id !== targetSub.groupId
            ? grp
            : {
                ...grp,
                members: grp.members.map((m) =>
                  m.linkedSubscriptionId === subscriptionId
                    ? { ...m, paymentStatus: 'Paid' }
                    : m
                ),
              }
        )
      );
    }

    const renewalPayment: PaymentRecord = {
      id: `pay-${Date.now()}`,
      referenceId,
      date: nowIso,
      planName: targetSub.plan.name,
      durationLabel: durationObj.label,
      months,
      amount,
      currencySymbol: targetSub.plan.currencySymbol,
      kind: 'renewal',
      recipientName:
        targetSub.payerType === 'recipient' ? targetSub.recipientName : undefined,
      status: 'Confirmed (Demo)',
    };
    setPaymentHistory((prev) => [renewalPayment, ...prev]);

    setPlatformTransactions((prev) => [
      {
        id: `tx-${Date.now()}`,
        referenceId,
        date: nowIso,
        memberName:
          targetSub.payerType === 'recipient' && targetSub.recipientName
            ? targetSub.recipientName
            : userProfile?.fullName ?? 'Member',
        planName: targetSub.plan.name,
        groupCode: targetSub.groupCode,
        source: 'Renewal',
        amount,
        currencySymbol: targetSub.plan.currencySymbol,
        status: 'Confirmed (Demo)',
      },
      ...prev,
    ]);
  };

  const handleCancelSubscriptionSlot = (subscriptionId: string) => {
    const targetSub = activeSubscriptions.find((s) => s.id === subscriptionId);
    if (!targetSub || targetSub.status === 'cancelled') return;

    // In live checkout mode, persist the cancellation before flipping UI state.
    // In live checkout mode, persist the cancellation before flipping UI state.
    if (checkoutMode === 'live') {
      cancelMyMembership({ referenceId: targetSub.referenceId }).catch((err) => {
        console.error('[App] cancelMyMembership failed:', err);
      });
    }

    const cancelledAt = new Date().toISOString();
    setActiveSubscriptions((prev) =>
      prev.map((sub) =>
        sub.id === subscriptionId
          ? {
              ...sub,
              status: 'cancelled',
              cancelledAt,
            }
          : sub
      )
    );

    if (targetSub.groupId) {
      setGroups((prev) =>
        prev.map((grp) =>
          grp.id !== targetSub.groupId
            ? grp
            : {
                ...grp,
                members: grp.members.map((m) =>
                  m.linkedSubscriptionId === subscriptionId
                    ? { ...m, paymentStatus: 'Cancelled', isLeader: false }
                    : m
                ),
              }
        )
      );
    }

    if (targetSub.status === 'active') {
      restoreOnePlanSlot(targetSub.plan.id);
    }
  };

  const handleMarkInboxRead = (messageId: string, isRead: boolean) => {
    setInboxMessages((prev) =>
      prev.map((msg) => (msg.id === messageId ? { ...msg, isRead } : msg))
    );
  };

  const handleSimulateAdminMessage = (subscriptionId: string) => {
    const targetSub =
      activeSubscriptions.find((s) => s.id === subscriptionId) ?? activeSubscriptions[0];
    if (!targetSub) return;

    const matchedGroup = targetSub.groupId
      ? groups.find((g) => g.id === targetSub.groupId)
      : undefined;

    const freshMsg = buildAdminInboxMessage({
      referenceId: generateReferenceId('ADM'),
      planName: targetSub.plan.name,
      receivedAt: new Date().toISOString(),
      recipientName:
        targetSub.payerType === 'recipient' ? targetSub.recipientName : undefined,
      groupCode: matchedGroup?.groupCode ?? targetSub.groupCode,
      groupName: matchedGroup?.groupName ?? targetSub.groupName,
      inviteLink: matchedGroup?.inviteLink,
      homeAddress: matchedGroup?.homeAddress,
    });
    setInboxMessages((prev) => [freshMsg, ...prev]);
  };

  const handleSendInvite = (name: string, contact: string) => {
    const newInvite: InvitedPerson = {
      id: `inv-${Date.now()}`,
      name,
      contact,
      inviteCode: userProfile?.inviteCode ?? generateReferenceId('INV'),
      sentAt: new Date().toISOString(),
      status: 'Invite Sent (Demo)',
    };
    setInvitedPeople((prev) => [newInvite, ...prev]);
  };

  const handlePayForSomebody = ({
    planId,
    months,
    recipientName,
    recipientEmail,
    recipientWhatsapp,
    note,
  }: {
    planId: string;
    months: BillingDurationMonths;
    recipientName: string;
    recipientEmail: string;
    recipientWhatsapp: string;
    note: string;
  }): string => {
    const chosenPlan = plans.find((p) => p.id === planId) ?? plans[0];
    const durationObj =
      BILLING_DURATIONS.find((d) => d.months === months) ?? BILLING_DURATIONS[0];
    const amount = chosenPlan.priceMonthly * months;
    const referenceId = generateReferenceId('GFT');
    const nowIso = new Date().toISOString();
    const newSubId = `sub-gift-${Date.now()}`;

    const targetGroup = assignMemberToPlanGroup(chosenPlan, {
      id: `mem-${Date.now()}`,
      fullName: recipientName,
      email: recipientEmail,
      whatsappNumber: recipientWhatsapp,
      referenceId,
      paymentStatus: 'Paid',
      joinedAt: nowIso,
      payerLabel: userProfile ? `Paid by ${userProfile.fullName}` : 'Sponsored',
      linkedSubscriptionId: newSubId,
      amountPaid: amount,
      contacted: false,
    });

    // Add to managed subscriptions so the payer can manage its renewals directly
    const recipientSub: ActiveSubscription = {
      id: newSubId,
      referenceId,
      plan: chosenPlan,
      status: chosenPlan.status === 'waitlist' ? 'waitlist' : 'active',
      joinedAt: nowIso,
      nextRenewalDate: addMonthsToIso(nowIso, months),
      lastDurationMonths: months,
      payerType: 'recipient',
      recipientName,
      recipientEmail,
      recipientWhatsapp,
      note: note || undefined,
      groupId: targetGroup.id,
      groupCode: targetGroup.groupCode,
      groupName: targetGroup.groupName,
    };
    setActiveSubscriptions((prev) => [recipientSub, ...prev]);

    if (chosenPlan.status === 'available' && chosenPlan.slotsOpen > 0) {
      setPlans((prevPlans) =>
        prevPlans.map((plan) => {
          if (plan.id !== chosenPlan.id) return plan;
          const nextOpen = Math.max(0, plan.slotsOpen - 1);
          return {
            ...plan,
            slotsOpen: nextOpen,
            availabilityLabel:
              nextOpen > 0
                ? `Available now · ${nextOpen} ${nextOpen === 1 ? 'slot' : 'slots'} remaining`
                : 'Current batch full · Waitlist open',
            status: nextOpen > 0 ? 'available' : 'waitlist',
          };
        })
      );
    }

    // Deliver admin inbox copy with group invite link & address for the sponsored slot
    const adminMsg = buildAdminInboxMessage({
      referenceId,
      planName: chosenPlan.name,
      receivedAt: nowIso,
      recipientName,
      groupCode: targetGroup.groupCode,
      groupName: targetGroup.groupName,
      inviteLink: targetGroup.inviteLink,
      homeAddress: targetGroup.homeAddress,
    });
    setInboxMessages((prev) => [adminMsg, ...prev]);

    const sponsored: SponsoredSlot = {
      id: `gift-${Date.now()}`,
      subscriptionId: newSubId,
      referenceId,
      recipientName,
      recipientContact: `${recipientEmail} · ${recipientWhatsapp}`,
      planName: chosenPlan.name,
      durationLabel: durationObj.label,
      amountFormatted: formatAmount(amount, chosenPlan.currencySymbol),
      paidAt: nowIso,
      note: note || undefined,
    };
    setSponsoredSlots((prev) => [sponsored, ...prev]);

    const giftPayment: PaymentRecord = {
      id: `pay-${Date.now()}`,
      referenceId,
      date: nowIso,
      planName: chosenPlan.name,
      durationLabel: durationObj.label,
      months,
      amount,
      currencySymbol: chosenPlan.currencySymbol,
      kind: 'gift',
      recipientName,
      status: 'Confirmed (Demo)',
    };
    setPaymentHistory((prev) => [giftPayment, ...prev]);

    setPlatformTransactions((prev) => [
      {
        id: `tx-${Date.now()}`,
        referenceId,
        date: nowIso,
        memberName: recipientName,
        planName: chosenPlan.name,
        groupCode: targetGroup.groupCode,
        source: 'Paid for Somebody',
        amount,
        currencySymbol: chosenPlan.currencySymbol,
        status: 'Confirmed (Demo)',
      },
      ...prev,
    ]);

    return newSubId;
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
    collectorRole: PortalRole
  ) => {
    const targetGroup = groups.find((g) => g.id === groupId);
    const targetMember = targetGroup?.members.find((m) => m.id === memberId);
    if (!targetGroup || !targetMember || targetMember.paymentStatus === 'Paid') return;

    const groupPlan = plans.find((p) => p.id === targetGroup.planId) ?? plans[0];
    const nowIso = new Date().toISOString();

    void setMembershipPayment(memberId, true)
      .then(() => refreshGroups())
      .catch((err: unknown) => {
        console.warn('Could not collect payment:', err);
        window.alert('Could not mark this member as paid. Check permissions or try again.');
      });

    setPlatformTransactions((prev) => [
      {
        id: `tx-${Date.now()}`,
        referenceId: targetMember.referenceId,
        date: nowIso,
        memberName: targetMember.fullName,
        planName: groupPlan.name,
        groupCode: targetGroup.groupCode,
        source: collectorRole === 'support' ? 'Support Collected' : 'Admin Marked Paid',
        amount: groupPlan.priceMonthly,
        currencySymbol: groupPlan.currencySymbol,
        status: 'Confirmed (Demo)',
      },
      ...prev,
    ]);
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

  const handleAddPlan = ({
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
  }) => {
    const slotsOpen = status === 'available' ? totalSlots : 0;
    const newPlan: SubscriptionPlan = {
      id: `plan-${Date.now()}`,
      name,
      category,
      description,
      priceMonthly,
      currencySymbol: '₦',
      billingCycle: 'month',
      status,
      availabilityLabel:
        status === 'available'
          ? `Available now · ${slotsOpen} ${slotsOpen === 1 ? 'slot' : 'slots'} remaining`
          : 'Next batch opening soon · Waitlist open',
      slotsOpen,
      totalSlots,
      eligibilityNote:
        'Independent slot coordination listed by Admin. Verify eligibility before joining.',
      highlights: [
        'Admin-coordinated subscription slot access',
        'Receive group invite link and home address in your Profile Inbox',
        'Manage monthly or multi-month renewals anytime',
      ],
      icon: 'music-disc',
      featured: false,
    };
    setPlans((prev) => [...prev, newPlan]);
  };

  const handleTogglePlanStatus = (planId: string) => {
    setPlans((prev) =>
      prev.map((plan) => {
        if (plan.id !== planId) return plan;
        const nextStatus: PlanStatus = plan.status === 'available' ? 'waitlist' : 'available';
        const nextOpen =
          nextStatus === 'available' ? Math.max(1, plan.slotsOpen || plan.totalSlots) : 0;
        return {
          ...plan,
          status: nextStatus,
          slotsOpen: nextOpen,
          availabilityLabel:
            nextStatus === 'available'
              ? `Available now · ${nextOpen} ${nextOpen === 1 ? 'slot' : 'slots'} remaining`
              : 'Next batch opening soon · Waitlist open',
        };
      })
    );
  };

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

      {/* Invite landing banner — visible when arriving via ?join=GFT-XXXX */}
      {showJoinBanner && (
        <div className="border-b border-[#1DB954]/30 bg-[#0d2010]">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3 text-sm text-white">
              <Ticket className="h-5 w-5 text-[#1DB954] shrink-0" aria-hidden="true" />
              <span>
                You were invited to group{' '}
                <strong className="font-mono text-[#1DB954]">{joinCodeFromUrl}</strong>.{' '}
                {currentUser ? 'Open your profile to claim a seat.' : 'Sign in — your seat is waiting.'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => (currentUser ? openProfileView() : setAuthModalOpen(true))}
                className="inline-flex items-center min-h-[36px] rounded-full bg-[#1DB954] px-4 py-1.5 text-xs font-bold text-black transition-colors hover:bg-[#15803D] hover:text-white cursor-pointer"
              >
                {currentUser ? 'Open join flow' : 'Sign In'}
              </button>
              <button
                type="button"
                onClick={() => setJoinBannerDismissed(true)}
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
            onOpenAdminConsole={currentUser && canOpenStaffConsole ? openAdminView : undefined}
            staffAccess={staffAccess}
            designatedSuperAdminAvailable={designatedSuperAdminAvailable && staffAccess === null}
            onTriggerNextPayment={handleTriggerNextPayment}
            onCancelSubscriptionSlot={handleCancelSubscriptionSlot}
            onMarkInboxRead={handleMarkInboxRead}
            onSimulateAdminMessage={handleSimulateAdminMessage}
            onSendInvite={handleSendInvite}
            onPayForSomebody={handlePayForSomebody}
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
            onToggleMemberPaymentStatus={handleToggleMemberPaymentStatus}
            onCollectMemberPayment={handleCollectMemberPayment}
            onLogMemberContact={handleLogMemberContact}
            onRemoveGroupMember={handleRemoveGroupMember}
            onAddPlan={handleAddPlan}
            onTogglePlanStatus={handleTogglePlanStatus}
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
        isCheckoutPending={isCheckoutPending}
        checkoutError={checkoutError}
      />

      <InfoModal modalType={infoModalType} onClose={() => setInfoModalType(null)} />

      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onSuccess={() => {
          setAuthModalOpen(false);
          openProfileView();
        }}
      />
    </div>
  );
}
