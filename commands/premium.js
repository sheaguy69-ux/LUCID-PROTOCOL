module.exports = function registerPremiumCommand(bot) {
  bot.onText(/\/premium(?:@\w+)?/, (msg) => {
    bot.sendMessage(msg.chat.id, 'Use /upgrade to see pricing and start your free trial.');
  });
};
