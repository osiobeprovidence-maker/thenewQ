/**
 * JOIN THE QUEUE — Honest test suite categorization.
 *
 * This file reports TRUE coverage status. Sections explicitly marked
 * [THIN] or [MOCKED] are coverage that looks like passing but does not
 * exercise the production code path end-to-end. They are NO LONGER reported
 * as if they were integration tests.
 *
 * Authoritative test blocks:
 *   [UNIT]                  — pure helpers inside functions/src (no network/DB)
 *   [MOCKED]                 — JS-only simulation of backend behaviour; verifies
 *                              our mental model, NOT the codebase. Zero backend
 *                              coverage. See test_webhook_fulfillment.sql for DB.
 *   [NEEDED-EXTERNAL]        — requires real Bachs sandbox + live DB; skipped here.
 *   [NOT-TESTED-HERE]        — backend paths exercised only via the Firebase
 *                              Emulator Suite (test_e2e_emulator.js).
 *
 * Do not advertise this file as "integration passing" elsewhere.
 */

const crypto = require('crypto');
const { verifyBachsWebhookSignature, getBachsApiBase } = require('./lib/index.js');

console.log('================================================================');
console.log('--- JOIN THE QUEUE — Webhook Crypto Unit Tests ---');
console.log('================================================================\n');

let passed = 0;
let failed = 0;
let skipped = 0;

function assert(category, description, condition, details) {
  if (condition) {
    console.log(`[PASS] [${category}] ${description}`);
    passed++;
  } else {
    console.error(`[FAIL] [${category}] ${description} ${details ? '-> ' + details : ''}`);
    failed++;
  }
}

function skip(category, description, reason) {
  console.log(`[SKIP] [${category}] ${description} — ${reason}`);
  skipped++;
}

const mockSecret = 'whsec_sandbox_test_secret_key_999';
const nowEpoch = Math.floor(Date.now() / 1000);

console.log('--- [UNIT] Webhook signature verification ---\n');

{
  const rawBody = JSON.stringify({ id: 'evt_unit_1', type: 'checkout.completed' });
  const timestamp = String(nowEpoch);
  const sig = crypto.createHmac('sha256', mockSecret).update(`${timestamp}.${rawBody}`).digest('hex');
  const res = verifyBachsWebhookSignature(rawBody, { 'x-bachs-signature': sig, 'x-bachs-timestamp': timestamp }, mockSecret);
  assert('UNIT', 'Verifies canonical HMAC-SHA256 signature with X-Bachs-Signature', res.isValid === true);
}

{
  const rawBody = JSON.stringify({ id: 'evt_unit_2', type: 'checkout.completed' });
  const timestamp = String(nowEpoch);
  const sig = crypto.createHmac('sha256', mockSecret).update(`${timestamp}.${rawBody}`).digest('hex');
  const res = verifyBachsWebhookSignature(rawBody, { 'x-bachs-signature-v2': `t=${timestamp},v1=${sig}` }, mockSecret);
  assert('UNIT', 'Verifies structured V2 header format (t=...,v1=...)', res.isValid === true);
}

{
  const rawBody = JSON.stringify({ id: 'evt_unit_3' });
  const oldTimestamp = String(nowEpoch - 305);
  const sig = crypto.createHmac('sha256', mockSecret).update(`${oldTimestamp}.${rawBody}`).digest('hex');
  const res = verifyBachsWebhookSignature(rawBody, { 'x-bachs-signature': sig, 'x-bachs-timestamp': oldTimestamp }, mockSecret);
  assert('UNIT', 'Rejects webhook delivery when timestamp is older than 300s window', res.isValid === false);
}

{
  process.env.BACHS_ENVIRONMENT = 'sandbox';
  assert('UNIT', 'Resolves sandbox API base URL when BACHS_ENVIRONMENT=sandbox', getBachsApiBase() === 'https://sandbox-api.bachs.io/v1');
  process.env.BACHS_ENVIRONMENT = 'production';
  assert('UNIT', 'Resolves production API base URL when BACHS_ENVIRONMENT=production', getBachsApiBase() === 'https://api.bachs.io/v1');
  delete process.env.BACHS_ENVIRONMENT;
  assert('UNIT', 'Defaults securely to sandbox API base URL if unset', getBachsApiBase() === 'https://sandbox-api.bachs.io/v1');
}

console.log('\n--- [INFLUENTIAL-MOCKS] Behaviour the real backend must replicate ---\n');

const db = {
  subscription_products: [
    { id: 'prod_music_premium', name: 'Music Premium', monthly_price: 15.00, currency: 'USD', is_active: true },
  ],
  slot_reservations: new Map(),
  slot_memberships: new Map(),
  processed_webhook_events: new Set(),
};

function createReservationMock(caller, requestData) {
  if (!caller) throw new Error('Unauthenticated');
  const product = db.subscription_products.find((p) => p.id === requestData.productId && p.is_active);
  if (!product) throw new Error('Active product not found');
  const expectedAmount = product.monthly_price;
  const expectedCurrency = product.currency;
  const reference = `JTQ-TEST-${Date.now()}`;
  const reservation = {
    id: `res_${Date.now()}`,
    productId: product.id,
    payerUserId: caller.uid,
    beneficiaryUserId: requestData.beneficiaryUserId || caller.uid,
    expectedAmount,
    expectedCurrency,
    reference,
    status: 'pending',
    expiresAt: Date.now() + 30 * 60 * 1000,
  };
  db.slot_reservations.set(reference, reservation);
  return { reservation, reference };
}

const caller = { uid: 'usr_payer_001', token: { email: 'payer@example.com' } };
const { reservation, reference } = createReservationMock(caller, {
  productId: 'prod_music_premium',
  beneficiaryUserId: 'usr_beneficiary_002',
  tamperedPrice: 1.0,
});

assert('MOCK', 'Reservation keeps DB price, ignores client price', reservation.expectedAmount === 15.00);
assert('MOCK', 'Beneficiary separate from payer', reservation.beneficiaryUserId === 'usr_beneficiary_002');

const { reference: validRef } = createReservationMock(caller, {
  productId: 'prod_music_premium',
});

function fulfillReservationMock(eventId, ref, verifiedAmount, verifiedCurrency, callerRole) {
  if (callerRole !== 'service_role') throw new Error('Unauthorized direct RPC execution');
  if (db.processed_webhook_events.has(eventId)) return { status: 'already_processed' };
  const res = db.slot_reservations.get(ref);
  if (!res) throw new Error('Reservation not found');
  if (res.status === 'fulfilled') return { status: 'already_fulfilled' };
  if (Date.now() > res.expiresAt) { res.status = 'expired'; throw new Error('Reservation has expired'); }
  if (res.expectedAmount !== verifiedAmount) throw new Error('Amount mismatch');
  if (res.expectedCurrency !== verifiedCurrency) throw new Error('Currency mismatch');
  res.status = 'fulfilled';
  db.slot_memberships.set(ref, { payerUserId: res.payerUserId, status: 'active' });
  db.processed_webhook_events.add(eventId);
  return { status: 'fulfilled' };
}

try { fulfillReservationMock('evt_1', validRef, 15.0, 'USD', 'authenticated'); } catch (e) {
  assert('MOCK', 'Only service_role may call fulfill', e.message.includes('Unauthorized'));
}

try { fulfillReservationMock('evt_2', validRef, 5.0, 'USD', 'service_role'); } catch (e) {
  assert('MOCK', 'Wrong amount rejected', e.message.includes('Amount mismatch'));
}

try { fulfillReservationMock('evt_3', validRef, 15.0, 'EUR', 'service_role'); } catch (e) {
  assert('MOCK', 'Wrong currency rejected', e.message.includes('Currency mismatch'));
}

const result = fulfillReservationMock('evt_success_1', validRef, 15.0, 'USD', 'service_role');
assert('MOCK', 'Happy path fulfill succeeds', result.status === 'fulfilled');

const dup = fulfillReservationMock('evt_success_1', validRef, 15.0, 'USD', 'service_role');
assert('MOCK', 'Duplicate event returns already_processed', dup.status === 'already_processed');

console.log('\n--- [NOT-TESTED-HERE] live integration cases ---\n');
skip('EXTERNAL', 'Real Bachs sandbox checkout + webhook round-trip', 'requires BACHS_SECRET_KEY + wired webhook endpoint');
skip('EXTERNAL', 'Callable createBachsCheckout with real Supabase service role', 'requires SUPABASE_SERVICE_ROLE_KEY');
skip('EXTERNAL', 'checkout.completed webhook signed with real Bachs secret', 'requires BACHS_WEBHOOK_SECRET');
skip('EXTERNAL', 'Live storefront plan fetch from Supabase', 'requires Supabase publishable key');
console.log('\nIntegration behaviour is exercised by test_e2e_emulator.js (Firebase emulator) and\ntest_webhook_fulfillment via the scratch Postgres container (run separately).\n');

console.log(`================================================================`);
console.log(`HONEST SUITE COMPLETE: ${passed} passed, ${failed} failed, ${skipped} skipped`);
console.log(`================================================================\n`);

if (failed > 0) process.exit(1);
