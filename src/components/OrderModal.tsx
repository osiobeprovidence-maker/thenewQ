import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  CreditCard,
  Loader2,
  ShieldCheck,
  X,
} from 'lucide-react';
import { formatAmount, formatPlanPrice } from '../data/subscriptions';
import type {
  CompletedOrder,
  FormErrors,
  OrderFormData,
  OrderModalStep,
  SubscriptionGroup,
  SubscriptionPlan,
} from '../types/subscription';

interface OrderModalProps {
  isOpen: boolean;
  step: OrderModalStep;
  plans: SubscriptionPlan[];
  groups: SubscriptionGroup[];
  formData: OrderFormData;
  completedOrder: CompletedOrder | null;
  onClose: () => void;
  onChangeForm: (updater: (prev: OrderFormData) => OrderFormData) => void;
  onProceedToCheckout: () => void;
  onBackToForm: () => void;
  onConfirmOrder: () => void;
  onStartNewOrder: () => void;
  onDoneToProfile: () => void;
}

function validateForm(data: OrderFormData, groups: SubscriptionGroup[]): FormErrors {
  const errors: FormErrors = {};

  const trimmedName = data.fullName.trim();
  if (!trimmedName) {
    errors.fullName = 'Please enter your full name.';
  } else if (trimmedName.length < 2) {
    errors.fullName = 'Full name must be at least 2 characters.';
  }

  const trimmedEmail = data.email.trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!trimmedEmail) {
    errors.email = 'Please enter your email address.';
  } else if (!emailRegex.test(trimmedEmail)) {
    errors.email = 'Please enter a valid email address.';
  }

  const digitsOnly = data.whatsappNumber.replace(/[^\d]/g, '');
  if (!data.whatsappNumber.trim()) {
    errors.whatsappNumber = 'Please enter your WhatsApp phone number.';
  } else if (digitsOnly.length < 10 || digitsOnly.length > 15) {
    errors.whatsappNumber = 'Enter a valid phone number (10 to 15 digits, e.g. +234 801 234 5678).';
  }

  if (!data.planId) {
    errors.planId = 'Please select a subscription plan.';
  }

  const trimmedCode = (data.groupCode ?? '').trim().toUpperCase();
  if (trimmedCode) {
    const matched = groups.find(
      (g) => g.groupCode.toUpperCase() === trimmedCode && g.planId === data.planId
    );
    if (!matched) {
      errors.groupCode = 'No group found with that code for the selected subscription.';
    } else {
      const occupied = matched.members.filter((m) => m.paymentStatus !== 'Cancelled').length;
      if (occupied >= matched.maxSlots) {
        errors.groupCode = `Group ${matched.groupCode} is currently full. Leave blank to auto-assign.`;
      }
    }
  }

  if (!data.acceptedTerms) {
    errors.acceptedTerms = 'You must agree to the subscription terms and conditions to continue.';
  }

  return errors;
}

export function OrderModal({
  isOpen,
  step,
  plans,
  groups,
  formData,
  completedOrder,
  onClose,
  onChangeForm,
  onProceedToCheckout,
  onBackToForm,
  onConfirmOrder,
  onStartNewOrder,
  onDoneToProfile,
}: OrderModalProps) {
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSimulatingConfirm, setIsSimulatingConfirm] = useState(false);

  const selectedPlan = plans.find((p) => p.id === formData.planId) ?? plans[0];
  const isWaitlistPlan = selectedPlan.status === 'waitlist';

  useEffect(() => {
    setErrors({});
    setIsSimulatingConfirm(false);
  }, [isOpen, step]);

  useEffect(() => {
    if (!isOpen) return;
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
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validationErrors = validateForm(formData, groups);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    setErrors({});
    onProceedToCheckout();
  };

  const handleSimulatedConfirm = () => {
    if (isSimulatingConfirm) return;
    setIsSimulatingConfirm(true);
    window.setTimeout(() => {
      setIsSimulatingConfirm(false);
      onConfirmOrder();
    }, 450);
  };

  const stepIndex = step === 'form' ? 1 : step === 'checkout' ? 2 : 3;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="order-modal-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="relative my-auto w-full max-w-lg rounded-2xl border border-white/15 bg-[#181818] p-5 sm:p-7 shadow-2xl">
        {/* Top Bar with Step Indicator & Close Button */}
        <div className="flex items-center justify-between gap-4 pb-4 border-b border-white/10">
          <div className="flex items-center gap-3 text-xs font-semibold">
            <span className="text-[#1DB954] font-mono tabular-nums">
              Step {stepIndex} of 3
            </span>
            <span aria-hidden="true" className="text-white/25">·</span>
            <span className="text-[#B3B3B3]">
              {step === 'form' && 'Register Details'}
              {step === 'checkout' && 'Simulated Checkout'}
              {step === 'success' && 'Order Confirmed'}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="flex h-10 w-10 items-center justify-center rounded-full text-[#B3B3B3] hover:bg-[#121212] hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* STEP 1: JOIN SLOT FORM */}
        {step === 'form' && (
          <form onSubmit={handleFormSubmit} noValidate className="mt-5 space-y-4">
            <div>
              <h2 id="order-modal-title" className="text-2xl font-extrabold text-white tracking-tight">
                {isWaitlistPlan ? 'Reserve Waitlist Spot' : 'Join Subscription Slot'}
              </h2>
              <p className="mt-1 text-sm text-[#B3B3B3]">
                Fill in your details below to proceed to the order summary.
              </p>
            </div>

            {/* Selected Subscription & Price */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl border border-white/10 bg-[#121212] p-4">
              <div>
                <label
                  htmlFor="plan-select"
                  className="block text-xs font-medium text-[#B3B3B3] mb-1.5"
                >
                  Selected subscription
                </label>
                <select
                  id="plan-select"
                  value={selectedPlan.id}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    onChangeForm((prev) => ({ ...prev, planId: nextId }));
                  }}
                  className="w-full min-h-[42px] rounded-lg border border-white/15 bg-[#181818] px-3 py-2 text-sm font-semibold text-white focus:border-[#1DB954] focus:outline-none"
                >
                  {plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name} {plan.status === 'waitlist' ? '(Waitlist)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:text-right flex flex-col justify-center">
                <span className="text-xs font-medium text-[#B3B3B3]">
                  Selected subscription price
                </span>
                <span className="mt-1 font-mono text-xl font-bold text-[#1DB954] tabular-nums">
                  {formatPlanPrice(selectedPlan)}
                </span>
              </div>
            </div>

            {/* Full Name */}
            <div>
              <label htmlFor="full-name" className="block text-sm font-medium text-white mb-1.5">
                Full name
              </label>
              <input
                id="full-name"
                type="text"
                autoComplete="name"
                placeholder="e.g. Tunde Adebayo"
                value={formData.fullName}
                onChange={(e) => {
                  const value = e.target.value;
                  onChangeForm((prev) => ({ ...prev, fullName: value }));
                  if (errors.fullName) setErrors((prev) => ({ ...prev, fullName: undefined }));
                }}
                aria-invalid={Boolean(errors.fullName)}
                className={`w-full min-h-[46px] rounded-xl border bg-[#121212] px-4 py-2.5 text-sm text-white placeholder:text-[#B3B3B3]/50 focus:outline-none transition-colors ${
                  errors.fullName
                    ? 'border-red-500 focus:border-red-400'
                    : 'border-white/15 focus:border-[#1DB954]'
                }`}
              />
              {errors.fullName && (
                <p className="mt-1.5 text-xs text-red-400" role="alert">
                  {errors.fullName}
                </p>
              )}
            </div>

            {/* Email Address */}
            <div>
              <label htmlFor="email-address" className="block text-sm font-medium text-white mb-1.5">
                Email address
              </label>
              <input
                id="email-address"
                type="email"
                autoComplete="email"
                placeholder="e.g. tunde@example.com"
                value={formData.email}
                onChange={(e) => {
                  const value = e.target.value;
                  onChangeForm((prev) => ({ ...prev, email: value }));
                  if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }));
                }}
                aria-invalid={Boolean(errors.email)}
                className={`w-full min-h-[46px] rounded-xl border bg-[#121212] px-4 py-2.5 text-sm text-white placeholder:text-[#B3B3B3]/50 focus:outline-none transition-colors ${
                  errors.email
                    ? 'border-red-500 focus:border-red-400'
                    : 'border-white/15 focus:border-[#1DB954]'
                }`}
              />
              {errors.email && (
                <p className="mt-1.5 text-xs text-red-400" role="alert">
                  {errors.email}
                </p>
              )}
            </div>

            {/* WhatsApp Phone Number */}
            <div>
              <label htmlFor="whatsapp-number" className="block text-sm font-medium text-white mb-1.5">
                WhatsApp phone number
              </label>
              <input
                id="whatsapp-number"
                type="tel"
                autoComplete="tel"
                placeholder="e.g. +234 801 234 5678"
                value={formData.whatsappNumber}
                onChange={(e) => {
                  const value = e.target.value;
                  onChangeForm((prev) => ({ ...prev, whatsappNumber: value }));
                  if (errors.whatsappNumber) {
                    setErrors((prev) => ({ ...prev, whatsappNumber: undefined }));
                  }
                }}
                aria-invalid={Boolean(errors.whatsappNumber)}
                className={`w-full min-h-[46px] rounded-xl border bg-[#121212] px-4 py-2.5 text-sm text-white placeholder:text-[#B3B3B3]/50 focus:outline-none transition-colors ${
                  errors.whatsappNumber
                    ? 'border-red-500 focus:border-red-400'
                    : 'border-white/15 focus:border-[#1DB954]'
                }`}
              />
              {errors.whatsappNumber && (
                <p className="mt-1.5 text-xs text-red-400" role="alert">
                  {errors.whatsappNumber}
                </p>
              )}
            </div>

            {/* Optional Group Code */}
            <div>
              <label htmlFor="group-code-input" className="block text-sm font-medium text-white mb-1.5">
                Group code <span className="text-xs font-normal text-[#B3B3B3]">(optional)</span>
              </label>
              <input
                id="group-code-input"
                type="text"
                placeholder="e.g. GFT-7471 (leave blank to auto-assign)"
                value={formData.groupCode ?? ''}
                onChange={(e) => {
                  const value = e.target.value;
                  onChangeForm((prev) => ({ ...prev, groupCode: value }));
                  if (errors.groupCode) {
                    setErrors((prev) => ({ ...prev, groupCode: undefined }));
                  }
                }}
                aria-invalid={Boolean(errors.groupCode)}
                className={`w-full min-h-[46px] rounded-xl border bg-[#121212] px-4 py-2.5 font-mono text-sm text-white placeholder:font-sans placeholder:text-[#B3B3B3]/50 focus:outline-none transition-colors ${
                  errors.groupCode
                    ? 'border-red-500 focus:border-red-400'
                    : 'border-white/15 focus:border-[#1DB954]'
                }`}
              />
              {errors.groupCode && (
                <p className="mt-1.5 text-xs text-red-400" role="alert">
                  {errors.groupCode}
                </p>
              )}
            </div>

            {/* Terms Checkbox */}
            <div className="pt-1">
              <label className="flex items-start gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={formData.acceptedTerms}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    onChangeForm((prev) => ({ ...prev, acceptedTerms: checked }));
                    if (errors.acceptedTerms) {
                      setErrors((prev) => ({ ...prev, acceptedTerms: undefined }));
                    }
                  }}
                  className="mt-0.5 h-5 w-5 rounded border-white/25 bg-[#121212] accent-[#1DB954] cursor-pointer shrink-0"
                />
                <span className="text-xs sm:text-sm text-[#B3B3B3] leading-snug">
                  I agree to the subscription terms and conditions.
                </span>
              </label>
              {errors.acceptedTerms && (
                <p className="mt-1.5 text-xs text-red-400" role="alert">
                  {errors.acceptedTerms}
                </p>
              )}
            </div>

            {/* Submit Button */}
            <div className="pt-2">
              <button
                type="submit"
                className="w-full min-h-[48px] rounded-full bg-[#1DB954] px-6 py-3.5 text-sm sm:text-base font-bold text-black transition-all duration-150 hover:bg-[#15803D] hover:text-white active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1DB954] focus-visible:ring-offset-2 focus-visible:ring-offset-[#181818] cursor-pointer"
              >
                Continue to Checkout
              </button>
            </div>
          </form>
        )}

        {/* STEP 2: SIMULATED CHECKOUT SCREEN */}
        {step === 'checkout' && (
          <div className="mt-5 space-y-5">
            <div>
              <h2 id="order-modal-title" className="text-2xl font-extrabold text-white tracking-tight">
                Checkout Summary
              </h2>
              <p className="mt-1 text-sm text-[#B3B3B3]">
                Review your details before confirming your simulated slot order.
              </p>
            </div>

            {/* Honest Frontend Simulation Notice */}
            <div className="flex items-start gap-3 rounded-xl border border-[#1DB954]/30 bg-[#121212] px-4 py-3 text-xs text-[#B3B3B3]">
              <CreditCard className="h-4 w-4 text-[#1DB954] shrink-0 mt-0.5" aria-hidden="true" />
              <p className="leading-relaxed">
                Frontend Checkout Preview: No real payment is collected or charged during this demonstration.
              </p>
            </div>

            {/* Order Summary Breakdown */}
            <div className="rounded-xl border border-white/10 bg-[#121212] p-4 sm:p-5 space-y-3.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#B3B3B3]">
                Order Summary
              </h3>

              <div className="space-y-2.5 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[#B3B3B3]">Selected subscription</span>
                  <span className="font-semibold text-white text-right">
                    {selectedPlan.name}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <span className="text-[#B3B3B3]">Customer name</span>
                  <span className="font-medium text-white text-right">
                    {formData.fullName.trim()}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <span className="text-[#B3B3B3]">Email address</span>
                  <span className="font-medium text-white text-right break-all">
                    {formData.email.trim()}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <span className="text-[#B3B3B3]">WhatsApp number</span>
                  <span className="font-mono text-xs sm:text-sm text-white tabular-nums text-right">
                    {formData.whatsappNumber.trim()}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <span className="text-[#B3B3B3]">Monthly price</span>
                  <span className="font-mono font-medium text-white tabular-nums">
                    {formatPlanPrice(selectedPlan)}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <span className="text-[#B3B3B3]">Queue coordination fee</span>
                  <span className="font-mono font-medium text-[#1DB954] tabular-nums">
                    {formatAmount(0, selectedPlan.currencySymbol)}
                  </span>
                </div>
              </div>

              <div className="pt-3.5 border-t border-white/10 flex items-center justify-between gap-4">
                <span className="text-base font-bold text-white">Total amount</span>
                <span className="font-mono text-2xl font-extrabold text-[#1DB954] tabular-nums">
                  {formatAmount(selectedPlan.priceMonthly, selectedPlan.currencySymbol)}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col-reverse sm:flex-row items-center gap-3 pt-1">
              <button
                type="button"
                onClick={onBackToForm}
                disabled={isSimulatingConfirm}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-[48px] rounded-full border border-white/20 bg-[#121212] px-5 py-3 text-sm font-semibold text-white transition-colors hover:border-white/40 hover:bg-black cursor-pointer disabled:opacity-50"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                <span>Edit Details</span>
              </button>

              <button
                type="button"
                onClick={handleSimulatedConfirm}
                disabled={isSimulatingConfirm}
                className="w-full sm:flex-1 inline-flex items-center justify-center gap-2 min-h-[48px] rounded-full bg-[#1DB954] px-6 py-3.5 text-sm sm:text-base font-bold text-black transition-all duration-150 hover:bg-[#15803D] hover:text-white active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1DB954] cursor-pointer disabled:opacity-80"
              >
                {isSimulatingConfirm ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    <span>Preparing Summary...</span>
                  </>
                ) : (
                  <span>Confirm Order</span>
                )}
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: ORDER SUCCESS DEMONSTRATION SCREEN */}
        {step === 'success' && completedOrder && (
          <div className="mt-5 space-y-5 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#1DB954]/15 border border-[#1DB954]/40 text-[#1DB954]">
              <CheckCircle2 className="h-9 w-9" aria-hidden="true" />
            </div>

            <div>
              <p className="font-mono text-xs font-semibold text-[#1DB954] tabular-nums">
                Reference #{completedOrder.referenceId}
              </p>
              <h2 id="order-modal-title" className="mt-1 text-2xl font-extrabold text-white tracking-tight">
                {completedOrder.plan.status === 'waitlist'
                  ? 'Waitlist Request Recorded'
                  : 'Order Demonstration Confirmed'}
              </h2>
              <p className="mt-2 text-sm text-[#B3B3B3] leading-relaxed">
                Thank you, <span className="font-semibold text-white">{completedOrder.fullName}</span>. Your simulated order for{' '}
                <span className="font-semibold text-white">{completedOrder.plan.name}</span> has been generated.
              </p>
            </div>

            {/* Confirmation Summary Card */}
            <div className="rounded-xl border border-white/10 bg-[#121212] p-4 text-left space-y-2.5 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[#B3B3B3]">Subscription</span>
                <span className="font-semibold text-white">{completedOrder.plan.name}</span>
              </div>
              {completedOrder.groupCode && (
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[#B3B3B3]">Assigned Group</span>
                  <span className="font-mono text-xs font-bold text-[#1DB954] tabular-nums">
                    {completedOrder.groupName ? `${completedOrder.groupName} · ` : ''}
                    {completedOrder.groupCode}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between gap-4">
                <span className="text-[#B3B3B3]">Monthly Total</span>
                <span className="font-mono font-bold text-[#1DB954] tabular-nums">
                  {completedOrder.totalFormatted}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-[#B3B3B3]">WhatsApp Contact</span>
                <span className="font-mono text-xs text-white tabular-nums">
                  {completedOrder.whatsappNumber}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-[#B3B3B3]">Mode</span>
                <span className="text-xs font-medium text-[#B3B3B3]">
                  Frontend Prototype Preview (No Charge)
                </span>
              </div>
            </div>

            {/* Next Steps Box */}
            <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-black/50 p-4 text-left text-xs sm:text-sm text-[#B3B3B3]">
              <ShieldCheck className="h-5 w-5 text-[#1DB954] shrink-0 mt-0.5" aria-hidden="true" />
              <p className="leading-relaxed">
                Next steps: Click <span className="font-semibold text-white">Done</span> to open your Profile—view your joined subscription, payment history, renewal options, or invite and pay for others.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 pt-1">
              <button
                type="button"
                onClick={onStartNewOrder}
                className="w-full sm:w-auto min-h-[46px] rounded-full border border-white/20 bg-[#121212] px-5 py-3 text-sm font-semibold text-white transition-colors hover:border-[#1DB954] hover:text-[#1DB954] cursor-pointer"
              >
                Place Another Demo Order
              </button>
              <button
                type="button"
                onClick={onDoneToProfile}
                className="w-full sm:flex-1 min-h-[46px] rounded-full bg-[#1DB954] px-6 py-3 text-sm font-bold text-black transition-colors hover:bg-[#15803D] hover:text-white cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
