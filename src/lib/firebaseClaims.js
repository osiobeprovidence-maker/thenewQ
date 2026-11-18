import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, auth } from './firebase.js';

/**
 * Lazily created so importing this module never throws when Firebase config is
 * missing — the app then renders the configuration screen instead of crashing.
 */
let functionsInstance = null;
const getFunctionsInstance = () => {
  if (!functionsInstance) {
    if (!app) {
      throw new Error('Firebase is not configured. Cannot reach Cloud Functions.');
    }
    functionsInstance = getFunctions(app, 'us-central1');
  }
  return functionsInstance;
};

/** Calls a backend callable with a consistent error surface. */
export async function callAdminFunction(name, data) {
  if (!app) {
    throw new Error('Firebase is not configured. Cannot call administrative functions.');
  }
  return httpsCallable(getFunctionsInstance(), name)(data);
}

export async function ensureAuthenticatedRoleAndRefreshToken() {
  if (!auth) {
    throw new Error('Firebase is not configured. Cannot sync the role claim.');
  }
  const user = auth.currentUser;
  if (!user) {
    throw new Error('A signed-in Firebase user is required to sync the role claim.');
  }

  try {
    await httpsCallable(getFunctionsInstance(), 'ensureAuthenticatedRole')({});
  } catch (error) {
    // If the Cloud Function is not yet deployed or fails, log warning but don't hard crash the app
    console.warn('ensureAuthenticatedRole Cloud Function call skipped or failed:', error);
  }

  if (auth.currentUser?.uid !== user.uid) {
    throw new Error('The active Firebase user changed while syncing the role claim.');
  }

  return getCurrentClaims();
}

/**
 * Forces a token refresh and returns the full claim set.
 * Used after redemptions/revocations so UI reflects new claims immediately.
 */
export async function refreshCurrentUserClaims() {
  if (!auth) {
    throw new Error('Firebase is not configured. Cannot refresh claims.');
  }
  const user = auth.currentUser;
  if (!user) {
    throw new Error('A signed-in Firebase user is required to refresh claims.');
  }
  await user.getIdToken(true);
  return getCurrentClaims();
}

async function getCurrentClaims() {
  const user = auth.currentUser;
  const idTokenResult = await user.getIdTokenResult();
  const claims = idTokenResult.claims ?? {};

  return {
    idToken: await user.getIdToken(),
    isAdmin: claims.admin === true,
    isSuperAdmin: claims.superAdmin === true,
    isSupport: claims.support === true,
    role: claims.role || 'authenticated',
  };
}

export async function setAdminUserPermission(targetUid, admin) {
  if (!app) {
    throw new Error('Firebase is not configured. Cannot call Cloud Functions.');
  }
  return httpsCallable(getFunctionsInstance(), 'setAdminClaim')({ targetUid, admin });
}
