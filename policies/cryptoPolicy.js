'use strict';

// Known legitimate crypto platforms — high scores on these are likely false positives
const SAFE_DOMAINS = [
  'coinbase.com', 'binance.com', 'kraken.com', 'coinmarketcap.com',
  'coingecko.com', 'etherscan.io', 'bscscan.com', 'opensea.io',
  'uniswap.org', 'aave.com', 'compound.finance', 'metamask.io',
];

// Signals that strongly indicate wallet drainer attacks
const WALLET_DRAINER_SIGNALS = [
  'connect wallet', 'connect your wallet', 'seed phrase', 'recovery phrase',
  '12 words', '24 words', 'mnemonic', 'private key', 'import wallet',
  'wallet verification', 'verify your wallet',
];

// Signals that strongly indicate rug pull schemes
const RUG_PULL_SIGNALS = [
  'presale', 'pre-sale', 'whitelist', 'no audit', 'anonymous team',
  'doxxed', 'locked liquidity', 'renounced', 'stealth launch',
  'fair launch', 'community token', 'based dev',
];

// Urgency language used to pressure victims
const URGENCY_SIGNALS = [
  'act now', 'limited time', 'expires soon', 'only today', 'last chance',
  'filling up fast', 'spots remaining', 'hurry', 'urgent', 'dont miss',
  "don't miss", 'ending soon',
];

/**
 * Reviews a scan result for crypto-specific threat patterns.
 * Returns an array of violation objects.
 */
function reviewCryptoThreats(result, context = {}) {
  const violations = [];
  const input = (context.input || '').toLowerCase();
  const indicators = (result.indicators || []).map((i) => i.toLowerCase()).join(' ');
  const allText = `${input} ${indicators}`;

  // 1. Wallet drainer: requesting wallet access + urgency or external link
  const hasWalletSignal = WALLET_DRAINER_SIGNALS.some((s) => input.includes(s));
  const hasUrgency = URGENCY_SIGNALS.some((s) => allText.includes(s));
  const hasExternalUrl = !!result.virusTotalResult; // VT was called = URL was present

  if (hasWalletSignal && result.riskScore >= 5) {
    violations.push({
      rule: 'WALLET_DRAINER_PATTERN',
      severity: hasUrgency || hasExternalUrl ? 'critical' : 'warning',
      message:
        'Wallet access request detected. Never share your seed phrase or connect your wallet to unknown sites.',
    });
  }

  // 2. Standalone seed phrase / private key solicitation (always critical)
  const seedSignals = ['seed phrase', 'recovery phrase', '12 words', '24 words', 'mnemonic', 'private key'];
  if (seedSignals.some((s) => input.includes(s))) {
    violations.push({
      rule: 'SEED_PHRASE_SOLICITATION',
      severity: 'critical',
      message: 'Content requests seed phrase or private key. This is always a scam — never share these.',
    });
  }

  // 3. Rug pull combo: multiple signals present at moderate-to-high risk
  const rugCount = RUG_PULL_SIGNALS.filter((s) => allText.includes(s)).length;
  if (rugCount >= 2 && result.riskScore >= 5) {
    violations.push({
      rule: 'RUG_PULL_PATTERN',
      severity: 'warning',
      message: `Rug pull indicators detected (${rugCount} signals). Verify team identity, audit status, and liquidity locks before investing.`,
    });
  }

  // 4. False positive guard: known-safe domain with high risk score
  if (result.virusTotalResult && result.virusTotalResult.malicious === 0 && result.riskScore > 7) {
    if (SAFE_DOMAINS.some((domain) => input.includes(domain))) {
      violations.push({
        rule: 'KNOWN_SAFE_DOMAIN_OVERRIDE',
        severity: 'warning',
        message:
          'High risk score assigned to a known legitimate domain. This may be a false positive — review the full context.',
      });
    }
  }

  return violations;
}

module.exports = { reviewCryptoThreats };
