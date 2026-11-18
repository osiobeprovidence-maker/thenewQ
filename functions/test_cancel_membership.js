/**
 * Fail-closed cancellation tests (no DB creds available locally).
 * Run in isolation — not against prod.
 */
const PROJECT = 'demo-jtsq-rbac-test';
const AUTH_REST = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const FUNCTIONS_BASE = `http://127.0.0.1:5001/${PROJECT}/us-central1`;

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

async function rest(method, url, body, idToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function signInPassword(email, password) {
  const res = await fetch(`${AUTH_REST}/accounts:signInWithPassword?key=fake-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  return res.json();
}

async function signUp(email, password) {
  const res = await fetch(`${AUTH_REST}/accounts:signUp?key=fake-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  return res.json();
}

async function callFunction(name, data, idToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const res = await fetch(`${FUNCTIONS_BASE}/${name}`, { method: 'POST', headers, body: JSON.stringify({ data }) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

(async () => {
  console.log('=== cancelMyMembership emulator tests ===\n');

  const u = await signUp('cancel@example.com', 'password123');
  assert('user signed up', !!u.idToken);

  // unauthenticated — no token
  const noAuth = await callFunction('cancelMyMembership', { membershipId: 'abcd' });
  assert('unauthenticated caller rejected', noAuth.body?.error?.status === 'UNAUTHENTICATED', JSON.stringify(noAuth.body));

  // missing both ids
  const noRef = await callFunction('cancelMyMembership', {}, u.idToken);
  assert('missing args rejected', noRef.body?.error?.status === 'INVALID_ARGUMENT', JSON.stringify(noRef.body));

  // no Supabase configured — fail-closed successful pass-through with persisted: false
  const res = await callFunction('cancelMyMembership', { referenceId: 'JTQ-TEST' }, u.idToken);
  assert('Supabase not configured — returns persisted:false (fail-closed)', res.body?.result?.persisted === false, JSON.stringify(res.body));

  assert('callable result does not leak secrets', JSON.stringify(res.body).indexOf('SERVICE_ROLE_KEY') === -1);

  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('Harness crashed:', err);
  process.exit(1);
});
