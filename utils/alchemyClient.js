// Thin Alchemy Token-API wrapper. Uses fetch + the JSON-RPC interface so we
// don't take on the alchemy-sdk dependency. ALCHEMY_API_KEY env var required.

const ALCHEMY_HOSTS = {
  1:        'eth-mainnet',
  56:       'bnb-mainnet',
  137:      'polygon-mainnet',
  42161:    'arb-mainnet',
  8453:     'base-mainnet',
  10:       'opt-mainnet',
  43114:    'avax-mainnet',
  solana:   'solana-mainnet',
};

function alchemyUrl(chain) {
  const host = ALCHEMY_HOSTS[chain];
  if (!host) return null;
  const key = process.env.ALCHEMY_API_KEY;
  if (!key) return null;
  return `https://${host}.g.alchemy.com/v2/${key}`;
}

async function rpc(chain, method, params) {
  const url = alchemyUrl(chain);
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.error) return null;
    return json.result;
  } catch {
    return null;
  }
}

// EVM: returns [{contractAddress, balance: bigint}, ...] for non-zero ERC-20 holdings.
async function getEvmTokenBalances(chainId, address) {
  const result = await rpc(chainId, 'alchemy_getTokenBalances', [address, 'erc20']);
  if (!result?.tokenBalances) return [];
  return result.tokenBalances
    .filter((t) => t.tokenBalance && t.tokenBalance !== '0x' && BigInt(t.tokenBalance) > 0n)
    .map((t) => ({
      contractAddress: t.contractAddress.toLowerCase(),
      balance: BigInt(t.tokenBalance),
    }));
}

async function getEvmTokenMetadata(chainId, contractAddress) {
  const result = await rpc(chainId, 'alchemy_getTokenMetadata', [contractAddress]);
  if (!result) return null;
  return {
    name: result.name || null,
    symbol: result.symbol || null,
    decimals: typeof result.decimals === 'number' ? result.decimals : null,
    logo: result.logo || null,
  };
}

// Solana: list token accounts for an owner. Returns [{mint, amount, decimals}, ...]
async function getSolanaTokenBalances(ownerAddress) {
  const result = await rpc('solana', 'getTokenAccountsByOwner', [
    ownerAddress,
    { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
    { encoding: 'jsonParsed' },
  ]);
  if (!result?.value) return [];
  return result.value
    .map((acc) => {
      const info = acc.account?.data?.parsed?.info;
      const amt = info?.tokenAmount;
      if (!info || !amt) return null;
      const ui = parseFloat(amt.uiAmountString || '0');
      if (!ui || ui <= 0) return null;
      return {
        contractAddress: info.mint,
        balance: BigInt(amt.amount || '0'),
        decimals: amt.decimals,
        uiAmount: ui,
      };
    })
    .filter(Boolean);
}

function isAlchemyConfigured() {
  return !!process.env.ALCHEMY_API_KEY;
}

module.exports = {
  ALCHEMY_HOSTS,
  isAlchemyConfigured,
  getEvmTokenBalances,
  getEvmTokenMetadata,
  getSolanaTokenBalances,
};
