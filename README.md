# JOIN THE QUEUE

A frontend subscription queue prototype built with React, TypeScript, and Vite.
The existing UI uses in-memory demo data; its admin and support views are local
previews, not secure authentication.

## Run locally

**Prerequisite:** Node.js

1. Install dependencies: `npm install`
2. Start the development server: `npm run dev`
3. Create a production build: `npm run build`

All changes made in the demo are held in browser memory and reset when the page is
reloaded.

## Firebase and Supabase client configuration

The optional client modules are in `src/lib/firebase.js` and `src/lib/supabase.js`.
Copy `.env.example` to `.env.local`, then replace all six placeholders with the
Firebase web-app configuration, Supabase project URL, and Supabase publishable key.
`.env.local` is ignored by Git. These values configure browser clients; never put a
Supabase secret/service-role key or Firebase Admin credential in a `VITE_*` variable.

Supabase requests use the current Firebase user's ID token. Supabase Auth is not used
for user sign-in, and the existing demo UI is not wired to a real sign-in flow.
Configure Firebase Auth providers in the Firebase console before implementing a
sign-in UI.

### Firebase custom claim for Supabase

The callable Cloud Function in `functions/src/index.ts` assigns
`role: authenticated` to the signed-in, non-anonymous caller. It preserves unrelated
custom claims and uses the managed Firebase Admin SDK credentials on the server.
Never set this claim in frontend code or place Firebase Admin credentials in Vite
environment variables.

After Firebase sign-in, call
`ensureAuthenticatedRoleAndRefreshToken()` from `src/lib/firebaseClaims.js`. It invokes
the callable, forces an ID-token refresh, and checks that `sub` equals the Firebase
UID and `role` is `authenticated`. This supports existing users as well as new users
once the application invokes the helper after sign-in.

See `functions/README.md` for deployment and verification steps. Deployment requires
selecting the correct Firebase project; it is not performed by this setup.

Keep Row Level Security enabled for every Supabase table and define restrictive
policies before using database data. This project contains no Supabase schema or
migrations, and this setup does not create or change tables or policies.
