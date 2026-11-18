/**
 * Support & Socials central configuration.
 * Stored as a single JSONB row `support_socials` in the `app_settings` table.
 * Reads by anonymous clients; writes restricted to super/admin by RLS.
 */
import { auth } from './firebase.js';
import { supabase } from './supabase.js';

export type SocialPlatform =
  | 'instagram'
  | 'x'
  | 'facebook'
  | 'tiktok'
  | 'telegram'
  | 'youtube'
  | 'discord'
  | 'linkedin'
  | 'custom';

export interface SocialAccount {
  id: string;
  platform: SocialPlatform;
  /** Display label, required for custom, optional otherwise. */
  label?: string;
  url: string;
  enabled: boolean;
}

export interface SupportSocialsSettings {
  whatsapp: {
    enabled: boolean;
    /** Normalized digits-only number, e.g. "2348000000000". No leading +. */
    number: string;
    /** Optional full https URL (wa.me link or custom). Override or null/undefined. */
    customUrl?: string;
  };
  socials: SocialAccount[];
}

export const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  instagram: 'Instagram',
  x: 'X (Twitter)',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  telegram: 'Telegram',
  youtube: 'YouTube',
  discord: 'Discord',
  linkedin: 'LinkedIn',
  custom: 'Custom',
};

export const EMPTY_SUPPORT_SOCIALS: SupportSocialsSettings = {
  whatsapp: { enabled: false, number: '' },
  socials: [],
};

/** Normalise a phone number to digits-only wa.me form; reject if fewer than 7 digits. */
export function normalizePhoneNumber(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return digits;
}

/**
 * Format digits for display: split country code (everything beyond the last
 * 10 digits) from the national number, which is grouped 3-3-4.
 * e.g. "2348000000000" → "+234 800 000 0000"
 */
export function displayPhone(digits: string): string {
  const clean = digits.replace(/\D/g, '');
  if (!clean) return '';
  let cc = '';
  let rest = clean;
  if (clean.length > 10) {
    const ccLen = clean.length - 10;
    cc = clean.slice(0, ccLen);
    rest = clean.slice(ccLen);
  }
  const national = rest.match(/^(\d{3})(\d{3})(\d{4})$/);
  const nationalDisplay = national ? `${national[1]} ${national[2]} ${national[3]}` : rest;
  return cc ? `+${cc} ${nationalDisplay}` : `+${nationalDisplay}`;
}

/** Build the WhatsApp conversation URL from the stored config. */
export function resolveWhatsappUrl(settings: SupportSocialsSettings): string | null {
  const { enabled, number, customUrl } = settings.whatsapp;
  if (!enabled) return null;
  const trimmed = (customUrl ?? '').trim();
  if (trimmed && /^https?:\/\//i.test(trimmed)) return trimmed;
  if (!number) return null;
  return `https://wa.me/${number}`;
}

/** Convenience: has anything worth rendering been configured? */
export function hasRenderableSocials(settings: SupportSocialsSettings): boolean {
  return settings.socials.some((s) => s.enabled && isValidUrl(s.url));
}

export function isValidUrl(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  try {
    const parsed = new URL(v);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeSettings(raw: unknown): SupportSocialsSettings {
  if (!raw || typeof raw !== 'object') return EMPTY_SUPPORT_SOCIALS;
  const source = raw as Record<string, unknown>;
  const whatsappRaw = (source.whatsapp ?? {}) as Record<string, unknown>;
  const socialsRaw = Array.isArray(source.socials) ? source.socials : [];

  const numberRaw = typeof whatsappRaw.number === 'string' ? whatsappRaw.number : '';
  const normalized = /\D/.test(numberRaw) ? normalizePhoneNumber(numberRaw) : numberRaw;
  const customUrlRaw = typeof whatsappRaw.customUrl === 'string' ? whatsappRaw.customUrl.trim() : '';

  const socials: SocialAccount[] = [];
  for (const entry of socialsRaw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const platform = typeof e.platform === 'string' ? e.platform : 'custom';
    const allowed: SocialPlatform[] = [
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
    if (!allowed.includes(platform as SocialPlatform)) continue;
    const url = typeof e.url === 'string' ? e.url.trim() : '';
    if (!isValidUrl(url)) continue;
    const id = typeof e.id === 'string' && e.id ? e.id : `soc-${Math.random().toString(36).slice(2, 9)}`;
    const labelRaw = typeof e.label === 'string' ? e.label.trim() : '';
    const enabled = typeof e.enabled === 'boolean' ? e.enabled : true;
    const account: SocialAccount = { id, platform: platform as SocialPlatform, url, enabled };
    if (labelRaw) account.label = labelRaw;
    socials.push(account);
  }

  return {
    whatsapp: {
      enabled: Boolean(whatsappRaw.enabled),
      number: normalized ?? '',
      customUrl: customUrlRaw.length > 0 ? customUrlRaw : undefined,
    },
    socials,
  };
}

export async function getSupportSocials(): Promise<SupportSocialsSettings> {
  if (!supabase) return EMPTY_SUPPORT_SOCIALS;
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'support_socials')
      .maybeSingle();

    if (error || !data) return EMPTY_SUPPORT_SOCIALS;
    return normalizeSettings((data as { value?: unknown }).value);
  } catch (err) {
    console.warn('[settingsService] Failed to load support_socials:', err);
    return EMPTY_SUPPORT_SOCIALS;
  }
}

export async function saveSupportSocials(
  settings: SupportSocialsSettings
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!supabase) return { ok: false, error: 'Supabase client is not configured.' };

  // Client-side guard — the RLS policy is the real fence.
  const token = auth?.currentUser ? await auth.currentUser.getIdToken() : null;
  if (!token) return { ok: false, error: 'You must be signed in as a super admin to save settings.' };

  const sanitized = normalizeSettings(settings);

  try {
    const { error } = await supabase
      .from('app_settings')
      .upsert({ key: 'support_socials', value: sanitized }, { onConflict: 'key' });
    if (error) {
      console.warn('[settingsService] Save error:', error);
      return { ok: false, error: error.message ?? 'Could not save settings.' };
    }
    return { ok: true };
  } catch (err) {
    console.warn('[settingsService] Save exception:', err);
    return { ok: false, error: 'Save failed. Please try again.' };
  }
}
