const EVM_ADDRESS_RE = /\b(0x[a-fA-F0-9]{40})\b/g;

const CHAIN_MAP = {
  1: 'Ethereum',
  56: 'BSC',
  137: 'Polygon',
  42161: 'Arbitrum',
  8453: 'Base',
  10: 'Optimism',
  43114: 'Avalanche',
};

function inferChains(text) {
  const lower = text.toLowerCase();
  if (/\b(bsc|bnb|binance)\b/.test(lower)) return [56];
  if (/\b(polygon|matic)\b/.test(lower)) return [137];
  if (/\b(arbitrum|arb)\b/.test(lower)) return [42161];
  if (/\bbase\b/.test(lower)) return [8453];
  if (/\b(optimism|op)\b/.test(lower)) return [10];
  if (/\b(avalanche|avax)\b/.test(lower)) return [43114];
  return [1, 56];
}

function extractAddresses(text) {
  const seen = new Set();
  const results = [];
  for (const m of text.matchAll(EVM_ADDRESS_RE)) {
    const addr = m[1].toLowerCase();
    if (!seen.has(addr)) {
      seen.add(addr);
      results.push(addr);
    }
    if (results.length === 3) break;
  }
  return results;
}

async function checkTokenSecurity(address, chainId) {
  try {
    const res = await fetch(
      `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${address}`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.code !== 1) return null;
    const result = data.result?.[address];
    if (!result || Object.keys(result).length === 0) return null;
    return result;
  } catch {
    return null;
  }
}

async function checkAddressSecurity(address) {
  try {
    const res = await fetch(
      `https://api.gopluslabs.io/api/v1/address_security/${address}`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.code !== 1) return null;
    return data.result || null;
  } catch {
    return null;
  }
}

function flag(val) {
  return val === '1' || val === 1 || val === true;
}

function computeRiskLevel(tokenSec, addrSec, flags) {
  if (flags.isHoneypot || flags.isSanctioned || flags.isMaliciousContract) return 'critical';
  if (flags.isPhishing || flags.isStealingAttack || flags.hasHiddenOwner) return 'high';
  const sellTax = parseFloat(tokenSec?.sell_tax || '0');
  const buyTax = parseFloat(tokenSec?.buy_tax || '0');
  if (sellTax > 20 || buyTax > 20 || flag(tokenSec?.blacklist_function)) return 'low';
  return 'none';
}

async function scanWeb3Addresses(text, chainHint = null) {
  const addresses = extractAddresses(text);
  if (addresses.length === 0) return null;

  const chains = chainHint ? [chainHint] : inferChains(text);

  const results = await Promise.all(
    addresses.map(async (address) => {
      const chainChecks = await Promise.all(
        chains.map((chainId) => checkTokenSecurity(address, chainId))
      );

      const firstHit = chainChecks.findIndex((r) => r !== null);
      const tokenSecurity = firstHit !== -1 ? chainChecks[firstHit] : null;
      const resolvedChainId = firstHit !== -1 ? chains[firstHit] : chains[0];

      const addressSecurity = await checkAddressSecurity(address);

      const flags = {
        isHoneypot: flag(tokenSecurity?.is_honeypot),
        hasHiddenOwner: flag(tokenSecurity?.hidden_owner),
        hasSelfDestruct: flag(tokenSecurity?.selfdestruct),
        isMaliciousContract: flag(addressSecurity?.malicious_contract),
        isPhishing: flag(addressSecurity?.phishing_activities),
        isStealingAttack: flag(addressSecurity?.stealing_attack),
        isSanctioned: flag(addressSecurity?.sanctioned),
        isMaliciousWallet: flag(addressSecurity?.phishing_activities)
          || flag(addressSecurity?.stealing_attack)
          || flag(addressSecurity?.malicious_contract),
      };

      const riskLevel = computeRiskLevel(tokenSecurity, addressSecurity, flags);

      return {
        address,
        chainId: resolvedChainId,
        chainName: CHAIN_MAP[resolvedChainId] || `Chain ${resolvedChainId}`,
        tokenSecurity,
        addressSecurity,
        flags,
        riskLevel,
      };
    })
  );

  const honeypotDetected = results.some((r) => r.flags.isHoneypot);
  const maliciousWalletDetected = results.some((r) => r.flags.isMaliciousWallet);

  const riskOrder = { critical: 3, high: 2, low: 1, none: 0 };
  const highestRisk = results.reduce(
    (best, r) => (riskOrder[r.riskLevel] > riskOrder[best] ? r.riskLevel : best),
    'none'
  );

  return { addresses, results, highestRisk, honeypotDetected, maliciousWalletDetected };
}

module.exports = { scanWeb3Addresses, extractAddresses };
