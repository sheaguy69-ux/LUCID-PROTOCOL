/**
 * /abyssal — Abyssal MEV defense deep layer command
 *
 * Subcommands:
 *   /abyssal                    — overview / landing
 *   /abyssal pools              — list your watched pools from threat-intel supabase
 *   /abyssal watch <addr>       — insert into protected_pools on threat-intel supabase
 *   /abyssal alerts             — check alert status & tier
 *   /abyssal stats              — aggregate protection stats
 *   /abyssal upgrade            — activate Active Defense via Stripe
 */

const { createClient } = require('@supabase/supabase-js');
const VALID_EVM_ADDR = /^0x[a-fA-F0-9]{40}$/;
const { createCheckoutSession, getSubscriberTier } = require('../billing');

// --- Lazy threat-intel supabase client (like intelClient.js) ----------

let threatIntelClient = null;
let threatIntelDisabled = false;

function getThreatIntelClient() {
  if (threatIntelDisabled) return null;
  if (threatIntelClient) return threatIntelClient;

  const url = process.env.THREAT_INTEL_URL;
  const key = process.env.THREAT_INTEL_SERVICE_KEY;

  if (!url || !key) {
    console.warn('[abyssal] THREAT_INTEL_URL or THREAT_INTEL_SERVICE_KEY missing — pools/write disabled');
    threatIntelDisabled = true;
    return null;
  }

  threatIntelClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-application-name': 'scamshield-bot-abyssal' } },
  });
  return threatIntelClient;
}

// --- Formatters (pure functions, testable) ---

function formatLanding() {
  return [
    '🌊 *Abyssal — Guard the Deep*',
    '',
    'Active MEV defense for your liquidity pools.',
    'ScamShield protects what you _see_. Abyssal protects what you _hold_.',
    '',
    '*Defense types:*',
    '🔹 Sandwich attack blocking',
    '🔹 JIT liquidity detection & counter',
    '🔹 Front-run & back-run prevention',
    '🔹 Private mempool routing',
    '',
    '*Pricing:*',
    '🆓 *Free tier* — monitor 1 pool, real-time alerts, no active defense',
    '⚡ *Active Defense* — unlimited pools, auto counter-measures,',
    '   17% commission on *verified value saved only*',
    '   (no-save, no-pay guarantee)',
    '',
    '*Commands:*',
    '`/abyssal pools` — list your protected pools',
    '`/abyssal watch <address>` — queue a pool for monitoring',
    '`/abyssal alerts` — check your alert status & tier',
    '`/abyssal stats` — aggregate protection stats',
    '`/abyssal upgrade` — upgrade to Active Defense',
    '',
    '_Coming soon: web dashboard with live value-saved counters._',
    '_Guard the Deep._',
  ].join('\n');
}

function formatPools(pools, tier) {
  if (!pools || pools.length === 0) {
    return [
      '📋 *Your Protected Pools*',
      '',
      'You\'re not monitoring any pools yet.',
      '',
      'Add one: `/abyssal watch <pool_address>`',
      '',
      'Works with Uniswap V2/V3, SushiSwap, and most EVM DEX pools.',
      'Example: `/abyssal watch 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640`',
      '',
      '_Free tier: 1 pool, alert-only._',
      '_Active Defense: unlimited pools, auto counter-measures._',
    ].join('\n');
  }

  const lines = [
    '📋 *Your Protected Pools*',
    '',
    `Tier: *${tier === 'abyssal_active' ? 'Active Defense' : 'Free'}*`,
    `Total pools: ${pools.length}`,
    '',
  ];

  pools.forEach((p, i) => {
    const addr = p.pool_address;
    const shortAddr = addr.slice(0, 6) + '...' + addr.slice(-4);
    const defense = p.active_defense ? '🛡️ Active' : '🔔 Alert only';
    const added = p.created_at ? new Date(p.created_at).toLocaleDateString() : 'unknown';
    lines.push(`${i + 1}. \`${shortAddr}\` — ${defense} (added ${added})`);
  });

  lines.push(
    '',
    `_Free tier: 1 pool, alert-only._`,
    `_Active Defense: unlimited pools, auto counter-measures._`,
  );

  return lines.join('\n');
}

function formatAlerts(tier, poolCount) {
  const isActive = tier === 'active' || tier === 'enterprise';
  const displayTier = isActive ? tier.charAt(0).toUpperCase() + tier.slice(1) : 'Free';
  const lines = [
    '🔔 *Abyssal Alert Status*',
    '',
    `Tier: *${displayTier}*`,
    `Active pools: ${poolCount || 0}`,
    'Attacks detected: 0',
    'Attacks blocked: 0',
    'Value saved: 0 ETH',
    '',
  ];
  if (isActive) {
    lines.push('Active defense is enabled. We\'re watching your pools.');
  } else {
    lines.push(
      'You\'re on the free tier — alerts only, no active defense.',
      '',
      'Upgrade to *Active Defense* for automatic MEV protection.',
      'Pay only on value saved (17% commission).',
    );
  }
  return lines.join('\n');
}

function formatStats() {
  return [
    '📊 *Abyssal Protection Stats*',
    '',
    'Global (all users):',
    '👁️ Pools monitored: 0',
    '⚠️ Attacks detected: 0',
    '🛡️ Attacks blocked: 0',
    '💰 Total value saved: 0 ETH',
    '',
    '_Stats update in real-time once monitoring is live._',
  ].join('\n');
}

function formatWatchSuccess(address) {
  return [
    '⏳ *Pool Queued for Monitoring*',
    '',
    `\`${address}\``,
    '',
    'We\'ll verify the address and activate monitoring shortly.',
    '',
    '*What happens next:*',
    '1. Verification — we check it\'s a valid DEX pool',
    '2. Mempool listener activation (1-2 min)',
    '3. First alert via this chat when an attack is detected',
    '',
    'Check status: `/abyssal pools`',
    '',
    '_Free tier: alert only. Upgrade to Active Defense for auto-blocking._',
  ].join('\n');
}

// --- /abyssal usage string ---

const USAGE =
  'Unknown subcommand. Try:\n' +
  '`/abyssal` — overview\n' +
  '`/abyssal pools` — your pools\n' +
  '`/abyssal upgrade` — checkout for Active Defense\n' +
  '`/abyssal watch <address>` — add a pool\n' +
  '`/abyssal alerts` — alert status\n' +
  '`/abyssal stats` — global stats';

// --- Subcommand regexes (anchored) ---

const RE_LANDING   = /^\/abyssal(?:@\w+)?$/;
const RE_POOLS     = /^\/abyssal(?:@\w+)?\s+pools$/;
const RE_ALERTS    = /^\/abyssal(?:@\w+)?\s+alerts$/;
const RE_STATS     = /^\/abyssal(?:@\w+)?\s+stats$/;
const RE_UPGRADE   = /^\/abyssal(?:@\w+)?\s+upgrade$/;
const RE_WATCH     = /^\/abyssal(?:@\w+)?\s+watch\s+(.+)$/i;
const RE_CATCHALL  = /^\/abyssal(?:@\w+)?\s+(.+)$/;

module.exports = function registerAbyssal(bot) {
  // --- /abyssal — main landing ---
  bot.onText(RE_LANDING, (msg) => {
    bot.sendMessage(msg.chat.id, formatLanding(), { parse_mode: 'Markdown' });
  });

  // --- /abyssal pools ---
  bot.onText(RE_POOLS, async (msg) => {
    const userId = String(msg.from.id);
    const tier = await getSubscriberTier(msg.from.id);
    const c = getThreatIntelClient();

    if (!c) {
      return bot.sendMessage(
        msg.chat.id,
        '⚠️ Threat-intel backend not configured. Ask the operator to set `THREAT_INTEL_URL` and `THREAT_INTEL_SERVICE_KEY`.',
      );
    }

    try {
      const { data, error } = await c
        .from('protected_pools')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      bot.sendMessage(msg.chat.id, formatPools(data || [], tier.tier), { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('[abyssal] Failed to fetch pools:', err.message);
      bot.sendMessage(msg.chat.id, 'Failed to fetch your pools. Please try again.');
    }
  });

  // --- /abyssal alerts ---
  bot.onText(RE_ALERTS, async (msg) => {
    const userId = msg.from.id;
    const sub = await getSubscriberTier(userId);
    let abyssalTier = 'none';
    if (sub.tier === 'abyssal_active') abyssalTier = 'active';
    else if (sub.tier && sub.tier !== 'none') abyssalTier = 'free';

    // Fetch pool count for the message
    let poolCount = 0;
    const c = getThreatIntelClient();
    if (c) {
      try {
        const { count, error } = await c
          .from('protected_pools')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', String(msg.from.id));
        if (!error) poolCount = count || 0;
      } catch (_) { /* non-blocking */ }
    }

    bot.sendMessage(msg.chat.id, formatAlerts(abyssalTier, poolCount), { parse_mode: 'Markdown' });
  });

  // --- /abyssal stats ---
  bot.onText(RE_STATS, async (msg) => {
    const c = getThreatIntelClient();
    let poolCount = 0;
    if (c) {
      try {
        const { count, error } = await c
          .from('protected_pools')
          .select('id', { count: 'exact', head: true });
        if (!error) poolCount = count || 0;
      } catch (_) { /* non-blocking */ }
    }

    const stats = formatStats().replace('0', String(poolCount), 1);
    bot.sendMessage(msg.chat.id, stats, { parse_mode: 'Markdown' });
  });

  // --- /abyssal upgrade ---
  bot.onText(RE_UPGRADE, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username || '';

    // Check if already active
    const sub = await getSubscriberTier(userId);
    if (sub.tier === 'abyssal_active') {
      return bot.sendMessage(
        chatId,
        'You\'re already on Abyssal Active Defense. ' +
        'We\'re watching your pools — add one with `/abyssal watch 0x...`.',
        { parse_mode: 'Markdown' }
      );
    }

    const text = [
      '🌊 *Abyssal Active Defense*',
      '',
      'You\'re about to activate real-time MEV protection for your LP pools.',
      '',
      '*What you get:*',
      '🔹 Unlimited protected pools',
      '🔹 Auto counter-measures (Flashbots bundles)',
      '🔹 Private mempool routing',
      '🔹 Real-time value-saved dashboard (coming soon)',
      '',
      '*Pricing:*',
      '17% commission on *verified value saved only*',
      'No attack blocked? No commission charged. Period.',
      '',
      'Ready?',
    ].join('\n');

    await bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '⚡ Enable Active Defense', callback_data: 'abyssal_upgrade_confirm' },
        ]],
      },
    });
  });

  // --- /abyssal upgrade callback handler ---
  bot.on('callback_query', async (query) => {
    if (query.data !== 'abyssal_upgrade_confirm') return;

    const userId = query.from.id;
    const username = query.from.username || '';
    const chatId = query.message.chat.id;

    await bot.answerCallbackQuery(query.id, { text: 'Creating checkout...' });

    try {
      const session = await createCheckoutSession(userId, username, 'abyssal_active');
      await bot.sendMessage(
        chatId,
        `✅ Your Abyssal Active Defense checkout is ready:\n\n${session.url}\n\n` +
        'This link expires in 24 hours. ' +
        'No upfront charge — commission only on value saved.',
      );
    } catch (err) {
      console.error('Abyssal checkout error:', err.message);
      await bot.sendMessage(
        chatId,
        'Failed to create checkout. Please make sure `STRIPE_ABYSSAL_ACTIVE_PRICE_ID` is set and try again.',
      );
    }
  });

  // --- /abyssal watch <address> ---
  bot.onText(RE_WATCH, async (msg, match) => {
    const address = match[1].trim();

    if (!VALID_EVM_ADDR.test(address)) {
      return bot.sendMessage(
        msg.chat.id,
        'Invalid EVM pool address.\n\n' +
        'Usage: `/abyssal watch 0x...`\n' +
        'Example: `/abyssal watch 0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640`',
        { parse_mode: 'Markdown' }
      );
    }

    bot.sendChatAction(msg.chat.id, 'typing');

    const userId = String(msg.from.id);
    const sub = await getSubscriberTier(msg.from.id);
    const isActive = sub.tier === 'abyssal_active';

    const c = getThreatIntelClient();
    if (!c) {
      return bot.sendMessage(
        msg.chat.id,
        '⚠️ Threat-intel backend not configured. Ask the operator to set `THREAT_INTEL_URL` and `THREAT_INTEL_SERVICE_KEY`.',
      );
    }

    // Free-tier user: enforce 1 pool limit
    if (!isActive) {
      try {
        const { count, error } = await c
          .from('protected_pools')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId);
        if (!error && (count || 0) >= 1) {
          return bot.sendMessage(
            msg.chat.id,
            '🛑 Free tier is limited to 1 pool. Upgrade to *Active Defense* for unlimited pools.\n\n`/abyssal upgrade`',
            { parse_mode: 'Markdown' }
          );
        }
      } catch (_) { /* proceed */ }
    }

    try {
      const { error } = await c
        .from('protected_pools')
        .insert({
          user_id: userId,
          pool_address: address.toLowerCase(),
          active_defense: isActive,
          commission_rate: isActive ? 0.17 : 0.0,
        });

      if (error) {
        // Unique violation on (user_id, chain_id, pool_address) with default chain_id=1
        if (error.code === '23505') {
          return bot.sendMessage(
            msg.chat.id,
            `Already tracking \`${address}\`. Check your pools: \`/abyssal pools\``,
            { parse_mode: 'Markdown' }
          );
        }
        throw error;
      }

      bot.sendMessage(msg.chat.id, formatWatchSuccess(address), { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('[abyssal] Failed to insert pool:', err.message);
      bot.sendMessage(
        msg.chat.id,
        'Failed to queue pool. Please try again or contact support.',
      );
    }
  });

  // --- /abyssal something invalid ---
  bot.onText(RE_CATCHALL, (msg) => {
    bot.sendMessage(msg.chat.id, USAGE, { parse_mode: 'Markdown' });
  });
};
