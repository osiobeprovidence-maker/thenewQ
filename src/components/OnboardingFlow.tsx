import React, { useState, useRef } from 'react';
import {
  Phone,
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronDown,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { ConfirmationResult, RecaptchaVerifier } from 'firebase/auth';

interface OnboardingFlowProps {
  onComplete: () => void;
}

const COUNTRY_CODES = [
  { code: '+234', label: 'NG +234', flag: '🇳🇬' },
  { code: '+1',   label: 'US +1',   flag: '🇺🇸' },
  { code: '+44',  label: 'UK +44',  flag: '🇬🇧' },
  { code: '+233', label: 'GH +233', flag: '🇬🇭' },
  { code: '+254', label: 'KE +254', flag: '🇰🇪' },
  { code: '+27',  label: 'ZA +27',  flag: '🇿🇦' },
  { code: '+91',  label: 'IN +91',  flag: '🇮🇳' },
  { code: '+49',  label: 'DE +49',  flag: '🇩🇪' },
  { code: '+33',  label: 'FR +33',  flag: '🇫🇷' },
  { code: '+971', label: 'AE +971', flag: '🇦🇪' },
];

function detectStep(
  phone?: string,
  phone_verified?: boolean,
  providerIds?: string[]
): 'phone' | 'password' {
  if (!phone || !phone_verified) return 'phone';
  // Check if the user already has a password provider
  const hasPassword = providerIds?.includes('password') ?? false;
  if (!hasPassword) return 'password';
  return 'password'; // Should not get here if onboarding_completed === true
}

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const {
    currentUser,
    profile,
    setupPhoneRecaptcha,
    sendPhoneOtp,
    verifyAndLinkPhone,
    setupAccountPassword,
    updateUserProfile,
  } = useAuth();

  const providerIds = currentUser?.providerData.map((p) => p.providerId) ?? [];
  const initialStep = detectStep(profile?.phone, profile?.phone_verified, providerIds);

  const [step, setStep] = useState<'phone' | 'password' | 'done'>(initialStep);

  // Phone step state
  const [countryCode, setCountryCode] = useState('+234');
  const [localPhone, setLocalPhone] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);
  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null);

  // Password step state
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fullPhone = `${countryCode}${localPhone.replace(/^0/, '')}`;

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!localPhone.trim() || localPhone.trim().length < 7) {
      setError('Please enter a valid phone number.');
      return;
    }
    setLoading(true);
    try {
      if (!recaptchaVerifierRef.current) {
        recaptchaVerifierRef.current = setupPhoneRecaptcha('recaptcha-onboarding');
      }
      const result = await sendPhoneOtp(fullPhone, recaptchaVerifierRef.current);
      setConfirmationResult(result);
      setOtpSent(true);
      setSuccessMsg(`OTP sent to ${fullPhone}`);
    } catch (err: any) {
      setError(err?.message || 'Failed to send OTP. Please check the phone number.');
      recaptchaVerifierRef.current = null;
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmationResult) return;
    setError(null);
    setLoading(true);
    try {
      await verifyAndLinkPhone(confirmationResult.verificationId, otpCode, fullPhone);
      setSuccessMsg('Phone verified! Now create your password.');
      setStep('password');
    } catch (err: any) {
      setError(err?.message || 'Invalid OTP code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSavePhoneForLater = async () => {
    setError(null);
    setSuccessMsg(null);
    if (!localPhone.trim() || localPhone.trim().length < 7) {
      setError('Please enter a valid phone number before continuing.');
      return;
    }
    setLoading(true);
    try {
      await updateUserProfile({
        phone: fullPhone,
        phone_verified: false,
      });
      setSuccessMsg('Phone number saved. You can verify it later in Account Settings.');
      setStep('password');
    } catch (err: any) {
      setError(err?.message || 'Could not save your phone number. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await setupAccountPassword(password);
      await updateUserProfile({ onboarding_completed: true });
      setStep('done');
      setTimeout(() => {
        onComplete();
      }, 2000);
    } catch (err: any) {
      setError(err?.message || 'Failed to create password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black p-4">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-black via-[#0a0a0a] to-[#111] pointer-events-none" />

      <div className="relative w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-[#1DB954]/10 border border-[#1DB954]/20 mb-4">
            <span className="text-2xl">🎟️</span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Complete Your Account
          </h1>
          <p className="mt-2 text-sm text-[#B3B3B3]">
            {step === 'phone' && 'Step 1 of 2 — Verify your phone number'}
            {step === 'password' && 'Step 2 of 2 — Create a password'}
            {step === 'done' && 'All done! Welcome aboard 🎉'}
          </p>
        </div>

        {/* Progress bar */}
        {step !== 'done' && (
          <div className="flex gap-2 mb-8">
            <div className={`flex-1 h-1 rounded-full transition-colors ${step === 'phone' || step === 'password' ? 'bg-[#1DB954]' : 'bg-white/10'}`} />
            <div className={`flex-1 h-1 rounded-full transition-colors ${step === 'password' ? 'bg-[#1DB954]' : 'bg-white/10'}`} />
          </div>
        )}

        <div className="rounded-2xl border border-white/10 bg-[#121212] p-6 sm:p-8 shadow-2xl">
          {/* Error banner */}
          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-950/50 border border-red-500/30 p-3 text-xs text-red-300">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Success banner */}
          {successMsg && step !== 'done' && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-green-950/50 border border-green-500/30 p-3 text-xs text-green-300">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-[#1DB954]" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* ── STEP 1: PHONE ── */}
          {step === 'phone' && !otpSent && (
            <form onSubmit={handleSendOtp} className="space-y-5">
              <div id="recaptcha-onboarding" />
              <div>
                <label className="block text-xs font-medium text-[#B3B3B3] mb-1">
                  Phone Number
                </label>
                <div className="flex gap-2">
                  {/* Country code selector */}
                  <div className="relative">
                    <select
                      value={countryCode}
                      onChange={(e) => setCountryCode(e.target.value)}
                      className="appearance-none h-full pl-3 pr-7 py-2.5 rounded-lg border border-white/10 bg-[#181818] text-sm text-white focus:border-[#1DB954] focus:outline-none cursor-pointer"
                    >
                      {COUNTRY_CODES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.flag} {c.code}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[#B3B3B3] pointer-events-none" />
                  </div>
                  {/* Local number */}
                  <div className="relative flex-1">
                    <Phone className="absolute left-3 top-3 w-4 h-4 text-[#B3B3B3]" />
                    <input
                      type="tel"
                      required
                      value={localPhone}
                      onChange={(e) => setLocalPhone(e.target.value)}
                      placeholder="8012345678"
                      className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-white/10 bg-[#181818] text-sm text-white placeholder-[#B3B3B3] focus:border-[#1DB954] focus:outline-none"
                    />
                  </div>
                </div>
                <p className="mt-1.5 text-[11px] text-[#B3B3B3]">
                  Enter without the leading 0, e.g. 8012345678
                </p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center rounded-full bg-[#1DB954] py-3 text-sm font-bold text-black hover:bg-[#17a349] transition-colors disabled:opacity-60"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Send Verification Code'}
              </button>
              <button
                type="button"
                onClick={() => void handleSavePhoneForLater()}
                disabled={loading}
                className="w-full rounded-full border border-white/20 py-3 text-sm font-semibold text-white hover:border-[#1DB954] transition-colors disabled:opacity-60"
              >
                Save number and verify later
              </button>
            </form>
          )}

          {/* ── STEP 1: OTP verification ── */}
          {step === 'phone' && otpSent && (
            <form onSubmit={handleVerifyOtp} className="space-y-5">
              <div>
                <label className="block text-xs font-medium text-[#B3B3B3] mb-1">
                  Enter 6-Digit Code sent to {fullPhone}
                </label>
                <input
                  type="text"
                  required
                  inputMode="numeric"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                  className="w-full text-center tracking-widest text-xl py-3 rounded-lg border border-white/10 bg-[#181818] text-white focus:border-[#1DB954] focus:outline-none font-mono"
                />
              </div>

              <button
                type="submit"
                disabled={loading || otpCode.length < 6}
                className="w-full flex items-center justify-center rounded-full bg-[#1DB954] py-3 text-sm font-bold text-black hover:bg-[#17a349] transition-colors disabled:opacity-60"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Verify & Continue'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setOtpSent(false);
                  setOtpCode('');
                  setConfirmationResult(null);
                  setSuccessMsg(null);
                  setError(null);
                  recaptchaVerifierRef.current = null;
                }}
                className="w-full text-center text-xs text-[#B3B3B3] hover:text-white"
              >
                ← Use a different number
              </button>
            </form>
          )}

          {/* ── STEP 2: PASSWORD ── */}
          {step === 'password' && (
            <form onSubmit={handleSetPassword} className="space-y-5">
              <div>
                <label className="block text-xs font-medium text-[#B3B3B3] mb-1">
                  Create Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 w-4 h-4 text-[#B3B3B3]" />
                  <input
                    type={showPass ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 8 characters"
                    className="w-full pl-9 pr-10 py-2.5 rounded-lg border border-white/10 bg-[#181818] text-sm text-white placeholder-[#B3B3B3] focus:border-[#1DB954] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass((v) => !v)}
                    className="absolute right-3 top-3 text-[#B3B3B3] hover:text-white"
                    aria-label={showPass ? 'Hide password' : 'Show password'}
                  >
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#B3B3B3] mb-1">
                  Confirm Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 w-4 h-4 text-[#B3B3B3]" />
                  <input
                    type={showConfirmPass ? 'text' : 'password'}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter your password"
                    className="w-full pl-9 pr-10 py-2.5 rounded-lg border border-white/10 bg-[#181818] text-sm text-white placeholder-[#B3B3B3] focus:border-[#1DB954] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPass((v) => !v)}
                    className="absolute right-3 top-3 text-[#B3B3B3] hover:text-white"
                    aria-label={showConfirmPass ? 'Hide password' : 'Show password'}
                  >
                    {showConfirmPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {password && confirmPassword && password !== confirmPassword && (
                  <p className="mt-1 text-[11px] text-red-400">Passwords do not match</p>
                )}
              </div>

              {/* Strength hint */}
              {password.length > 0 && (
                <div className="flex gap-1">
                  {[...Array(4)].map((_, i) => (
                    <div
                      key={i}
                      className={`flex-1 h-1 rounded-full transition-colors ${
                        password.length >= (i + 1) * 3
                          ? password.length >= 12
                            ? 'bg-[#1DB954]'
                            : 'bg-yellow-500'
                          : 'bg-white/10'
                      }`}
                    />
                  ))}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || password.length < 8 || password !== confirmPassword}
                className="w-full flex items-center justify-center rounded-full bg-[#1DB954] py-3 text-sm font-bold text-black hover:bg-[#17a349] transition-colors disabled:opacity-60"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Complete Setup'}
              </button>
            </form>
          )}

          {/* ── DONE ── */}
          {step === 'done' && (
            <div className="text-center py-4">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#1DB954]/10 border border-[#1DB954]/30 mb-4">
                <CheckCircle2 className="w-8 h-8 text-[#1DB954]" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Account Setup Complete!</h3>
              <p className="text-sm text-[#B3B3B3]">
                Your phone number and password have been saved.<br />
                Redirecting you to your dashboard…
              </p>
              <Loader2 className="w-5 h-5 animate-spin text-[#1DB954] mx-auto mt-4" />
            </div>
          )}
        </div>

        {/* Logged-in-as indicator */}
        <p className="text-center text-[11px] text-[#B3B3B3] mt-4">
          Signed in as{' '}
          <span className="text-white font-medium">
            {currentUser?.email ?? currentUser?.phoneNumber ?? 'your account'}
          </span>
        </p>
      </div>
    </div>
  );
}
