/**
 * Lucid Protocol — Twitter Scanner Scheduler
 * Polls every 30 minutes. Silently skips if TWITTER_BEARER_TOKEN not set.
 */

const { run } = require('./scripts/twitter-scanner');

const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

async function poll() {
  try {
    await run();
  } catch (err) {
    console.error('[twitter-scheduler] Poll error:', err.message);
  }
  setTimeout(poll, INTERVAL_MS);
}

// First poll after 2 min (let bot fully start up)
setTimeout(() => {
  console.log('[twitter-scheduler] Starting — polling every 30 min');
  poll();
}, 2 * 60 * 1000);
