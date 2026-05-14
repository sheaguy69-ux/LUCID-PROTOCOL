// /portfolio — Portfolio Shield. Scans an EVM or Solana wallet's holdings for
// honeypots, rugs, drainers, and other risk patterns.
//
// Subcommands:
//   /portfolio <address> [chain?]      one-shot scan
//   /portfolio watch <address> [chain] subscribe to daily alerts (Pro+)
//   /portfolio list                    list watched wallets
//   /portfolio remove <address>        unsubscribe

const { scanWeb3Addresses, SOLANA_KEY } = require('../web3Scanner');
const {
  isAlchemyConfigured,
  getEvmTokenBalances,
  getEvmTokenMetadata,
  getSolanaTokenBalances,
} = require('../utils/alchemyClient');
const { isConfigured: isWalletHashConfigured } = require('../utils/walletHash');
const {
  addTrackedWallet,
  removeTrackedWallet,
  listTrackedWallets,
  countTrackedWallets,
  updateTrackedWalletScan,
} = require('../database');
const { getSubscriberTier } = require('../billing');

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const SOL_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;

const EVM_CHAINS = [1, 56, 137, 42161, 8453, 10, 43114];
const CHAIN_LABEL = {
  1: 'Ethereum', 56: 'BSC', 137: 'Polygon',
  42161: 'Arbitrum', 8453: 'Base', 10: 'Optimism', 43114: 'Avalanche',
  [SOLANA_KEY]: 'Solana',
};
const CHAIN_HINTS = {
  eth: 1, ethereum: 1,
  bsc: 56, bnb: 56, binance: 56,
  polygon: 137, matic: 137,
  arb: 42161, arbitrum: 42161,
  base: 8453,
  op: 10, optimism: 10,
  avax: 43114, avalanche: 43114,
  sol: SOLANA_KEY, solana: SOLANA_KEY, spl: SOLANA_KEY,
};

const FREE_DAILY_PORTFOLIO_LIMIT = 1;
const PRO_WATCH_LIMIT = 3;
const UNLIMITED_WATCH_LIMIT = 25;
const MAX_TOKENS_SCANNED_PER_CHAIN = 25;
const RISK_CHECK_CONCURRENCY = 5;

function detectKind(address) {
  if (EVM_ADDRESS_RE.test(address)) return 'evm';
  if (SOL_ADDRESS_RE.test(address)) return 'solana';
  return null;
}

function parseChainHint(token) {
  if (!token) return null;
  return CHAIN_HINTS[token.toLowerCase()] ?? null;
}

async function pLimit(items, concurrency, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function gatherEvmHoldings(address, chains) {
  const perChain = await Promise.all(
    chains.map(async (chainId) => {
      const balances = await getEvmTokenBalances(chainId, address);
      const limited = balances.slice(0, MAX_TOKENS_SCANNED_PER_CHAIN);
      return limited.map((b) => ({ ...b, chainId }));
    })
  );
  return perChain.flat();
}

async function gatherSolanaHoldings(address) {
  const tokens = await getSolanaTokenBalances(address);
  return tokens.slice(0, MAX_TOKENS_SCANNED_PER_CHAIN).map((t) => ({ ...t, chainId: SOLANA_KEY }));
}

function summarize(scans) {
  const counts = { critical: 0, high: 0, low: 0, none: 0 };
  for (const s of scans) {
    const lvl = s?.results?.[0]?.riskLevel || 'none';
    counts[lvl] = (counts[lvl] || 0) + 1;
  }
  const top = scans
    .filter((s) => s?.results?.[0])
    .map((s) => s.results[0])
    .filter((r) => r.riskLevel === 'critical' || r.riskLevel === 'high')
    .slice(0, 8);
  return { counts, top };
}

async function scanWallet(address, kind, chainHint) {
  let holdings;
  if (kind === 'solana' || chainHint === SOLANA_KEY) {
    holdings = await gatherSolanaHoldings(address);
  } else {
    const chains = chainHint ? [chainHint] : EVM_CHAINS;
    holdings = await gatherEvmHoldings(address, chains);
  }

  if (holdings.length === 0) {
    return { totalTokens: 0, scanned: 0, summary: { counts: {}, top: [] } };
  }

  const scans = await pLimit(holdings, RISK_CHECK_CONCURRENCY, (h) =>
    scanWeb3Addresses(h.contractAddress, h.chainId).catch(() => null)
  );

  return {
    totalTokens: holdings.length,
    scanned: scans.filter(Boolean).length,
    summary: summarize(scans),
  };
}

function formatScanReport(address, kind, result) {
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
  const lines = [
    `🛡 *Portfolio Shield* — \`${short}\` (${kind === 'solana' ? 'Solana' : 'EVM'})`,
    '',
    `Scanned ${result.scanned} of ${result.totalTokens} tokens`,
    '',
  ];
  const c = result.summary.counts || {};
  if (result.totalTokens === 0) {
    lines.push('_No token holdings detected on the scanned chain(s)._');
  } else {
    lines.push(`🚨 Critical: *${c.critical || 0}*  ⚠️ High: *${c.high || 0}*  ⚡ Low: *${c.low || 0}*  ✅ Safe: *${c.none || 0}*`);
    if (result.summary.top.length) {
      lines.push('', '*Top risks:*');
      for (const r of result.summary.top) {
        const icon = r.riskLevel === 'critical' ? '🚨' : '⚠️';
        const sym = r.tokenSecurity?.token_symbol || r.tokenSecurity?.metadata?.symbol || 'unknown';
        const sa = `${r.address.slice(0, 6)}…${r.address.slice(-4)}`;
        lines.push(`${icon} ${sym} (${r.chainName}) \`${sa}\``);
      }
    }
  }
  lines.push('', '_Powered by Aegis. Read-only scan — no signature required._');
  return lines.join('\n');
}

function buildUpsellWatch() {
  return [
    '🛡 *Portfolio Shield Watch*',
    '',
    'Subscribe a wallet to get a daily DM if any held token crosses Critical risk.',
    '',
    'Available on *Pro* ($8/mo, watch up to 3 wallets) and *Unlimited* ($17/mo, up to 25).',
    '',
    'Upgrade: /upgrade',
  ].join('\n');
}

async function getWatchLimit(userId) {
  const sub = await getSubscriberTier(userId).catch(() => null);
  const tier = sub?.tier;
  const status = sub?.status;
  if (status !== 'active' && status !== 'trialing') return 0;
  if (tier === 'unlimited') return UNLIMITED_WATCH_LIMIT;
  if (tier === 'pro') return PRO_WATCH_LIMIT;
  return 0;
}

async function handleScan(bot, msg, address, chainHint) {
  const kind = detectKind(address);
  if (!kind) {
    return bot.sendMessage(msg.chat.id, 'That doesn\'t look like a valid EVM (0x…) or Solana address.');
  }
  if (!isAlchemyConfigured()) {
    return bot.sendMessage(msg.chat.id, '🛡 Portfolio Shield is being set up — try again shortly.');
  }
  await bot.sendChatAction(msg.chat.id, 'typing');
  await bot.sendMessage(msg.chat.id, '🔎 Scanning wallet — this can take 10–30 seconds…');
  const result = await scanWallet(address, kind, chainHint);
  return bot.sendMessage(msg.chat.id, formatScanReport(address, kind, result), { parse_mode: 'Markdown' });
}

async function handleWatch(bot, msg, address, chainHint) {
  const userId = msg.from.id;
  const kind = detectKind(address);
  if (!kind) {
    return bot.sendMessage(msg.chat.id, 'That doesn\'t look like a valid EVM (0x…) or Solana address.');
  }
  if (!isWalletHashConfigured()) {
    return bot.sendMessage(
      msg.chat.id,
      '🛡 Portfolio Shield watch lists are being set up — try again shortly. (Operator: set `WALLET_HASH_SECRET` env to enable.)',
      { parse_mode: 'Markdown' }
    );
  }
  const watchLimit = await getWatchLimit(userId);
  if (watchLimit === 0) {
    return bot.sendMessage(msg.chat.id, buildUpsellWatch(), { parse_mode: 'Markdown' });
  }
  const current = await countTrackedWallets(userId);
  if (current >= watchLimit) {
    return bot.sendMessage(
      msg.chat.id,
      `You're already watching ${current} of ${watchLimit} wallets. Remove one with \`/portfolio remove <address>\` or upgrade for more slots.`,
      { parse_mode: 'Markdown' }
    );
  }
  const chain = kind === 'solana' || chainHint === SOLANA_KEY ? SOLANA_KEY : (chainHint || 'auto');
  const row = await addTrackedWallet({
    telegramUserId: userId,
    address,
    chain: String(chain),
  });
  if (!row) {
    return bot.sendMessage(msg.chat.id, '⚠️ Could not save the wallet to your watch list. Try again.');
  }
  return bot.sendMessage(
    msg.chat.id,
    `✅ Now watching \`${address}\` (${chain === 'auto' ? 'all EVM chains' : CHAIN_LABEL[chain] || chain}).\nYou'll get a daily DM if any held token crosses Critical risk.`,
    { parse_mode: 'Markdown' }
  );
}

async function handleList(bot, msg) {
  const wallets = await listTrackedWallets(msg.from.id);
  if (wallets.length === 0) {
    return bot.sendMessage(msg.chat.id, "You're not watching any wallets yet. Try `/portfolio watch <address>`.", { parse_mode: 'Markdown' });
  }
  const lines = [
    '🛡 *Your watched wallets*',
    '_(We store HMAC hashes only — not the raw addresses. Use your own labels to identify them.)_',
    '',
  ];
  for (const w of wallets) {
    const tag = w.label ? `"${w.label}"` : `wallet:${(w.address_hash || '').slice(0, 8)}`;
    const last = w.last_scanned_at ? new Date(w.last_scanned_at).toISOString().slice(0, 10) : 'never';
    lines.push(`• ${tag} — ${CHAIN_LABEL[w.chain] || w.chain} · last: ${last}`);
  }
  return bot.sendMessage(msg.chat.id, lines.join('\n'), { parse_mode: 'Markdown' });
}

async function handleRemove(bot, msg, address) {
  const removed = await removeTrackedWallet({ telegramUserId: msg.from.id, address });
  return bot.sendMessage(
    msg.chat.id,
    removed > 0 ? `✅ Removed ${removed} watch entry for \`${address}\`.` : `Nothing to remove for \`${address}\`.`,
    { parse_mode: 'Markdown' }
  );
}

function help() {
  return [
    '🛡 *Portfolio Shield*',
    '',
    'Scan a wallet for honeypots, rugs, drainers, and risky holdings — read-only, no signature.',
    '',
    '*Commands:*',
    '`/portfolio <address> [chain]`      one-shot scan',
    '`/portfolio watch <address> [chain]` daily alerts (Pro/Unlimited)',
    '`/portfolio list`                   list watched wallets',
    '`/portfolio remove <address>`       stop watching',
    '',
    '*Examples:*',
    '`/portfolio 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045`',
    '`/portfolio EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v sol`',
    '`/portfolio watch 0xd8dA… eth`',
  ].join('\n');
}

module.exports = function registerPortfolio(bot) {
  bot.onText(/^\/portfolio(?:@\w+)?(?:\s+([\s\S]+))?$/, async (msg, match) => {
    const args = (match && match[1] ? match[1].trim() : '').split(/\s+/).filter(Boolean);

    if (args.length === 0) {
      return bot.sendMessage(msg.chat.id, help(), { parse_mode: 'Markdown' });
    }

    const sub = args[0].toLowerCase();
    try {
      if (sub === 'list') return await handleList(bot, msg);
      if (sub === 'remove' || sub === 'unwatch') {
        const addr = args[1];
        if (!addr) return bot.sendMessage(msg.chat.id, 'Usage: `/portfolio remove <address>`', { parse_mode: 'Markdown' });
        return await handleRemove(bot, msg, addr);
      }
      if (sub === 'watch') {
        const addr = args[1];
        if (!addr) return bot.sendMessage(msg.chat.id, 'Usage: `/portfolio watch <address> [chain]`', { parse_mode: 'Markdown' });
        const hint = parseChainHint(args[2]);
        return await handleWatch(bot, msg, addr, hint);
      }
      // Default: treat first arg as address
      const addr = args[0];
      const hint = parseChainHint(args[1]);
      return await handleScan(bot, msg, addr, hint);
    } catch (err) {
      console.error('/portfolio error:', err.message);
      return bot.sendMessage(msg.chat.id, '⚠️ An error occurred during the wallet scan. Please try again.');
    }
  });
};

module.exports.scanWallet = scanWallet;
module.exports.formatScanReport = formatScanReport;
module.exports.updateTrackedWalletScan = updateTrackedWalletScan;
