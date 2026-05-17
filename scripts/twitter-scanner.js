#!/usr/bin/env node
/**
 * Lucid Armor — X/Twitter Scan Reply Engine
 *
 * Polls Twitter Search API v2 every 30 min for tweets containing
 * EVM contract addresses or token safety questions. Scans each with
 * GoPlus, generates a ready-to-post reply, sends batch to Anthony's Telegram.
 *
 * Anthony posts manually — looks authentic, zero write API needed.
 *
 * Usage:  node scripts/twitter-scanner.js
 * Needs:  TWITTER_BEARER_TOKEN in env
 */

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { scanWeb3Addresses, extractAddresses } = require('../web3Scanner');

const ANTHONY_CHAT_ID  = 1989311996;
const BOT_TOKEN        = process.env.TELEGRAM_BOT_TOKEN;
const BEARER_TOKEN     = process.env.TWITTER_BEARER_TOKEN;
const ANTHROPIC_KEY    = process.env.ANTHROPIC_API_KEY;

// In-memory dedup — never surface the same tweet twice per process lifetime
const seenTweetIds = new Set();

// ─── Twitter Search ───────────────────────────────────────────────────────────

const SEARCH_QUERIES = [
  // People posting contract addresses asking if they're safe
  '(0x) (legit OR safe OR scam OR rug OR honeypot) -is:retweet lang:en',
  // People asking about specific token safety
  '("is this legit" OR "rug pull" OR "honeypot?" OR "safe to buy") crypto -is:retweet lang:en',
];

async function searchTweets(query) {
  const params = new URLSearchParams({
    query,
    max_results: '10',
    'tweet.fields': 'author_id,created_at,text',
    expansions: 'author_id',
    'user.fields': 'username',
  });

  const res = await fetch(
    `https://api.twitter.com/2/tweets/search/recent?${params}`,
    {
      headers: { Authorization: `Bearer ${BEARER_TOKEN}` },
      signal: AbortSignal.timeout(15_000),
    }
  );

  if (res.status === 429) {
    console.log('[twitter-scanner] Rate limited — skipping this poll');
    return [];
  }
  if (!res.ok) {
    const err = await res.text();
    console.error(`[twitter-scanner] Search failed ${res.status}:`, err.slice(0, 200));
    return [];
  }

  const data = await res.json();
  if (!data.data?.length) return [];

  // Build username map from includes
  const userMap = {};
  for (const u of data.includes?.users ?? []) {
    userMap[u.id] = u.username;
  }

  return data.data.map(t => ({
    id:       t.id,
    text:     t.text,
    username: userMap[t.author_id] ?? 'unknown',
    url:      `https://x.com/${userMap[t.author_id] ?? 'i'}/status/${t.id}`,
  }));
}

// ─── Risk scoring (mirrors daily-content.js) ─────────────────────────────────

function riskScore(scan) {
  if (!scan) return 0;
  let score = 0;
  if (scan.flags?.some(f => /honeypot/i.test(f)))      score += 100;
  if (scan.flags?.some(f => /sell tax/i.test(f))) {
    const m = scan.flags.join(' ').match(/sell tax (\d+)/i);
    const pct = m ? parseInt(m[1]) : 0;
    score += pct > 50 ? 80 : 40;
  }
  if (scan.flags?.some(f => /drain/i.test(f)))          score += 60;
  if (scan.flags?.some(f => /mintable/i.test(f)))       score += 30;
  if (scan.flags?.some(f => /closed source/i.test(f)))  score += 20;
  return score;
}

// ─── Reply generator ──────────────────────────────────────────────────────────

async function generateReply(tweet, scanResult) {
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

  const flags = scanResult?.flags?.length
    ? scanResult.flags.join(', ')
    : 'no major red flags';

  const prompt = `You write short, punchy Twitter/X replies for Lucid Armor — a crypto scam scanner.

Someone tweeted: "${tweet.text.slice(0, 200)}"

GoPlus scan result: ${flags}

Write a reply that:
- Leads with the scan result (data first, no preamble)
- Is under 240 characters total
- Ends with: "Test free 👉 t.me/SGbutta_bot"
- Crypto-native tone — direct, no corporate speak
- If result is clean: acknowledge it but still mention the tool

Output only the reply text. No quotes, no labels.`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 120,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0]?.text?.trim() ?? null;
}

// ─── Telegram ─────────────────────────────────────────────────────────────────

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
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!BEARER_TOKEN) {
    console.log('[twitter-scanner] TWITTER_BEARER_TOKEN not set — skipping');
    return;
  }
  if (!BOT_TOKEN || !ANTHROPIC_KEY) {
    console.error('[twitter-scanner] Missing BOT_TOKEN or ANTHROPIC_KEY');
    return;
  }

  console.log('[twitter-scanner] Polling X...');
  const opportunities = [];

  for (const query of SEARCH_QUERIES) {
    const tweets = await searchTweets(query);

    for (const tweet of tweets) {
      if (seenTweetIds.has(tweet.id)) continue;
      seenTweetIds.add(tweet.id);

      // Extract EVM contract addresses from tweet text
      const addresses = extractAddresses(tweet.text);
      if (!addresses.length) continue;

      // Scan the first address found
      const { address, kind } = addresses[0];
      let scanResult = null;

      try {
        const results = await scanWeb3Addresses(tweet.text);
        scanResult = results?.[0] ?? null;
      } catch {
        continue;
      }

      const score = riskScore(scanResult);
      if (score === 0 && scanResult) continue; // clean + uninteresting

      const reply = await generateReply(tweet, scanResult);
      if (!reply) continue;

      opportunities.push({ tweet, scanResult, reply, score });
    }
  }

  if (!opportunities.length) {
    console.log('[twitter-scanner] 0 opportunities this poll');
    return;
  }

  // Sort highest risk first, cap at 5
  opportunities.sort((a, b) => b.score - a.score);
  const picks = opportunities.slice(0, 5);

  let message = `🐦 *X Opportunities — ${picks.length} found*\n\n`;

  for (let i = 0; i < picks.length; i++) {
    const { tweet, scanResult, reply } = picks[i];
    const flags = scanResult?.flags?.join(' · ') || 'no flags';

    message += `*[${i + 1}] @${tweet.username}*\n`;
    message += `_"${tweet.text.slice(0, 100)}${tweet.text.length > 100 ? '…' : ''}"_\n`;
    message += `🔗 ${tweet.url}\n`;
    message += `🚨 ${flags}\n\n`;
    message += `*Your reply (copy-paste):*\n\`\`\`\n${reply}\n\`\`\`\n`;
    message += '\n' + '─'.repeat(28) + '\n\n';
  }

  message += `_Post the top pick — highest risk = most engagement_`;

  await sendTelegram(ANTHONY_CHAT_ID, message);
  console.log(`[twitter-scanner] Sent ${picks.length} opportunities to Telegram`);
}

if (require.main === module) {
  main().catch(err => {
    console.error('[twitter-scanner] Fatal:', err.message);
    process.exit(1);
  });
}

module.exports = { run: main };
