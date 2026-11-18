import { useEffect, useState, type FormEvent } from 'react';
import type { ConfirmationResult, RecaptchaVerifier } from 'firebase/auth';
import {
  ArrowLeft,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  ExternalLink,
  Gift,
  Hash,
  History,
  Inbox,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Plus,
  RefreshCw,
  Send,
  Settings,
  ShieldCheck,
  Ticket,
  UserCheck,
  UserPlus,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { MarketplaceView } from './MarketplaceView';
import { SettingsView } from './SettingsView';
import {
  BILLING_DURATIONS,
  addMonthsToIso,
  formatAmount,
  formatDisplayDate,
  formatPlanPrice,
} from '../data/subscriptions';
import {
  fetchMyGroups,
  joinGroupByCode,
  previewGroupByCode,
  type GroupPreview,
  type MyGroupEntry,
} from '../lib/groupService';
import type {
  ActiveSubscription,
  BillingDurationMonths,
  InboxMessage,
  InvitedPerson,
  PaymentRecord,
  SponsoredSlot,
  SubscriptionPlan,
  UserProfile,
} from '../types/subscription';

interface ProfileViewProps {
  profile: UserProfile | null;
  plans: SubscriptionPlan[];
  subscriptions: ActiveSubscription[];
  inboxMessages: InboxMessage[];
  paymentHistory: PaymentRecord[];
  invitedPeople: InvitedPerson[];
  sponsoredSlots: SponsoredSlot[];
  onBackToPlans: () => void;
  onJoinNewSlot: () => void;
  onOpenAdminConsole?: () => void;
  staffAccess?: 'superAdmin' | 'admin' | 'support' | null;
  /** Designated bootstrap account that may claim super admin access. */
  designatedSuperAdminAvailable?: boolean;
  onTriggerNextPayment: (subscriptionId: string, months: BillingDurationMonths) => void;
  onCancelSubscriptionSlot: (subscriptionId: string) => void;
  onMarkInboxRead: (messageId: string, isRead: boolean) => void;
  onSimulateAdminMessage: (subscriptionId: string) => void;
  onSendInvite: (name: string, contact: string) => void;
  onPayForSomebody: (payload: {
    planId: string;
    months: BillingDurationMonths;
    recipientName: string;
    recipientEmail: string;
    recipientWhatsapp: string;
    note: string;
  }) => string;
  phoneVerified: boolean;
  onSavePhone: (phone: string) => Promise<void>;
  setupPhoneRecaptcha: (containerId: string) => RecaptchaVerifier;
  sendPhoneOtp: (phone: string, verifier: RecaptchaVerifier) => Promise<ConfirmationResult>;
  verifyAndLinkPhone: (verificationId: string, code: string, phone: string) => Promise<void>;
}

type HistoryFilter = 'all' | 'renewal' | 'gift';
type ProfileSubView =
  | 'overview'
  | 'inbox'
  | 'invite'
  | 'gift'
  | 'renew'
  | 'settings'
  | 'marketplace'
  | 'join';

interface PendingConfirmation {
  mode: 'renewal' | 'gift';
  title: string;
  planName: string;
  durationLabel: string;
  months: BillingDurationMonths;
  amount: number;
  currencySymbol: string;
  subscriptionId?: string;
  currentRenewalDate?: string;
  newRenewalDate?: string;
  recipientName?: string;
  recipientEmail?: string;
  recipientWhatsapp?: string;
  planId?: string;
  note?: string;
}

export function ProfileView({
  profile,
  plans,
  subscriptions,
  inboxMessages,
  paymentHistory,
  invitedPeople,
  sponsoredSlots,
  onBackToPlans,
  onJoinNewSlot,
  onOpenAdminConsole,
  staffAccess,
  designatedSuperAdminAvailable,
  onTriggerNextPayment,
  onCancelSubscriptionSlot,
  onMarkInboxRead,
  onSimulateAdminMessage,
  onSendInvite,
  onPayForSomebody,
  phoneVerified,
  onSavePhone,
  setupPhoneRecaptcha,
  sendPhoneOtp,
  verifyAndLinkPhone,
}: ProfileViewProps) {
  const [subView, setSubView] = useState<ProfileSubView>('overview');
  const [mockPassword, setMockPassword] = useState<string | null>(null);
  const [selectedSubId, setSelectedSubId] = useState<string>(subscriptions[0]?.id ?? '');
  const [selectedDuration, setSelectedDuration] = useState<BillingDurationMonths>(1);
  const [selectedInboxId, setSelectedInboxId] = useState<string>(inboxMessages[0]?.id ?? '');
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');

  // Copy states
  const [copiedInviteLink, setCopiedInviteLink] = useState(false);
  const [copiedInviteCode, setCopiedInviteCode] = useState(false);
  const [copiedInboxCodeId, setCopiedInboxCodeId] = useState<string | null>(null);
  const [copiedInboxLinkId, setCopiedInboxLinkId] = useState<string | null>(null);
  const [copiedInboxAddressId, setCopiedInboxAddressId] = useState<string | null>(null);

  // Join-with-code state
  const [joinCode, setJoinCode] = useState('');
  const [joinPreview, setJoinPreview] = useState<GroupPreview | null>(null);
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinSuccess, setJoinSuccess] = useState<string | null>(null);
  const [myGroups, setMyGroups] = useState<MyGroupEntry[]>([]);

  const refreshMyGroups = () => {
    fetchMyGroups()
      .then((rows) => setMyGroups(rows))
      .catch((err) => console.warn('[ProfileView] Could not load your groups:', err));
  };

  const handleLookupGroup = async () => {
    const code = joinCode.trim().toUpperCase();
    if (!/^GFT-\d{4}$/i.test(code)) {
      setJoinError('Enter a valid group code (e.g. GFT-7471).');
      setJoinPreview(null);
      return;
    }
    setJoinBusy(true);
    setJoinError(null);
    setJoinSuccess(null);
    try {
      const preview = await previewGroupByCode(code);
      setJoinPreview(preview);
    } catch (err) {
      setJoinPreview(null);
      setJoinError(err instanceof Error ? err.message : 'No open group found with that code.');
    } finally {
      setJoinBusy(false);
    }
  };

  const handleJoinGroup = async () => {
    if (!joinPreview) return;
    setJoinBusy(true);
    setJoinError(null);
    try {
      const result = await joinGroupByCode(joinPreview.groupCode);
      setJoinSuccess(
        `Your request to join ${result.group_name} (${result.group_code}) for ${result.product_name} was sent. Your seat is reserved while the admin reviews it.`
      );
      setJoinPreview(null);
      setJoinCode('');
      refreshMyGroups();
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : 'Could not join this group.');
    } finally {
      setJoinBusy(false);
    }
  };

  useEffect(() => {
    refreshMyGroups();
    // Prefill a ?join=GFT-XXXX invite link straight into the join flow
    const fromUrl = new URLSearchParams(window.location.search).get('join');
    if (fromUrl) {
      setJoinCode(fromUrl.trim().toUpperCase());
      setSubView('join');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Invite form state
  const [inviteName, setInviteName] = useState('');
  const [inviteContact, setInviteContact] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccessMsg, setInviteSuccessMsg] = useState<string | null>(null);

  // Pay for somebody form state
  const [giftPlanId, setGiftPlanId] = useState<string>(
    plans.find((p) => p.status === 'available')?.id ?? plans[0].id
  );
  const [giftDuration, setGiftDuration] = useState<BillingDurationMonths>(1);
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientWhatsapp, setRecipientWhatsapp] = useState('');
  const [giftNote, setGiftNote] = useState('');
  const [giftError, setGiftError] = useState<string | null>(null);

  // Payment & Cancel confirmation modal & banner feedback
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [pendingCancelSub, setPendingCancelSub] = useState<ActiveSubscription | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [profileNotice, setProfileNotice] = useState<string | null>(null);

  useEffect(() => {
    if (subscriptions.length > 0 && !subscriptions.some((s) => s.id === selectedSubId)) {
      setSelectedSubId(subscriptions[0].id);
    }
  }, [subscriptions, selectedSubId]);

  useEffect(() => {
    if (inboxMessages.length > 0 && !inboxMessages.some((m) => m.id === selectedInboxId)) {
      setSelectedInboxId(inboxMessages[0].id);
    }
  }, [inboxMessages, selectedInboxId]);

  useEffect(() => {
    if (!pendingConfirmation && !pendingCancelSub) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isConfirming) {
        setPendingConfirmation(null);
        setPendingCancelSub(null);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [pendingConfirmation, pendingCancelSub, isConfirming]);

  if (!profile) {
    return (
      <section className="bg-black py-16 sm:py-24 min-h-[70vh] flex items-center">
        <div className="mx-auto max-w-2xl px-4 sm:px-6 text-center">
          <div className="rounded-2xl border border-white/10 bg-[#181818] p-8 sm:p-10">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[#1DB954]/30 bg-[#1DB954]/10 text-[#1DB954]">
              <Users className="h-7 w-7" aria-hidden="true" />
            </div>
            <h1 className="mt-5 text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
              Your Profile Is Ready Once You Join a Slot
            </h1>
            <p className="mt-3 text-sm sm:text-base text-[#B3B3B3] leading-relaxed">
              Choose a subscription plan and confirm your simulated order to view your joined slot, inbox messages, payment history, multi-month renewal options, and invite tools here.
            </p>
            <div className="mt-7 flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                type="button"
                onClick={onJoinNewSlot}
                className="w-full sm:w-auto min-h-[46px] rounded-full bg-[#1DB954] px-7 py-3 text-sm font-bold text-black transition-colors hover:bg-[#15803D] hover:text-white cursor-pointer"
              >
                Join a Subscription Slot
              </button>
              <button
                type="button"
                onClick={onBackToPlans}
                className="w-full sm:w-auto min-h-[46px] rounded-full border border-white/20 bg-[#121212] px-6 py-3 text-sm font-semibold text-white transition-colors hover:border-[#1DB954] cursor-pointer"
              >
                Explore Available Plans
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const activeSub = subscriptions.find((s) => s.id === selectedSubId) ?? subscriptions[0];
  const selectedDurationObj =
    BILLING_DURATIONS.find((d) => d.months === selectedDuration) ?? BILLING_DURATIONS[0];
  const renewalTotal = activeSub ? activeSub.plan.priceMonthly * selectedDuration : 0;
  const previewNewRenewalDate = activeSub
    ? addMonthsToIso(activeSub.nextRenewalDate, selectedDuration)
    : '';

  const activeInboxMessage =
    inboxMessages.find((m) => m.id === selectedInboxId) ?? inboxMessages[0] ?? null;
  const unreadCount = inboxMessages.filter((m) => !m.isRead).length;

  const giftPlan = plans.find((p) => p.id === giftPlanId) ?? plans[0];
  const giftDurationObj =
    BILLING_DURATIONS.find((d) => d.months === giftDuration) ?? BILLING_DURATIONS[0];
  const giftTotal = giftPlan.priceMonthly * giftDuration;

  const inviteUrl = `https://jointhequeue.demo/invite/${profile.inviteCode}`;
  const totalSpent = paymentHistory.reduce((sum, item) => sum + item.amount, 0);

  const filteredHistory = paymentHistory.filter((item) => {
    if (historyFilter === 'renewal') return item.kind === 'renewal' || item.kind === 'initial';
    if (historyFilter === 'gift') return item.kind === 'gift';
    return true;
  });

  const openSubPage = (nextView: ProfileSubView) => {
    setSubView(nextView);
    if (nextView === 'inbox') {
      const firstUnread = inboxMessages.find((m) => !m.isRead);
      const targetMsg = firstUnread ?? inboxMessages[0];
      if (targetMsg) {
        setSelectedInboxId(targetMsg.id);
        if (!targetMsg.isRead) {
          onMarkInboxRead(targetMsg.id, true);
        }
      }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleManageRenewal = (subscriptionId: string) => {
    setSelectedSubId(subscriptionId);
    setSubView('renew');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSelectInboxMessage = (message: InboxMessage) => {
    setSelectedInboxId(message.id);
    if (!message.isRead) {
      onMarkInboxRead(message.id, true);
    }
  };

  const handleCopyText = async (value: string, onDone: () => void) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard API may be unavailable in restricted contexts; still provide UI feedback
    }
    onDone();
  };

  const handleCopyInviteLink = () => {
    void handleCopyText(inviteUrl, () => {
      setCopiedInviteLink(true);
      window.setTimeout(() => setCopiedInviteLink(false), 2000);
    });
  };

  const handleCopyInviteCode = () => {
    void handleCopyText(profile.inviteCode, () => {
      setCopiedInviteCode(true);
      window.setTimeout(() => setCopiedInviteCode(false), 2000);
    });
  };

  const handleInviteSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = inviteName.trim();
    const trimmedContact = inviteContact.trim();

    if (trimmedName.length < 2) {
      setInviteError('Please enter your friend’s name.');
      return;
    }
    if (trimmedContact.length < 5) {
      setInviteError('Please enter an email address or WhatsApp number.');
      return;
    }

    setInviteError(null);
    onSendInvite(trimmedName, trimmedContact);
    setInviteName('');
    setInviteContact('');
    setInviteSuccessMsg(`Invite sent to ${trimmedName}.`);
    window.setTimeout(() => setInviteSuccessMsg(null), 4000);
  };

  const handleGiftSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = recipientName.trim();
    const trimmedEmail = recipientEmail.trim();
    const digitsOnly = recipientWhatsapp.replace(/[^\d]/g, '');
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (trimmedName.length < 2) {
      setGiftError('Please enter the recipient’s full name.');
      return;
    }
    if (!emailRegex.test(trimmedEmail)) {
      setGiftError('Please enter a valid recipient email address.');
      return;
    }
    if (digitsOnly.length < 10 || digitsOnly.length > 15) {
      setGiftError('Please enter a valid recipient WhatsApp number (10–15 digits).');
      return;
    }

    setGiftError(null);
    setPendingConfirmation({
      mode: 'gift',
      title: `Pay for ${trimmedName}`,
      planName: giftPlan.name,
      durationLabel: giftDurationObj.label,
      months: giftDuration,
      amount: giftTotal,
      currencySymbol: giftPlan.currencySymbol,
      recipientName: trimmedName,
      recipientEmail: trimmedEmail,
      recipientWhatsapp: recipientWhatsapp.trim(),
      planId: giftPlan.id,
      note: giftNote.trim(),
    });
  };

  const handleOpenRenewalConfirmation = () => {
    if (!activeSub) return;
    setPendingConfirmation({
      mode: 'renewal',
      title:
        activeSub.payerType === 'recipient' && activeSub.recipientName
          ? `Renew Slot for ${activeSub.recipientName}`
          : 'Confirm Next Payment',
      planName: activeSub.plan.name,
      durationLabel: selectedDurationObj.label,
      months: selectedDuration,
      amount: renewalTotal,
      currencySymbol: activeSub.plan.currencySymbol,
      subscriptionId: activeSub.id,
      currentRenewalDate: formatDisplayDate(activeSub.nextRenewalDate),
      newRenewalDate: formatDisplayDate(previewNewRenewalDate),
      recipientName: activeSub.recipientName,
    });
  };

  const handleConfirmPendingPayment = () => {
    if (!pendingConfirmation || isConfirming) return;
    setIsConfirming(true);

    window.setTimeout(() => {
      if (pendingConfirmation.mode === 'renewal' && pendingConfirmation.subscriptionId) {
        onTriggerNextPayment(pendingConfirmation.subscriptionId, pendingConfirmation.months);
        const ownerSuffix = pendingConfirmation.recipientName
          ? ` for ${pendingConfirmation.recipientName}`
          : '';
        setSubView('overview');
        setProfileNotice(
          `Simulated ${pendingConfirmation.durationLabel} renewal (${formatAmount(
            pendingConfirmation.amount,
            pendingConfirmation.currencySymbol
          )}) recorded for ${pendingConfirmation.planName}${ownerSuffix}.`
        );
      } else if (
        pendingConfirmation.mode === 'gift' &&
        pendingConfirmation.planId &&
        pendingConfirmation.recipientName &&
        pendingConfirmation.recipientEmail &&
        pendingConfirmation.recipientWhatsapp
      ) {
        const createdSubId = onPayForSomebody({
          planId: pendingConfirmation.planId,
          months: pendingConfirmation.months,
          recipientName: pendingConfirmation.recipientName,
          recipientEmail: pendingConfirmation.recipientEmail,
          recipientWhatsapp: pendingConfirmation.recipientWhatsapp,
          note: pendingConfirmation.note ?? '',
        });
        setSelectedSubId(createdSubId);
        setSubView('overview');
        setProfileNotice(
          `Simulated ${pendingConfirmation.durationLabel} payment (${formatAmount(
            pendingConfirmation.amount,
            pendingConfirmation.currencySymbol
          )}) recorded for ${pendingConfirmation.recipientName}. Manage their renewal below.`
        );
        setRecipientName('');
        setRecipientEmail('');
        setRecipientWhatsapp('');
        setGiftNote('');
      }

      setIsConfirming(false);
      setPendingConfirmation(null);
    }, 400);
  };

  const handleConfirmCancelSlot = () => {
    if (!pendingCancelSub) return;
    const cancelledPlanName = pendingCancelSub.plan.name;
    const holderSuffix =
      pendingCancelSub.payerType === 'recipient' && pendingCancelSub.recipientName
        ? ` for ${pendingCancelSub.recipientName}`
        : '';

    onCancelSubscriptionSlot(pendingCancelSub.id);
    setPendingCancelSub(null);
    setSubView('overview');
    setProfileNotice(
      `Cancelled ${cancelledPlanName} slot${holderSuffix}. This slot is now marked cancelled. This is not a refund operation.`
    );
  };

  return (
    <section className="bg-black py-8 sm:py-14 min-h-screen">
      {/* SUB-VIEW 1: DEDICATED PROFILE INBOX PAGE */}
      {subView === 'inbox' && (
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#121212] px-4 py-3.5 sm:px-6">
            <button
              type="button"
              onClick={() => openSubPage('overview')}
              className="inline-flex items-center gap-2 min-h-[40px] text-sm font-semibold text-white hover:text-[#1DB954] transition-colors cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span>Back to Profile</span>
            </button>

            {activeSub && (
              <button
                type="button"
                onClick={() => onSimulateAdminMessage(activeSub.id)}
                className="inline-flex items-center justify-center gap-2 min-h-[40px] rounded-full border border-white/15 bg-[#181818] px-4 py-2 text-xs font-semibold text-white hover:border-[#1DB954] hover:text-[#1DB954] transition-colors cursor-pointer whitespace-nowrap"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Simulate Admin Update</span>
              </button>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#181818] p-5 sm:p-8 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-5 border-b border-white/10">
              <div className="flex items-center gap-3.5">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#1DB954]/30 bg-[#1DB954]/10 text-[#1DB954] shrink-0">
                  <Inbox className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
                    Profile Inbox
                  </h1>
                  <p className="text-xs sm:text-sm text-[#B3B3B3]">
                    Your subscription code, invite link, and home address from Admin.
                  </p>
                </div>
              </div>
              <span className="text-xs font-semibold text-[#1DB954] tabular-nums self-start sm:self-center">
                {inboxMessages.length} {inboxMessages.length === 1 ? 'message' : 'messages'}
                {unreadCount > 0 ? ` · ${unreadCount} unread` : ''}
              </span>
            </div>

            {inboxMessages.length === 0 ? (
              <div className="py-10 text-center text-sm text-[#B3B3B3]">
                No messages yet. When you join a subscription, Admin sends your invite link and home address here.
              </div>
            ) : (
              <div className="space-y-5">
                {/* Clean Message Selector Strip (when 2+ messages exist) */}
                {inboxMessages.length > 1 && (
                  <div className="flex gap-2.5 overflow-x-auto pb-1">
                    {inboxMessages.map((msg) => {
                      const selected = msg.id === activeInboxMessage?.id;
                      return (
                        <button
                          key={msg.id}
                          type="button"
                          onClick={() => handleSelectInboxMessage(msg)}
                          className={`flex flex-col items-start rounded-xl border px-4 py-3 text-left transition-colors shrink-0 min-w-[200px] cursor-pointer ${
                            selected
                              ? 'border-[#1DB954] bg-[#121212]'
                              : 'border-white/10 bg-[#121212]/60 hover:border-white/25'
                          }`}
                        >
                          <div className="flex w-full items-center justify-between gap-2 text-xs">
                            <span className="font-mono font-bold text-[#1DB954] tabular-nums">
                              {msg.referenceId}
                            </span>
                            <span className={msg.isRead ? 'text-[#B3B3B3]' : 'text-[#1DB954] font-semibold'}>
                              {msg.isRead ? 'Read' : 'New'}
                            </span>
                          </div>
                          <span className="mt-1 text-sm font-semibold text-white truncate max-w-[210px]">
                            {msg.recipientName ? `${msg.planName} (${msg.recipientName})` : msg.planName}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Clear, Scannable Message Details */}
                {activeInboxMessage && (
                  <div className="rounded-2xl border border-white/10 bg-[#121212] p-5 sm:p-6 space-y-5">
                    <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-white/10">
                      <div>
                        <p className="text-xs font-semibold text-[#1DB954]">
                          {activeInboxMessage.sender} · {formatDisplayDate(activeInboxMessage.receivedAt)}
                        </p>
                        <h2 className="mt-1 text-lg sm:text-xl font-bold text-white">
                          {activeInboxMessage.subject}
                        </h2>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          onMarkInboxRead(activeInboxMessage.id, !activeInboxMessage.isRead)
                        }
                        className="text-xs font-semibold text-[#B3B3B3] hover:text-white border border-white/15 rounded-full px-3.5 py-2 transition-colors cursor-pointer"
                      >
                        {activeInboxMessage.isRead ? 'Mark unread' : 'Mark read'}
                      </button>
                    </div>

                    <p className="text-sm text-[#B3B3B3] leading-relaxed">
                      {activeInboxMessage.body}
                    </p>

                    {/* 3 Simple Steps / Detail Rows */}
                    <div className="space-y-3">
                      {/* 1. Subscription & Group Code */}
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-white/10 bg-[#181818] p-4">
                        <div className="min-w-0">
                          <p className="inline-flex items-center gap-1.5 text-xs font-medium text-[#B3B3B3]">
                            <Hash className="h-3.5 w-3.5 text-[#1DB954]" aria-hidden="true" />
                            <span>
                              1. Subscription Code
                              {activeInboxMessage.groupCode ? ` · Group ${activeInboxMessage.groupCode}` : ''}
                            </span>
                          </p>
                          <p className="mt-1 font-mono text-base sm:text-lg font-extrabold text-[#1DB954] tabular-nums">
                            {activeInboxMessage.referenceId}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            void handleCopyText(activeInboxMessage.referenceId, () => {
                              setCopiedInboxCodeId(activeInboxMessage.id);
                              window.setTimeout(() => setCopiedInboxCodeId(null), 2000);
                            })
                          }
                          className="inline-flex items-center justify-center gap-1.5 min-h-[42px] rounded-full border border-white/15 bg-[#121212] px-4 py-2 text-xs font-bold text-white hover:border-[#1DB954] hover:text-[#1DB954] transition-colors shrink-0 cursor-pointer"
                        >
                          {copiedInboxCodeId === activeInboxMessage.id ? (
                            <>
                              <Check className="h-3.5 w-3.5 text-[#1DB954]" aria-hidden="true" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Copy Code</span>
                            </>
                          )}
                        </button>
                      </div>

                      {/* 2. Invite Link */}
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-white/10 bg-[#181818] p-4">
                        <div className="min-w-0 flex-1">
                          <p className="inline-flex items-center gap-1.5 text-xs font-medium text-[#B3B3B3]">
                            <ExternalLink className="h-3.5 w-3.5 text-[#1DB954]" aria-hidden="true" />
                            <span>2. Invite Link</span>
                          </p>
                          <p className="mt-1 font-mono text-xs sm:text-sm text-white break-all">
                            {activeInboxMessage.inviteLink}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            void handleCopyText(activeInboxMessage.inviteLink, () => {
                              setCopiedInboxLinkId(activeInboxMessage.id);
                              window.setTimeout(() => setCopiedInboxLinkId(null), 2000);
                            })
                          }
                          className="inline-flex items-center justify-center gap-1.5 min-h-[42px] rounded-full bg-[#1DB954] px-4 py-2 text-xs font-bold text-black hover:bg-[#15803D] hover:text-white transition-colors shrink-0 cursor-pointer"
                        >
                          {copiedInboxLinkId === activeInboxMessage.id ? (
                            <>
                              <Check className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Copy Link</span>
                            </>
                          )}
                        </button>
                      </div>

                      {/* 3. Home Address */}
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-white/10 bg-[#181818] p-4">
                        <div className="min-w-0 flex-1">
                          <p className="inline-flex items-center gap-1.5 text-xs font-medium text-[#B3B3B3]">
                            <MapPin className="h-3.5 w-3.5 text-[#1DB954]" aria-hidden="true" />
                            <span>3. Home Address</span>
                          </p>
                          <p className="mt-1 text-sm font-medium text-white">
                            {activeInboxMessage.homeAddress}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            void handleCopyText(activeInboxMessage.homeAddress, () => {
                              setCopiedInboxAddressId(activeInboxMessage.id);
                              window.setTimeout(() => setCopiedInboxAddressId(null), 2000);
                            })
                          }
                          className="inline-flex items-center justify-center gap-1.5 min-h-[42px] rounded-full border border-white/15 bg-[#121212] px-4 py-2 text-xs font-bold text-white hover:border-[#1DB954] hover:text-[#1DB954] transition-colors shrink-0 cursor-pointer"
                        >
                          {copiedInboxAddressId === activeInboxMessage.id ? (
                            <>
                              <Check className="h-3.5 w-3.5 text-[#1DB954]" aria-hidden="true" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Copy Address</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    <p className="pt-2 text-xs text-[#B3B3B3]">
                      Use Copy Link to open your slot invitation, and paste the Home Address above if requested during verification.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {subView === 'join' && (
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 space-y-6 pb-16">
          {/* Back navigation */}
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => openSubPage('overview')}
              className="inline-flex items-center gap-2 text-sm font-medium text-[#B3B3B3] hover:text-white transition-colors cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span>Back to Profile Overview</span>
            </button>
          </div>

          {/* Header */}
          <div className="rounded-2xl border border-[#1DB954]/25 bg-[#181818] p-6 sm:p-8">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#1DB954]/40 bg-[#1DB954]/10 text-[#1DB954]">
                <Ticket className="h-6 w-6" aria-hidden="true" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[#1DB954]">
                  Invite Only
                </p>
                <h1 className="mt-1 text-2xl font-extrabold text-white">Join With Your Invite Code</h1>
                <p className="mt-1.5 text-sm text-[#B3B3B3]">
                  Enter the group code your group admin shared with you (e.g. GFT-7471). You will
                  see the group details first — nothing happens until you confirm.
                </p>
              </div>
            </div>

            {/* Code entry */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleLookupGroup();
              }}
              className="mt-6 flex flex-col sm:flex-row gap-3"
            >
              <div className="relative flex-1">
                <Hash className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#6B6B6B]" aria-hidden="true" />
                <input
                  type="text"
                  value={joinCode}
                  onChange={(e) => {
                    setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 8));
                    setJoinError(null);
                    setJoinSuccess(null);
                  }}
                  placeholder="GFT-7471"
                  maxLength={8}
                  aria-label="Group invite code"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full min-h-[50px] rounded-xl border border-white/15 bg-[#121212] pl-12 pr-4 text-lg font-mono font-extrabold uppercase tracking-widest text-[#1DB954] placeholder-[#4A4A4A] outline-none transition-colors focus:border-[#1DB954] focus:ring-1 focus:ring-[#1DB954]/40"
                />
              </div>
              <button
                type="submit"
                disabled={joinBusy || joinCode.trim().length < 8}
                className="inline-flex items-center justify-center gap-2 min-h-[50px] rounded-xl bg-[#1DB954] px-6 text-sm font-extrabold text-black transition-colors hover:bg-[#1ed760] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {joinBusy ? 'Looking up…' : 'Preview Group'}
              </button>
            </form>

            {joinError && (
              <p className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300" role="alert">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{joinError}</span>
              </p>
            )}
            {joinSuccess && (
              <p className="mt-3 flex items-start gap-2 rounded-xl border border-[#1DB954]/30 bg-[#1DB954]/10 px-4 py-3 text-sm text-[#1DB954]" role="status">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{joinSuccess}</span>
              </p>
            )}

            {/* Preview card */}
            {joinPreview && (
              <div className="mt-5 rounded-2xl border border-white/10 bg-[#121212] p-5 sm:p-6 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#B3B3B3]">
                      {joinPreview.productName}
                    </p>
                    <h2 className="mt-1 text-lg font-extrabold text-white">{joinPreview.groupName}</h2>
                    {joinPreview.homeAddress && (
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-[#B3B3B3]">
                        <MapPin className="h-3.5 w-3.5 text-[#1DB954]" aria-hidden="true" />
                        {joinPreview.homeAddress}
                      </p>
                    )}
                  </div>
                  <span
                    className={`font-mono text-sm font-extrabold tabular-nums rounded-lg px-3 py-1.5 ${
                      joinPreview.remaining > 0 ? 'bg-[#1DB954]/10 text-[#1DB954]' : 'bg-red-500/10 text-red-400'
                    }`}
                  >
                    {joinPreview.occupied}/{joinPreview.capacity} seats
                  </span>
                </div>

                <div className="h-2 w-full overflow-hidden rounded-full bg-white/10" aria-hidden="true">
                  <div
                    className={`h-full rounded-full transition-all ${joinPreview.remaining > 0 ? 'bg-[#1DB954]' : 'bg-red-500'}`}
                    style={{ width: `${Math.min(100, Math.round((joinPreview.occupied / Math.max(1, joinPreview.capacity)) * 100))}%` }}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void handleJoinGroup()}
                    disabled={joinBusy || joinPreview.full}
                    className="inline-flex items-center justify-center gap-2 min-h-[46px] rounded-full bg-[#1DB954] px-7 py-2.5 text-sm font-extrabold text-black transition-colors hover:bg-[#15803D] hover:text-white disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {joinBusy ? 'Joining…' : joinPreview.full ? 'Group Is Full' : 'Join This Group'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setJoinPreview(null)}
                    className="inline-flex items-center min-h-[46px] rounded-full border border-white/15 px-5 py-2.5 text-xs font-semibold text-[#B3B3B3] hover:text-white hover:border-white/30 transition-colors cursor-pointer"
                  >
                    Not my group
                  </button>
                </div>
                <p className="text-[11px] text-[#6B6B6B]">
                  Joining reserves a seat with payment marked as pending — your group admin will
                  confirm payment before streaming begins.
                </p>
              </div>
            )}
          </div>

          {/* Your groups */}
          <div className="rounded-2xl border border-white/10 bg-[#181818] p-6 sm:p-8 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-white">Your Groups</h2>
                <p className="text-xs text-[#B3B3B3]">Live membership records linked to your account.</p>
              </div>
              <button
                type="button"
                onClick={refreshMyGroups}
                aria-label="Refresh your groups"
                title="Refresh your groups"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-[#B3B3B3] hover:text-white hover:border-white/30 transition-colors cursor-pointer"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {myGroups.length === 0 ? (
              <p className="rounded-xl border border-dashed border-white/15 bg-[#121212] px-4 py-8 text-center text-sm text-[#B3B3B3]">
                You are not in any groups yet. Enter an invite code above to join one.
              </p>
            ) : (
              <ul className="space-y-3">
                {myGroups.map((g) => (
                  <li key={g.id} className="rounded-xl border border-white/10 bg-[#121212] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-xs font-extrabold text-[#1DB954] tabular-nums">Code {g.groupCode}</p>
                        <p className="mt-1 text-sm font-bold text-white">{g.groupName}</p>
                        <p className="text-xs text-[#B3B3B3]">{g.planName}{g.isLeader ? ' · Group Leader' : ''}</p>
                        <p className={`mt-1 text-xs font-semibold ${g.approvalStatus === 'pending' ? 'text-amber-300' : 'text-[#1DB954]'}`}>
                          {g.approvalStatus === 'pending'
                            ? 'Waiting for admin approval'
                            : g.approvalStatus === 'rejected'
                              ? 'Join request was not approved'
                              : 'Approved'}
                        </p>
                        {g.firstPaymentDueDate && g.approvalStatus === 'approved' && (
                          <p className="mt-1 text-xs text-[#B3B3B3]">
                            First payment due {formatDisplayDate(g.firstPaymentDueDate)}
                          </p>
                        )}
                        {g.homeAddress && (
                          <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-[#B3B3B3] break-words">
                            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#1DB954]" aria-hidden="true" />
                            {g.homeAddress}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span
                          className={`rounded-full px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider ${
                            g.paymentStatus === 'Paid'
                              ? 'bg-[#1DB954]/10 text-[#1DB954]'
                              : 'bg-amber-400/10 text-amber-400'
                          }`}
                        >
                          {g.approvalStatus === 'pending'
                            ? 'PAYMENT NOT DUE'
                            : g.paymentStatus}
                        </span>
                        {g.inviteLink && (
                          <button
                            type="button"
                            onClick={() =>
                              void handleCopyText(g.inviteLink ?? '', () => {
                                setCopiedInviteLink(true);
                                window.setTimeout(() => setCopiedInviteLink(false), 2000);
                              })
                            }
                            className="inline-flex items-center gap-1.5 min-h-[34px] rounded-full border border-white/15 px-3 py-1.5 text-[11px] font-semibold text-white hover:border-[#1DB954] hover:text-[#1DB954] transition-colors cursor-pointer"
                          >
                            {copiedInviteLink ? (
                              <>
                                <Check className="h-3 w-3 text-[#1DB954]" aria-hidden="true" />
                                Copied
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3" aria-hidden="true" />
                                Copy invite link
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {subView === 'settings' && (
        <SettingsView
          phoneNumber={profile.whatsappNumber}
          phoneVerified={phoneVerified}
          onSavePhone={onSavePhone}
          setupPhoneRecaptcha={setupPhoneRecaptcha}
          sendPhoneOtp={sendPhoneOtp}
          verifyAndLinkPhone={verifyAndLinkPhone}
          passwordConfigured={mockPassword !== null}
          onBack={() => openSubPage('overview')}
          onSetPassword={setMockPassword}
          onOpenMarketplace={() => openSubPage('marketplace')}
          onChangePassword={(currentPassword, newPassword) => {
            if (mockPassword !== currentPassword) return false;
            setMockPassword(newPassword);
            return true;
          }}
        />
      )}

      {subView === 'marketplace' && (
        <MarketplaceView onBackToProfile={() => openSubPage('settings')} />
      )}

      {/* SUB-VIEW 2: DEDICATED INVITE SOMEBODY PAGE (MATCHING INBOX DESIGN) */}
      {subView === 'invite' && (
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#121212] px-4 py-3.5 sm:px-6">
            <button
              type="button"
              onClick={() => openSubPage('overview')}
              className="inline-flex items-center gap-2 min-h-[40px] text-sm font-semibold text-white hover:text-[#1DB954] transition-colors cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span>Back to Profile</span>
            </button>

            <span className="text-xs font-medium text-[#B3B3B3] tabular-nums">
              {invitedPeople.length} {invitedPeople.length === 1 ? 'invite sent' : 'invites sent'}
            </span>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#181818] p-5 sm:p-8 space-y-6">
            <div className="flex items-center gap-3.5 pb-5 border-b border-white/10">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#1DB954]/30 bg-[#1DB954]/10 text-[#1DB954] shrink-0">
                <UserPlus className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
                  Invite Somebody
                </h1>
                <p className="text-xs sm:text-sm text-[#B3B3B3]">
                  Share your personal invite link or send an invite directly to a friend.
                </p>
              </div>
            </div>

            {/* 1. Share Invite Code & Link (matching Inbox 1-tap Copy rows) */}
            <div className="rounded-2xl border border-white/10 bg-[#121212] p-5 sm:p-6 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#1DB954]">
                Option 1 · Share Your Link
              </p>

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-white/10 bg-[#181818] p-4">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-[#B3B3B3]">Your Invite Code</p>
                  <p className="mt-1 font-mono text-base font-extrabold text-[#1DB954] tabular-nums">
                    {profile.inviteCode}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCopyInviteCode}
                  className="inline-flex items-center justify-center gap-1.5 min-h-[42px] rounded-full border border-white/15 bg-[#121212] px-4 py-2 text-xs font-bold text-white hover:border-[#1DB954] hover:text-[#1DB954] transition-colors shrink-0 cursor-pointer"
                >
                  {copiedInviteCode ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-[#1DB954]" aria-hidden="true" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Copy Code</span>
                    </>
                  )}
                </button>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-white/10 bg-[#181818] p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-[#B3B3B3]">Personal Invite Link</p>
                  <p className="mt-1 font-mono text-xs sm:text-sm text-white break-all">
                    {inviteUrl}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCopyInviteLink}
                  className="inline-flex items-center justify-center gap-1.5 min-h-[42px] rounded-full bg-[#1DB954] px-4 py-2 text-xs font-bold text-black hover:bg-[#15803D] hover:text-white transition-colors shrink-0 cursor-pointer"
                >
                  {copiedInviteLink ? (
                    <>
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Copy Link</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* 2. Send Direct Invite Form */}
            <form
              onSubmit={handleInviteSubmit}
              noValidate
              className="rounded-2xl border border-white/10 bg-[#121212] p-5 sm:p-6 space-y-4"
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-[#1DB954]">
                Option 2 · Send Direct Invite
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="invite-name" className="block text-sm font-medium text-white mb-1.5">
                    Friend&apos;s name
                  </label>
                  <input
                    id="invite-name"
                    type="text"
                    placeholder="e.g. Amaka Obi"
                    value={inviteName}
                    onChange={(e) => {
                      setInviteName(e.target.value);
                      if (inviteError) setInviteError(null);
                    }}
                    className="w-full min-h-[46px] rounded-xl border border-white/15 bg-[#181818] px-4 py-2.5 text-sm text-white placeholder:text-[#B3B3B3]/50 focus:border-[#1DB954] focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="invite-contact" className="block text-sm font-medium text-white mb-1.5">
                    Email or WhatsApp number
                  </label>
                  <input
                    id="invite-contact"
                    type="text"
                    placeholder="e.g. +234 803 000 1122"
                    value={inviteContact}
                    onChange={(e) => {
                      setInviteContact(e.target.value);
                      if (inviteError) setInviteError(null);
                    }}
                    className="w-full min-h-[46px] rounded-xl border border-white/15 bg-[#181818] px-4 py-2.5 text-sm text-white placeholder:text-[#B3B3B3]/50 focus:border-[#1DB954] focus:outline-none"
                  />
                </div>
              </div>

              {inviteError && (
                <p className="text-xs text-red-400" role="alert">
                  {inviteError}
                </p>
              )}

              {inviteSuccessMsg && (
                <p className="text-xs text-[#1DB954] font-medium" role="status">
                  {inviteSuccessMsg}
                </p>
              )}

              <button
                type="submit"
                className="inline-flex w-full sm:w-auto items-center justify-center gap-2 min-h-[46px] rounded-full bg-[#1DB954] px-7 py-3 text-sm font-bold text-black transition-colors hover:bg-[#15803D] hover:text-white cursor-pointer"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
                <span>Send Invite</span>
              </button>
            </form>

            {/* 3. Sent Invites History */}
            {invitedPeople.length > 0 && (
              <div className="rounded-2xl border border-white/10 bg-[#121212] p-5 sm:p-6 space-y-3">
                <h2 className="text-sm font-bold text-white">
                  Sent Invites ({invitedPeople.length})
                </h2>
                <ul className="space-y-2.5">
                  {invitedPeople.map((person) => (
                    <li
                      key={person.id}
                      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-xl border border-white/10 bg-[#181818] px-4 py-3 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-white truncate">{person.name}</p>
                        <p className="text-xs text-[#B3B3B3] truncate">{person.contact}</p>
                      </div>
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#1DB954] shrink-0">
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{person.status}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-VIEW 3: DEDICATED PAY FOR SOMEBODY PAGE (MATCHING INBOX DESIGN) */}
      {subView === 'gift' && (
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#121212] px-4 py-3.5 sm:px-6">
            <button
              type="button"
              onClick={() => openSubPage('overview')}
              className="inline-flex items-center gap-2 min-h-[40px] text-sm font-semibold text-white hover:text-[#1DB954] transition-colors cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span>Back to Profile</span>
            </button>

            <span className="text-xs font-medium text-[#B3B3B3] tabular-nums">
              {sponsoredSlots.length} {sponsoredSlots.length === 1 ? 'slot sponsored' : 'slots sponsored'}
            </span>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#181818] p-5 sm:p-8 space-y-6">
            <div className="flex items-center gap-3.5 pb-5 border-b border-white/10">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#1DB954]/30 bg-[#1DB954]/10 text-[#1DB954] shrink-0">
                <Gift className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
                  Pay for Somebody
                </h1>
                <p className="text-xs sm:text-sm text-[#B3B3B3]">
                  Sponsor a subscription slot for someone else and manage their renewals from your profile.
                </p>
              </div>
            </div>

            <form
              onSubmit={handleGiftSubmit}
              noValidate
              className="rounded-2xl border border-white/10 bg-[#121212] p-5 sm:p-6 space-y-4"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="gift-plan" className="block text-sm font-medium text-white mb-1.5">
                    Subscription plan
                  </label>
                  <select
                    id="gift-plan"
                    value={giftPlanId}
                    onChange={(e) => setGiftPlanId(e.target.value)}
                    className="w-full min-h-[46px] rounded-xl border border-white/15 bg-[#181818] px-3.5 py-2.5 text-sm font-medium text-white focus:border-[#1DB954] focus:outline-none"
                  >
                    {plans.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name} ({formatPlanPrice(plan)})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="gift-duration" className="block text-sm font-medium text-white mb-1.5">
                    Payment duration
                  </label>
                  <select
                    id="gift-duration"
                    value={giftDuration}
                    onChange={(e) =>
                      setGiftDuration(Number(e.target.value) as BillingDurationMonths)
                    }
                    className="w-full min-h-[46px] rounded-xl border border-white/15 bg-[#181818] px-3.5 py-2.5 text-sm font-medium text-white focus:border-[#1DB954] focus:outline-none"
                  >
                    {BILLING_DURATIONS.map((d) => (
                      <option key={d.months} value={d.months}>
                        {d.label} ({formatAmount(giftPlan.priceMonthly * d.months, giftPlan.currencySymbol)})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="recipient-name" className="block text-sm font-medium text-white mb-1.5">
                  Recipient full name
                </label>
                <input
                  id="recipient-name"
                  type="text"
                  placeholder="e.g. Chinedu Okafor"
                  value={recipientName}
                  onChange={(e) => {
                    setRecipientName(e.target.value);
                    if (giftError) setGiftError(null);
                  }}
                  className="w-full min-h-[46px] rounded-xl border border-white/15 bg-[#181818] px-4 py-2.5 text-sm text-white placeholder:text-[#B3B3B3]/50 focus:border-[#1DB954] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="recipient-email" className="block text-sm font-medium text-white mb-1.5">
                    Recipient email
                  </label>
                  <input
                    id="recipient-email"
                    type="email"
                    placeholder="chinedu@example.com"
                    value={recipientEmail}
                    onChange={(e) => {
                      setRecipientEmail(e.target.value);
                      if (giftError) setGiftError(null);
                    }}
                    className="w-full min-h-[46px] rounded-xl border border-white/15 bg-[#181818] px-4 py-2.5 text-sm text-white placeholder:text-[#B3B3B3]/50 focus:border-[#1DB954] focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="recipient-whatsapp" className="block text-sm font-medium text-white mb-1.5">
                    Recipient WhatsApp
                  </label>
                  <input
                    id="recipient-whatsapp"
                    type="tel"
                    placeholder="+234 802 345 6789"
                    value={recipientWhatsapp}
                    onChange={(e) => {
                      setRecipientWhatsapp(e.target.value);
                      if (giftError) setGiftError(null);
                    }}
                    className="w-full min-h-[46px] rounded-xl border border-white/15 bg-[#181818] px-4 py-2.5 text-sm text-white placeholder:text-[#B3B3B3]/50 focus:border-[#1DB954] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="gift-note" className="block text-sm font-medium text-white mb-1.5">
                  Optional note
                </label>
                <input
                  id="gift-note"
                  type="text"
                  placeholder="e.g. Enjoy ad-free music this quarter!"
                  value={giftNote}
                  onChange={(e) => setGiftNote(e.target.value)}
                  className="w-full min-h-[46px] rounded-xl border border-white/15 bg-[#181818] px-4 py-2.5 text-sm text-white placeholder:text-[#B3B3B3]/50 focus:border-[#1DB954] focus:outline-none"
                />
              </div>

              {giftError && (
                <p className="text-xs text-red-400" role="alert">
                  {giftError}
                </p>
              )}

              <button
                type="submit"
                className="inline-flex w-full sm:w-auto items-center justify-center gap-2 min-h-[48px] rounded-full bg-[#1DB954] px-7 py-3 text-sm font-bold text-black transition-colors hover:bg-[#15803D] hover:text-white cursor-pointer"
              >
                <Gift className="h-4 w-4" aria-hidden="true" />
                <span>
                  Pay for Recipient · {formatAmount(giftTotal, giftPlan.currencySymbol)}
                </span>
              </button>
            </form>

            {sponsoredSlots.length > 0 && (
              <div className="rounded-2xl border border-white/10 bg-[#121212] p-5 sm:p-6 space-y-3">
                <h2 className="text-sm font-bold text-white">
                  Subscriptions You Pay For ({sponsoredSlots.length})
                </h2>
                <ul className="space-y-2.5">
                  {sponsoredSlots.map((slot) => {
                    const linkedSub = subscriptions.find((s) => s.id === slot.subscriptionId);
                    const isCancelled = linkedSub?.status === 'cancelled';

                    return (
                      <li
                        key={slot.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#181818] px-4 py-3 text-xs sm:text-sm"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-white truncate">
                            {slot.recipientName} · {slot.planName}
                          </p>
                          <p className="text-xs text-[#B3B3B3] truncate">
                            Initial {slot.durationLabel} ({slot.amountFormatted}) · Ref {slot.referenceId}
                          </p>
                        </div>
                        {isCancelled ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-400 shrink-0">
                            <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Slot Cancelled</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleManageRenewal(slot.subscriptionId)}
                            className="inline-flex items-center gap-1.5 rounded-full border border-[#1DB954]/50 bg-[#121212] px-3.5 py-2 text-xs font-bold text-[#1DB954] hover:bg-[#1DB954] hover:text-black transition-colors shrink-0 cursor-pointer"
                          >
                            <RefreshCw className="h-3 w-3" aria-hidden="true" />
                            <span>Manage Renewal</span>
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-VIEW 4: DEDICATED MANAGE RENEWAL PAGE */}
      {subView === 'renew' && activeSub && (
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#121212] px-4 py-3.5 sm:px-6">
            <button
              type="button"
              onClick={() => openSubPage('overview')}
              className="inline-flex items-center gap-2 min-h-[40px] text-sm font-semibold text-white hover:text-[#1DB954] transition-colors cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span>Back to Profile</span>
            </button>

            <span className="font-mono text-xs font-semibold text-[#B3B3B3] tabular-nums">
              Ref {activeSub.referenceId}
            </span>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#181818] p-5 sm:p-8 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-white/10">
              <div className="flex items-center gap-3.5">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#1DB954]/30 bg-[#1DB954]/10 text-[#1DB954] shrink-0">
                  <RefreshCw className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#1DB954]">
                    Manage Renewal
                  </p>
                  <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
                    {activeSub.payerType === 'recipient' && activeSub.recipientName
                      ? `Extend ${activeSub.plan.name} for ${activeSub.recipientName}`
                      : `Extend ${activeSub.plan.name}`}
                  </h1>
                  <p className="mt-1 text-xs sm:text-sm text-[#B3B3B3]">
                    {activeSub.payerType === 'recipient' && activeSub.recipientName
                      ? `You manage billing for ${activeSub.recipientName}'s slot. Select your next payment duration below.`
                      : 'Select how long you want to extend your subscription and trigger your next simulated payment.'}
                  </p>
                </div>
              </div>

              <span className="font-mono text-lg font-extrabold text-[#1DB954] tabular-nums self-start sm:self-center">
                {formatPlanPrice(activeSub.plan)}
              </span>
            </div>

            {/* Subscription Switcher (when managing multiple slots) */}
            {subscriptions.length > 1 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-[#B3B3B3]">
                  Switch subscription slot
                </p>
                <div className="flex gap-2.5 overflow-x-auto pb-1">
                  {subscriptions.map((sub) => {
                    const selected = sub.id === activeSub.id;
                    return (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={() => setSelectedSubId(sub.id)}
                        className={`flex flex-col items-start rounded-xl border px-4 py-2.5 text-left transition-colors shrink-0 cursor-pointer ${
                          selected
                            ? 'border-[#1DB954] bg-[#121212]'
                            : 'border-white/10 bg-[#121212]/60 hover:border-white/25'
                        }`}
                      >
                        <span className="text-xs font-bold text-white">
                          {sub.plan.name}
                        </span>
                        <span className="text-[11px] text-[#B3B3B3]">
                          {sub.payerType === 'recipient' && sub.recipientName
                            ? `For ${sub.recipientName}`
                            : 'Your slot'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Duration Options or Cancelled Notice */}
            {activeSub.status === 'cancelled' ? (
              <div className="rounded-xl border border-red-500/35 bg-[#121212] p-5 space-y-3">
                <div className="flex items-center gap-2.5 text-red-400 font-bold text-sm">
                  <XCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <span>This subscription slot has been cancelled</span>
                </div>
                <p className="text-sm text-[#B3B3B3]">
                  Future renewal payments are stopped for Ref{' '}
                  <span className="font-mono text-white">{activeSub.referenceId}</span>. This is slot cancellation only, not a refund — no money has been returned. Join a new slot anytime from Available Plans.
                </p>
                <button
                  type="button"
                  onClick={() => openSubPage('overview')}
                  className="inline-flex items-center justify-center min-h-[42px] rounded-full bg-[#1DB954] px-5 py-2 text-xs font-bold text-black hover:bg-[#15803D] hover:text-white transition-colors cursor-pointer"
                >
                  Return to Profile
                </button>
              </div>
            ) : (
              <>
                <div>
                  <p className="text-sm font-semibold text-white mb-3">
                    Select next payment duration
                  </p>
                  <div
                    role="radiogroup"
                    aria-label="Select next payment duration"
                    className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3"
                  >
                    {BILLING_DURATIONS.map((option) => {
                      const selected = selectedDuration === option.months;
                      const priceForDuration = activeSub.plan.priceMonthly * option.months;
                      return (
                        <button
                          key={option.months}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => setSelectedDuration(option.months)}
                          className={`flex flex-row sm:flex-col items-center sm:items-start justify-between rounded-xl border p-4 text-left transition-all duration-150 min-h-[64px] cursor-pointer ${
                            selected
                              ? 'border-[#1DB954] bg-[#1DB954]/10'
                              : 'border-white/10 bg-[#121212] hover:border-white/30'
                          }`}
                        >
                          <div>
                            <span className="text-sm font-bold text-white block">
                              {option.label}
                            </span>
                            <span className="mt-0.5 text-xs text-[#B3B3B3] block">
                              {option.description}
                            </span>
                          </div>
                          <span
                            className={`sm:mt-4 font-mono text-base font-extrabold tabular-nums ${
                              selected ? 'text-[#1DB954]' : 'text-white'
                            }`}
                          >
                            {formatAmount(priceForDuration, activeSub.plan.currencySymbol)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Renewal Summary Box */}
                <div className="rounded-xl border border-white/10 bg-[#121212] p-4 sm:p-5 space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-[#B3B3B3]">Slot holder</span>
                    <span className="font-semibold text-white text-right">
                      {activeSub.payerType === 'recipient' && activeSub.recipientName
                        ? `${activeSub.recipientName} (Paid by you)`
                        : `${profile.fullName} (Your slot)`}
                    </span>
                  </div>
                  {activeSub.groupCode && (
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-[#B3B3B3]">Assigned group</span>
                      <span className="font-mono text-xs font-bold text-[#1DB954] tabular-nums text-right">
                        {activeSub.groupName ? `${activeSub.groupName} · ` : ''}
                        {activeSub.groupCode}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-[#B3B3B3]">Selected duration</span>
                    <span className="font-semibold text-white text-right">
                      {selectedDurationObj.label}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-[#B3B3B3]">Current renewal date</span>
                    <span className="font-mono text-xs sm:text-sm text-[#B3B3B3] tabular-nums">
                      {formatDisplayDate(activeSub.nextRenewalDate)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-[#B3B3B3]">New renewal date after payment</span>
                    <span className="font-mono text-xs sm:text-sm font-semibold text-[#1DB954] tabular-nums">
                      {formatDisplayDate(previewNewRenewalDate)}
                    </span>
                  </div>
                </div>

                {/* Trigger Action Footer + Cancel Slot */}
                <div className="pt-4 border-t border-white/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <p className="text-xs text-[#B3B3B3]">Next payment total (Simulated)</p>
                    <p className="font-mono text-2xl font-extrabold text-[#1DB954] tabular-nums">
                      {formatAmount(renewalTotal, activeSub.plan.currencySymbol)}
                    </p>
                  </div>

                  <div className="flex flex-col-reverse sm:flex-row items-center gap-3 w-full sm:w-auto">
                    <button
                      type="button"
                      onClick={() => setPendingCancelSub(activeSub)}
                      className="inline-flex w-full sm:w-auto items-center justify-center gap-1.5 min-h-[48px] rounded-full border border-red-500/40 bg-red-500/10 px-5 py-3 text-sm font-semibold text-red-300 hover:bg-red-500/20 hover:text-white transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <XCircle className="h-4 w-4" aria-hidden="true" />
                      <span>Cancel Slot</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenRenewalConfirmation}
                      className="inline-flex w-full sm:w-auto items-center justify-center gap-2 min-h-[48px] rounded-full bg-[#1DB954] px-7 py-3 text-sm sm:text-base font-bold text-black transition-all duration-150 hover:bg-[#15803D] hover:text-white active:scale-[0.99] cursor-pointer whitespace-nowrap"
                    >
                      <CreditCard className="h-4 w-4" aria-hidden="true" />
                      <span>Trigger Next Payment</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* MAIN PROFILE OVERVIEW */}
      {subView === 'overview' && (
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 space-y-8">
          {/* Top Breadcrumb & Member Identity Header */}
          <div className="flex flex-col gap-6 rounded-2xl border border-white/10 bg-[#121212] p-6 sm:p-8">
            <div className="flex flex-wrap items-center justify-end gap-4">
              <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
                {/* Join with Code Icon Button */}
                <button
                  type="button"
                  onClick={() => openSubPage('join')}
                  aria-label="Join a group with an invite code"
                  title="Join with Code"
                  className="relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#1DB954]/40 bg-[#181818] text-[#1DB954] transition-colors hover:border-[#1DB954] hover:bg-[#1DB954]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1DB954] cursor-pointer shrink-0"
                >
                  <Ticket className="h-5 w-5" aria-hidden="true" />
                </button>

                {/* Invite Somebody Icon Button */}
                <button
                  type="button"
                  onClick={() => openSubPage('invite')}
                  aria-label={
                    invitedPeople.length > 0
                      ? `Open Invite Somebody (${invitedPeople.length} sent)`
                      : 'Open Invite Somebody'
                  }
                  title="Invite Somebody"
                  className="relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-[#181818] text-white transition-colors hover:border-[#1DB954] hover:text-[#1DB954] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1DB954] cursor-pointer shrink-0"
                >
                  <UserPlus className="h-5 w-5" aria-hidden="true" />
                  {invitedPeople.length > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-white px-1 font-mono text-[11px] font-extrabold text-black tabular-nums ring-2 ring-[#121212]">
                      {invitedPeople.length}
                    </span>
                  )}
                </button>

                {/* Pay for Somebody Icon Button */}
                <button
                  type="button"
                  onClick={() => openSubPage('gift')}
                  aria-label={
                    sponsoredSlots.length > 0
                      ? `Open Pay for Somebody (${sponsoredSlots.length} sponsored)`
                      : 'Open Pay for Somebody'
                  }
                  title="Pay for Somebody"
                  className="relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-[#181818] text-white transition-colors hover:border-[#1DB954] hover:text-[#1DB954] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1DB954] cursor-pointer shrink-0"
                >
                  <Gift className="h-5 w-5" aria-hidden="true" />
                  {sponsoredSlots.length > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-white px-1 font-mono text-[11px] font-extrabold text-black tabular-nums ring-2 ring-[#121212]">
                      {sponsoredSlots.length}
                    </span>
                  )}
                </button>

                {/* Inbox Icon with Subscription Notification Indicator */}
                <button
                  type="button"
                  onClick={() => openSubPage('inbox')}
                  aria-label={
                    unreadCount > 0
                      ? `Open Profile Inbox (${unreadCount} new notification${unreadCount > 1 ? 's' : ''})`
                      : 'Open Profile Inbox'
                  }
                  title={
                    unreadCount > 0
                      ? `Inbox · ${unreadCount} new subscription notification`
                      : 'Open Profile Inbox'
                  }
                  className="relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-[#181818] text-white transition-colors hover:border-[#1DB954] hover:text-[#1DB954] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1DB954] cursor-pointer shrink-0"
                >
                  <Inbox className="h-5 w-5" aria-hidden="true" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#1DB954] px-1 font-mono text-[11px] font-extrabold text-black tabular-nums ring-2 ring-[#121212]">
                      {unreadCount}
                    </span>
                  )}
                </button>

                {/* Staff console — only for staff or invited users */}
                {onOpenAdminConsole && (
                  <button
                    type="button"
                    onClick={onOpenAdminConsole}
                    aria-label={staffAccess ? 'Open staff console' : designatedSuperAdminAvailable ? 'Claim super admin access' : 'Redeem staff invitation'}
                    title={staffAccess ? 'Staff Console' : designatedSuperAdminAvailable ? 'Claim Super Admin access' : 'Redeem staff invitation'}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/15 bg-[#181818] text-white transition-colors hover:border-[#1DB954] hover:text-[#1DB954] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1DB954] cursor-pointer"
                  >
                    <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => openSubPage('settings')}
                  aria-label="Open account settings"
                  title="Settings"
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/15 bg-[#181818] text-white transition-colors hover:border-[#1DB954] hover:text-[#1DB954] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1DB954] cursor-pointer"
                >
                  <Settings className="h-5 w-5" aria-hidden="true" />
                </button>

                <button
                  type="button"
                  onClick={onJoinNewSlot}
                  className="inline-flex items-center gap-2 rounded-full bg-[#1DB954] px-5 py-2.5 text-sm font-bold text-black transition-colors hover:bg-[#15803D] hover:text-white cursor-pointer whitespace-nowrap"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  <span>Join Another Slot</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-end pt-2 border-t border-white/10">
              <div className="lg:col-span-7">
                <p className="text-xs font-semibold uppercase tracking-wider text-[#1DB954]">
                  Member Profile
                </p>
                <h1 className="mt-1.5 text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
                  {profile.fullName}
                </h1>
                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-[#B3B3B3]">
                  <span className="inline-flex items-center gap-1.5">
                    <Mail className="h-4 w-4 text-[#1DB954]" aria-hidden="true" />
                    <span>{profile.email}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-mono text-xs sm:text-sm tabular-nums">
                    <Phone className="h-4 w-4 text-[#1DB954]" aria-hidden="true" />
                    <span>{profile.whatsappNumber}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="h-4 w-4 text-[#1DB954]" aria-hidden="true" />
                    <span>Joined {formatDisplayDate(profile.joinedAt)}</span>
                  </span>
                </div>
              </div>

              <div className="lg:col-span-5 grid grid-cols-3 gap-3 sm:gap-4">
                <div className="rounded-xl border border-white/10 bg-[#181818] p-3.5">
                  <p className="text-xs text-[#B3B3B3]">Managed Slots</p>
                  <p className="mt-1 font-mono text-xl font-bold text-white tabular-nums">
                    {subscriptions.length}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openSubPage('inbox')}
                  className="rounded-xl border border-white/10 bg-[#181818] p-3.5 text-left transition-colors hover:border-[#1DB954] cursor-pointer"
                >
                  <p className="text-xs text-[#B3B3B3]">
                    {unreadCount > 0 ? `Inbox (${unreadCount} new)` : 'Inbox'}
                  </p>
                  <p className="mt-1 font-mono text-xl font-bold text-[#1DB954] tabular-nums">
                    {inboxMessages.length}
                  </p>
                </button>
                <div className="rounded-xl border border-white/10 bg-[#181818] p-3.5">
                  <p className="text-xs text-[#B3B3B3]">Total (Demo)</p>
                  <p className="mt-1 font-mono text-lg sm:text-xl font-bold text-[#1DB954] tabular-nums truncate">
                    {formatAmount(totalSpent)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Immediate Action Feedback Banner */}
          {profileNotice && (
            <div
              role="status"
              className="flex items-center justify-between gap-4 rounded-2xl border border-[#1DB954]/50 bg-[#181818] px-5 py-4 text-sm"
            >
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-[#1DB954] shrink-0" aria-hidden="true" />
                <span className="text-white font-medium">{profileNotice}</span>
              </div>
              <button
                type="button"
                onClick={() => setProfileNotice(null)}
                aria-label="Dismiss notification"
                className="text-[#B3B3B3] hover:text-white p-1 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Section 1: Managed Subscriptions (Own + Paid for Others) */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-white tracking-tight">
                  Your Subscriptions
                </h2>
                <p className="mt-1 text-xs sm:text-sm text-[#B3B3B3]">
                  Select Manage Renewal on any subscription to choose 1 month, 3 months, 6 months, or 1 year.
                </p>
              </div>
              <span className="text-xs text-[#B3B3B3] tabular-nums shrink-0">
                {subscriptions.length} {subscriptions.length === 1 ? 'subscription' : 'subscriptions'}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {subscriptions.map((sub) => {
                const isActive = sub.status === 'active';
                const isCancelled = sub.status === 'cancelled';
                const isForRecipient = sub.payerType === 'recipient';

                return (
                  <div
                    key={sub.id}
                    className={`flex flex-col justify-between rounded-2xl border p-5 sm:p-6 transition-colors ${
                      isCancelled
                        ? 'border-white/10 bg-[#141414] opacity-85'
                        : 'border-white/10 bg-[#181818] hover:border-[#1DB954]/50'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-[#B3B3B3] truncate">
                            {sub.plan.category} · Ref {sub.referenceId}
                            {sub.groupCode ? ` · Group ${sub.groupCode}` : ''}
                          </p>
                          <h3 className="mt-1 text-lg font-bold text-white">
                            {sub.plan.name}
                          </h3>
                          <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium">
                            {isForRecipient ? (
                              <>
                                <Gift className="h-3.5 w-3.5 text-[#1DB954]" aria-hidden="true" />
                                <span className="text-[#1DB954]">
                                  Paid for: {sub.recipientName}
                                </span>
                              </>
                            ) : (
                              <>
                                <UserCheck className="h-3.5 w-3.5 text-[#B3B3B3]" aria-hidden="true" />
                                <span className="text-[#B3B3B3]">Your own slot</span>
                              </>
                            )}
                          </p>
                        </div>
                        <span
                          className={`font-mono text-base font-bold tabular-nums shrink-0 ${
                            isCancelled ? 'text-[#B3B3B3] line-through' : 'text-[#1DB954]'
                          }`}
                        >
                          {formatPlanPrice(sub.plan)}
                        </span>
                      </div>
                    </div>

                    <div className="mt-5 pt-4 border-t border-white/10 space-y-3 text-xs">
                      <div className="space-y-1">
                        <span className="inline-flex items-center gap-1.5 font-medium text-white">
                          {isCancelled ? (
                            <XCircle className="h-4 w-4 text-red-400" aria-hidden="true" />
                          ) : isActive ? (
                            <CheckCircle2 className="h-4 w-4 text-[#1DB954]" aria-hidden="true" />
                          ) : (
                            <Clock className="h-4 w-4 text-[#B3B3B3]" aria-hidden="true" />
                          )}
                          <span>
                            {isCancelled
                              ? 'Cancelled · No future payments'
                              : isActive
                                ? 'Active Demo Slot'
                                : 'Waitlist Reserved'}
                          </span>
                        </span>
                        <p className="text-[#B3B3B3] tabular-nums">
                          {isCancelled ? (
                            <>
                              Cancelled on:{' '}
                              <strong className="text-white">
                                {formatDisplayDate(sub.cancelledAt ?? sub.joinedAt)}
                              </strong>
                            </>
                          ) : (
                            <>
                              Next renewal:{' '}
                              <strong className="text-white">
                                {formatDisplayDate(sub.nextRenewalDate)}
                              </strong>
                            </>
                          )}
                        </p>
                      </div>

                      {!isCancelled && (
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleManageRenewal(sub.id)}
                            className="inline-flex flex-1 items-center justify-center gap-1.5 min-h-[40px] rounded-full bg-[#1DB954] px-4 py-2 text-xs font-bold text-black transition-colors hover:bg-[#15803D] hover:text-white whitespace-nowrap cursor-pointer"
                          >
                            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Manage Renewal</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setPendingCancelSub(sub)}
                            className="inline-flex items-center justify-center gap-1.5 min-h-[40px] rounded-full border border-red-500/35 bg-red-500/10 px-3.5 py-2 text-xs font-semibold text-red-300 transition-colors hover:bg-red-500/20 hover:text-white whitespace-nowrap cursor-pointer"
                          >
                            <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Cancel Slot</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>


          {/* Section 3: Payment History */}
          <div className="rounded-2xl border border-white/10 bg-[#181818] p-6 sm:p-7">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-[#121212] text-[#1DB954]">
                  <History className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">Payment History</h2>
                  <p className="text-xs sm:text-sm text-[#B3B3B3]">
                    Record of your initial slot, renewals, and payments made for others.
                  </p>
                </div>
              </div>

              <div
                role="tablist"
                aria-label="Filter payment history"
                className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-[#121212] p-1 self-start sm:self-auto"
              >
                {(
                  [
                    { id: 'all', label: 'All' },
                    { id: 'renewal', label: 'My Slots' },
                    { id: 'gift', label: 'Paid for Others' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={historyFilter === tab.id}
                    onClick={() => setHistoryFilter(tab.id)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                      historyFilter === tab.id
                        ? 'bg-[#1DB954] text-black'
                        : 'text-[#B3B3B3] hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {filteredHistory.length === 0 ? (
              <div className="py-10 text-center text-sm text-[#B3B3B3]">
                No payment records match this filter yet.
              </div>
            ) : (
              <>
                {/* Desktop Table */}
                <div className="hidden md:block overflow-x-auto mt-4">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-white/10 text-xs font-semibold uppercase tracking-wider text-[#B3B3B3]">
                        <th className="py-3 pr-4">Reference</th>
                        <th className="py-3 px-4">Date</th>
                        <th className="py-3 px-4">Subscription / Details</th>
                        <th className="py-3 px-4">Duration</th>
                        <th className="py-3 px-4 text-right">Amount</th>
                        <th className="py-3 pl-4 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10 text-sm">
                      {filteredHistory.map((item) => (
                        <tr key={item.id} className="hover:bg-[#121212]/60 transition-colors">
                          <td className="py-4 pr-4 font-mono text-xs text-white tabular-nums whitespace-nowrap">
                            {item.referenceId}
                          </td>
                          <td className="py-4 px-4 text-[#B3B3B3] tabular-nums whitespace-nowrap">
                            {formatDisplayDate(item.date)}
                          </td>
                          <td className="py-4 px-4">
                            <span className="font-semibold text-white">{item.planName}</span>
                            <span className="block text-xs text-[#B3B3B3]">
                              {item.kind === 'initial' && 'Initial slot order'}
                              {item.kind === 'renewal' &&
                                (item.recipientName
                                  ? `Renewal paid for ${item.recipientName}`
                                  : 'Next payment renewal')}
                              {item.kind === 'gift' && `Paid for ${item.recipientName}`}
                            </span>
                          </td>
                          <td className="py-4 px-4 text-[#B3B3B3] whitespace-nowrap">
                            {item.durationLabel}
                          </td>
                          <td className="py-4 px-4 text-right font-mono font-bold text-white tabular-nums whitespace-nowrap">
                            {formatAmount(item.amount, item.currencySymbol)}
                          </td>
                          <td className="py-4 pl-4 text-right whitespace-nowrap">
                            <span className="inline-flex items-center justify-end gap-1.5 text-xs font-medium text-[#1DB954]">
                              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>{item.status}</span>
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Card List */}
                <div className="md:hidden mt-4 space-y-3">
                  {filteredHistory.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-xl border border-white/10 bg-[#121212] p-4 space-y-2 text-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-white">{item.planName}</p>
                          <p className="text-xs text-[#B3B3B3]">
                            {item.kind === 'initial' && 'Initial slot order'}
                            {item.kind === 'renewal' &&
                              (item.recipientName
                                ? `Renewal paid for ${item.recipientName}`
                                : 'Next payment renewal')}
                            {item.kind === 'gift' && `Paid for ${item.recipientName}`}
                          </p>
                        </div>
                        <span className="font-mono font-bold text-[#1DB954] tabular-nums">
                          {formatAmount(item.amount, item.currencySymbol)}
                        </span>
                      </div>
                      <div className="pt-2 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs text-[#B3B3B3] tabular-nums">
                        <span className="font-mono">
                          {item.referenceId} · {item.durationLabel}
                        </span>
                        <span>{formatDisplayDate(item.date)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Simulated Payment Confirmation Modal for Renewals & Pay-for-Somebody */}
      {pendingConfirmation && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="profile-confirm-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isConfirming) {
              setPendingConfirmation(null);
            }
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-white/15 bg-[#181818] p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between gap-4 pb-3 border-b border-white/10">
              <h3 id="profile-confirm-title" className="text-lg font-extrabold text-white">
                {pendingConfirmation.title}
              </h3>
              <button
                type="button"
                onClick={() => !isConfirming && setPendingConfirmation(null)}
                aria-label="Close confirmation"
                className="flex h-9 w-9 items-center justify-center rounded-full text-[#B3B3B3] hover:bg-[#121212] hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="rounded-xl border border-[#1DB954]/30 bg-[#121212] px-4 py-3 text-xs text-[#B3B3B3]">
              Simulated Payment Preview: No real card or bank charge is processed in this frontend prototype.
            </div>

            <div className="rounded-xl border border-white/10 bg-[#121212] p-4 space-y-2.5 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[#B3B3B3]">Subscription</span>
                <span className="font-semibold text-white">{pendingConfirmation.planName}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-[#B3B3B3]">Duration</span>
                <span className="font-semibold text-white">{pendingConfirmation.durationLabel}</span>
              </div>

              {pendingConfirmation.mode === 'renewal' && (
                <>
                  {pendingConfirmation.recipientName && (
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-[#B3B3B3]">Slot holder</span>
                      <span className="font-semibold text-white">
                        {pendingConfirmation.recipientName}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-[#B3B3B3]">Current renewal</span>
                    <span className="font-mono text-xs text-[#B3B3B3] tabular-nums">
                      {pendingConfirmation.currentRenewalDate}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-[#B3B3B3]">New renewal date</span>
                    <span className="font-mono text-xs font-semibold text-[#1DB954] tabular-nums">
                      {pendingConfirmation.newRenewalDate}
                    </span>
                  </div>
                </>
              )}

              {pendingConfirmation.mode === 'gift' && (
                <>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-[#B3B3B3]">Recipient</span>
                    <span className="font-semibold text-white">
                      {pendingConfirmation.recipientName}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-[#B3B3B3]">Recipient WhatsApp</span>
                    <span className="font-mono text-xs text-white tabular-nums">
                      {pendingConfirmation.recipientWhatsapp}
                    </span>
                  </div>
                </>
              )}

              <div className="pt-3 border-t border-white/10 flex items-center justify-between gap-4">
                <span className="font-bold text-white">Total amount</span>
                <span className="font-mono text-xl font-extrabold text-[#1DB954] tabular-nums">
                  {formatAmount(pendingConfirmation.amount, pendingConfirmation.currencySymbol)}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={isConfirming}
                onClick={() => setPendingConfirmation(null)}
                className="min-h-[46px] rounded-full border border-white/20 bg-[#121212] px-5 py-2.5 text-sm font-semibold text-white hover:border-white/40 cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isConfirming}
                onClick={handleConfirmPendingPayment}
                className="flex-1 inline-flex items-center justify-center gap-2 min-h-[46px] rounded-full bg-[#1DB954] px-6 py-2.5 text-sm font-bold text-black hover:bg-[#15803D] hover:text-white transition-colors cursor-pointer disabled:opacity-80"
              >
                {isConfirming ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    <span>Recording...</span>
                  </>
                ) : (
                  <span>Confirm Payment</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Cancel Slot Confirmation Modal */}
      {pendingCancelSub && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-slot-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setPendingCancelSub(null);
            }
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-white/15 bg-[#181818] p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between gap-4 pb-3 border-b border-white/10">
              <h3 id="cancel-slot-title" className="text-lg font-extrabold text-white">
                Cancel Subscription Slot?
              </h3>
              <button
                type="button"
                onClick={() => setPendingCancelSub(null)}
                aria-label="Close cancel confirmation"
                className="flex h-9 w-9 items-center justify-center rounded-full text-[#B3B3B3] hover:bg-[#121212] hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="rounded-xl border border-red-500/35 bg-[#121212] p-4 space-y-2 text-sm">
              <p className="font-semibold text-white">
                {pendingCancelSub.plan.name}
                {pendingCancelSub.payerType === 'recipient' && pendingCancelSub.recipientName
                  ? ` (${pendingCancelSub.recipientName})`
                  : ''}
              </p>
              <p className="font-mono text-xs text-[#B3B3B3] tabular-nums">
                Ref {pendingCancelSub.referenceId}
                {pendingCancelSub.groupCode ? ` · Group ${pendingCancelSub.groupCode}` : ''}
              </p>
              <p className="text-xs text-[#B3B3B3] leading-relaxed pt-1">
                Cancelling this slot releases your seat from the queue and stops all future renewal payments for it.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setPendingCancelSub(null)}
                className="min-h-[46px] rounded-full border border-white/20 bg-[#121212] px-5 py-2.5 text-sm font-semibold text-white hover:border-white/40 cursor-pointer"
              >
                Keep Slot
              </button>
              <button
                type="button"
                onClick={handleConfirmCancelSlot}
                className="flex-1 inline-flex items-center justify-center gap-2 min-h-[46px] rounded-full bg-red-500 px-6 py-2.5 text-sm font-bold text-white hover:bg-red-600 transition-colors cursor-pointer"
              >
                <XCircle className="h-4 w-4" aria-hidden="true" />
                <span>Confirm Cancel Slot</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
