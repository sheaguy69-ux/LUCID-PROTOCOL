/**
 * Lucid Armor — Content Engine Scheduler
 * Fires daily-content.js at 09:00 every day (server local time).
 * Required once from bot.js — runs silently alongside the bot process.
 */

const { run } = require('./scripts/daily-content');

function msUntilNextRun(hour = 9, minute = 0) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1); // already passed today → tomorrow
  return next - now;
}

function scheduleDaily() {
  const delay = msUntilNextRun(9, 0);
  const nextRun = new Date(Date.now() + delay);
  console.log(`[content-scheduler] Next run: ${nextRun.toLocaleString()}`);

  setTimeout(async () => {
    console.log('[content-scheduler] Firing content engine...');
    try {
      await run();
    } catch (err) {
      console.error('[content-scheduler] Run failed:', err.message);
    }
    scheduleDaily(); // reschedule for tomorrow
  }, delay);
}

scheduleDaily();
