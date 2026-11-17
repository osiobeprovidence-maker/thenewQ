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

export const MARKETPLACE_SUBSCRIPTIONS: MarketplaceSubscription[] = [
  {
    id: 'spotify-marketplace',
    name: 'Spotify Premium',
    category: 'Music',
    description: 'Ad-free listening, offline downloads, and on-demand playback.',
    monthlyPrice: 800,
    currencySymbol: '₦',
    billingPeriod: 'month',
    availability: 'available',
    availabilityLabel: 'Available to join',
    eligibilityInfo:
      'Provider account and household requirements may apply. Check current Spotify terms before joining.',
    arrangementInfo:
      'A demo group-membership option is listed where current provider rules allow it.',
    icon: 'music',
    featured: true,
  },
  {
    id: 'youtube-marketplace',
    name: 'YouTube Premium',
    category: 'Entertainment',
    description: 'Watch without ads and enjoy background playback across devices.',
    monthlyPrice: 1100,
    currencySymbol: '₦',
    billingPeriod: 'month',
    availability: 'waitlist',
    availabilityLabel: 'Waitlist open',
    eligibilityInfo:
      'Provider family and household requirements may apply. Verify current eligibility with YouTube.',
    arrangementInfo:
      'Discovery listing only. No independent shared-membership offer is made for this product.',
    icon: 'video',
    featured: true,
  },
  {
    id: 'apple-music-marketplace',
    name: 'Apple Music',
    category: 'Music',
    description: 'Explore a large music catalog, curated playlists, and spatial audio.',
    monthlyPrice: 1000,
    currencySymbol: '₦',
    billingPeriod: 'month',
    availability: 'waitlist',
    availabilityLabel: 'Waitlist open',
    eligibilityInfo:
      'Family group and regional requirements may apply. Check Apple’s current terms.',
    arrangementInfo:
      'Discovery listing only. No independent shared-membership offer is made for this product.',
    icon: 'disc',
  },
  {
    id: 'netflix-marketplace',
    name: 'Netflix',
    category: 'Entertainment',
    description: 'Discover series, films, documentaries, and more.',
    monthlyPrice: 3500,
    currencySymbol: '₦',
    billingPeriod: 'month',
    availability: 'discovery',
    availabilityLabel: 'Discovery only',
    eligibilityInfo:
      'Plans and any additional-member options vary by region. Check Netflix’s current terms.',
    arrangementInfo:
      'Discovery listing only. No independent shared-membership offer is made for this product.',
    icon: 'film',
    featured: true,
  },
  {
    id: 'canva-pro-marketplace',
    name: 'Canva Pro',
    category: 'Productivity',
    description: 'Create designs with premium templates, assets, and tools.',
    monthlyPrice: 4500,
    currencySymbol: '₦',
    billingPeriod: 'month',
    availability: 'discovery',
    availabilityLabel: 'Discovery only',
    eligibilityInfo:
      'Features and plan eligibility depend on the plan selected directly with Canva.',
    arrangementInfo:
      'Discovery listing only. No independent shared-membership offer is made for this product.',
    icon: 'design',
  },
  {
    id: 'microsoft-365-marketplace',
    name: 'Microsoft 365',
    category: 'Productivity',
    description: 'Explore productivity apps and cloud-connected tools.',
    monthlyPrice: 8000,
    currencySymbol: '₦',
    billingPeriod: 'month',
    availability: 'discovery',
    availabilityLabel: 'Discovery only',
    eligibilityInfo:
      'Apps, storage, and member benefits depend on the selected Microsoft plan.',
    arrangementInfo:
      'Discovery listing only. No independent shared-membership offer is made for this product.',
    icon: 'office',
  },
  {
    id: 'duolingo-marketplace',
    name: 'Duolingo Super',
    category: 'Education',
    description: 'Practice languages with extra learning and review features.',
    monthlyPrice: 6000,
    currencySymbol: '₦',
    billingPeriod: 'month',
    availability: 'discovery',
    availabilityLabel: 'Discovery only',
    eligibilityInfo:
      'Plan availability and learning features are subject to Duolingo’s current terms.',
    arrangementInfo:
      'Discovery listing only. No independent shared-membership offer is made for this product.',
    icon: 'learning',
  },
  {
    id: 'google-one-marketplace',
    name: 'Google One',
    category: 'Cloud Storage',
    description: 'Explore expanded cloud storage and account benefits.',
    monthlyPrice: 1500,
    currencySymbol: '₦',
    billingPeriod: 'month',
    availability: 'discovery',
    availabilityLabel: 'Discovery only',
    eligibilityInfo:
      'Storage tiers and family-sharing options vary. Check Google One’s current terms.',
    arrangementInfo:
      'Discovery listing only. No independent shared-membership offer is made for this product.',
    icon: 'cloud',
  },
];
