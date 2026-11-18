import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Check,
  CheckCircle2,
  Globe,
  Loader2,
  MessageCircle,
  Pencil,
  Phone,
  Plus,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import {
  EMPTY_SUPPORT_SOCIALS,
  PLATFORM_LABELS,
  displayPhone,
  getSupportSocials,
  isValidUrl,
  normalizePhoneNumber,
  resolveWhatsappUrl,
  saveSupportSocials,
  type SocialAccount,
  type SocialPlatform,
  type SupportSocialsSettings,
} from '../lib/settingsService';
import { PlatformIcon } from './PlatformIcon';

const PLATFORM_OPTIONS: SocialPlatform[] = [
  'instagram',
  'x',
  'facebook',
  'tiktok',
  'telegram',
  'youtube',
  'discord',
  'linkedin',
  'custom',
];

function newSocialId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `soc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

const inputClass =
  'w-full rounded-xl border border-white/10 bg-[#121212] px-3.5 py-2.5 text-sm text-white placeholder-[#6B6B6B] outline-none transition-colors focus:border-[#1DB954] focus:ring-1 focus:ring-[#1DB954]/40';

const SOCIAL_URL_DUPLICATE_MESSAGE = 'A social account with this profile URL already exists.';

export function SupportSocialsPanel() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Working copy — edited locally, persisted on Save Changes.
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const [numberInput, setNumberInput] = useState('');
  const [customUrlInput, setCustomUrlInput] = useState('');
  const [socials, setSocials] = useState<SocialAccount[]>([]);

  // Add / edit social form
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formPlatform, setFormPlatform] = useState<SocialPlatform>('instagram');
  const [formLabel, setFormLabel] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formEnabled, setFormEnabled] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  // Save state
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    null
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const settings = await getSupportSocials();
      setWhatsappEnabled(settings.whatsapp.enabled);
      setNumberInput(settings.whatsapp.number);
      setCustomUrlInput(settings.whatsapp.customUrl ?? '');
      setSocials(settings.socials);
    } catch {
      setLoadError('Could not load the Support & Socials settings. Please refresh and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Build the settings object exactly as it would be persisted. */
  const buildSettings = useCallback((): SupportSocialsSettings => {
    const normalized = normalizePhoneNumber(numberInput) ?? '';
    const customUrl = customUrlInput.trim();
    return {
      whatsapp: {
        enabled: whatsappEnabled,
        number: normalized,
        customUrl: customUrl.length > 0 ? customUrl : undefined,
      },
      socials,
    };
  }, [whatsappEnabled, numberInput, customUrlInput, socials]);

  const previewSettings = buildSettings();
  const previewWhatsappUrl = resolveWhatsappUrl(previewSettings);
  const previewSocials = socials.filter((s) => s.enabled && isValidUrl(s.url));

  const resetForm = () => {
    setEditingId(null);
    setFormPlatform('instagram');
    setFormLabel('');
    setFormUrl('');
    setFormEnabled(true);
    setFormError(null);
  };

  const startEdit = (account: SocialAccount) => {
    setEditingId(account.id);
    setFormPlatform(account.platform);
    setFormLabel(account.label ?? '');
    setFormUrl(account.url);
    setFormEnabled(account.enabled);
    setFormError(null);
  };

  const findDuplicateUrl = (url: string, exceptId?: string | null) => {
    const candidate = url.trim().toLowerCase();
    return socials.find(
      (s) => s.id !== exceptId && s.url.trim().toLowerCase() === candidate
    );
  };

  const submitSocial = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError(null);
    setSaveNotice(null);

    const url = formUrl.trim();
    if (!isValidUrl(url)) {
      setFormError('Enter a valid profile URL starting with https:// or http://');
      return;
    }
    const label = formLabel.trim();
    if (formPlatform === 'custom' && !label) {
      setFormError('Custom platforms need a display name (e.g. "Discord Server").');
      return;
    }
    if (findDuplicateUrl(url, editingId)) {
      setFormError(SOCIAL_URL_DUPLICATE_MESSAGE);
      return;
    }

    if (editingId) {
      setSocials((prev) =>
        prev.map((s) =>
          s.id === editingId
            ? {
                id: s.id,
                platform: formPlatform,
                label: formPlatform === 'custom' ? label : label || undefined,
                url,
                enabled: formEnabled,
              }
            : s
        )
      );
    } else {
      setSocials((prev) => [
        ...prev,
        {
          id: newSocialId(),
          platform: formPlatform,
          label: formPlatform === 'custom' ? label : label || undefined,
          url,
          enabled: formEnabled,
        },
      ]);
    }
    resetForm();
  };

  const removeSocial = (id: string) => {
    setSocials((prev) => prev.filter((s) => s.id !== id));
    if (editingId === id) resetForm();
  };

  const toggleSocialEnabled = (id: string) => {
    setSocials((prev) => prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)));
  };

  const handleSave = async () => {
    setSaveNotice(null);
    setFormError(null);

    const normalized = normalizePhoneNumber(numberInput);
    const customUrl = customUrlInput.trim();
    if (whatsappEnabled) {
      const hasCustom = customUrl.length > 0;
      if (hasCustom && !isValidUrl(customUrl)) {
        setSaveNotice({
          kind: 'error',
          text: 'The custom WhatsApp URL is not valid. Use a full https:// link.',
        });
        return;
      }
      if (!normalized && !hasCustom) {
        setSaveNotice({
          kind: 'error',
          text: 'WhatsApp support is enabled but no valid number or custom URL is set. Enter at least 7 digits, e.g. +234 800 000 0000.',
        });
        return;
      }
      if (numberInput.trim() && !normalized) {
        setSaveNotice({
          kind: 'error',
          text: 'The phone number looks invalid. Use 7–15 digits including country code.',
        });
        return;
      }
    }
    if (customUrl && !isValidUrl(customUrl)) {
      setSaveNotice({
        kind: 'error',
        text: 'The custom WhatsApp URL is not valid. Use a full https:// link.',
      });
      return;
    }

    // Socials-level validation pass (URLs, duplicates, custom labels).
    const seen = new Set<string>();
    for (const account of socials) {
      if (!isValidUrl(account.url)) {
        setSaveNotice({
          kind: 'error',
          text: `"${account.url.trim() || '(empty)'}" is not a valid http(s) URL. Fix or remove it before saving.`,
        });
        return;
      }
      const key = account.url.trim().toLowerCase();
      if (seen.has(key)) {
        setSaveNotice({ kind: 'error', text: SOCIAL_URL_DUPLICATE_MESSAGE });
        return;
      }
      seen.add(key);
      if (account.platform === 'custom' && !account.label?.trim()) {
        setSaveNotice({
          kind: 'error',
          text: 'A custom social account is missing its display name.',
        });
        return;
      }
    }

    setSaving(true);
    try {
      const result = await saveSupportSocials(buildSettings());
      if (result.ok) {
        setSaveNotice({
          kind: 'success',
          text: 'Support & Socials settings saved. The footer now reflects these changes.',
        });
        // Re-sync the local copy with whatever was persisted.
        const persisted = await getSupportSocials();
        setWhatsappEnabled(persisted.whatsapp.enabled);
        setNumberInput(persisted.whatsapp.number);
        setCustomUrlInput(persisted.whatsapp.customUrl ?? '');
        setSocials(persisted.socials);
      } else {
        setSaveNotice({ kind: 'error', text: result.error });
      }
    } catch {
      setSaveNotice({ kind: 'error', text: 'Save failed. Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-[#181818] p-5 sm:p-7">
        <div className="h-6 w-56 animate-pulse rounded bg-white/5" />
        <div className="mt-6 h-32 w-full animate-pulse rounded-xl bg-white/5" />
        <div className="mt-4 h-32 w-full animate-pulse rounded-xl bg-white/5" />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-[#181818] p-5 sm:p-7 space-y-6">
      {/* Header */}
      <div className="pb-4 border-b border-white/10 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[#1DB954]">
            Super Admin · Storefront
          </p>
          <h2 className="mt-1 text-xl font-extrabold text-white">Support &amp; Socials</h2>
          <p className="mt-1 text-sm text-[#B3B3B3] max-w-2xl">
            Control the WhatsApp support contact and social profiles shown in the public footer.
            Changes go live immediately after saving.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-[#B3B3B3] hover:text-white hover:border-white/30 transition-colors cursor-pointer"
        >
          Reload from server
        </button>
      </div>

      {loadError && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300" role="alert">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{loadError}</span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Left column — editors */}
        <div className="xl:col-span-7 space-y-6">
          {/* ── WhatsApp configuration ─────────────────────────────── */}
          <section className="space-y-4" aria-labelledby="support-whatsapp-heading">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <MessageCircle className="h-5 w-5 text-[#1DB954]" aria-hidden="true" />
                <h3 id="support-whatsapp-heading" className="text-sm font-bold text-white">
                  WhatsApp Support Configuration
                </h3>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-[#B3B3B3] select-none">
                <span>{whatsappEnabled ? 'Enabled' : 'Disabled'}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={whatsappEnabled}
                  aria-label="Enable WhatsApp support"
                  onClick={() => setWhatsappEnabled((v) => !v)}
                  className={`relative h-6 w-11 rounded-full transition-colors cursor-pointer ${
                    whatsappEnabled ? 'bg-[#1DB954]' : 'bg-white/15'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                      whatsappEnabled ? 'left-[22px]' : 'left-0.5'
                    }`}
                  />
                </button>
              </label>
            </div>

            <div className="space-y-3 rounded-xl border border-white/10 bg-[#121212] p-4">
              <div>
                <label htmlFor="support-phone" className="mb-1.5 block text-xs font-semibold text-[#B3B3B3]">
                  WhatsApp number
                </label>
                <div className="relative">
                  <Phone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B6B6B]" aria-hidden="true" />
                  <input
                    id="support-phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={numberInput}
                    onChange={(e) => setNumberInput(e.target.value)}
                    placeholder="+234 800 000 0000"
                    className={`${inputClass} pl-10`}
                    aria-describedby="support-phone-hint"
                  />
                </div>
                <p id="support-phone-hint" className="mt-1.5 text-[11px] text-[#6B6B6B]">
                  Include the country code. Spaces, dashes and parentheses are stripped automatically; 7–15 digits required.
                </p>
              </div>

              <div>
                <label htmlFor="support-custom-url" className="mb-1.5 block text-xs font-semibold text-[#B3B3B3]">
                  Custom WhatsApp link <span className="font-normal text-[#6B6B6B]">(optional)</span>
                </label>
                <input
                  id="support-custom-url"
                  type="url"
                  inputMode="url"
                  value={customUrlInput}
                  onChange={(e) => setCustomUrlInput(e.target.value)}
                  placeholder="https://wa.me/2348000000000 or https://chat.whatsapp.com/…"
                  className={inputClass}
                  aria-describedby="support-url-hint"
                />
                <p id="support-url-hint" className="mt-1.5 text-[11px] text-[#6B6B6B]">
                  When set, this link is used instead of the generated wa.me link.
                </p>
              </div>

              {/* Generated-link hint */}
              <div className="rounded-lg border border-white/5 bg-black/40 px-3 py-2 font-mono text-[11px] text-[#B3B3B3] break-all">
                <span className="text-[#6B6B6B]">Footer link → </span>
                {customUrlInput.trim()
                  ? customUrlInput.trim()
                  : normalizePhoneNumber(numberInput)
                    ? `https://wa.me/${normalizePhoneNumber(numberInput)}`
                    : 'Enter a valid number or custom link to enable the card'}
              </div>
            </div>
          </section>

          {/* ── Social accounts ────────────────────────────────────── */}
          <section className="space-y-3" aria-labelledby="support-socials-heading">
            <div className="flex items-center justify-between gap-4">
              <h3 id="support-socials-heading" className="text-sm font-bold text-white">
                Social Media Accounts
              </h3>
              <span className="text-[11px] font-semibold text-[#B3B3B3]">
                {socials.length} {socials.length === 1 ? 'account' : 'accounts'}
              </span>
            </div>

            {/* Existing accounts */}
            {socials.length === 0 ? (
              <p className="rounded-xl border border-dashed border-white/15 bg-[#121212] px-4 py-6 text-center text-xs text-[#B3B3B3]">
                No social accounts yet. Add your first one below — enabled accounts appear as
                circular icons in the footer.
              </p>
            ) : (
              <ul className="space-y-2">
                {socials.map((account) => (
                  <li
                    key={account.id}
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-[#121212] px-3 py-2.5"
                  >
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors ${
                        account.enabled
                          ? 'border-[#1DB954]/40 bg-[#1DB954]/10 text-[#1DB954]'
                          : 'border-white/10 bg-white/5 text-[#6B6B6B]'
                      }`}
                    >
                      <PlatformIcon platform={account.platform} className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-white">
                        {account.platform === 'custom'
                          ? account.label?.trim() || 'Custom'
                          : PLATFORM_LABELS[account.platform]}
                      </p>
                      <a
                        href={account.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block truncate text-[11px] text-[#B3B3B3] hover:text-white transition-colors"
                        title={account.url}
                      >
                        {account.url}
                      </a>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={account.enabled}
                        aria-label={`${account.enabled ? 'Disable' : 'Enable'} ${
                          PLATFORM_LABELS[account.platform]
                        } link`}
                        onClick={() => toggleSocialEnabled(account.id)}
                        className={`relative h-5 w-9 rounded-full transition-colors cursor-pointer ${
                          account.enabled ? 'bg-[#1DB954]' : 'bg-white/15'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                            account.enabled ? 'left-[18px]' : 'left-0.5'
                          }`}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => startEdit(account)}
                        aria-label="Edit account"
                        title="Edit"
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-[#B3B3B3] hover:bg-white/5 hover:text-white transition-colors cursor-pointer"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeSocial(account.id)}
                        aria-label="Delete account"
                        title="Delete"
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-[#B3B3B3] hover:bg-red-500/10 hover:text-red-400 transition-colors cursor-pointer"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {/* Add / edit form */}
            <form
              onSubmit={submitSocial}
              className="space-y-3 rounded-xl border border-white/10 bg-[#121212] p-4"
            >
              <p className="text-xs font-bold text-white">
                {editingId ? 'Edit social account' : 'Add social account'}
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="social-platform" className="mb-1.5 block text-[11px] font-semibold text-[#B3B3B3]">
                    Platform
                  </label>
                  <select
                    id="social-platform"
                    value={formPlatform}
                    onChange={(e) => setFormPlatform(e.target.value as SocialPlatform)}
                    className={inputClass}
                  >
                    {PLATFORM_OPTIONS.map((platform) => (
                      <option key={platform} value={platform}>
                        {PLATFORM_LABELS[platform]}
                      </option>
                    ))}
                  </select>
                </div>

                {formPlatform === 'custom' ? (
                  <div>
                    <label htmlFor="social-label" className="mb-1.5 block text-[11px] font-semibold text-[#B3B3B3]">
                      Custom name
                    </label>
                    <input
                      id="social-label"
                      type="text"
                      value={formLabel}
                      onChange={(e) => setFormLabel(e.target.value)}
                      placeholder="e.g. Discord Community"
                      className={inputClass}
                    />
                  </div>
                ) : (
                  <div>
                    <label htmlFor="social-label-optional" className="mb-1.5 block text-[11px] font-semibold text-[#B3B3B3]">
                      Label <span className="font-normal text-[#6B6B6B]">(optional)</span>
                    </label>
                    <input
                      id="social-label-optional"
                      type="text"
                      value={formLabel}
                      onChange={(e) => setFormLabel(e.target.value)}
                      placeholder={PLATFORM_LABELS[formPlatform]}
                      className={inputClass}
                    />
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="social-url" className="mb-1.5 block text-[11px] font-semibold text-[#B3B3B3]">
                  Profile URL
                </label>
                <input
                  id="social-url"
                  type="url"
                  inputMode="url"
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  placeholder="https://instagram.com/yourhandle"
                  className={inputClass}
                  aria-invalid={Boolean(formError)}
                />
              </div>

              {formError && (
                <p className="flex items-start gap-1.5 text-xs text-red-400" role="alert">
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{formError}</span>
                </p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-[#B3B3B3] select-none">
                  <input
                    type="checkbox"
                    checked={formEnabled}
                    onChange={(e) => setFormEnabled(e.target.checked)}
                    className="h-4 w-4 rounded border-white/25 bg-[#181818] accent-[#1DB954]"
                  />
                  Enabled in footer
                </label>
                <div className="flex items-center gap-2">
                  {editingId && (
                    <button
                      type="button"
                      onClick={resetForm}
                      className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-[#B3B3B3] hover:text-white transition-colors cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                      Cancel
                    </button>
                  )}
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#1DB954] px-4 py-2 text-xs font-extrabold text-black transition-colors hover:bg-[#1ed760] cursor-pointer"
                  >
                    {editingId ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
                    {editingId ? 'Update Account' : 'Add Account'}
                  </button>
                </div>
              </div>
            </form>
          </section>
        </div>

        {/* Right column — save bar + footer preview */}
        <div className="xl:col-span-5 space-y-4">
          {/* Save card */}
          <div className="rounded-xl border border-white/10 bg-[#121212] p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-bold text-white">Save Support &amp; Socials</p>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#B3B3B3]">
                Super Admin only
              </span>
            </div>
            <p className="text-[11px] text-[#B3B3B3]">
              Persists to the shared settings store. The public footer reads the same values, so
              the next page load shows exactly what you save here.
            </p>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1DB954] px-4 py-3 text-sm font-extrabold text-black transition-colors hover:bg-[#1ed760] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Saving…
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" aria-hidden="true" />
                  Save Changes
                </>
              )}
            </button>
            {saveNotice && (
              <div
                className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
                  saveNotice.kind === 'success'
                    ? 'border-[#1DB954]/30 bg-[#1DB954]/10 text-[#1DB954]'
                    : 'border-red-500/30 bg-red-500/10 text-red-300'
                }`}
                role={saveNotice.kind === 'success' ? 'status' : 'alert'}
              >
                {saveNotice.kind === 'success' ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                )}
                <span>{saveNotice.text}</span>
              </div>
            )}
          </div>

          {/* Footer preview */}
          <div className="rounded-xl border border-white/10 bg-[#121212] p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-bold text-white">Footer Preview</p>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6B6B6B]">
                Live as you type
              </span>
            </div>

            <div className="rounded-lg border border-white/10 bg-black p-4 space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#B3B3B3]">
                Support &amp; Socials
              </p>

              {previewWhatsappUrl ? (
                <div className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-[#181818] px-4 py-3">
                  <MessageCircle className="h-5 w-5 text-[#1DB954] shrink-0" aria-hidden="true" />
                  <div>
                    <p className="text-[11px] font-medium text-[#B3B3B3]">WhatsApp Support</p>
                    <p className="font-mono text-[11px] font-semibold text-white">
                      {previewSettings.whatsapp.number
                        ? displayPhone(previewSettings.whatsapp.number)
                        : 'Chat with support'}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-white/10 px-4 py-3 text-center text-[11px] text-[#6B6B6B]">
                  WhatsApp card hidden {whatsappEnabled ? '— number/link missing or invalid' : '(disabled)'}
                </p>
              )}

              {previewSocials.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2.5">
                  {previewSocials.map((social) => (
                    <span
                      key={social.id}
                      title={social.platform === 'custom' ? social.label || 'Custom' : PLATFORM_LABELS[social.platform]}
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-[#181818] text-[#B3B3B3]"
                    >
                      <PlatformIcon platform={social.platform} className="h-4 w-4" />
                    </span>
                  ))}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-white/10 px-4 py-3 text-center text-[11px] text-[#6B6B6B]">
                  No social icons — nothing enabled, or every URL is invalid
                </p>
              )}
            </div>
            <p className="flex items-start gap-1.5 text-[10px] leading-snug text-[#6B6B6B]">
              <Globe className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              Public visitors see only enabled accounts with valid http(s) URLs. Disabled entries
              disappear instantly after the next save.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
