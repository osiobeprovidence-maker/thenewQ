import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Cloud,
  Disc3,
  Film,
  GraduationCap,
  LayoutTemplate,
  Music2,
  PanelsTopLeft,
  PlayCircle,
  Search,
  UsersRound,
  X,
} from 'lucide-react';
import {
  MARKETPLACE_SUBSCRIPTIONS,
  type MarketplaceAvailability,
  type MarketplaceCategory,
  type MarketplaceIcon,
  type MarketplaceSubscription,
} from '../data/marketplace';

const CATEGORIES: Array<'All' | MarketplaceCategory> = [
  'All',
  'Music',
  'Entertainment',
  'Productivity',
  'Education',
  'Cloud Storage',
];

type DemoAction = 'joined' | 'waitlisted' | 'interested';

const ICONS: Record<MarketplaceIcon, typeof Music2> = {
  music: Music2,
  video: PlayCircle,
  disc: Disc3,
  film: Film,
  design: LayoutTemplate,
  office: PanelsTopLeft,
  learning: GraduationCap,
  cloud: Cloud,
};

const AVAILABILITY_LABELS: Record<MarketplaceAvailability, string> = {
  available: 'Available to join',
  waitlist: 'Waitlist open',
  discovery: 'Discovery only',
};

function formatPrice(subscription: MarketplaceSubscription) {
  return `${subscription.currencySymbol}${subscription.monthlyPrice.toLocaleString('en-NG')}/${subscription.billingPeriod}`;
}

function ProductIcon({ icon }: { icon: MarketplaceIcon }) {
  const Icon = ICONS[icon];
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-[#121212] text-[#1DB954]">
      <Icon className="h-6 w-6" aria-hidden="true" />
    </div>
  );
}

function SubscriptionCard({
  subscription,
  demoAction,
  onViewDetails,
}: {
  subscription: MarketplaceSubscription;
  demoAction?: DemoAction;
  onViewDetails: (subscription: MarketplaceSubscription) => void;
}) {
  const availabilityText = demoAction
    ? demoAction === 'joined'
      ? 'Added in demo'
      : demoAction === 'waitlisted'
        ? 'Waitlisted in demo'
        : 'Interest recorded'
    : subscription.availabilityLabel;

  return (
    <article className="box-border flex min-w-0 h-full flex-col rounded-2xl border border-white/10 bg-[#181818] p-5 transition-colors hover:border-white/25 sm:p-6">
      <div className="flex min-w-0 items-start gap-3.5">
        <ProductIcon icon={subscription.icon} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-[#B3B3B3]">{subscription.category}</p>
          <h3 className="mt-0.5 break-words text-lg font-bold leading-snug tracking-tight text-white">
            {subscription.name}
          </h3>
        </div>
      </div>
      <p className="mt-4 min-w-0 flex-1 break-words text-sm leading-relaxed text-[#B3B3B3]">
        {subscription.description}
      </p>
      <div className="mt-5 border-t border-white/10 pt-4">
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="font-mono text-xl font-extrabold tabular-nums text-[#1DB954]">
            {formatPrice(subscription)}
          </span>
          <span
            className={`break-words text-xs font-semibold ${
              demoAction || subscription.availability === 'available'
                ? 'text-[#1DB954]'
                : 'text-[#B3B3B3]'
            }`}
          >
            {availabilityText}
          </span>
        </div>
        {subscription.availability !== 'available' && (
          <p className="mt-2 break-words text-xs leading-relaxed text-[#B3B3B3]">
            Discovery listing; no independent shared-membership offer.
          </p>
        )}
        <button
          type="button"
          onClick={() => onViewDetails(subscription)}
          className="mt-4 min-h-[42px] w-full rounded-full border border-white/20 bg-[#121212] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:border-[#1DB954] hover:text-[#1DB954] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1DB954]"
        >
          View Details
        </button>
      </div>
    </article>
  );
}

export function MarketplaceView({ onBackToProfile }: { onBackToProfile: () => void }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('All');
  const [selectedSubscription, setSelectedSubscription] =
    useState<MarketplaceSubscription | null>(null);
  const [demoActions, setDemoActions] = useState<Record<string, DemoAction>>({});
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedSubscription) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedSubscription(null);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [selectedSubscription]);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredSubscriptions = MARKETPLACE_SUBSCRIPTIONS.filter((subscription) => {
    const matchesCategory = category === 'All' || subscription.category === category;
    const matchesQuery =
      !normalizedQuery ||
      `${subscription.name} ${subscription.category} ${subscription.description}`
        .toLowerCase()
        .includes(normalizedQuery);
    return matchesCategory && matchesQuery;
  });
  const featuredSubscriptions = filteredSubscriptions.filter((subscription) => subscription.featured);
  const selectedAction = selectedSubscription
    ? demoActions[selectedSubscription.id]
    : undefined;

  const handleOpenDetails = (subscription: MarketplaceSubscription) => {
    setNotice(null);
    setSelectedSubscription(subscription);
  };

  const handleDemoAction = (subscription: MarketplaceSubscription) => {
    const action: DemoAction =
      subscription.availability === 'available'
        ? 'joined'
        : subscription.availability === 'waitlist'
          ? 'waitlisted'
          : 'interested';
    setDemoActions((previous) => ({ ...previous, [subscription.id]: action }));
    setNotice(
      action === 'joined'
        ? `${subscription.name} added to your demo list. No purchase was made.`
        : action === 'waitlisted'
          ? `Demo waitlist request recorded for ${subscription.name}.`
          : `Demo interest recorded for ${subscription.name}.`
    );
  };

  const actionLabel = selectedSubscription
    ? demoActions[selectedSubscription.id]
      ? demoActions[selectedSubscription.id] === 'joined'
        ? 'Added to Demo List'
        : demoActions[selectedSubscription.id] === 'waitlisted'
          ? 'Waitlisted (Demo)'
          : 'Interest Recorded'
      : selectedSubscription.availability === 'available'
        ? 'Join Subscription'
        : selectedSubscription.availability === 'waitlist'
          ? 'Join Waitlist'
          : 'Express Interest'
    : '';

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-14 lg:px-8">
      <div className="mb-7 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#121212] px-4 py-3.5 sm:px-6">
        <button
          type="button"
          onClick={onBackToProfile}
          className="inline-flex min-h-[40px] items-center gap-2 text-sm font-semibold text-white transition-colors hover:text-[#1DB954]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>Back to Profile</span>
        </button>
        <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#1DB954]">
          <UsersRound className="h-4 w-4" aria-hidden="true" />
          Marketplace
        </span>
      </div>

      <header className="rounded-2xl border border-white/10 bg-[#181818] p-5 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#1DB954]">
          Member Marketplace
        </p>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-white sm:text-4xl">
          Discover More Subscriptions
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#B3B3B3] sm:text-base">
          Find more subscription options and discover what else you can join.
        </p>

        <label className="mt-6 flex min-h-[48px] items-center gap-3 rounded-xl border border-white/15 bg-[#121212] px-4 focus-within:border-[#1DB954]">
          <Search className="h-4 w-4 shrink-0 text-[#B3B3B3]" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search subscriptions"
            aria-label="Search subscriptions"
            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[#B3B3B3]/70"
          />
        </label>

        <div className="mt-4 flex flex-wrap gap-2" aria-label="Subscription categories">
          {CATEGORIES.map((item) => {
            const active = category === item;
            return (
              <button
                key={item}
                type="button"
                aria-pressed={active}
                onClick={() => setCategory(item)}
                className={`min-h-[38px] rounded-full border px-4 py-2 text-xs font-semibold transition-colors ${
                  active
                    ? 'border-[#1DB954] bg-[#1DB954] text-black'
                    : 'border-white/15 bg-[#121212] text-[#B3B3B3] hover:border-[#1DB954] hover:text-white'
                }`}
              >
                {item}
              </button>
            );
          })}
        </div>
      </header>

      <section className="mt-9" aria-labelledby="marketplace-featured-heading">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[#1DB954]">
              Curated picks
            </p>
            <h2
              id="marketplace-featured-heading"
              className="mt-1 text-xl font-extrabold text-white sm:text-2xl"
            >
              Featured subscriptions
            </h2>
          </div>
          <span className="text-xs text-[#B3B3B3]">
            {featuredSubscriptions.length} featured
          </span>
        </div>
        {featuredSubscriptions.length > 0 ? (
          <div className="grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {featuredSubscriptions.map((subscription) => (
              <SubscriptionCard
                key={subscription.id}
                subscription={subscription}
                demoAction={demoActions[subscription.id]}
                onViewDetails={handleOpenDetails}
              />
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-white/10 bg-[#181818] p-5 text-sm text-[#B3B3B3]">
            No featured subscriptions match your search and category.
          </p>
        )}
      </section>

      <section className="mt-10" aria-labelledby="marketplace-all-heading">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[#1DB954]">
              Browse catalog
            </p>
            <h2 id="marketplace-all-heading" className="mt-1 text-xl font-extrabold text-white sm:text-2xl">
              All subscriptions
            </h2>
          </div>
          <span className="text-xs text-[#B3B3B3]">{filteredSubscriptions.length} options</span>
        </div>
        {filteredSubscriptions.length > 0 ? (
          <div className="grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filteredSubscriptions.map((subscription) => (
              <SubscriptionCard
                key={subscription.id}
                subscription={subscription}
                demoAction={demoActions[subscription.id]}
                onViewDetails={handleOpenDetails}
              />
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-white/10 bg-[#181818] p-8 text-center text-sm text-[#B3B3B3]">
            No subscriptions match this search. Try another name or category.
          </p>
        )}
      </section>

      <p className="mt-8 rounded-2xl border border-white/10 bg-[#121212] p-4 text-xs leading-relaxed text-[#B3B3B3]">
        Prices and availability are frontend demo data only. Only listings explicitly marked as
        available have a demo join option; discovery listings do not imply that shared memberships
        are allowed. Always check each provider’s current terms. No payment is processed.
      </p>

      {selectedSubscription && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setSelectedSubscription(null)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="subscription-details-title"
            className="my-auto w-full max-w-xl rounded-2xl border border-white/10 bg-[#181818] p-5 shadow-2xl sm:p-7"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3.5">
                <ProductIcon icon={selectedSubscription.icon} />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-[#B3B3B3]">
                    {selectedSubscription.category}
                  </p>
                  <h2
                    id="subscription-details-title"
                    className="break-words text-xl font-extrabold text-white"
                  >
                    {selectedSubscription.name}
                  </h2>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSubscription(null)}
                aria-label="Close subscription details"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/15 bg-[#121212] text-white transition-colors hover:border-[#1DB954] hover:text-[#1DB954]"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <p className="mt-5 text-sm leading-relaxed text-[#B3B3B3]">
              {selectedSubscription.description}
            </p>
            <div className="mt-5 flex flex-wrap items-baseline justify-between gap-2 border-y border-white/10 py-4">
              <span className="font-mono text-2xl font-extrabold tabular-nums text-[#1DB954]">
                {formatPrice(selectedSubscription)}
              </span>
              <span
                className={`text-xs font-semibold ${
                  selectedSubscription.availability === 'available'
                    ? 'text-[#1DB954]'
                    : 'text-[#B3B3B3]'
                }`}
              >
                {AVAILABILITY_LABELS[selectedSubscription.availability]}
              </span>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-white">Eligibility</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[#B3B3B3]">
                  {selectedSubscription.eligibilityInfo}
                </p>
              </div>
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                  Membership arrangement
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[#B3B3B3]">
                  {selectedSubscription.arrangementInfo}
                </p>
              </div>
            </div>

            {notice && (
              <p
                role="status"
                className="mt-5 flex items-start gap-2 rounded-xl border border-[#1DB954]/30 bg-[#1DB954]/5 p-3.5 text-sm text-white"
              >
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#1DB954]" aria-hidden="true" />
                <span>{notice}</span>
              </p>
            )}
            <button
              type="button"
              onClick={() => handleDemoAction(selectedSubscription)}
              disabled={Boolean(selectedAction)}
              className="mt-6 min-h-[46px] w-full rounded-full bg-[#1DB954] px-5 py-3 text-sm font-bold text-black transition-colors hover:bg-[#15803D] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1DB954] disabled:cursor-default disabled:bg-[#121212] disabled:text-[#1DB954]"
            >
              {actionLabel}
            </button>
            <p className="mt-3 text-center text-xs leading-relaxed text-[#B3B3B3]">
              Demo interaction only. This action does not start a subscription or take payment.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
