const { getUsageSummaryForUser, FREE_TIER_SCANS, OVERAGE_COST_PER_SCAN } = require('../metering');
const { escapeMarkdownV2 } = require('../utils/formatter');

module.exports = function registerUsageCommand(bot) {
  bot.onText(/\/usage(?:@\w+)?/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    bot.sendChatAction(chatId, 'typing');

    const summaries = await getUsageSummaryForUser(userId);

    if (!summaries || summaries.length === 0) {
      return bot.sendMessage(
        chatId,
        'No API keys found\\. Use `/apikey` to generate one\\.',
        { parse_mode: 'MarkdownV2' }
      );
    }

    const e = escapeMarkdownV2;
    const lines = ['*API Usage Summary*', ''];

    for (const key of summaries) {
      const u = key.usage;
      const type = key.is_test ? 'TEST' : 'LIVE';
      const barFilled = Math.min(10, Math.round((u.scanCount / FREE_TIER_SCANS) * 10));
      const bar = '\u2588'.repeat(barFilled) + '\u2591'.repeat(10 - barFilled);

      lines.push(`*${e(type)}* \`${e(key.key_prefix)}\\.\\.\\.\` \\(${e(key.label)}\\)`);
      lines.push(`Month: ${e(u.month)}`);
      lines.push(`Scans: ${e(String(u.scanCount))} / ${e(String(FREE_TIER_SCANS))} free`);
      lines.push(`\\[${e(bar)}\\]`);
      lines.push(`Remaining: ${e(String(u.freeRemaining))}`);

      if (u.overageCount > 0) {
        lines.push(`Overage: ${e(String(u.overageCount))} scans \\= $${e(u.overageCost.toFixed(2))}`);
        lines.push(`Rate: $${e(OVERAGE_COST_PER_SCAN.toFixed(2))}/scan`);
      }

      const statusEmoji = u.billingStatus === 'free' ? '\u2705' : '\u26A0\uFE0F';
      lines.push(`Status: ${statusEmoji} ${e(u.billingStatus.toUpperCase())}`);
      lines.push('');
    }

    await bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'MarkdownV2' });
  });
};
