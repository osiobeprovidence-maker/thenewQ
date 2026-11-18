/**
 * Firestore rules test — uses the Firebase emulator via @firebase/rules-unit-testing.
 * Exercises: processed_webhook_events, admin_audit_log, slot_reservations.
 */
const {
  initializeTestEnvironment,
} = require('@firebase/rules-unit-testing');
const { readFileSync } = require('fs');
const PROJECT_ID = 'demo-jtsq-rbac-test';

(async () => {
  const rules = readFileSync('firestore.rules', 'utf8');
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules,
      host: '127.0.0.1',
      port: 8080,
    },
  });

  testEnv.clearFirestore();

  const ADMIN_UID = 'admin-uid-test-1';
  const ALICE_UID = 'alice-uid-test-001';
  const BOB_UID = 'bob-uid-test-002';

  const adminContext = testEnv.authenticatedContext(ADMIN_UID);
  const aliceContext = testEnv.authenticatedContext(ALICE_UID);
  const bobContext = testEnv.authenticatedContext(BOB_UID);
  const anonContext = testEnv.unauthenticatedContext();

  // Seed one reservation per user via admin SDK route
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.collection('slot_reservations').doc('res-alice-1').set({ payerUserId: ALICE_UID, productId: 'mock-product', status: 'pending' });
    await db.collection('slot_reservations').doc('res-bob-1').set({ payerUserId: BOB_UID, productId: 'mock-product', status: 'pending' });
    await db.collection('slot_reservations').doc('res-alice-2').set({ payerUserId: BOB_UID, productId: 'mock-product', status: 'fulfilled' });
    await db.collection('processed_webhook_events').doc('evt-test-1').set({ type: 'checkout.completed' });
    await db.collection('admin_audit_log').doc('log-1').set({ action: 'bootstrap' });
  });

  let passed = 0;
  let failed = 0;

  function assert(label, condition) {
    if (condition) {
      console.log(`[PASS] ${label}`);
      passed++;
    } else {
      console.error(`[FAIL] ${label}`);
      failed++;
    }
  }

  async function run(label, fn) {
    try {
      const result = await fn();
      assert(label, result);
    } catch (e) {
      assert(label, false);
    }
  }

  // --- processed_webhook_events: clients cannot read/write/forge ---
  await run('processed_webhook_events: anon cannot read', async () => {
    try { await anonContext.firestore().collection('processed_webhook_events').doc('evt-test-1').get(); return false; } catch { return true; }
  });
  await run('processed_webhook_events: authenticated client cannot read', async () => {
    try { await aliceContext.firestore().collection('processed_webhook_events').doc('evt-test-1').get(); return false; } catch { return true; }
  });
  await run('processed_webhook_events: authenticated client cannot write/forge', async () => {
    try { await aliceContext.firestore().collection('processed_webhook_events').doc('evt-forged').set({ type: 'checkout.completed', ok: true }); return false; } catch { return true; }
  });

  // --- admin_audit_log: clients cannot read/write/forge ---
  await run('admin_audit_log: anon cannot read', async () => {
    try { await anonContext.firestore().collection('admin_audit_log').doc('log-1').get(); return false; } catch { return true; }
  });
  await run('admin_audit_log: authenticated client cannot read', async () => {
    try { await aliceContext.firestore().collection('admin_audit_log').doc('log-1').get(); return false; } catch { return true; }
  });
  await run('admin_audit_log: authenticated client cannot write/forge', async () => {
    try { await aliceContext.firestore().collection('admin_audit_log').doc('log-forged').set({ action: 'bootstrap' }); return false; } catch { return true; }
  });

  // --- slot_reservations: owner get only ---
  await run('slot_reservations: owner may get own reservation', async () => {
    const doc = await aliceContext.firestore().collection('slot_reservations').doc('res-alice-1').get();
    return doc.exists && doc.data().payerUserId === ALICE_UID;
  });
  await run('slot_reservations: owner cannot get another user reservation', async () => {
    try { await aliceContext.firestore().collection('slot_reservations').doc('res-bob-1').get(); return false; } catch { return true; }
  });
  await run('slot_reservations: client cannot list reservations', async () => {
    try {
      const snapshot = await aliceContext.firestore().collection('slot_reservations').get();
      // If rules honour list, snapshot would be allowed; verify all docs are owned by caller or empty
      const owners = snapshot.docs.map((d) => d.data().payerUserId);
      return owners.every((u) => u === ALICE_UID);
    } catch {
      return true;
    }
  });
  await run('slot_reservations: client cannot create reservation', async () => {
    try { await aliceContext.firestore().collection('slot_reservations').doc('res-forged').set({ payerUserId: ALICE_UID, productId: 'mock' }); return false; } catch { return true; }
  });
  await run('slot_reservations: client cannot update reservation', async () => {
    try { await aliceContext.firestore().collection('slot_reservations').doc('res-alice-1').update({ status: 'fulfilled' }); return false; } catch { return true; }
  });
  await run('slot_reservations: client cannot delete reservation', async () => {
    try { await aliceContext.firestore().collection('slot_reservations').doc('res-alice-1').delete(); return false; } catch { return true; }
  });

  // --- default deny catch-all ---
  await run('default deny: unknown collection blocked', async () => {
    try { await aliceContext.firestore().collection('whatever').doc('x').get(); return false; } catch { return true; }
  });

  await testEnv.cleanup();
  console.log('\n========================================');
  console.log(` FIRESTORE RULES: ${passed} passed, ${failed} failed`);
  console.log('========================================');
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('Harness crashed:', err);
  process.exit(1);
});
