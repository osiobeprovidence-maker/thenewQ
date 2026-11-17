import { useEffect } from 'react';
import { Mail, MessageCircle, X } from 'lucide-react';
import { BRAND_INFO } from '../data/subscriptions';
import type { InfoModalType } from '../types/subscription';

interface InfoModalProps {
  modalType: InfoModalType;
  onClose: () => void;
}

export function InfoModal({ modalType, onClose }: InfoModalProps) {
  useEffect(() => {
    if (!modalType) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [modalType, onClose]);

  if (!modalType) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="info-modal-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-[#181818] p-6 sm:p-7 shadow-2xl">
        <div className="flex items-center justify-between gap-4 pb-4 border-b border-white/10">
          <h2 id="info-modal-title" className="text-xl font-extrabold text-white">
            {modalType === 'contact' && 'Customer Support & Contact'}
            {modalType === 'privacy' && 'Privacy Policy'}
            {modalType === 'terms' && 'Terms and Conditions'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="flex h-10 w-10 items-center justify-center rounded-full text-[#B3B3B3] hover:bg-[#121212] hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 space-y-4 text-sm text-[#B3B3B3] leading-relaxed">
          {modalType === 'contact' && (
            <>
              <p>
                Need help with a subscription slot or order confirmation? Reach our support desk using the placeholder contact channels below.
              </p>
              <div className="space-y-3 rounded-xl border border-white/10 bg-[#121212] p-4">
                <div className="flex items-center gap-3">
                  <MessageCircle className="h-5 w-5 text-[#1DB954] shrink-0" aria-hidden="true" />
                  <div>
                    <p className="text-xs text-[#B3B3B3]">WhatsApp Support Placeholder</p>
                    <p className="font-mono font-semibold text-white">
                      {BRAND_INFO.supportWhatsappDisplay}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Mail className="h-5 w-5 text-[#1DB954] shrink-0" aria-hidden="true" />
                  <div>
                    <p className="text-xs text-[#B3B3B3]">Support Email Placeholder</p>
                    <p className="font-mono font-semibold text-white">
                      {BRAND_INFO.supportEmailDisplay}
                    </p>
                  </div>
                </div>
                <p className="pt-2 border-t border-white/10 text-xs text-[#B3B3B3]">
                  Support hours: {BRAND_INFO.operatingHours}
                </p>
              </div>
            </>
          )}

          {modalType === 'privacy' && (
            <>
              <p>
                JOIN THE QUEUE respects your privacy. In this frontend demonstration, any name, email address, or WhatsApp phone number entered in the Join Slot form stays strictly in your current browser session state.
              </p>
              <p>
                No personal details are transmitted to external servers, stored in a database, or shared with third parties in this prototype.
              </p>
            </>
          )}

          {modalType === 'terms' && (
            <>
              <p>
                JOIN THE QUEUE is an independent subscription-slot coordination platform and is not officially affiliated with Spotify or any third-party media provider.
              </p>
              <p>
                Displayed prices, slot counts, and checkout confirmations on this website are simulated frontend demonstrations. Participation in any live subscription plan remains subject to individual eligibility requirements and the respective provider&apos;s terms of service.
              </p>
            </>
          )}
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-full bg-[#1DB954] px-6 py-2.5 text-sm font-bold text-black transition-colors hover:bg-[#15803D] hover:text-white cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
