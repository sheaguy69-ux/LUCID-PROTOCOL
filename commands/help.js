const { formatHelp } = require('../utils/formatter');

module.exports = function registerHelpCommand(bot) {
  bot.onText(/\/help(?:@\w+)?/, (msg) => {
    bot.sendMessage(msg.chat.id, formatHelp(), { parse_mode: 'MarkdownV2' });
  });
};
