const { fetchMarketData } = require('./utils/marketData');

const EVM_ADDRESS_RE = /\b(0x[a-fA-F0-9]{40})\b/g;
// Solana base58 mint addresses encode 32 bytes → 43–44 chars. Excludes 0/O/I/l.
const SOL_ADDRESS_RE = /\b([1-9A-HJ-NP-Za-km-z]{43,44})\b/g;

const SOLANA_KEY = 'solana';

const CHAIN_MAP = {
  1: 'Ethereum',
  56: 'BSC',
  137: 'Polygon',
  42161: 'Arbitrum',
  8453: 'Base',
  10: 'Optimism',
  43114: 'Avalanche',
  [SOLANA_KEY]: 'Solana',
};

function inferChains(text) {
  const lower = text.toLowerCase();
  if (/\b(sol|solana|spl)\b/.test(lower)) return [SOLANA_KEY];
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
      results.push({ address: addr, kind: 'evm' });
    }
    if (results.length === 3) return results;
  }

  for (const m of text.matchAll(SOL_ADDRESS_RE)) {
    const addr = m[1];
    if (!seen.has(addr)) {
      seen.add(addr);
      results.push({ address: addr, kind: 'solana' });
    }
    if (results.length === 3) return results;
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

async function checkSolanaTokenSecurity(address) {
  try {
    const res = await fetch(
      `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${address}`,
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

function flag(val) {
  return val === '1' || val === 1 || val === true;
}

// GoPlus Solana shape varies per field — some are { status: '0'|'1' }, some are scalar.
function statusFlag(field) {
  if (field == null) return false;
  if (typeof field === 'object') return flag(field.status);
  return flag(field);
}

function topHolderShare(sol) {
  if (!Array.isArray(sol?.holders) || sol.holders.length === 0) return 0;
  const pct = parseFloat(sol.holders[0]?.percent || '0');
  return Number.isFinite(pct) ? pct : 0;
}

function lpLockedOrBurned(sol) {
  if (!Array.isArray(sol?.lp_holders) || sol.lp_holders.length === 0) return false;
  return sol.lp_holders.some((h) => flag(h.is_locked));
}

function buildSolanaFlags(sol) {
  if (!sol) return null;
  // Honeypot equivalent on Solana: token can't be transferred or accounts default-frozen.
  const nonTransferable = statusFlag(sol.non_transferable);
  const defaultFrozen = (sol.default_account_state || '').toLowerCase() === 'frozen';
  const isHoneypot = nonTransferable || defaultFrozen;

  const freezable = statusFlag(sol.freezable);
  const mintable = statusFlag(sol.mintable);
  const closable = statusFlag(sol.closable);
  const metaMutable = statusFlag(sol.metadata_mutable);
  const balanceMutable = statusFlag(sol.balance_mutable_authority);
  const transferHook = statusFlag(sol.transfer_hook);
  const top = topHolderShare(sol);
  const lpLocked = lpLockedOrBurned(sol);

  return {
    isHoneypot,
    hasHiddenOwner: mintable || freezable,
    hasSelfDestruct: closable,
    isMaliciousContract: false,
    isPhishing: false,
    isStealingAttack: false,
    isSanctioned: false,
    isMaliciousWallet: false,
    // Solana-specific (consumers can ignore unknown keys)
    sol: {
      mintable,
      freezable,
      closable,
      metaMutable,
      balanceMutable,
      transferHook,
      defaultFrozen,
      nonTransferable,
      topHolderPercent: top,
      lpLockedOrBurned: lpLocked,
      trustedToken: flag(sol.trusted_token),
      transferFeePercent: parseFloat(sol.transfer_fee?.transfer_fee_bps || '0') / 100,
    },
  };
}

function computeSolanaRisk(flags) {
  const s = flags.sol;
  if (!s) return 'none';
  if (flags.isHoneypot) return 'critical';
  if (s.freezable && !s.trustedToken) return 'high';
  if (s.closable && !s.trustedToken) return 'high';
  if (s.topHolderPercent > 80 && !s.trustedToken) return 'high';
  if (s.mintable && !s.trustedToken) return 'low';
  if (s.topHolderPercent > 50 && !s.trustedToken) return 'low';
  if (s.transferFeePercent > 10) return 'low';
  return 'none';
}

function computeRiskLevel(tokenSec, addrSec, flags) {
  if (flags.isHoneypot || flags.isSanctioned || flags.isMaliciousContract) return 'critical';
  if (flags.isPhishing || flags.isStealingAttack || flags.hasHiddenOwner) return 'high';
  const sellTax = parseFloat(tokenSec?.sell_tax || '0');
  const buyTax = parseFloat(tokenSec?.buy_tax || '0');
  if (sellTax > 20 || buyTax > 20 || flag(tokenSec?.blacklist_function)) return 'low';
  return 'none';
}

async function scanEvmAddress(address, chains) {
  const chainChecks = await Promise.all(
    chains.map((chainId) => checkTokenSecurity(address, chainId))
  );
  const firstHit = chainChecks.findIndex((r) => r !== null);
  const tokenSecurity = firstHit !== -1 ? chainChecks[firstHit] : null;
  const resolvedChainId = firstHit !== -1 ? chains[firstHit] : chains[0];

  const [addressSecurity, marketData] = await Promise.all([
    checkAddressSecurity(address),
    tokenSecurity ? fetchMarketData(address, resolvedChainId) : null,
  ]);

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

  return {
    address,
    chainId: resolvedChainId,
    chainName: CHAIN_MAP[resolvedChainId] || `Chain ${resolvedChainId}`,
    tokenSecurity,
    addressSecurity,
    marketData,
    flags,
    riskLevel: computeRiskLevel(tokenSecurity, addressSecurity, flags),
  };
}

async function scanSolanaAddress(address) {
  const sol = await checkSolanaTokenSecurity(address);
  if (!sol) {
    return {
      address,
      chainId: SOLANA_KEY,
      chainName: 'Solana',
      tokenSecurity: null,
      addressSecurity: null,
      marketData: null,
      flags: null,
      riskLevel: 'none',
    };
  }
  const flags = buildSolanaFlags(sol);
  const marketData = await fetchMarketData(address, SOLANA_KEY);
  return {
    address,
    chainId: SOLANA_KEY,
    chainName: 'Solana',
    tokenSecurity: sol,
    addressSecurity: null,
    marketData,
    flags,
    riskLevel: computeSolanaRisk(flags),
  };
}

async function scanWeb3Addresses(text, chainHint = null) {
  const tagged = extractAddresses(text);
  if (tagged.length === 0) return null;

  const evmChains = chainHint && chainHint !== SOLANA_KEY ? [chainHint] : inferChains(text).filter((c) => c !== SOLANA_KEY);
  const evmDefault = evmChains.length ? evmChains : [1, 56];

  const results = await Promise.all(
    tagged.map(({ address, kind }) => {
      if (kind === 'solana' || chainHint === SOLANA_KEY) {
        return scanSolanaAddress(address);
      }
      return scanEvmAddress(address, evmDefault);
    })
  );

  const honeypotDetected = results.some((r) => r.flags?.isHoneypot);
  const maliciousWalletDetected = results.some((r) => r.flags?.isMaliciousWallet);

  const riskOrder = { critical: 3, high: 2, low: 1, none: 0 };
  const highestRisk = results.reduce(
    (best, r) => (riskOrder[r.riskLevel] > riskOrder[best] ? r.riskLevel : best),
    'none'
  );

  return {
    addresses: tagged.map((t) => t.address),
    results,
    highestRisk,
    honeypotDetected,
    maliciousWalletDetected,
  };
}

module.exports = { scanWeb3Addresses, extractAddresses, SOLANA_KEY };
