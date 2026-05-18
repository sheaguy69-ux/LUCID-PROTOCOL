#!/usr/bin/env node
/**
 * Lucid Protocol — Daily TikTok Content Engine
 *
 * Runs every morning. Pulls the most hyped tokens on DexScreener,
 * scans each with GoPlus, picks the most scandalous result, and
 * fires a ready-to-film TikTok script to Anthony's Telegram.
 *
 * Usage:  node scripts/daily-content.js
 * PM2:    pm2 start scripts/daily-content.js --name content-engine --cron "0 9 * * *" --no-autorestart
 */

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');

const ANTHONY_CHAT_ID = 1989311996;
const BOT_TOKEN       = process.env.TELEGRAM_BOT_TOKEN;
const ANTHROPIC_KEY   = process.env.ANTHROPIC_API_KEY;

// ─── DexScreener ─────────────────────────────────────────────────────────────

async function getTrendingTokens() {
  // Top boosted = most actively hyped right now = highest drama potential
  const res = await fetch('https://api.dexscreener.com/token-boosts/top/v1', {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`DexScreener ${res.status}`);
  const data = await res.json();
  // Returns array of { tokenAddress, chainId, description, links, ... }
  return (Array.isArray(data) ? data : []).slice(0, 10);
}

async function getDexTokenInfo(chainId, tokenAddress) {
  const res = await fetch(
    `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
    { signal: AbortSignal.timeout(10_000) }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const pair = data?.pairs?.[0];
  if (!pair) return null;
  return {
    name:       pair.baseToken?.name  ?? 'Unknown',
    symbol:     pair.baseToken?.symbol ?? '???',
    priceUsd:   pair.priceUsd ?? '?',
    volume24h:  pair.volume?.h24 ?? 0,
    priceChange: pair.priceChange?.h24 ?? 0,
    txns24h:    (pair.txns?.h24?.buys ?? 0) + (pair.txns?.h24?.sells ?? 0),
    dexUrl:     pair.url ?? '',
    liquidity:  pair.liquidity?.usd ?? 0,
  };
}

// ─── GoPlus ──────────────────────────────────────────────────────────────────

const CHAIN_ID_MAP = {
  ethereum: 1, eth: 1,
  bsc: 56, bnb: 56, binance: 56,
  polygon: 137, matic: 137,
  arbitrum: 42161,
  base: 8453,
  optimism: 10,
  avalanche: 43114, avax: 43114,
  solana: 'solana', sol: 'solana',
};

function resolveChainId(chainId) {
  if (!chainId) return 1;
  const key = String(chainId).toLowerCase();
  return CHAIN_ID_MAP[key] ?? 1;
}

function flag(val) { return val === '1' || val === 1 || val === true; }

async function goplusScan(address, chainId) {
  const chain = resolveChainId(chainId);
  const isSolana = chain === 'solana';
  const url = isSolana
    ? `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${address}`
    : `https://api.gopluslabs.io/api/v1/token_security/${chain}?contract_addresses=${address}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.code !== 1) return null;
    const t = data.result?.[address.toLowerCase()] ?? data.result?.[address];
    if (!t || Object.keys(t).length === 0) return null;

    if (isSolana) {
      const statusFlag = (f) => f == null ? false : (typeof f === 'object' ? flag(f.status) : flag(f));
      return {
        chain:      'Solana',
        isHoneypot: false,
        isMintable: statusFlag(t.mintable),
        isFreezable: statusFlag(t.freezeable),
        creatorHoldsPct: parseFloat(t.creator_percentage ?? '0'),
        top10HolderPct:  parseFloat(t.top10_holder_rate ?? '0') * 100,
        flags: ['mintable','freezeable','non_transferable','default_account_state_unsafe']
          .filter(k => statusFlag(t[k])),
      };
    }

    const buyTax  = parseFloat(t.buy_tax  ?? '0') * 100;
    const sellTax = parseFloat(t.sell_tax ?? '0') * 100;
    return {
      chain:        CHAIN_ID_MAP[String(chain)] ?? String(chain),
      isHoneypot:   flag(t.is_honeypot),
      buyTax,
      sellTax,
      isOpenSource: flag(t.is_open_source),
      isMintable:   flag(t.is_mintable),
      creatorPct:   parseFloat(t.creator_percent ?? '0') * 100,
      top10Pct:     parseFloat(t.holder_count ? '0' : t.top10_holder_rate ?? '0') * 100,
      ownerCanChange: flag(t.owner_change_balance) || flag(t.can_take_back_ownership),
      flags: [
        flag(t.is_honeypot)            && 'HONEYPOT',
        sellTax > 10                   && `SELL TAX ${sellTax.toFixed(0)}%`,
        flag(t.is_mintable)            && 'MINTABLE (supply can be inflated)',
        flag(t.owner_change_balance)   && 'OWNER CAN DRAIN WALLETS',
        flag(t.can_take_back_ownership)&& 'OWNERSHIP RECLAIMABLE',
        !flag(t.is_open_source)        && 'CLOSED SOURCE',
      ].filter(Boolean),
    };
  } catch {
    return null;
  }
}

// ─── Score each token by how interesting the scan result is ──────────────────

function riskScore(scan) {
  if (!scan) return 0;
  let score = 0;
  if (scan.isHoneypot)         score += 100;
  if (scan.sellTax > 50)       score += 80;
  else if (scan.sellTax > 10)  score += 40;
  if (scan.ownerCanChange)     score += 60;
  if (scan.isMintable)         score += 30;
  if (!scan.isOpenSource)      score += 20;
  if (scan.flags?.length > 2)  score += 20;
  return score;
}

// ─── Claude script generator ─────────────────────────────────────────────────

async function generateScript(token, scan) {
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

  const scanSummary = scan.flags?.length
    ? scan.flags.join(', ')
    : 'no major red flags detected';

  const prompt = `You write punchy, authentic TikTok scripts for a crypto scam detection tool called Lucid Protocol.

TOKEN: ${token.name} ($${token.symbol})
24h Volume: $${Number(token.volume24h).toLocaleString()}
Price change 24h: ${token.priceChange > 0 ? '+' : ''}${token.priceChange}%
SCAN RESULT: ${scanSummary}
Risk flags: ${scan.flags?.join(', ') || 'none'}

Write a 30-second TikTok script. Rules:
- Open with a HOOK that creates instant curiosity (no "Hey guys", no "Today I'm going to")
- Show the scan result dramatically — let the data be the reveal
- One line CTA at the end pointing to the Lucid Protocol bot
- Crypto-native voice. No corporate speak. No fake hype. Real and direct.
- Format: HOOK / SCAN MOMENT / REACTION / CTA — each on its own line
- Max 80 words total

Output the script only. No preamble.`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0]?.text?.trim() ?? null;
}

// ─── Telegram sender ─────────────────────────────────────────────────────────

async function sendTelegram(chatId, text) {
  const res = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telegram send failed: ${err}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!BOT_TOKEN || !ANTHROPIC_KEY) {
    console.error('[content-engine] Missing TELEGRAM_BOT_TOKEN or ANTHROPIC_API_KEY');
    process.exit(1);
  }

  console.log('[content-engine] Fetching trending tokens...');
  const trending = await getTrendingTokens();

  if (!trending.length) {
    console.error('[content-engine] No trending tokens returned');
    return;
  }

  // Scan each token, pick top 3 by risk score
  const results = [];
  for (const item of trending) {
    const address = item.tokenAddress;
    const chainId = item.chainId ?? 'ethereum';
    if (!address) continue;

    const [tokenInfo, scan] = await Promise.all([
      getDexTokenInfo(chainId, address),
      goplusScan(address, chainId),
    ]);

    if (!tokenInfo || !scan) continue;

    const score = riskScore(scan);
    results.push({ tokenInfo, scan, score, address, chainId });
    console.log(`[content-engine] ${tokenInfo.symbol} — risk score ${score}`);
  }

  results.sort((a, b) => b.score - a.score);
  const picks = results.slice(0, 3).filter(r => r.score > 0);

  if (!picks.length) {
    // No risky tokens found — send a "all clean today" message
    await sendTelegram(
      ANTHONY_CHAT_ID,
      `🛡 *Lucid Protocol Content Engine*\n\nScanned ${results.length} trending tokens today — unusually clean. No strong drama. Try again tomorrow or pick a specific token to scan manually.`
    );
    return;
  }

  // Build and send the daily brief
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  let message = `🎬 *Lucid Protocol — TikTok Scripts for ${date}*\n\n`;
  message += `Scanned ${results.length} trending tokens. Top ${picks.length} picks:\n\n`;

  for (let i = 0; i < picks.length; i++) {
    const { tokenInfo, scan } = picks[i];
    const script = await generateScript(tokenInfo, scan);

    message += `*#${i + 1} — $${tokenInfo.symbol} (${tokenInfo.name})*\n`;
    message += `Vol: $${Number(tokenInfo.volume24h).toLocaleString()} | ${tokenInfo.priceChange > 0 ? '▲' : '▼'}${Math.abs(tokenInfo.priceChange)}% 24h\n`;
    message += `🚨 ${scan.flags?.join(' · ') || 'suspicious'}\n\n`;

    if (script) {
      message += `📱 *SCRIPT:*\n${script}\n`;
    }
    message += '\n' + '─'.repeat(30) + '\n\n';
  }

  message += `_Film today's top pick 👆 — highest risk = most shareable_`;

  await sendTelegram(ANTHONY_CHAT_ID, message);
  console.log(`[content-engine] Sent ${picks.length} scripts to Telegram`);
}

// Allow both direct execution and require() import
if (require.main === module) {
  main().catch(err => {
    console.error('[content-engine] Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { run: main };
