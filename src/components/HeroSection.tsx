import { useState } from 'react';
import { ArrowRight, Headphones, Users } from 'lucide-react';
import heroImage from '../assets/images/hero_queue_waves_1794907811028.jpg';
import { BRAND_INFO } from '../data/subscriptions';

interface HeroSectionProps {
  onExplorePlans: () => void;
  onHowItWorks: () => void;
}

export function HeroSection({ onExplorePlans, onHowItWorks }: HeroSectionProps) {
  const [imageError, setImageError] = useState(false);

  return (
    <section
      id="home"
      className="relative overflow-hidden bg-black pt-12 pb-16 sm:pt-16 sm:pb-24 lg:pt-20 lg:pb-28 border-b border-white/10"
    >
      {/* Subtle controlled ambient radial glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 right-0 h-[420px] w-[420px] rounded-full bg-[#1DB954]/10 blur-3xl"
      />

      <div className="relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 items-stretch gap-10 lg:grid-cols-12 lg:gap-12">
          {/* Left Column: Headline & Actions */}
          <div className="flex flex-col justify-center lg:col-span-6">
            <p className="mb-4 text-sm font-semibold tracking-wide text-[#1DB954]">
              {BRAND_INFO.slogan}
            </p>

            <h1
              className="text-white font-extrabold tracking-tight leading-[1.08] max-w-xl"
              style={{
                fontSize: 'clamp(2.25rem, 4.2vw, 3.75rem)',
                textWrap: 'balance',
              }}
            >
              Your Premium Experience Starts Here.
            </h1>

            <p className="mt-5 max-w-lg text-base sm:text-lg text-[#B3B3B3] leading-relaxed">
              Find your spot, choose your subscription plan and get started in just a few simple steps.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={onExplorePlans}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[#1DB954] px-7 py-3.5 min-h-[48px] text-sm sm:text-base font-bold text-black transition-all duration-150 hover:bg-[#15803D] hover:text-white active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1DB954] focus-visible:ring-offset-2 focus-visible:ring-offset-black whitespace-nowrap shrink-0 cursor-pointer"
              >
                <span>Explore Plans</span>
                <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={onHowItWorks}
                className="inline-flex items-center justify-center rounded-full border border-white/20 bg-[#121212] px-7 py-3.5 min-h-[48px] text-sm sm:text-base font-semibold text-white transition-all duration-150 hover:border-[#1DB954] hover:bg-[#181818] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1DB954] focus-visible:ring-offset-2 focus-visible:ring-offset-black whitespace-nowrap shrink-0 cursor-pointer"
              >
                How It Works
              </button>
            </div>

            <div className="mt-10 pt-6 border-t border-white/10 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs sm:text-sm text-[#B3B3B3]">
              <span>Clear monthly pricing</span>
              <span aria-hidden="true" className="text-white/25">·</span>
              <span>3-step registration</span>
              <span aria-hidden="true" className="text-white/25">·</span>
              <span>Direct order confirmation</span>
            </div>
          </div>

          {/* Right Column: Sound Waves & Queue Illustration */}
          <div className="lg:col-span-6 flex">
            <div className="relative w-full overflow-hidden rounded-2xl border border-white/10 bg-[#121212] min-h-[300px] sm:min-h-[360px] lg:min-h-[420px]">
              {!imageError ? (
                <img
                  src={heroImage}
                  alt="Illustration of people stepping forward in a queue toward green acoustic sound waves and a music disc"
                  referrerPolicy="no-referrer"
                  onError={() => setImageError(true)}
                  className="h-full w-full object-cover object-center"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-[#121212] via-[#181818] to-black p-8 text-center">
                  <div className="mb-4 flex items-center gap-3 text-[#1DB954]">
                    <Users className="h-10 w-10" aria-hidden="true" />
                    <Headphones className="h-10 w-10" aria-hidden="true" />
                  </div>
                  <p className="text-lg font-bold text-white">JOIN THE QUEUE</p>
                  <p className="mt-1 text-sm text-[#B3B3B3]">
                    Abstract Sound Waves &amp; Subscription Slot Experience
                  </p>
                </div>
              )}

              {/* Subtle bottom scrim for caption legibility */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/90 via-black/45 to-transparent"
              />

              <div className="absolute inset-x-0 bottom-0 p-5 sm:p-6 flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-medium text-[#1DB954]">
                    Queue-Based Access
                  </p>
                  <p className="mt-0.5 text-sm sm:text-base font-semibold text-white">
                    Reserve your slot in three quick steps
                  </p>
                </div>
                <span className="font-mono text-xs sm:text-sm font-semibold text-white/90 tabular-nums shrink-0">
                  From ₦800/mo
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
