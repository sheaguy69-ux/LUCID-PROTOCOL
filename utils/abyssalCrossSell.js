/**
 * Abyssal Cross-Sell Cards — shown in scan results to upsell the deep layer
 *
 * Target: free-tier users who just performed a crypto-relevant scan.
 * Tier-gated: paid users (abyssal_active) don't see these.
 *
 * Each build* function now accepts an optional userId to check tier.
 * If the user already has abyssal_active, returns null (caller should skip).
 */

const { getSubscriberTier } = require('../billing');

/**
 * Check if a user should see cross-sell cards.
 * Returns true if the user is NOT on abyssal_active tier.
 */
async function shouldShowCrossSell(userId) {
  try {
    const sub = await getSubscriberTier(userId);
    return sub.tier !== 'abyssal_active';
  } catch (_) {
    return false;
  }
}

/**
 * Card shown after a contract/wallet scan — strongest signal to cross-sell.
 * Returns null if user is already on abyssal_active tier.
 */
async function buildContractCrossSell(userId) {
  if (userId && !(await shouldShowCrossSell(userId))) {
    return null;
  }

  return [
    '🌊 *Going Deeper — Abyssal*',
    '',
    'ScamShield scans the _surface_.',
    'Abyssal guards the _deep_.',
    '',
    '🧿 Real-time on-chain monitoring for your LP pools.',
    '🧿 Detect suspicious activity targeting your positions.',
    '🧿 Commission-only: you only pay when we save you.',
    '',
    '`/abyssal` to learn more.',
    '_Guard the Deep._',
  ].join('\n');
}

/**
 * Card shown after any scan result — softer upsell.
 * Returns null if user is already on abyssal_active tier.
 */
async function buildScanCrossSell(userId) {
  if (userId && !(await shouldShowCrossSell(userId))) {
    return null;
  }

  return [
    '🛡 *ScamShield → Abyssal*',
    '',
    'We protect the surface.',
    'Abyssal protects what\'s underneath.',
    '',
    '→ Real-time on-chain monitoring for DeFi pools',
    '→ Detect suspicious transactions targeting your LPs',
    '→ Pay only on value saved (17% commission)',
    '',
    '`/abyssal` — _Guard the Deep._',
  ].join('\n');
}

module.exports = {
  buildContractCrossSell,
  buildScanCrossSell,
};
