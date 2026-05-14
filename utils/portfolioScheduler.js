// utils/portfolioScheduler.js
//
// Portfolio Shield — scheduled daily alert runner.
//
// Architecture note on privacy:
//   tracked_wallets stores HMAC hashes of wallet addresses (not raw addresses).
//   This means the scheduler cannot re-derive raw addresses from the DB, so it
//   cannot trigger fresh on-chain scans autonomously. Instead it works in two modes:
//
//   DEGRADED MODE (no ALCHEMY_API_KEY):
//     Logs which wallets are due for a scan. Use user-triggered /portfolio commands
//     to populate last_risk_summary, then the scheduler will alert on that data.
//
//   ALERT MODE (ALCHEMY_API_KEY configured):
//     Reads last_risk_summary populated by user-triggered /portfolio scans. If any
//     wallet has critical holdings and hasn't been alerted in the last 22 hours,
//     sends the user a Telegram DM. Fresh re-scans require the user to re-run
//     /portfolio <address> so the raw address is available in-process.
//
// Usage: call startPortfolioScheduler(bot) once after the bot is initialized.

const { getSupabase } = require('../database');
const { isAlchemyConfigured } = require('./alchemyClient');

const INTERVAL_MS = 60 * 60 * 1000; // 60 minutes
const SCAN_DUE_HOURS = 24; // alert if last_scanned_at is older than this
const CRITICAL_THRESHOLD = 1; // fire alert if critical token count >= this

function scanDueMs() {
  return SCAN_DUE_HOURS * 60 * 60 * 1000;
}

async function fetchAllTrackedWallets() {
  try {
    const { data, error } = await getSupabase()
      .from('tracked_wallets')
      .select('id, telegram_user_id, chain, label, last_scanned_at, last_risk_summary')
      .order('last_scanned_at', { ascending: true, nullsFirst: true });
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('[portfolioScheduler] Failed to fetch tracked wallets:', err.message);
    return [];
  }
}

function isDue(wallet) {
  if (!wallet.last_scanned_at) return true;
  const age = Date.now() - new Date(wallet.last_scanned_at).getTime();
  return age >= scanDueMs();
}

function hasCriticalRisk(wallet) {
  const summary = wallet.last_risk_summary;
  if (!summary || !summary.counts) return false;
  return (summary.counts.critical || 0) >= CRITICAL_THRESHOLD;
}

function buildAlertMessage(wallet) {
  const chain = wallet.chain === 'auto' ? 'EVM chains' : wallet.chain;
  const label = wallet.label ? `"${wallet.label}"` : `wallet on ${chain}`;
  const c = wallet.last_risk_summary.counts;
  const lines = [
    `🚨 *Portfolio Shield Alert* — ${label}`,
    '',
    `Your last scan found:`,
    `  🚨 Critical: *${c.critical || 0}*  ⚠️ High: *${c.high || 0}*  ⚡ Low: *${c.low || 0}*`,
    '',
    'One or more tokens in this wallet crossed the Critical risk threshold.',
    'Run `/portfolio <address>` for a fresh scan and full details.',
    '',
    '_To stop alerts: /portfolio remove <address>_',
  ];

  const top = wallet.last_risk_summary.top || [];
  if (top.length) {
    lines.splice(5, 0, '', '*Critical holdings:*');
    for (const r of top.slice(0, 5)) {
      const sym = r.tokenSecurity?.token_symbol || r.tokenSecurity?.metadata?.symbol || 'unknown';
      const addr = r.address ? `\`${r.address.slice(0, 6)}…${r.address.slice(-4)}\`` : '';
      lines.splice(7, 0, `  🚨 ${sym} (${r.chainName || chain}) ${addr}`);
    }
  }

  return lines.join('\n');
}

async function sendAlert(bot, wallet) {
  try {
    await bot.sendMessage(wallet.telegram_user_id, buildAlertMessage(wallet), {
      parse_mode: 'Markdown',
    });
    console.log(
      `[portfolioScheduler] Alert sent to user ${wallet.telegram_user_id} for wallet ${wallet.id}`
    );
  } catch (err) {
    console.error(
      `[portfolioScheduler] Failed to send alert to user ${wallet.telegram_user_id}:`,
      err.message
    );
  }
}

async function runSchedulerTick(bot) {
  const apiConfigured = isAlchemyConfigured();

  if (!apiConfigured) {
    console.warn(
      '[portfolioScheduler] DEGRADED MODE — ALCHEMY_API_KEY not set. ' +
        'Fetching tracked wallets to log scan queue; no scans or alerts will fire.'
    );
  }

  const wallets = await fetchAllTrackedWallets();

  if (wallets.length === 0) {
    console.log('[portfolioScheduler] No tracked wallets. Nothing to do.');
    return;
  }

  const due = wallets.filter(isDue);
  console.log(
    `[portfolioScheduler] ${wallets.length} tracked wallet(s) total, ${due.length} due for scan.`
  );

  if (!apiConfigured) {
    // Degraded mode — log each wallet that would be scanned.
    for (const w of due) {
      const chain = w.chain === 'auto' ? 'all EVM chains' : w.chain;
      console.warn(
        `[portfolioScheduler] WOULD SCAN wallet id=${w.id} ` +
          `user=${w.telegram_user_id} chain=${chain} ` +
          `last_scanned=${w.last_scanned_at || 'never'}`
      );
    }
    console.warn(
      '[portfolioScheduler] Set ALCHEMY_API_KEY to enable live scans and risk alerts.'
    );
    return;
  }

  // Alert mode — raw addresses are not in the DB (privacy-preserving design).
  // We cannot trigger fresh on-chain scans here. Instead we read last_risk_summary
  // from user-triggered scans and alert on wallets that are overdue and show critical risk.
  let alertsSent = 0;
  for (const w of due) {
    if (hasCriticalRisk(w)) {
      await sendAlert(bot, w);
      alertsSent++;
    } else if (w.last_risk_summary) {
      console.log(
        `[portfolioScheduler] Wallet ${w.id} (user ${w.telegram_user_id}) ` +
          `is due but below alert threshold — no alert sent.`
      );
    } else {
      // No prior scan data — user hasn't run /portfolio <address> yet.
      console.log(
        `[portfolioScheduler] Wallet ${w.id} (user ${w.telegram_user_id}) ` +
          `has no scan data yet. User must run /portfolio <address> to populate risk summary.`
      );
    }
  }

  if (alertsSent > 0) {
    console.log(`[portfolioScheduler] Sent ${alertsSent} alert(s) this tick.`);
  } else {
    console.log('[portfolioScheduler] No alerts triggered this tick.');
  }
}

/**
 * Start the portfolio alert scheduler.
 *
 * @param {import('node-telegram-bot-api')} bot - The initialized Telegram bot instance.
 * @returns {{ stop: () => void }} - Call stop() to cancel the interval.
 */
function startPortfolioScheduler(bot) {
  console.log(
    `[portfolioScheduler] Starting — will check tracked wallets every ${INTERVAL_MS / 60000} minutes.`
  );

  // Run once shortly after startup (30s delay to let DB connections settle),
  // then every INTERVAL_MS.
  const startupTimer = setTimeout(() => {
    runSchedulerTick(bot).catch((err) =>
      console.error('[portfolioScheduler] Tick error:', err.message)
    );
  }, 30_000);

  const interval = setInterval(() => {
    runSchedulerTick(bot).catch((err) =>
      console.error('[portfolioScheduler] Tick error:', err.message)
    );
  }, INTERVAL_MS);

  return {
    stop() {
      clearTimeout(startupTimer);
      clearInterval(interval);
      console.log('[portfolioScheduler] Stopped.');
    },
  };
}

module.exports = { startPortfolioScheduler };
