export type MarketplaceCategory =
  | 'Music'
  | 'Entertainment'
  | 'Productivity'
  | 'Education'
  | 'Cloud Storage';

export type MarketplaceAvailability = 'available' | 'waitlist' | 'discovery';

export type MarketplaceIcon =
  | 'music'
  | 'video'
  | 'disc'
  | 'film'
  | 'design'
  | 'office'
  | 'learning'
  | 'cloud';

export interface MarketplaceSubscription {
  id: string;
  name: string;
  category: MarketplaceCategory;
  description: string;
  monthlyPrice: number;
  currencySymbol: string;
  billingPeriod: string;
  availability: MarketplaceAvailability;
  availabilityLabel: string;
  eligibilityInfo: string;
  arrangementInfo: string;
  icon: MarketplaceIcon;
  featured?: boolean;
}

// Marketplace listings are populated by admins through the production catalog.
// The bundled demo list has been removed. Nothing to display until real listings exist.
export const MARKETPLACE_SUBSCRIPTIONS: MarketplaceSubscription[] = [];
