import { Instagram, MessageCircle, Share2 } from 'lucide-react';
import { BRAND_INFO } from '../data/subscriptions';
import type { InfoModalType } from '../types/subscription';
import { BrandLogo } from './BrandLogo';

interface FooterProps {
  onNavigateSection: (sectionId: string) => void;
  onOpenInfoModal: (type: Exclude<InfoModalType, null>) => void;
}

export function Footer({ onNavigateSection, onOpenInfoModal }: FooterProps) {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-black py-12 sm:py-16 border-t border-white/10">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-12">
          {/* Brand Column */}
          <div className="md:col-span-5 space-y-4">
            <button
              type="button"
              onClick={() => onNavigateSection('home')}
              className="inline-block text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1DB954] rounded-md cursor-pointer"
            >
              <BrandLogo />
            </button>
            <p className="text-base font-semibold text-white">
              {BRAND_INFO.slogan}
            </p>
            <p className="text-sm text-[#B3B3B3] max-w-sm leading-relaxed">
              A clean, queue-based subscription slot discovery and registration experience. Independent platform—not affiliated with Spotify.
            </p>
          </div>

          {/* Navigation Links */}
          <div className="md:col-span-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#B3B3B3]">
              Quick Links
            </h3>
            <ul className="mt-4 grid grid-cols-2 gap-y-3 gap-x-6 text-sm">
              <li>
                <button
                  type="button"
                  onClick={() => onNavigateSection('home')}
                  className="text-[#B3B3B3] hover:text-white transition-colors cursor-pointer text-left"
                >
                  Home
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigateSection('plans')}
                  className="text-[#B3B3B3] hover:text-white transition-colors cursor-pointer text-left"
                >
                  Available Plans
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigateSection('how-it-works')}
                  className="text-[#B3B3B3] hover:text-white transition-colors cursor-pointer text-left"
                >
                  How It Works
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigateSection('faqs')}
                  className="text-[#B3B3B3] hover:text-white transition-colors cursor-pointer text-left"
                >
                  FAQs
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onOpenInfoModal('contact')}
                  className="text-[#B3B3B3] hover:text-white transition-colors cursor-pointer text-left"
                >
                  Contact
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onOpenInfoModal('privacy')}
                  className="text-[#B3B3B3] hover:text-white transition-colors cursor-pointer text-left"
                >
                  Privacy Policy
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onOpenInfoModal('terms')}
                  className="text-[#B3B3B3] hover:text-white transition-colors cursor-pointer text-left"
                >
                  Terms &amp; Conditions
                </button>
              </li>
            </ul>
          </div>

          {/* Support & Social Placeholders */}
          <div className="md:col-span-3 space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#B3B3B3]">
              Support &amp; Socials
            </h3>

            <button
              type="button"
              onClick={() => onOpenInfoModal('contact')}
              className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-[#181818] px-4 py-3 text-left transition-colors hover:border-[#1DB954] cursor-pointer"
            >
              <MessageCircle className="h-5 w-5 text-[#1DB954] shrink-0" aria-hidden="true" />
              <div>
                <p className="text-xs font-medium text-[#B3B3B3]">WhatsApp Support</p>
                <p className="font-mono text-xs font-semibold text-white">
                  {BRAND_INFO.supportWhatsappDisplay}
                </p>
              </div>
            </button>

            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => onOpenInfoModal('contact')}
                aria-label="WhatsApp Support Placeholder"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-[#181818] text-[#B3B3B3] transition-colors hover:border-[#1DB954] hover:text-[#1DB954] cursor-pointer"
              >
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => onOpenInfoModal('contact')}
                aria-label="Instagram Placeholder"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-[#181818] text-[#B3B3B3] transition-colors hover:border-[#1DB954] hover:text-[#1DB954] cursor-pointer"
              >
                <Instagram className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => onOpenInfoModal('contact')}
                aria-label="Social Share Placeholder"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-[#181818] text-[#B3B3B3] transition-colors hover:border-[#1DB954] hover:text-[#1DB954] cursor-pointer"
              >
                <Share2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-white/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-[#B3B3B3]">
          <p>&copy; {currentYear} {BRAND_INFO.name}. Frontend demonstration prototype.</p>
          <p>Built for smooth subscription-slot discovery.</p>
        </div>
      </div>
    </footer>
  );
}
