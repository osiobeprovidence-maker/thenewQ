/**
 * Phase 0 — Admin RBAC unit test suite.
 * Verifies the pure decision logic behind the super admin bootstrap,
 * invitation lifecycle and claim-merge helpers in ./lib/index.js.
 * Run: node test_admin_rbac.js
 */

const {
  SUPER_ADMIN_EMAILS,
  normalizeEmail,
  isGoogleVerifiedAccount,
  isBootstrapSuperAdminEmail,
  parseStaffRole,
  isValidInvitationEmail,
  mergeClaimsForGrant,
  mergeClaimsForRevoke,
  generateInvitationCode,
} = require('./lib/index.js');

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

console.log('========================================');
console.log(' ADMIN RBAC — PURE LOGIC UNIT TESTS');
console.log('========================================\n');

// ---------- Super admin bootstrap ----------
console.log('--- Super admin bootstrap (designated accounts) ---');
assert('Allowlist contains exactly the two designated emails',
  Array.isArray(SUPER_ADMIN_EMAILS)
    && SUPER_ADMIN_EMAILS.length === 2
    && SUPER_ADMIN_EMAILS.includes('riderezzy@gmail.com')
    && SUPER_ADMIN_EMAILS.includes('osiobeprovidence@gmail.com'));

assert('Bootstrap: riderezzy@gmail.com is eligible', isBootstrapSuperAdminEmail('riderezzy@gmail.com') === true);
assert('Bootstrap: osiobeprovidence@gmail.com is eligible', isBootstrapSuperAdminEmail('osiobeprovidence@gmail.com') === true);
assert('Bootstrap: comparison is case-insensitive', isBootstrapSuperAdminEmail('  RIDEREZZY@gmail.com ') === true);
assert('Bootstrap: ordinary Gmail is rejected', isBootstrapSuperAdminEmail('someone.else@gmail.com') === false);
assert('Bootstrap: admin-sounding lookalike is rejected', isBootstrapSuperAdminEmail('riderezzy@gmail.com.evil.com') === false);
assert('Bootstrap: empty / garbage rejected', isBootstrapSuperAdminEmail('') === false && isBootstrapSuperAdminEmail(undefined) === false && isBootstrapSuperAdminEmail(123) === false);

// ---------- Google-verified identity ----------
console.log('\n--- Google verified identity checks ---');
const googleVerified = { email: 'riderezzy@gmail.com', email_verified: true, firebase: { sign_in_provider: 'google.com' } };
const passwordProvider = { email: 'riderezzy@gmail.com', email_verified: true, firebase: { sign_in_provider: 'password' } };
const unverifiedGoogle = { email: 'riderezzy@gmail.com', email_verified: false, firebase: { sign_in_provider: 'google.com' } };
const noEmailVerified = { email: 'riderezzy@gmail.com', firebase: { sign_in_provider: 'google.com' } };
const missingEmail = { email_verified: true, firebase: { sign_in_provider: 'google.com' } };
const anonymous = { email: '', email_verified: false, firebase: { sign_in_provider: 'anonymous' } };

assert('Verified Google identity accepted', isGoogleVerifiedAccount(googleVerified) === true);
assert('Password provider is rejected (must be Google)', isGoogleVerifiedAccount(passwordProvider) === false);
assert('Unverified Google email is rejected', isGoogleVerifiedAccount(unverifiedGoogle) === false);
assert('Missing email_verified claim is rejected', isGoogleVerifiedAccount(noEmailVerified) === false);
assert('Missing email is rejected', isGoogleVerifiedAccount(missingEmail) === false);
assert('Anonymous sign-in is rejected', isGoogleVerifiedAccount(anonymous) === false);
assert('Email is normalized (case/whitespace)', normalizeEmail('  A@B.com ') === 'a@b.com');

// ---------- Invitation validation ----------
console.log('\n--- Invitation role and email validation ---');
assert('Role: admin is valid', parseStaffRole('admin') === 'admin');
assert('Role: support is valid', parseStaffRole('support') === 'support');
assert('Role: superAdmin is NOT grantable by invitation', parseStaffRole('superAdmin') === null);
assert('Role: arbitrary string rejected', parseStaffRole('root') === null && parseStaffRole('') === null && parseStaffRole(undefined) === null);
assert('Email: normal address accepted', isValidInvitationEmail('staff@example.com') === true);
assert('Email: address without TLD rejected', isValidInvitationEmail('staff@example') === false);
assert('Email: empty / malformed rejected', isValidInvitationEmail('') === false && isValidInvitationEmail('a@b.c') === false && isValidInvitationEmail('not-an-email') === false);

assert('Invitation code format INV-XXXX-XXXX', (() => {
  const code = generateInvitationCode();
  return /^INV-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(code);
})());
assert('Invitation codes are unique across samples', new Set(Array.from({ length: 200 }, generateInvitationCode)).size > 190);

// ---------- Claim merge helpers ----------
console.log('\n--- Claim merge helpers (grant / revoke) ---');
const base = { role: 'authenticated', sign2: 'keep-me' };

const grantAdmin = mergeClaimsForGrant({ ...base, sign2: 'keep-me' }, 'admin');
assert('Grant admin: sets admin true', grantAdmin.admin === true);
assert('Grant admin: preserves unrelated claims', grantAdmin.sign2 === 'keep-me');
assert('Grant admin: guarantees baseline role claim', grantAdmin.role === 'authenticated');

const grantSupport = mergeClaimsForGrant({ ...base }, 'support');
assert('Grant support: sets support true only', grantSupport.support === true && grantSupport.admin !== true);
assert('Grant support: preserves superAdmin if somehow present', mergeClaimsForGrant({ superAdmin: true }, 'support').superAdmin === true);

const grantSuper = mergeClaimsForGrant({ ...base }, 'superAdmin');
assert('Grant superAdmin: sets superAdmin and admin true', grantSuper.superAdmin === true && grantSuper.admin === true);
assert('Grant superAdmin: does not touch support', grantSuper.support === undefined);

const grantAdminPreservesSuper = mergeClaimsForGrant({ superAdmin: true, admin: false }, 'admin');
assert('Grant admin: re-enabling admin never clears superAdmin', grantAdminPreservesSuper.superAdmin === true && grantAdminPreservesSuper.admin === true);

const revokeAdmin = mergeClaimsForRevoke({ role: 'authenticated', admin: true, support: true, sign2: 'keep-me' }, 'admin');
assert('Revoke admin: clears admin only', revokeAdmin.admin === false);
assert('Revoke admin: support claim untouched', revokeAdmin.support === true);
assert('Revoke admin: unrelated claims preserved', revokeAdmin.sign2 === 'keep-me');

const revokeSupport = mergeClaimsForRevoke({ role: 'authenticated', admin: true, support: true }, 'support');
assert('Revoke support: clears support only', revokeSupport.support === false && revokeSupport.admin === true);

const revokeAdminKeepsSuper = mergeClaimsForRevoke({ role: 'authenticated', admin: false, superAdmin: true }, 'admin');
assert('Revoke admin: never clears superAdmin (bootstrap-only)', revokeAdminKeepsSuper.superAdmin === true);

console.log('\n========================================');
console.log(` RESULT: ${passed} passed, ${failed} failed`);
console.log('========================================');
process.exit(failed === 0 ? 0 : 1);
