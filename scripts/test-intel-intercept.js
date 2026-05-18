#!/usr/bin/env node
// Smoke test: fire a fake high-risk intercept into threat-intel DB.
// Prereq: THREAT_INTEL_URL + THREAT_INTEL_SERVICE_KEY set in .env
//
// Usage:  node scripts/test-intel-intercept.js
//
// Expected: one row in raw_intercepts (status=pending) within 2s.
// Re-run same day -> second call returns { ok:false, reason:'duplicate' }.

require('dotenv').config();
const { fireIntercept, RISK_THRESHOLD } = require('../intelClient');

const FAKE_SCAM = `🚀 GUARANTEED 100% PROFIT! Send 0.1 ETH to
0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef and receive 0.5 ETH back
instantly. Limited slots — act now! http://scam-test-${Date.now()}.example`;

(async () => {
  console.log(`[test] threshold = ${RISK_THRESHOLD}`);
  console.log('[test] firing high-risk intercept...');

  const t0 = Date.now();
  const result = await fireIntercept({
    rawText: FAKE_SCAM,
    urls: [`http://scam-test-${Date.now()}.example`],
    contracts: ['0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'],
    risk: 9,
    sourceProduct: 'lucidprotocol_tg',
    userId: 'smoke-test-user',
    mediaType: 'text',
  });
  const elapsed = Date.now() - t0;

  console.log(`[test] result (${elapsed}ms):`, result);

  if (!result.ok) {
    console.log(`[test] NOT OK: ${result.reason}`);
    if (result.reason === 'client_disabled') {
      console.log('[test] -> check THREAT_INTEL_URL + THREAT_INTEL_SERVICE_KEY in .env');
    }
    process.exit(1);
  }

  console.log('[test] PASS — intercept row inserted. Verify in Supabase dashboard:');
  console.log('[test]   https://supabase.com/dashboard/project/kociyrlnqlnqxgwqvvga/editor');

  // Below-threshold test
  console.log('[test] firing low-risk (should be skipped by threshold)...');
  const low = await fireIntercept({
    rawText: 'boring message',
    risk: 2,
    sourceProduct: 'lucidprotocol_tg',
    userId: 'smoke-test-user',
  });
  console.log('[test] low-risk result:', low);
  if (low.ok) {
    console.log('[test] FAIL — below-threshold should NOT insert');
    process.exit(1);
  }

  console.log('[test] ALL CHECKS PASSED');
})();
