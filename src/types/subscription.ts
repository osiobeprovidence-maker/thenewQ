export type PlanStatus = 'available' | 'limited' | 'waitlist';

export type PlanIconKey = 'spotify-wave' | 'music-disc' | 'play-stream';

export type AppView = 'landing' | 'profile' | 'admin';

export type BillingDurationMonths = 1 | 3 | 6 | 12;

export interface BillingDurationOption {
  months: BillingDurationMonths;
  label: string;
  shortLabel: string;
  description: string;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  category: string;
  description: string;
  priceMonthly: number;
  currencySymbol: string;
  billingCycle: string;
  status: PlanStatus;
  availabilityLabel: string;
  slotsOpen: number;
  totalSlots: number;
  eligibilityNote: string;
  highlights: string[];
  icon: PlanIconKey;
  featured?: boolean;
}

export type PortalRole = 'admin' | 'support';

export interface GoogleStaffAccount {
  id: string;
  name: string;
  email: string;
  role: PortalRole;
}

export interface SupportPermissions {
  viewScope: 'unpaid-only' | 'groups-and-members';
  canViewContactDetails: boolean;
  canLogOutreach: boolean;
  canCollectPayments: boolean;
  showGroupCodes: boolean;
  canRemoveUnpaidMembers: boolean;
}

export type GroupMemberPaymentStatus = 'Paid' | 'Unpaid' | 'Cancelled';

export interface GroupMember {
  id: string;
  fullName: string;
  email: string;
  whatsappNumber: string;
  referenceId: string;
  isLeader: boolean;
  paymentStatus: GroupMemberPaymentStatus;
  joinedAt: string;
  payerLabel: string;
  linkedSubscriptionId?: string;
  amountPaid?: number;
  contacted?: boolean;
  contactedAt?: string;
  contactedBy?: string;
  contactNote?: string;
  collectedBySupport?: boolean;
  /** Raw membership row status from the database (active/expired/cancelled). */
  membershipStatus?: 'active' | 'expired' | 'cancelled';
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  approvedAt?: string | null;
  firstPaymentDueDate?: string | null;
}

export interface PlatformTransaction {
  id: string;
  referenceId: string;
  date: string;
  memberName: string;
  planName: string;
  groupCode?: string;
  source:
    | 'Initial Seed'
    | 'User Checkout'
    | 'Renewal'
    | 'Paid for Somebody'
    | 'Support Collected'
    | 'Admin Marked Paid'
    | 'verified_checkout'
    | 'bachs';
  amount: number;
  currencySymbol: string;
  status: 'Confirmed (Demo)' | 'Waitlist Recorded' | 'Confirmed' | 'Pending' | 'Failed' | 'Refunded';
}

export interface SubscriptionGroup {
  id: string;
  groupName: string;
  groupCode: string;
  planId: string;
  planName: string;
  homeAddress: string;
  inviteLink: string;
  maxSlots: number;
  createdAt: string;
  members: GroupMember[];
}

export interface OrderFormData {
  fullName: string;
  email: string;
  whatsappNumber: string;
  planId: string;
  groupCode?: string;
  acceptedTerms: boolean;
}

export interface FormErrors {
  fullName?: string;
  email?: string;
  whatsappNumber?: string;
  planId?: string;
  groupCode?: string;
  acceptedTerms?: string;
}

export type OrderModalStep =
  | 'form'
  | 'checkout'
  | 'awaiting-payment'
  | 'success';

export interface CompletedOrder {
  referenceId: string;
  fullName: string;
  email: string;
  whatsappNumber: string;
  plan: SubscriptionPlan;
  totalFormatted: string;
  createdAt: string;
  groupCode?: string;
  groupName?: string;
}

export interface UserProfile {
  fullName: string;
  email: string;
  whatsappNumber: string;
  joinedAt: string;
  inviteCode: string;
}

export interface ActiveSubscription {
  id: string;
  referenceId: string;
  plan: SubscriptionPlan;
  status: 'active' | 'waitlist' | 'cancelled';
  joinedAt: string;
  nextRenewalDate: string;
  lastDurationMonths: BillingDurationMonths;
  payerType: 'self' | 'recipient';
  recipientName?: string;
  recipientEmail?: string;
  recipientWhatsapp?: string;
  note?: string;
  groupId?: string;
  groupCode?: string;
  groupName?: string;
  cancelledAt?: string;
}

export interface InboxMessage {
  id: string;
  referenceId: string;
  groupCode?: string;
  sender: string;
  subject: string;
  planName: string;
  recipientName?: string;
  body: string;
  inviteLink: string;
  homeAddress: string;
  receivedAt: string;
  isRead: boolean;
}

export interface PaymentRecord {
  id: string;
  referenceId: string;
  date: string;
  planName: string;
  durationLabel: string;
  months: BillingDurationMonths;
  amount: number;
  currencySymbol: string;
  kind: 'initial' | 'renewal' | 'gift';
  recipientName?: string;
  status: 'Confirmed (Demo)' | 'Waitlist Recorded' | 'Confirmed' | 'Pending' | 'Failed' | 'Refunded';
}

export interface InvitedPerson {
  id: string;
  name: string;
  contact: string;
  inviteCode: string;
  sentAt: string;
  status: 'Invite Sent (Demo)';
}

export interface SponsoredSlot {
  id: string;
  subscriptionId: string;
  referenceId: string;
  recipientName: string;
  recipientContact: string;
  planName: string;
  durationLabel: string;
  amountFormatted: string;
  paidAt: string;
  note?: string;
}

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

export type InfoModalType = 'contact' | 'privacy' | 'terms' | null;
