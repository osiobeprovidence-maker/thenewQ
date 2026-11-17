import { useState } from 'react';
import { Check, CheckCircle2, Clock, Disc3, Info, PlayCircle } from 'lucide-react';
import { formatPlanPrice } from '../data/subscriptions';
import type { CompletedOrder, PlanIconKey, SubscriptionPlan } from '../types/subscription';

interface PlansSectionProps {
  plans: SubscriptionPlan[];
  recentOrder: CompletedOrder | null;
  onSelectPlan: (plan: SubscriptionPlan) => void;
  onViewRecentOrder: () => void;
}

type PlanFilter = 'all' | 'available' | 'waitlist';

function PlanEmblem({ icon, isAvailable }: { icon: PlanIconKey; isAvailable: boolean }) {
  const iconColor = isAvailable ? '#1DB954' : '#B3B3B3';

  if (icon === 'spotify-wave') {
    return (
      <div
        className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-[#121212]"
        aria-hidden="true"
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10.5" fill={iconColor} />
          <path
            d="M7.2 9.4C10.5 8.4 14.3 8.7 17.2 10.3"
            stroke="#000000"
            strokeWidth="1.9"
            strokeLinecap="round"
          />
          <path
            d="M8 12.4C10.7 11.6 13.7 11.8 16.1 13.2"
            stroke="#000000"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
          <path
            d="M8.8 15.3C10.9 14.7 13.2 14.9 15 15.9"
            stroke="#000000"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </div>
    );
  }

  if (icon === 'play-stream') {
    return (
      <div
        className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-[#121212]"
        aria-hidden="true"
      >
        <PlayCircle className="h-6 w-6 text-[#B3B3B3]" />
      </div>
    );
  }

  return (
    <div
      className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-[#121212]"
      aria-hidden="true"
    >
      <Disc3 className="h-6 w-6 text-[#B3B3B3]" />
    </div>
  );
}

export function PlansSection({
  plans,
  recentOrder,
  onSelectPlan,
  onViewRecentOrder,
}: PlansSectionProps) {
  const [filter, setFilter] = useState<PlanFilter>('all');

  const filteredPlans = plans.filter((plan) => {
    if (filter === 'available') return plan.status === 'available' || plan.status === 'limited';
    if (filter === 'waitlist') return plan.status === 'waitlist';
    return true;
  });

  return (
    <section id="plans" className="bg-[#121212] py-16 sm:py-24 border-b border-white/10">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2
              className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white"
              style={{ textWrap: 'balance' }}
            >
              Find Your Spot.
            </h2>
            <p className="mt-3 text-base sm:text-lg text-[#B3B3B3] max-w-xl">
              Explore our available subscription options.
            </p>
          </div>

          {/* Interactive Filter Tabs */}
          <div
            role="tablist"
            aria-label="Filter subscription plans"
            className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-[#181818] p-1 self-start sm:self-auto"
          >
            {(
              [
                { id: 'all', label: 'All Offers' },
                { id: 'available', label: 'Open Now' },
                { id: 'waitlist', label: 'Upcoming' },
              ] as const
            ).map((tab) => {
              const active = filter === tab.id;
              return (
                <button
                  key={tab.id}
                  role="tab"
                  type="button"
                  aria-selected={active}
                  onClick={() => setFilter(tab.id)}
                  className={`rounded-lg px-3.5 py-2 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-[#1DB954] text-black'
                      : 'text-[#B3B3B3] hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Optional session confirmation banner if user already completed a demo order */}
        {recentOrder && (
          <div className="mt-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-2xl border border-[#1DB954]/40 bg-[#181818] px-5 py-4">
            <div className="flex items-start sm:items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-[#1DB954] shrink-0 mt-0.5 sm:mt-0" aria-hidden="true" />
              <div className="text-sm">
                <span className="font-semibold text-white">
                  Demo order {recentOrder.referenceId} confirmed
                </span>
                <span className="text-[#B3B3B3]">
                  {' '}
                  for {recentOrder.plan.name} ({recentOrder.totalFormatted}) under {recentOrder.fullName}.
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={onViewRecentOrder}
              className="self-start sm:self-auto text-sm font-semibold text-[#1DB954] hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Open My Profile
            </button>
          </div>
        )}

        {/* Subscription Cards Grid */}
        <div className="mt-10 grid auto-rows-fr grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {filteredPlans.map((plan) => {
            const isAvailable = plan.status === 'available' || plan.status === 'limited';
            const isFeatured = Boolean(plan.featured) && filter === 'all';
            const colSpanClass = isFeatured ? 'xl:col-span-2' : '';
            const filledSlots = Math.max(0, plan.totalSlots - plan.slotsOpen);
            const fillPercent =
              plan.totalSlots > 0 ? Math.round((filledSlots / plan.totalSlots) * 100) : 100;

            return (
              <article
                key={plan.id}
                className={`group box-border flex h-full min-w-0 flex-col rounded-2xl bg-[#181818] p-6 sm:p-7 transition-all duration-200 ${
                  isAvailable
                    ? 'border border-[#1DB954]/50 hover:border-[#1DB954]'
                    : 'border border-white/10 hover:border-white/25'
                } ${colSpanClass}`}
              >
                <div className="min-w-0 flex-1">
                  {/* Card Header */}
                  <div className="flex min-w-0 items-start justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3.5">
                      <PlanEmblem icon={plan.icon} isAvailable={isAvailable} />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-[#B3B3B3]">
                          {plan.category}
                        </p>
                        <h3 className="break-words text-xl font-bold text-white tracking-tight">
                          {plan.name}
                        </h3>
                      </div>
                    </div>
                  </div>

                  {/* Price */}
                  <div className="mt-6 flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                    <span className="min-w-0 break-words font-mono text-3xl font-extrabold tracking-tight text-[#1DB954] tabular-nums sm:text-4xl">
                      {plan.currencySymbol}
                      {plan.priceMonthly.toLocaleString('en-NG')}
                    </span>
                    <span className="break-words text-sm font-medium text-[#B3B3B3]">
                      /{plan.billingCycle}
                    </span>
                  </div>

                  {/* Description */}
                  <p className="mt-3 break-words text-sm leading-relaxed text-[#B3B3B3] sm:text-base">
                    {plan.description}
                  </p>

                  {/* Availability Indicator (clean unboxed metadata + icon, zero pill badges) */}
                  <div className="mt-5 pt-5 border-t border-white/10">
                    <div className="flex min-w-0 items-start gap-2 text-sm font-medium">
                      {isAvailable ? (
                        <CheckCircle2 className="h-4 w-4 text-[#1DB954] shrink-0" aria-hidden="true" />
                      ) : (
                        <Clock className="h-4 w-4 text-[#B3B3B3] shrink-0" aria-hidden="true" />
                      )}
                      <span className={`min-w-0 break-words ${isAvailable ? 'text-white' : 'text-[#B3B3B3]'}`}>
                        {plan.availabilityLabel}
                      </span>
                    </div>

                    {/* Subtle Queue Capacity Bar */}
                    <div className="mt-3">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-black">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            isAvailable ? 'bg-[#1DB954]' : 'bg-white/25'
                          }`}
                          style={{ width: `${fillPercent}%` }}
                        />
                      </div>
                      <p className="mt-1.5 break-words text-xs text-[#B3B3B3] tabular-nums">
                        {isAvailable
                          ? `${plan.slotsOpen} of ${plan.totalSlots} slots open in current queue`
                          : `0 of ${plan.totalSlots} slots open · Accepting waitlist requests`}
                      </p>
                    </div>
                  </div>

                  {/* Plan Highlights */}
                  <ul className="mt-5 space-y-2.5 text-sm text-[#B3B3B3]">
                    {plan.highlights.map((highlight) => (
                      <li key={highlight} className="flex items-start gap-2.5">
                        <Check
                          className={`h-4 w-4 shrink-0 mt-0.5 ${
                            isAvailable ? 'text-[#1DB954]' : 'text-[#B3B3B3]'
                          }`}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 break-words">{highlight}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Card Footer CTA */}
                <div className="mt-7 border-t border-white/10 pt-5">
                  <button
                    type="button"
                    onClick={() => onSelectPlan(plan)}
                    className={`box-border flex min-h-[46px] w-full min-w-0 flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 rounded-full px-4 py-3 text-center text-sm font-bold leading-snug transition-all duration-150 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1DB954] focus-visible:ring-offset-2 focus-visible:ring-offset-[#181818] cursor-pointer ${
                      isAvailable
                        ? 'bg-[#1DB954] text-black hover:bg-[#15803D] hover:text-white'
                        : 'border border-white/20 bg-[#121212] text-white hover:border-[#1DB954] hover:text-[#1DB954]'
                    }`}
                  >
                    <span className="min-w-0 break-words">
                      {isAvailable ? 'Join Slot' : 'Join Waitlist'}
                    </span>
                    {!isAvailable && (
                      <span className="min-w-0 break-words text-xs font-medium">
                        · {formatPlanPrice(plan)}
                      </span>
                    )}
                  </button>
                  <p className="mt-3 break-words text-xs leading-relaxed text-[#B3B3B3]">
                    {plan.eligibilityNote}
                  </p>
                </div>
              </article>
            );
          })}
        </div>

        {/* Accuracy & Non-Affiliation Notice */}
        <div className="mt-10 flex items-start gap-3 rounded-2xl border border-white/10 bg-black/50 px-5 py-4 text-xs sm:text-sm text-[#B3B3B3]">
          <Info className="h-4 w-4 text-[#1DB954] shrink-0 mt-0.5" aria-hidden="true" />
          <p className="leading-relaxed">
            JOIN THE QUEUE is an independent subscription-slot coordination platform and is not officially affiliated with, sponsored by, or endorsed by Spotify or any third-party service provider. Slot availability and account eligibility remain subject to each provider&apos;s applicable terms.
          </p>
        </div>
      </div>
    </section>
  );
}
