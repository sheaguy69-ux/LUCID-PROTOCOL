const COINGECKO_PLATFORM = {
  1:        'ethereum',
  56:       'binance-smart-chain',
  137:      'polygon-pos',
  42161:    'arbitrum-one',
  8453:     'base',
  10:       'optimistic-ethereum',
  43114:    'avalanche',
  solana:   'solana',
};

async function fetchMarketData(address, chainId) {
  const platform = COINGECKO_PLATFORM[chainId];
  if (!platform) return null;

  try {
    const url =
      `https://api.coingecko.com/api/v3/simple/token_price/${platform}` +
      `?contract_addresses=${address.toLowerCase()}` +
      `&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true`;

    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;

    const data = await res.json();
    const entry = data[address.toLowerCase()];
    if (!entry || entry.usd == null) return null;

    return {
      price:     entry.usd          ?? null,
      marketCap: entry.usd_market_cap ?? null,
      volume24h: entry.usd_24h_vol  ?? null,
      change24h: entry.usd_24h_change ?? null,
    };
  } catch {
    return null;
  }
}

module.exports = { fetchMarketData };
