// Shared upsell-message builder for free/paid cap hits.
//
// reason → text pairs (plain Telegram markdown, no MarkdownV2 escaping).

const { FREE_DAILY_LIMIT } = require('../metering');

function buildUpsellMessage(check) {
  switch (check.reason) {
    case 'free_limit_exceeded':
      return [
        `🧱 You've hit today's *${FREE_DAILY_LIMIT} free deep scans*.`,
        ``,
        `Two ways to keep scanning:`,
        `1. */invite* — share your link. *+5 scans* per friend that joins.`,
        `2. */upgrade* — Pro $8/mo (1K scans) or Unlimited $17/mo.`,
        ``,
        `Free resets at 00:00 UTC. Both paid tiers include a 7-day trial.`,
      ].join('\n');

    case 'limit_exceeded':
      return [
        `🧱 You've used all *${check.limit} scans* this month.`,
        ``,
        `Go */upgrade* to Unlimited — $17/mo.`,
      ].join('\n');

    case 'no_subscription':
      // Legacy path — should rarely fire now that free tier exists.
      return 'ScamShield requires a subscription.\nType /upgrade to start your free 7-day trial.';

    default:
      return 'Scans temporarily unavailable. Try again in a moment.';
  }
}

// Short tag appended to free-tier scan results — "2/3 today · /upgrade for unlimited"
function buildFreeScanFooter(used, limit) {
  const remaining = Math.max(0, limit - used);
  if (remaining <= 0) return '';
  return `\n\n_${used}/${limit} free scans today. /upgrade for unlimited._`;
}

module.exports = { buildUpsellMessage, buildFreeScanFooter };
