const { getReportStats } = require('../database');
const { formatStatus } = require('../utils/formatter');

module.exports = function registerStatusCommand(bot) {
  bot.onText(/\/status(?:@\w+)?/, async (msg) => {
    const chatId = msg.chat.id;

    try {
      const stats = await getReportStats();
      const uptime = process.uptime();
      const formatted = formatStatus(stats, uptime);
      await bot.sendMessage(chatId, formatted, { parse_mode: 'MarkdownV2' });
    } catch (err) {
      console.error('Status command error:', err.message);
      bot.sendMessage(chatId, 'Failed to fetch status. Please try again.');
    }
  });
};
