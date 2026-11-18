import { createClient } from '@supabase/supabase-js';
import { auth } from './firebase.js';
import { getFrontendConfig } from './config';

/**
 * Supabase initialization is fail-safe: missing configuration must not throw at
 * import time. The client is only consumed by `src/App.tsx` and
 * `src/context/AuthContext.tsx`, which are never mounted when configuration is
 * invalid (see `src/main.tsx`).
 */
const configResult = getFrontendConfig();

export const supabaseConfigError = configResult.ok
  ? null
  : configResult.missing.filter((name) => name.startsWith('VITE_SUPABASE_'));

/**
 * Typed as the configured client: when configuration is invalid this is `null`
 * at runtime, but every consumer lives under <App/>, which is never mounted
 * without valid configuration (see `src/main.tsx`).
 * @type {import('@supabase/supabase-js').SupabaseClient}
 */
export const supabase = configResult.ok
  ? createClient(configResult.config.supabaseUrl, configResult.config.supabasePublishableKey, {
      accessToken: async () => {
        const currentUser = auth.currentUser;
        return currentUser ? currentUser.getIdToken() : null;
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    })
  : /** @type {any} */ (null);
