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

/**
 * Claim Super Admin access for the two designated bootstrap accounts.
 * Self-service: the server verifies a Google-verified sign-in whose email is
 * in SUPER_ADMIN_EMAILS. Everyone else receives permission-denied.
 */
export async function bootstrapSuperAdmin() {
  const result = await callAdminFunction('bootstrapSuperAdmin', {});
  return /** @type {{ granted: boolean, alreadyGranted?: boolean, email?: string } | null} */ (result.data ?? null);
}

/**
 * Returns the caller's pending staff invitation (if any).
 * Returns { pending: false } for unauthenticated callers or errors — never leaks
 * whether an invitation exists for an arbitrary email.
 * @returns {Promise<{ pending: boolean, role?: 'admin' | 'support', invitationId?: string }>}
 */
export async function checkMyPendingStaffInvitation() {
  if (!app) return { pending: false };
  try {
    const result = await callAdminFunction('checkMyPendingStaffInvitation', {});
    return /** @type {{ pending: boolean, role?: 'admin' | 'support', invitationId?: string }} */ (result.data) ?? { pending: false };
  } catch (err) {
    console.warn('checkMyPendingStaffInvitation failed:', err);
    return { pending: false };
  }
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
