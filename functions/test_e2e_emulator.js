/**
 * Local emulator end-to-end RBAC smoke test.
 * Runs ONLY against firebase emulators (project demo-jtsq-rbac-test).
 * Never touches production Firebase or production Supabase.
 */

const PROJECT = 'demo-jtsq-rbac-test';
const AUTH = `http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}`;
const AUTH_REST = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1`;
const FUNCTIONS_BASE = `http://127.0.0.1:5001/${PROJECT}/us-central1`;
const FIRESTORE = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;

let passed = 0;
let failed = 0;

function assert(description, condition, details) {
  if (condition) {
    console.log(`[PASS] ${description}`);
    passed++;
  } else {
    console.error(`[FAIL] ${description}${details ? ' -> ' + details : ''}`);
    failed++;
  }
}

async function json(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function rest(method, url, body, idToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await json(res) };
}

async function createPasswordUser(email, password, displayName) {
  const res = await rest('POST', `${AUTH_REST}/accounts:signUp?key=fake-api-key`, {
    email,
    password,
    returnSecureToken: true,
  });
  return res;
}

async function signInPassword(email, password) {
  return rest('POST', `${AUTH_REST}/accounts:signInWithPassword?key=fake-api-key`, {
    email,
    password,
    returnSecureToken: true,
  });
}

async function signInFakeGoogle(email, displayName) {
  // Firebase Auth Emulator parses (does not verify) fake Google ID tokens.
  const payload = Buffer.from(
    JSON.stringify({
      iss: 'https://accounts.google.com',
      sub: `google-${email}-${Date.now()}`,
      aud: 'fake-client-id.apps.googleusercontent.com',
      email,
      email_verified: true,
      name: displayName || email.split('@')[0],
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      firebase: { sign_in_provider: 'google.com', identities: { 'google.com': [`google-${email}`] }, sign_in_second_factor: null },
    })
  ).toString('base64url');
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const fakeIdToken = `${header}.${payload}.fakesig`;
  const res = await fetch(`${AUTH_REST}/accounts:signInWithIdp?key=fake-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      postBody: new URLSearchParams({ id_token: fakeIdToken, providerId: 'google.com' }).toString(),
      requestUri: 'https://localhost',
    }),
  });
  return { status: res.status, body: await json(res) };
}

function errStatus(body) {
  return body?.error?.status ?? null;
}

async function refreshIdToken(refreshToken) {
  const res = await fetch('http://127.0.0.1:9099/securetoken.googleapis.com/v1/token?key=fake-api-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
  });
  return { status: res.status, body: await json(res) };
}

async function callFunction(name, data, idToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(`${FUNCTIONS_BASE}/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ data }),
  });
  const body = await json(res);
  return { status: res.status, body };
}

async function setEmulatorUserClaims(uid, claims) {
  // Deterministic claim bootstrap for the designated super admin test path.
  const res = await fetch(
    `${AUTH}/accounts/update`,
    {
      method: 'POST',
      headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
      body: JSON.stringify({ localId: uid, customClaims: JSON.stringify(claims) }),
    }
  );
  return { status: res.status, body: await json(res) };
}

async function main() {
  console.log('=== RBAC EMULATOR E2E ===\n');

  // 1) Create a regular password user and ensure authentication role
  const regular = await createPasswordUser('regular@example.com', 'password123', 'Regular User');
  assert('Regular user can sign up in emulator', regular.status === 200 && regular.body.idToken, JSON.stringify(regular.body));

  const ensure1 = await callFunction('ensureAuthenticatedRole', {}, regular.body.idToken);
  assert('ensureAuthenticatedRole grants authenticated role (new user)',
    ensure1.body?.result?.role === 'authenticated' && ensure1.body?.result?.claimUpdated === true,
    JSON.stringify(ensure1.body));

  const ensure2 = await callFunction('ensureAuthenticatedRole', {}, regular.body.idToken);
  assert('ensureAuthenticatedRole idempotent on second call',
    ensure2.body?.result?.claimUpdated === false,
    JSON.stringify(ensure2.body));

  // 2) bootstrapSuperAdmin with NON-designated (password) account → denied
  const denied = await callFunction('bootstrapSuperAdmin', {}, regular.body.idToken);
  assert('Non-Google / non-designated account denied bootstrap',
    errStatus(denied.body)==='PERMISSION_DENIED',
    JSON.stringify(denied.body));

  // 3) Fake Google sign-in as designated super admin
  const googleSuper = await signInFakeGoogle('riderezzy@gmail.com', 'Super Admin');
  assert('Designated account can fake-Google sign in (emulator)',
    googleSuper.status === 200 && googleSuper.body.idToken,
    JSON.stringify(googleSuper.body));

  const freshSuper = async () => {
    const refresh = await refreshIdToken(googleSuper.body.refreshToken);
    assert('Super-admin token refresh works', refresh.status === 200 && refresh.body.id_token, JSON.stringify(refresh.body));
    return refresh.body.id_token;
  };

  const bootstrap1 = await callFunction('bootstrapSuperAdmin', {}, await freshSuper());
  assert('Designated riderezzy@gmail.com granted superAdmin',
    bootstrap1.body?.result?.granted === true && bootstrap1.body?.result?.alreadyGranted === false,
    JSON.stringify(bootstrap1.body));

  const bootstrap2 = await callFunction('bootstrapSuperAdmin', {}, await freshSuper());
  assert('Bootstrap idempotent — second call reports alreadyGranted',
    bootstrap2.body?.result?.alreadyGranted === true,
    JSON.stringify(bootstrap2.body));

  // 4) Second designated account
  const googleSuper2 = await signInFakeGoogle('osiobeprovidence@gmail.com', 'Super Admin Two');
  const bootstrap3 = await callFunction('bootstrapSuperAdmin', {}, googleSuper2.body.idToken);
  assert('Second designated account granted superAdmin',
    bootstrap3.body?.result?.granted === true,
    JSON.stringify(bootstrap3.body));

  // 5) Ordinary Google account (not on allowlist) → denied
  const outsider = await signInFakeGoogle('outsider@example.com', 'Outsider');
  const bootstrap4 = await callFunction('bootstrapSuperAdmin', {}, outsider.body.idToken);
  assert('Non-designated Google account denied bootstrap',
    errStatus(bootstrap4.body)==='PERMISSION_DENIED',
    JSON.stringify(bootstrap4.body));

  const superUid = googleSuper.body.localId || googleSuper.body.user_id;

  // 6) Create staff invitation as super admin
  const invite = await callFunction('createAdminInvitation', {
    email: 'support@example.com',
    role: 'support',
    note: 'Test invite',
  }, await freshSuper());
  assert('Super admin can create support invitation',
    invite.body?.result?.role === 'support' && invite.body?.result?.status === 'pending',
    JSON.stringify(invite.body));

  const inviteBogus = await callFunction('createAdminInvitation', {
    email: 'bogus',
    role: 'admin',
  }, await freshSuper());
  assert('Invalid invitation email rejected',
    errStatus(inviteBogus.body)==='INVALID_ARGUMENT',
    JSON.stringify(inviteBogus.body));

  const inviteBadRole = await callFunction('createAdminInvitation', {
    email: 'admin@example.com',
    role: 'superAdmin',
  }, await freshSuper());
  assert('superAdmin role not grantable via invitation',
    errStatus(inviteBadRole.body)==='INVALID_ARGUMENT',
    JSON.stringify(inviteBadRole.body));

  // 7) Non-super-admin cannot create invitations
  const deniedInvite = await callFunction('createAdminInvitation', {
    email: 'sneaky@example.com',
    role: 'support',
  }, regular.body.idToken);
  assert('Regular user cannot create invitations',
    errStatus(deniedInvite.body)==='PERMISSION_DENIED',
    JSON.stringify(deniedInvite.body));

  // 8) Support redeems invitation
  const supportSignIn = await signInFakeGoogle('support@example.com', 'Support Staff');
  const redeem1 = await callFunction('redeemAdminInvitation', {}, supportSignIn.body.idToken);
  assert('Invited staff can redeem invitation and receive support claim',
    redeem1.body?.result?.granted === true && redeem1.body?.result?.role === 'support',
    JSON.stringify(redeem1.body));

  const redeem2 = await callFunction('redeemAdminInvitation', {}, supportSignIn.body.idToken);
  assert('Invitation cannot be redeemed twice',
    errStatus(redeem2.body)==='FAILED_PRECONDITION',
    JSON.stringify(redeem2.body));

  // 9) listAdminInvitations requires superAdmin
  const listDenied = await callFunction('listAdminInvitations', {}, regular.body.idToken);
  assert('Regular user cannot list invitations',
    errStatus(listDenied.body)==='PERMISSION_DENIED',
    JSON.stringify(listDenied.body));

  const listOk = await callFunction('listAdminInvitations', {}, await freshSuper());
  assert('Super admin can list invitations',
    Array.isArray(listOk.body?.result?.invitations) && listOk.body.result.invitations.length >= 1,
    JSON.stringify(listOk.body));

  // 10) listStaffUsers requires superAdmin
  const staffDenied = await callFunction('listStaffUsers', {}, regular.body.idToken);
  assert('Regular user cannot list staff users',
    errStatus(staffDenied.body)==='PERMISSION_DENIED',
    JSON.stringify(staffDenied.body));

  const staffOk = await callFunction('listStaffUsers', {}, await freshSuper());
  assert('Super admin can list staff users',
    Array.isArray(staffOk.body?.result?.staff) && staffOk.body.result.staff.some((u) => u.email === 'riderezzy@gmail.com'),
    JSON.stringify(staffOk.body));

  // 11) revokeAdminAccess — cannot self-revoke
  const selfRevoke = await callFunction('revokeAdminAccess', {
    targetUid: superUid,
    role: 'admin',
  }, await freshSuper());
  assert('Super admin cannot revoke own access',
    errStatus(selfRevoke.body)==='INVALID_ARGUMENT',
    JSON.stringify(selfRevoke.body));

  // 12) Redeeming for a second path then revoking
  const adminInvite = await callFunction('createAdminInvitation', {
    email: 'admin@example.com',
    role: 'admin',
  }, await freshSuper());
  assert('Super admin can create admin invitation',
    adminInvite.body?.result?.role === 'admin',
    JSON.stringify(adminInvite.body));

  const adminSignIn = await signInFakeGoogle('admin@example.com', 'Admin Two');
  const adminRedeem = await callFunction('redeemAdminInvitation', {}, adminSignIn.body.idToken);
  assert('Invited admin can redeem invitation',
    adminRedeem.body?.result?.role === 'admin',
    JSON.stringify(adminRedeem.body));

  // Fetch the staff directory AFTER the admin invitation was redeemed so the new row exists
  const staffAfter = await callFunction('listStaffUsers', {}, await freshSuper());
  const staff = staffAfter.body?.result?.staff ?? [];
  const adminUser = staff.find((u) => u.email === 'admin@example.com');

  const revokeAdmin = await callFunction('revokeAdminAccess', {
    targetUid: adminUser?.uid,
    role: 'admin',
  }, await freshSuper());
  assert('Super admin can revoke invited admin',
    revokeAdmin.body?.result?.revoked === true,
    JSON.stringify(revokeAdmin.body));

  // 13) listAdminAuditLog accessible by superAdmin and admin, not regular user
  const auditSuper = await callFunction('listAdminAuditLog', {}, await freshSuper());
  assert('Super admin can read audit log',
    Array.isArray(auditSuper.body?.result?.entries) && auditSuper.body.result.entries.length >= 1,
    JSON.stringify(auditSuper.body));

  const auditDenied = await callFunction('listAdminAuditLog', {}, regular.body.idToken);
  assert('Regular user cannot read audit log',
    errStatus(auditDenied.body)==='PERMISSION_DENIED',
    JSON.stringify(auditDenied.body));

  // 14) setAdminClaim — superAdmin only
  const setAsRegular = await callFunction('setAdminClaim', {
    targetUid: superUid,
    admin: false,
  }, regular.body.idToken);
  assert('Regular user cannot call setAdminClaim',
    errStatus(setAsRegular.body)==='PERMISSION_DENIED',
    JSON.stringify(setAsRegular.body));

  const setAsSuper = await callFunction('setAdminClaim', {
    targetUid: superUid,
    admin: true,
  }, await freshSuper());
  assert('Super admin can toggle admin claim',
    setAsSuper.body?.result?.success === true,
    JSON.stringify(setAsSuper.body));

  // Restore super admin claim (harmless in emulator)
  await setEmulatorUserClaims(superUid, { role: 'authenticated', superAdmin: true, admin: true });

  // 15) External price safety — createBachsCheckout without Supabase creds fails-closed
  const checkoutNoEnv = await callFunction('createBachsCheckout', {
    productId: '00000000-0000-0000-0000-000000000000',
    beneficiaryUserId: 'uid',
  }, regular.body.idToken);
  assert('createBachsCheckout fails closed without Supabase config',
    errStatus(checkoutNoEnv.body)==='FAILED_PRECONDITION',
    JSON.stringify(checkoutNoEnv.body));

  // 16) Unauthenticated caller rejected
  const noAuth = await callFunction('bootstrapSuperAdmin', {}, null);
  assert('Unauthenticated caller rejected by bootstrap',
    errStatus(noAuth.body)==='UNAUTHENTICATED',
    JSON.stringify(noAuth.body));

  // 17) Webhook rejects bad signature
  const webhookRes = await fetch(`${FUNCTIONS_BASE}/bachsWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-bachs-signature': 'deadbeef', 'x-bachs-timestamp': String(Math.floor(Date.now() / 1000)) },
    body: JSON.stringify({ id: 'evt_1', type: 'checkout.completed', data: { checkout_id: 'cs_fake' } }),
  });
  assert('bachsWebhook rejects invalid signature', webhookRes.status === 400, `status ${webhookRes.status}`);

  const strangerInvite = await callFunction('createAdminInvitation', { email: 'nope@example.com', role: 'admin' }, outsider.body.idToken);
  assert('Non-super-admin Google account cannot create invitations',
    errStatus(strangerInvite.body)==='PERMISSION_DENIED',
    JSON.stringify(strangerInvite.body));

  console.log('\n==============================');
  console.log(` RESULT: ${passed} passed, ${failed} failed`);
  console.log('==============================');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Harness crashed:', err);
  process.exit(1);
});
