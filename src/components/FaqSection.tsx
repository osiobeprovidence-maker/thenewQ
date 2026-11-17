import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { FaqItem } from '../types/subscription';

interface FaqSectionProps {
  items: FaqItem[];
}

export function FaqSection({ items }: FaqSectionProps) {
  const [openId, setOpenId] = useState<string | null>(items[0]?.id ?? null);

  const toggleItem = (id: string) => {
    setOpenId((prev) => (prev === id ? null : id));
  };

  return (
    <section id="faqs" className="bg-[#121212] py-16 sm:py-24 border-b border-white/10">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <div className="text-left sm:text-center">
          <p className="text-sm font-semibold text-[#1DB954]">Support &amp; Clarity</p>
          <h2
            className="mt-2 text-3xl sm:text-4xl font-extrabold tracking-tight text-white"
            style={{ textWrap: 'balance' }}
          >
            Frequently Asked Questions
          </h2>
          <p className="mt-3 text-base sm:text-lg text-[#B3B3B3]">
            Everything you need to know about joining a slot and tracking your order confirmation.
          </p>
        </div>

        <div className="mt-10 space-y-3">
          {items.map((item) => {
            const isOpen = openId === item.id;
            return (
              <div
                key={item.id}
                className={`rounded-2xl border bg-[#181818] transition-colors duration-150 ${
                  isOpen ? 'border-[#1DB954]/50' : 'border-white/10 hover:border-white/25'
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleItem(item.id)}
                  aria-expanded={isOpen}
                  aria-controls={`faq-panel-${item.id}`}
                  id={`faq-trigger-${item.id}`}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 sm:px-6 sm:py-5 text-left min-h-[56px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1DB954] rounded-2xl cursor-pointer"
                >
                  <span className="text-base sm:text-lg font-semibold text-white">
                    {item.question}
                  </span>
                  <ChevronDown
                    className={`h-5 w-5 shrink-0 transition-transform duration-200 ${
                      isOpen ? 'rotate-180 text-[#1DB954]' : 'text-[#B3B3B3]'
                    }`}
                    aria-hidden="true"
                  />
                </button>

                {isOpen && (
                  <div
                    id={`faq-panel-${item.id}`}
                    role="region"
                    aria-labelledby={`faq-trigger-${item.id}`}
                    className="px-5 pb-5 sm:px-6 sm:pb-6 pt-0"
                  >
                    <p className="border-t border-white/10 pt-4 text-sm sm:text-base text-[#B3B3B3] leading-relaxed">
                      {item.answer}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
