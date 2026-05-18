const { getUsageSummaryForUser, TIER_LIMITS, countUserScansThisMonth, getCurrentMonth } = require('../metering');
const { getSubscriberTier } = require('../billing');
const { escapeMarkdownV2 } = require('../utils/formatter');

module.exports = function registerUsageCommand(bot) {
  bot.onText(/\/usage(?:@\w+)?/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    bot.sendChatAction(chatId, 'typing');

    const sub = await getSubscriberTier(userId);
    const e = escapeMarkdownV2;
    const lines = ['*📊 Lucid Protocol Usage*', ''];

    // Tier info
    const tierLabel = sub.tier === 'none' ? 'None' : sub.tier.charAt(0).toUpperCase() + sub.tier.slice(1);
    const statusLabel = sub.status === 'trialing' ? 'Trial' : sub.status === 'active' ? 'Active' : sub.status === 'past_due' ? 'Past Due' : 'Inactive';

    lines.push(`*Tier:* ${e(tierLabel)} \\(${e(statusLabel)}\\)`);

    if (sub.status === 'trialing' && sub.trialEndsAt) {
      lines.push(`*Trial ends:* ${e(new Date(sub.trialEndsAt).toLocaleDateString())}`);
    }

    // Scan usage
    if (sub.tier !== 'none' && (sub.status === 'active' || sub.status === 'trialing')) {
      const totalScans = await countUserScansThisMonth(userId);
      const limit = TIER_LIMITS[sub.tier];

      if (limit === Infinity) {
        lines.push(`*Scans used:* ${e(String(totalScans))} \\(unlimited\\)`);
      } else {
        const barFilled = Math.min(10, Math.round((totalScans / limit) * 10));
        const bar = '\u2588'.repeat(barFilled) + '\u2591'.repeat(10 - barFilled);
        lines.push(`*Scans:* ${e(String(totalScans))} / ${e(String(limit))}`);
        lines.push(`\\[${e(bar)}\\]`);
        lines.push(`*Remaining:* ${e(String(Math.max(0, limit - totalScans)))}`);
      }
    } else {
      lines.push('', `No active subscription\\. Type /upgrade to get started\\.`);
    }

    // API keys
    const summaries = await getUsageSummaryForUser(userId);
    if (summaries && summaries.length > 0) {
      lines.push('', `*API Keys:* ${e(String(summaries.length))} active`);
      for (const key of summaries) {
        const type = key.is_test ? 'TEST' : 'LIVE';
        lines.push(`  • \`${e(key.key_prefix)}\\.\\.\\.\` \\[${e(type)}\\] ${e(String(key.usage.scanCount))} scans`);
      }
    }

    lines.push('', `_Type /manage to manage your subscription\\._`);

    await bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'MarkdownV2' });
  });
};
