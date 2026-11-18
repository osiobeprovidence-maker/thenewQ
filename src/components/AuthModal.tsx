import React, { useState } from 'react';
import { Mail, Lock, Phone, User, CheckCircle2, AlertCircle, Loader2, ArrowLeft, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ConfirmationResult, RecaptchaVerifier } from 'firebase/auth';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultMode?: 'login' | 'signup' | 'phone' | 'forgot';
  onSuccess?: () => void;
}

export function AuthModal({ isOpen, onClose, defaultMode = 'login', onSuccess }: AuthModalProps) {
  const {
    loginWithGoogle,
    loginWithEmail,
    signupWithEmail,
    sendPasswordReset,
    setupPhoneRecaptcha,
    sendPhoneOtp,
    confirmPhoneOtp,
  } = useAuth();

  const [mode, setMode] = useState<'login' | 'signup' | 'phone' | 'forgot'>(defaultMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleGoogleLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      await loginWithGoogle();
      onSuccess?.();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Google authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === 'login') {
        await loginWithEmail(email, password);
      } else if (mode === 'signup') {
        if (!fullName.trim()) {
          throw new Error('Please enter your full name.');
        }
        await signupWithEmail(email, password, fullName);
      }
      onSuccess?.();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Authentication failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await sendPasswordReset(email);
      setSuccessMessage('Password reset link sent to your email.');
    } catch (err: any) {
      setError(err?.message || 'Failed to send password reset email.');
    } finally {
      setLoading(false);
    }
  };

  const handleSendPhoneOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const verifier = setupPhoneRecaptcha('recaptcha-container');
      const confirmation = await sendPhoneOtp(phoneNumber, verifier);
      setConfirmationResult(confirmation);
      setSuccessMessage('OTP code sent to your phone number via SMS.');
    } catch (err: any) {
      setError(err?.message || 'Failed to send SMS OTP. Ensure number is in international format (e.g. +234...).');
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
      await confirmPhoneOtp(confirmationResult, otpCode);
      onSuccess?.();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Invalid OTP code.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#121212] p-6 sm:p-8 shadow-2xl text-white">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-[#B3B3B3] hover:text-white p-2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1DB954]"
          aria-label="Close modal"
        >
          <X className="w-5 h-5" />
        </button>

        <div id="recaptcha-container"></div>

        <div className="text-center mb-6">
          <h2 className="text-2xl font-bold text-white tracking-tight">
            {mode === 'login' && 'Sign in to JOIN THE QUEUE'}
            {mode === 'signup' && 'Create your account'}
            {mode === 'phone' && 'Phone Authentication'}
            {mode === 'forgot' && 'Reset your password'}
          </h2>
          <p className="mt-1 text-xs text-[#B3B3B3]">
            Access your shared subscriptions, slot coordination, and profile.
          </p>
        </div>

        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-950/50 border border-red-500/30 p-3 text-xs text-red-300">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        {successMessage && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-green-950/50 border border-green-500/30 p-3 text-xs text-green-300">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-[#1DB954]" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Google Authentication */}
        {mode !== 'forgot' && !confirmationResult && (
          <div className="space-y-3 mb-5">
            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 rounded-full border border-white/20 bg-white/5 py-2.5 px-4 text-sm font-semibold text-white hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1DB954]"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              Continue with Google
            </button>

            <div className="relative flex items-center justify-center my-4">
              <div className="border-t border-white/10 w-full"></div>
              <span className="bg-[#121212] px-3 text-[10px] uppercase font-bold text-[#B3B3B3] tracking-wider absolute">
                or
              </span>
            </div>
          </div>
        )}

        {/* Email Form */}
        {(mode === 'login' || mode === 'signup') && (
          <form onSubmit={handleEmailAuth} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="block text-xs font-medium text-[#B3B3B3] mb-1">Full Name</label>
                <div className="relative">
                  <User className="absolute left-3 top-3 w-4 h-4 text-[#B3B3B3]" />
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Jane Doe"
                    className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-white/10 bg-[#181818] text-sm text-white placeholder-[#B3B3B3] focus:border-[#1DB954] focus:outline-none"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-[#B3B3B3] mb-1">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 w-4 h-4 text-[#B3B3B3]" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-white/10 bg-[#181818] text-sm text-white placeholder-[#B3B3B3] focus:border-[#1DB954] focus:outline-none"
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs font-medium text-[#B3B3B3]">Password</label>
                {mode === 'login' && (
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setSuccessMessage(null);
                      setMode('forgot');
                    }}
                    className="text-[11px] text-[#1DB954] hover:underline"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-3 w-4 h-4 text-[#B3B3B3]" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-white/10 bg-[#181818] text-sm text-white placeholder-[#B3B3B3] focus:border-[#1DB954] focus:outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center rounded-full bg-[#1DB954] py-3 text-sm font-bold text-black hover:bg-[#15803D] hover:text-white transition-colors"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : mode === 'login' ? (
                'Sign In'
              ) : (
                'Create Account'
              )}
            </button>
          </form>
        )}

        {/* Forgot Password Form */}
        {mode === 'forgot' && (
          <form onSubmit={handleForgotPassword} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#B3B3B3] mb-1">Account Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 w-4 h-4 text-[#B3B3B3]" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-white/10 bg-[#181818] text-sm text-white placeholder-[#B3B3B3] focus:border-[#1DB954] focus:outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center rounded-full bg-[#1DB954] py-3 text-sm font-bold text-black hover:bg-[#15803D] hover:text-white transition-colors"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Send Reset Link'}
            </button>

            <button
              type="button"
              onClick={() => {
                setError(null);
                setSuccessMessage(null);
                setMode('login');
              }}
              className="w-full text-center text-xs text-[#B3B3B3] hover:text-white mt-2"
            >
              Back to Sign In
            </button>
          </form>
        )}

        {/* Phone OTP Form */}
        {mode === 'phone' && (
          <div className="space-y-4">
            {!confirmationResult ? (
              <form onSubmit={handleSendPhoneOtp} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-[#B3B3B3] mb-1">
                    Phone Number (International format)
                  </label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-3 w-4 h-4 text-[#B3B3B3]" />
                    <input
                      type="tel"
                      required
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      placeholder="+234 801 234 5678"
                      className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-white/10 bg-[#181818] text-sm text-white placeholder-[#B3B3B3] focus:border-[#1DB954] focus:outline-none"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center rounded-full bg-[#1DB954] py-3 text-sm font-bold text-black hover:bg-[#15803D] hover:text-white transition-colors"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Send SMS OTP'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-[#B3B3B3] mb-1">Enter 6-Digit SMS Code</label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    placeholder="123456"
                    className="w-full text-center tracking-widest text-lg py-2.5 rounded-lg border border-white/10 bg-[#181818] text-white focus:border-[#1DB954] focus:outline-none font-mono"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center rounded-full bg-[#1DB954] py-3 text-sm font-bold text-black hover:bg-[#15803D] hover:text-white transition-colors"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Verify & Continue'}
                </button>
              </form>
            )}
          </div>
        )}

        {/* Footer Mode Switchers */}
        <div className="mt-6 pt-4 border-t border-white/10 text-center space-y-2">
          {mode === 'login' ? (
            <>
              <p className="text-xs text-[#B3B3B3]">
                Don't have an account?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setSuccessMessage(null);
                    setMode('signup');
                  }}
                  className="text-[#1DB954] font-semibold hover:underline"
                >
                  Sign up
                </button>
              </p>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setSuccessMessage(null);
                  setMode('phone');
                }}
                className="text-xs text-[#B3B3B3] hover:text-white underline block mx-auto"
              >
                Sign in with Phone Number
              </button>
            </>
          ) : mode === 'signup' ? (
            <p className="text-xs text-[#B3B3B3]">
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setSuccessMessage(null);
                  setMode('login');
                }}
                className="text-[#1DB954] font-semibold hover:underline"
              >
                Sign in
              </button>
            </p>
          ) : (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setSuccessMessage(null);
                setMode('login');
              }}
              className="text-xs text-[#B3B3B3] hover:text-white underline"
            >
              Sign in with Email or Google
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
