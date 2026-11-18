# Firebase Functions

`ensureAuthenticatedRole` is a callable Firebase Cloud Function that assigns the
baseline `role: authenticated` custom claim to the signed-in, non-anonymous caller.
The callable does not accept a UID, so a client cannot set claims for another user.
It rejects disabled accounts, preserves unrelated custom claims, and is idempotent
when the role is already present. The role is an authentication baseline, not an
administrator or elevated-privilege role.

Firebase Functions uses the project's managed service account through Application
Default Credentials. Do not add a service-account JSON file or private key to this
repository or to any `VITE_*` variable.

## Deploy

1. Install the Firebase CLI and authenticate with an account authorized for the
   Firebase project.
2. From the project root, run `firebase use --add` and select the intended project.
   The repository intentionally has no project alias.
3. Install and build the backend with `npm --prefix functions install` and
   `npm --prefix functions run build`.
4. Deploy only this function with
   `firebase deploy --only functions:ensureAuthenticatedRole`.

The function is configured for `us-central1` and Node.js 22. The deploy command runs
the TypeScript build as a predeploy check. No deployment or credential access is
performed as part of this change.

## Use after sign-in

After an existing or new Firebase user signs in, invoke the frontend helper:

```js
import { ensureAuthenticatedRoleAndRefreshToken } from './lib/firebaseClaims.js';

const idToken = await ensureAuthenticatedRoleAndRefreshToken();
```

The helper only calls the authenticated server function; claim assignment remains
exclusively in Firebase Admin SDK code. It forces `getIdToken(true)` after the
callable completes, then checks the refreshed token result for `sub === user.uid`
and `role === 'authenticated'`. Supabase's configured `accessToken` callback can
then obtain the refreshed Firebase ID token.

## Verify

For an authenticated user, the helper's successful return verifies the ID token
claims using Firebase Auth's `getIdTokenResult()`. To inspect them directly:

```js
const user = auth.currentUser;
const { claims } = await user.getIdTokenResult();

console.log(claims.sub === user.uid); // true
console.log(claims.role === 'authenticated'); // true
```

Do not paste ID tokens into public token-inspection websites. Supabase must also be
configured to trust the Firebase project as a third-party auth provider, and its
tables must retain restrictive Row Level Security policies.
