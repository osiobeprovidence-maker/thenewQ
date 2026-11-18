import { useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Search, UsersRound, X } from 'lucide-react';
import type { SubscriptionPlan } from '../types/subscription';

interface MarketplaceViewProps {
  plans: SubscriptionPlan[];
  onBackToProfile: () => void;
  onSelectPlan: (plan: SubscriptionPlan) => void;
}

function formatPrice(plan: SubscriptionPlan) {
  return `${plan.currencySymbol}${plan.priceMonthly.toLocaleString('en-NG')}/${plan.billingCycle || 'month'}`;
}

function availabilityLabel(plan: SubscriptionPlan) {
  if (plan.status === 'available') return 'Available to join';
  if (plan.status === 'limited') return 'Limited spaces';
  return 'Waitlist';
}

export function MarketplaceView({ plans, onBackToProfile, onSelectPlan }: MarketplaceViewProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan | null>(null);
  const categories = useMemo(
    () => ['All', ...Array.from(new Set(plans.map((plan) => plan.category).filter(Boolean)))],
    [plans]
  );
  const normalizedQuery = query.trim().toLowerCase();
  const filteredPlans = plans.filter((plan) => {
    const matchesCategory = category === 'All' || plan.category === category;
    const matchesQuery = !normalizedQuery ||
      `${plan.name} ${plan.category} ${plan.description}`.toLowerCase().includes(normalizedQuery);
    return matchesCategory && matchesQuery;
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-14 lg:px-8">
      <div className="mb-7 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#121212] px-4 py-3.5 sm:px-6">
        <button type="button" onClick={onBackToProfile} className="inline-flex min-h-[40px] items-center gap-2 text-sm font-semibold text-white hover:text-[#1DB954]">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to Settings
        </button>
        <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#1DB954]"><UsersRound className="h-4 w-4" aria-hidden="true" /> Marketplace</span>
      </div>

      <header className="rounded-2xl border border-white/10 bg-[#181818] p-5 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#1DB954]">Member Marketplace</p>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-white sm:text-4xl">Discover subscriptions</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#B3B3B3] sm:text-base">Browse current plans published by the Join the Queue team. Choose a plan to see its live availability and continue to secure checkout.</p>
        <label className="mt-6 flex min-h-[48px] items-center gap-3 rounded-xl border border-white/15 bg-[#121212] px-4 focus-within:border-[#1DB954]">
          <Search className="h-4 w-4 shrink-0 text-[#B3B3B3]" aria-hidden="true" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search subscriptions" aria-label="Search subscriptions" className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[#B3B3B3]/70" />
        </label>
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Subscription categories">
          {categories.map((item) => <button key={item} type="button" aria-pressed={category === item} onClick={() => setCategory(item)} className={`min-h-[38px] rounded-full border px-4 py-2 text-xs font-semibold transition-colors ${category === item ? 'border-[#1DB954] bg-[#1DB954] text-black' : 'border-white/15 bg-[#121212] text-[#B3B3B3] hover:border-[#1DB954] hover:text-white'}`}>{item}</button>)}
        </div>
      </header>

      {plans.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-white/10 bg-[#181818] p-8 text-center text-sm text-[#B3B3B3]">There are no published subscription plans right now. Please check back later.</p>
      ) : (
        <>
          <PlanSection title="All subscriptions" plans={filteredPlans} onSelect={setSelectedPlan} />
          {filteredPlans.length === 0 && <p className="mt-8 rounded-xl border border-white/10 bg-[#181818] p-8 text-center text-sm text-[#B3B3B3]">No subscriptions match this search. Try another name or category.</p>}
        </>
      )}

      <p className="mt-8 rounded-2xl border border-white/10 bg-[#121212] p-4 text-xs leading-relaxed text-[#B3B3B3]">Prices and availability are taken from the current subscription catalog. Secure checkout confirms the final amount before payment.</p>

      {selectedPlan && <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm" onClick={() => setSelectedPlan(null)}>
        <section role="dialog" aria-modal="true" aria-labelledby="marketplace-plan-title" className="my-auto w-full max-w-xl rounded-2xl border border-white/10 bg-[#181818] p-5 shadow-2xl sm:p-7" onClick={(event) => event.stopPropagation()}>
          <div className="flex items-start justify-between gap-4">
            <div><p className="text-xs font-medium text-[#B3B3B3]">{selectedPlan.category}</p><h2 id="marketplace-plan-title" className="mt-1 text-xl font-extrabold text-white">{selectedPlan.name}</h2></div>
            <button type="button" onClick={() => setSelectedPlan(null)} aria-label="Close subscription details" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/15 bg-[#121212] text-white hover:border-[#1DB954] hover:text-[#1DB954]"><X className="h-4 w-4" aria-hidden="true" /></button>
          </div>
          <p className="mt-5 text-sm leading-relaxed text-[#B3B3B3]">{selectedPlan.description}</p>
          <div className="mt-5 flex flex-wrap items-baseline justify-between gap-2 border-y border-white/10 py-4"><span className="font-mono text-2xl font-extrabold tabular-nums text-[#1DB954]">{formatPrice(selectedPlan)}</span><span className="text-xs font-semibold text-[#B3B3B3]">{availabilityLabel(selectedPlan)}</span></div>
          <p className="mt-4 text-sm text-[#B3B3B3]">{selectedPlan.slotsOpen} of {selectedPlan.totalSlots} spaces currently open.</p>
          {selectedPlan.highlights.length > 0 && <ul className="mt-4 space-y-2">{selectedPlan.highlights.map((highlight) => <li key={highlight} className="flex items-start gap-2 text-sm text-[#B3B3B3]"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#1DB954]" aria-hidden="true" />{highlight}</li>)}</ul>}
          {selectedPlan.eligibilityNote && <p className="mt-4 text-xs leading-relaxed text-[#B3B3B3]">{selectedPlan.eligibilityNote}</p>}
          <button type="button" onClick={() => { const plan = selectedPlan; setSelectedPlan(null); onSelectPlan(plan); }} className="mt-6 min-h-[46px] w-full rounded-full bg-[#1DB954] px-5 py-3 text-sm font-bold text-black transition-colors hover:bg-[#15803D] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1DB954]">Continue to secure checkout</button>
        </section>
      </div>}
    </div>
  );
}

function PlanSection({ title, plans, onSelect }: { title: string; plans: SubscriptionPlan[]; onSelect: (plan: SubscriptionPlan) => void }) {
  return <section className="mt-9" aria-label={title}>
    <div className="mb-4 flex items-end justify-between gap-3"><h2 className="text-xl font-extrabold text-white sm:text-2xl">{title}</h2><span className="text-xs text-[#B3B3B3]">{plans.length} plans</span></div>
    {plans.length > 0 ? <div className="grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{plans.map((plan) => <article key={plan.id} className="box-border flex min-w-0 h-full flex-col rounded-2xl border border-white/10 bg-[#181818] p-5 transition-colors hover:border-white/25 sm:p-6">
      <div className="flex min-w-0 items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-medium text-[#1DB954]">{plan.category}</p><h3 className="mt-1 break-words text-lg font-bold leading-snug tracking-tight text-white">{plan.name}</h3></div><span className="shrink-0 rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-semibold text-[#B3B3B3]">{availabilityLabel(plan)}</span></div>
      <p className="mt-4 min-w-0 flex-1 break-words text-sm leading-relaxed text-[#B3B3B3]">{plan.description}</p>
      <div className="mt-5 border-t border-white/10 pt-4"><span className="font-mono text-xl font-extrabold tabular-nums text-[#1DB954]">{formatPrice(plan)}</span><p className="mt-1 text-xs text-[#B3B3B3]">{plan.slotsOpen} of {plan.totalSlots} spaces open</p><button type="button" onClick={() => onSelect(plan)} className="mt-4 min-h-[42px] w-full rounded-full border border-white/20 bg-[#121212] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:border-[#1DB954] hover:text-[#1DB954] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1DB954]">View plan</button></div>
    </article>)}</div> : <p className="rounded-xl border border-white/10 bg-[#181818] p-5 text-sm text-[#B3B3B3]">No featured subscriptions match your search and category.</p>}
  </section>;
}
