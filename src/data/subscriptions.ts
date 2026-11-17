import type {
  BillingDurationOption,
  FaqItem,
  GoogleStaffAccount,
  PlatformTransaction,
  SubscriptionGroup,
  SubscriptionPlan,
  SupportPermissions,
} from '../types/subscription';

export const BRAND_INFO = {
  name: 'JOIN THE QUEUE',
  slogan: 'Get in. Get Premium. Enjoy.',
  supportWhatsappDisplay: '+234 800 000 0000',
  supportEmailDisplay: 'support@jointhequeue.demo',
  operatingHours: 'Monday – Saturday, 9:00 AM – 7:00 PM WAT',
  demoAdminSender: 'JOIN THE QUEUE Admin',
  demoHomeAddress: '14 Admiralty Way, Lekki Phase 1, Lagos (Demo Address)',
};

export const INITIAL_GOOGLE_STAFF_ACCOUNTS: GoogleStaffAccount[] = [
  {
    id: 'staff-admin-1',
    name: 'Main Admin',
    email: 'admin@jointhequeue.demo',
    role: 'admin',
  },
  {
    id: 'staff-admin-2',
    name: 'Operations Admin',
    email: 'admin@jointhequeue.demo',
    role: 'admin',
  },
  {
    id: 'staff-support-1',
    name: 'Customer Care Desk',
    email: 'support@jointhequeue.demo',
    role: 'support',
  },
];

export const DEFAULT_SUPPORT_PERMISSIONS: SupportPermissions = {
  viewScope: 'unpaid-only',
  canViewContactDetails: true,
  canLogOutreach: true,
  canCollectPayments: true,
  showGroupCodes: true,
  canRemoveUnpaidMembers: false,
};

export const BILLING_DURATIONS: BillingDurationOption[] = [
  {
    months: 1,
    label: '1 Month',
    shortLabel: '1M',
    description: 'Standard monthly renewal',
  },
  {
    months: 3,
    label: '3 Months',
    shortLabel: '3M',
    description: 'Quarterly slot renewal',
  },
  {
    months: 6,
    label: '6 Months',
    shortLabel: '6M',
    description: 'Half-year slot renewal',
  },
  {
    months: 12,
    label: '1 Year',
    shortLabel: '1Y',
    description: 'Full 12-month coverage',
  },
];

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: 'spotify-premium',
    name: 'Spotify Premium',
    category: 'Music Streaming',
    description: 'Enjoy your music experience with Premium.',
    priceMonthly: 800,
    currencySymbol: '₦',
    billingCycle: 'month',
    status: 'available',
    availabilityLabel: 'Available now · 4 slots remaining',
    slotsOpen: 4,
    totalSlots: 6,
    eligibilityNote:
      'Independent slot coordination for eligible accounts. JOIN THE QUEUE is not affiliated with or endorsed by Spotify.',
    highlights: [
      'Ad-free listening experience across mobile and desktop',
      'Offline downloads for playlists and podcasts',
      'Simple monthly slot coordination with clear confirmation steps',
    ],
    icon: 'spotify-wave',
    featured: true,
  },
  {
    id: 'youtube-premium',
    name: 'YouTube Premium',
    category: 'Video & Music',
    description: 'Watch videos uninterrupted and stream background audio across devices.',
    priceMonthly: 1100,
    currencySymbol: '₦',
    billingCycle: 'month',
    status: 'waitlist',
    availabilityLabel: 'Next batch opening soon · Waitlist open',
    slotsOpen: 0,
    totalSlots: 5,
    eligibilityNote:
      'Waitlist registration only. You will be notified when eligible slots open for the next cycle.',
    highlights: [
      'Ad-free video streaming and background playback',
      'Includes access to YouTube Music streaming',
      'Priority queue notification once the next batch opens',
    ],
    icon: 'play-stream',
    featured: false,
  },
  {
    id: 'apple-music',
    name: 'Apple Music',
    category: 'Lossless Audio',
    description: 'Stream curated radio, spatial audio, and millions of tracks seamlessly.',
    priceMonthly: 1000,
    currencySymbol: '₦',
    billingCycle: 'month',
    status: 'waitlist',
    availabilityLabel: 'Next batch opening soon · Waitlist open',
    slotsOpen: 0,
    totalSlots: 6,
    eligibilityNote:
      'Waitlist registration only. Slots open subject to regional account eligibility.',
    highlights: [
      'Lossless and spatial audio catalog support',
      'Curated playlists and live radio stations',
      'Early notification before general queue access opens',
    ],
    icon: 'music-disc',
    featured: false,
  },
];

export const INITIAL_SUBSCRIPTION_GROUPS: SubscriptionGroup[] = [
  {
    id: 'grp-spotify-01',
    groupName: 'Spotify Queue Group 01',
    groupCode: 'GFT-7471',
    planId: 'spotify-premium',
    planName: 'Spotify Premium',
    homeAddress: '14 Admiralty Way, Lekki Phase 1, Lagos (Demo Address)',
    inviteLink: 'https://jointhequeue.demo/slot-invite/gft-7471',
    maxSlots: 6,
    createdAt: '2026-11-01T10:00:00.000Z',
    members: [
      {
        id: 'mem-tunde',
        fullName: 'Tunde Bello',
        email: 'tunde.bello@example.com',
        whatsappNumber: '+234 803 111 2200',
        referenceId: 'GFT-1001',
        isLeader: true,
        paymentStatus: 'Paid',
        joinedAt: '2026-11-01T10:05:00.000Z',
        payerLabel: 'Self',
        amountPaid: 800,
        contacted: false,
      },
      {
        id: 'mem-joy',
        fullName: 'Joy Emeka',
        email: 'joy.emeka@example.com',
        whatsappNumber: '+234 809 444 5511',
        referenceId: 'GFT-3012',
        isLeader: false,
        paymentStatus: 'Unpaid',
        joinedAt: '2026-11-10T14:20:00.000Z',
        payerLabel: 'Self',
        amountPaid: 0,
        contacted: false,
      },
    ],
  },
];

export const INITIAL_PLATFORM_TRANSACTIONS: PlatformTransaction[] = [
  {
    id: 'tx-seed-tunde',
    referenceId: 'GFT-1001',
    date: '2026-11-01T10:05:00.000Z',
    memberName: 'Tunde Bello',
    planName: 'Spotify Premium',
    groupCode: 'GFT-7471',
    source: 'Initial Seed',
    amount: 800,
    currencySymbol: '₦',
    status: 'Confirmed (Demo)',
  },
  {
    id: 'tx-seed-kemi',
    referenceId: 'JTQ-2104',
    date: '2026-11-05T11:30:00.000Z',
    memberName: 'Kemi Adeyemi',
    planName: 'Spotify Premium',
    groupCode: 'GFT-7471',
    source: 'User Checkout',
    amount: 800,
    currencySymbol: '₦',
    status: 'Confirmed (Demo)',
  },
  {
    id: 'tx-seed-chidi',
    referenceId: 'JTQ-2290',
    date: '2026-11-08T16:15:00.000Z',
    memberName: 'Chidi Nwosu',
    planName: 'Spotify Premium',
    groupCode: 'GFT-7471',
    source: 'Paid for Somebody',
    amount: 2400,
    currencySymbol: '₦',
    status: 'Confirmed (Demo)',
  },
];

export const FAQ_ITEMS: FaqItem[] = [
  {
    id: 'how-to-join',
    question: 'How do I join a subscription slot?',
    answer:
      'Browse the Available Plans section to see currently open subscription offers. Select an active plan such as Spotify Premium, click "Join Slot", and complete the short registration form with your details to reserve your place in the queue.',
  },
  {
    id: 'how-to-order',
    question: 'How do I make an order?',
    answer:
      'Click "Join Slot" on your preferred subscription card, enter your full name, email address, and WhatsApp phone number, review the subscription terms checkbox, and select "Continue to Checkout". On the summary screen, click "Confirm Order" to submit your request. Note that this prototype demonstrates the checkout flow in your browser without collecting real payments.',
  },
  {
    id: 'receive-confirmation',
    question: 'How will I receive confirmation?',
    answer:
      'Immediately after confirming your order, an on-screen confirmation summary is displayed with your reference number. Clicking Done takes you to your Profile where you can view your joined subscription, admin inbox messages, payment history, and renewal options.',
  },
  {
    id: 'whatsapp-group',
    question: 'Do I need to join a WhatsApp group?',
    answer:
      'No public or crowded WhatsApp group is required. Order updates, slot availability notices, and support follow-ups are handled directly via one-to-one messages so your contact details remain private.',
  },
  {
    id: 'customer-support',
    question: 'How do I contact customer support?',
    answer:
      'You can reach our support desk through the Contact link in the footer or via our official WhatsApp support channel listed there. Share your order reference ID and full name so our team can assist you promptly.',
  },
];

export function formatPlanPrice(plan: SubscriptionPlan): string {
  return `${plan.currencySymbol}${plan.priceMonthly.toLocaleString('en-NG')}/${plan.billingCycle}`;
}

export function formatAmount(amount: number, currencySymbol = '₦'): string {
  return `${currencySymbol}${amount.toLocaleString('en-NG')}`;
}

export function addMonthsToIso(baseIso: string, months: number): string {
  const date = new Date(baseIso);
  date.setMonth(date.getMonth() + months);
  return date.toISOString();
}

export function formatDisplayDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function generateGroupCode(): string {
  const code = Math.floor(1000 + Math.random() * 9000);
  return `GFT-${code}`;
}

export function normalizePhoneNumber(phone: string): string {
  const digits = phone.replace(/[^\d]/g, '');
  if (digits.startsWith('234') && digits.length === 13) {
    return `0${digits.slice(3)}`;
  }
  return digits;
}
