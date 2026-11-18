/**
 * Central validation for the frontend environment.
 *
 * The app must never crash with an unstyled white screen because of a missing
 * build-time variable. This module reports WHICH variables are missing or still
 * hold placeholder values — never the values themselves — so the UI can render a
 * friendly configuration screen instead of throwing at import time.
 */

export interface FrontendConfig {
  firebaseApiKey: string;
  firebaseAuthDomain: string;
  firebaseProjectId: string;
  firebaseAppId: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
}

export type FrontendConfigResult =
  | { ok: true; config: FrontendConfig }
  | { ok: false; missing: string[] };

export type EnvironmentMap = Record<string, string | undefined>;

export const REQUIRED_FRONTEND_VARIABLES = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
] as const;

export type RequiredFrontendVariable = (typeof REQUIRED_FRONTEND_VARIABLES)[number];

const PLACEHOLDER_PATTERN = /replace[_-]with|your[_-]?(firebase|supabase|project)|placeholder/i;

function isMissing(value: string | undefined): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  return trimmed.length === 0 || PLACEHOLDER_PATTERN.test(trimmed);
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Validates an environment map. Pure and side-effect free so it can be unit
 * tested with fixtures later. Returns only variable NAMES in the failure case.
 */
export function validateFrontendConfig(env: EnvironmentMap): FrontendConfigResult {
  const missing = REQUIRED_FRONTEND_VARIABLES.filter((name) => isMissing(env[name]));

  // Light format check on the Supabase URL so malformed values surface early.
  const supabaseUrl = env.VITE_SUPABASE_URL?.trim() ?? '';
  if (!isMissing(supabaseUrl) && !isHttpUrl(supabaseUrl)) {
    if (!missing.includes('VITE_SUPABASE_URL')) {
      missing.push('VITE_SUPABASE_URL');
    }
  }

  if (missing.length > 0) {
    return { ok: false, missing };
  }

  return {
    ok: true,
    config: {
      firebaseApiKey: env.VITE_FIREBASE_API_KEY!.trim(),
      firebaseAuthDomain: env.VITE_FIREBASE_AUTH_DOMAIN!.trim(),
      firebaseProjectId: env.VITE_FIREBASE_PROJECT_ID!.trim(),
      firebaseAppId: env.VITE_FIREBASE_APP_ID!.trim(),
      supabaseUrl,
      supabasePublishableKey: env.VITE_SUPABASE_PUBLISHABLE_KEY!.trim(),
    },
  };
}

let cachedResult: FrontendConfigResult | null = null;

/**
 * Validates the live build-time environment exactly once per page load.
 */
export function getFrontendConfig(): FrontendConfigResult {
  if (!cachedResult) {
    cachedResult = validateFrontendConfig(import.meta.env as unknown as EnvironmentMap);
  }
  return cachedResult;
}
