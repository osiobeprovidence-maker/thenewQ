import { getApps, initializeApp } from 'firebase/app';
import { getAuth, browserLocalPersistence, setPersistence } from 'firebase/auth';
import { getFrontendConfig } from './config';

/**
 * Firebase initialization is fail-safe: when configuration is missing the module
 * must never throw at import time (that produced a blank screen). Instead it
 * exports `app`/`auth` as null and reports the missing variable NAMES via
 * `firebaseConfigError`. `src/main.tsx` renders a configuration screen in that
 * state and the application tree is never mounted.
 */
const configResult = getFrontendConfig();

export const firebaseConfigError = configResult.ok
  ? null
  : configResult.missing.filter((name) => name.startsWith('VITE_FIREBASE_'));

/**
 * Typed as the configured instance: when configuration is invalid these are
 * `null` at runtime, but the application tree (including every consumer below)
 * is never mounted — `src/main.tsx` renders <ConfigErrorScreen/> first.
 * @type {import('firebase/app').FirebaseApp}
 */
export const app = configResult.ok
  ? getApps().find((existingApp) => existingApp.name === '[DEFAULT]') ??
    initializeApp({
      apiKey: configResult.config.firebaseApiKey,
      authDomain: configResult.config.firebaseAuthDomain,
      projectId: configResult.config.firebaseProjectId,
      appId: configResult.config.firebaseAppId,
    })
  : /** @type {any} */ (null);

/** @type {import('firebase/auth').Auth} */
export const auth = app ? getAuth(app) : /** @type {any} */ (null);

// Explicitly set persistence to avoid cross-tab IndexedDB DB_TIMEOUT polling errors.
// browserLocalPersistence uses localStorage which is more reliable across tabs
// than the default indexedDB cross-tab sync mechanism.
if (auth) {
  setPersistence(auth, browserLocalPersistence).catch((err) => {
    console.warn('[Firebase] Could not set auth persistence:', err);
  });
}
