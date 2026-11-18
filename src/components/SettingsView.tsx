import { useState, type FormEvent } from 'react';
import { ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, Phone, ShieldCheck, UsersRound } from 'lucide-react';

interface SettingsViewProps {
  phoneNumber: string;
  passwordConfigured: boolean;
  onBack: () => void;
  onSetPassword: (password: string) => void;
  onOpenMarketplace: () => void;
  onChangePassword: (currentPassword: string, newPassword: string) => boolean;
}

type PasswordMode = 'set' | 'change';

const MIN_PASSWORD_LENGTH = 8;

export function SettingsView({
  phoneNumber,
  passwordConfigured,
  onBack,
  onSetPassword,
  onOpenMarketplace,
  onChangePassword,
}: SettingsViewProps) {
  const [passwordMode, setPasswordMode] = useState<PasswordMode | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [visibleFields, setVisibleFields] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const toggleVisibility = (field: string) => {
    setVisibleFields((previous) => ({ ...previous, [field]: !previous[field] }));
  };

  const resetPasswordForm = () => {
    setPasswordMode(null);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setVisibleFields({});
    setError(null);
  };

  const handlePasswordSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters for your new password.`);
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.');
      return;
    }

    if (passwordMode === 'change' && !onChangePassword(currentPassword, newPassword)) {
      setError('The current password is incorrect.');
      return;
    }

    if (passwordMode === 'set') {
      onSetPassword(newPassword);
      setSuccess('Demo password set. It is held in temporary page state only.');
    } else {
      setSuccess('Demo password changed successfully.');
    }
    resetPasswordForm();
  };

  const renderPasswordField = (
    id: string,
    label: string,
    value: string,
    onChange: (value: string) => void
  ) => (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-white">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={id}
          type={visibleFields[id] ? 'text' : 'password'}
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required
          className="min-h-[46px] w-full rounded-xl border border-white/15 bg-[#121212] px-4 py-2.5 pr-12 text-sm text-white focus:border-[#1DB954] focus:outline-none"
        />
        <button
          type="button"
          onClick={() => toggleVisibility(id)}
          aria-label={`${visibleFields[id] ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
          className="absolute inset-y-0 right-0 inline-flex w-12 items-center justify-center text-[#B3B3B3] transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1DB954]"
        >
          {visibleFields[id] ? (
            <EyeOff className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Eye className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 space-y-6">
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#121212] px-4 py-3.5 sm:px-6">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-[40px] items-center gap-2 text-sm font-semibold text-white transition-colors hover:text-[#1DB954]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>Back to Profile</span>
        </button>
        <span className="text-xs font-semibold uppercase tracking-wider text-[#1DB954]">
          Account Settings
        </span>
      </div>

      <section className="rounded-2xl border border-white/10 bg-[#181818] p-5 sm:p-8">
        <div className="flex items-start gap-3.5 border-b border-white/10 pb-5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#1DB954]/30 bg-[#1DB954]/10 text-[#1DB954]">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold tracking-tight text-white sm:text-2xl">
              Account Security
            </h1>
            <p className="mt-1 text-sm leading-relaxed text-[#B3B3B3]">
              Review your contact number and manage this demo’s password state.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenMarketplace}
          className="mt-5 flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#121212] px-4 py-3 text-left transition-colors hover:border-[#1DB954] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1DB954]"
          aria-label="Open subscription marketplace"
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#1DB954]/30 bg-[#1DB954]/10 text-[#1DB954]">
              <UsersRound className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">Marketplace</p>
              <p className="mt-0.5 break-words text-xs text-[#B3B3B3]">Coming soon · verified subscription listings from Q</p>
            </div>
          </div>
          <ArrowLeft className="h-4 w-4 shrink-0 rotate-180 text-[#B3B3B3]" aria-hidden="true" />
        </button>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-[#121212] p-4">
            <p className="text-xs font-medium text-[#B3B3B3]">Account phone number</p>
            <p className="mt-2 flex min-w-0 items-center gap-2 break-words font-mono text-sm text-white">
              <Phone className="h-4 w-4 shrink-0 text-[#1DB954]" aria-hidden="true" />
              {phoneNumber}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#121212] p-4">
            <p className="text-xs font-medium text-[#B3B3B3]">Password status</p>
            <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-white">
              <KeyRound className="h-4 w-4 text-[#1DB954]" aria-hidden="true" />
              {passwordConfigured ? 'Configured for this demo session' : 'Not set'}
            </p>
          </div>
        </div>

        {success && (
          <p
            role="status"
            className="mt-5 flex items-start gap-2 rounded-xl border border-[#1DB954]/30 bg-[#1DB954]/5 p-4 text-sm text-white"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#1DB954]" aria-hidden="true" />
            <span>{success}</span>
          </p>
        )}

        {passwordMode ? (
          <form onSubmit={handlePasswordSubmit} className="mt-6 space-y-4">
            <h2 className="text-lg font-bold text-white">
              {passwordMode === 'set' ? 'Set Password' : 'Change Password'}
            </h2>
            {passwordMode === 'change' &&
              renderPasswordField(
                'current-password',
                'Current password',
                currentPassword,
                setCurrentPassword
              )}
            {renderPasswordField(
              'new-password',
              'New password',
              newPassword,
              setNewPassword
            )}
            {renderPasswordField(
              'confirm-password',
              'Confirm new password',
              confirmPassword,
              setConfirmPassword
            )}
            <p className="text-xs text-[#B3B3B3]">
              Use at least {MIN_PASSWORD_LENGTH} characters.
            </p>
            {error && (
              <p role="alert" className="text-sm text-red-300">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-3 pt-1">
              <button
                type="submit"
                className="min-h-[44px] rounded-full bg-[#1DB954] px-5 py-2.5 text-sm font-bold text-black transition-colors hover:bg-[#15803D] hover:text-white"
              >
                Save Password
              </button>
              <button
                type="button"
                onClick={resetPasswordForm}
                className="min-h-[44px] rounded-full border border-white/20 bg-[#121212] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:border-[#1DB954]"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                setSuccess(null);
                setPasswordMode(passwordConfigured ? 'change' : 'set');
              }}
              className="min-h-[44px] rounded-full bg-[#1DB954] px-5 py-2.5 text-sm font-bold text-black transition-colors hover:bg-[#15803D] hover:text-white"
            >
              {passwordConfigured ? 'Change Password' : 'Set Password'}
            </button>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#181818] p-5 sm:p-6">
        <h2 className="text-base font-bold text-white">Login preference</h2>
        <p className="mt-2 text-sm leading-relaxed text-[#B3B3B3]">
          In a future connected service, you could use your registered phone number and a configured
          password to log in. This prototype does not authenticate users or save passwords.
        </p>
        <p className="mt-3 rounded-xl border border-white/10 bg-[#121212] p-4 text-xs leading-relaxed text-[#B3B3B3]">
          Demo only: the mock password is kept in temporary React state while this page is open. It
          is not written to localStorage, sessionStorage, or another persistent store.
        </p>
      </section>
    </div>
  );
}
