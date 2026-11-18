import type {
  BillingDurationOption,
  FaqItem,
  SubscriptionPlan,
  SupportPermissions,
} from '../types/subscription';

export const BRAND_INFO = {
  name: 'JOIN THE QUEUE',
  slogan: 'Get in. Get Premium. Enjoy.',
  supportWhatsappDisplay: '+234 800 000 0000',
  supportEmailDisplay: 'support@jointhequeue.demo',
  operatingHours: 'Monday â€“ Saturday, 9:00 AM â€“ 7:00 PM WAT',
  demoAdminSender: 'JOIN THE QUEUE Admin',
  demoHomeAddress: '14 Admiralty Way, Lekki Phase 1, Lagos (Demo Address)',
};

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

export function formatAmount(amount: number, currencySymbol = 'â‚¦'): string {
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



export function normalizePhoneNumber(phone: string): string {
  const digits = phone.replace(/[^\d]/g, '');
  if (digits.startsWith('234') && digits.length === 13) {
    return `0${digits.slice(3)}`;
  }
  return digits;
}
