import { useEffect } from 'react';
import { Mail, MessageCircle, X } from 'lucide-react';
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
                Need help with a subscription slot or order confirmation? Support contact details will be published here when available.
              </p>
              <div className="space-y-3 rounded-xl border border-white/10 bg-[#121212] p-4">
                <div className="flex items-center gap-3">
                  <MessageCircle className="h-5 w-5 text-[#1DB954] shrink-0" aria-hidden="true" />
                  <p className="font-semibold text-white">WhatsApp support details are not available yet.</p>
                </div>
                <div className="flex items-center gap-3">
                  <Mail className="h-5 w-5 text-[#1DB954] shrink-0" aria-hidden="true" />
                  <p className="font-semibold text-white">Email support details are not available yet.</p>
                </div>
                <p className="pt-2 border-t border-white/10 text-xs text-[#B3B3B3]">
                  Support hours will be listed here when support contact details are available.
                </p>
              </div>
            </>
          )}

          {modalType === 'privacy' && (
            <>
              <p>
                JOIN THE QUEUE uses the information you provide to manage your account, subscription requests, and support. Account and profile information is stored by the services that operate this platform.
              </p>
              <p>
                Payments are handled by the payment provider. Do not enter payment card details into JOIN THE QUEUE forms. Information may be processed by service providers as needed to operate the platform and complete your request.
              </p>
            </>
          )}

          {modalType === 'terms' && (
            <>
              <p>
                JOIN THE QUEUE is an independent subscription-slot coordination platform and is not officially affiliated with Spotify or any third-party media provider.
              </p>
              <p>
                Plan prices and availability are shown before checkout and may change. Your order is confirmed only after the payment provider verifies payment. Subscription access is also subject to the relevant provider&apos;s terms and eligibility requirements.
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
