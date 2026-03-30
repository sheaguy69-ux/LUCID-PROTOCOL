const { formatPremium } = require('../utils/formatter');

module.exports = function registerPremiumCommand(bot) {
  bot.onText(/\/premium(?:@\w+)?/, (msg) => {
    bot.sendMessage(msg.chat.id, formatPremium(), { parse_mode: 'MarkdownV2' });
  });
};
