module.exports = function registerPingCommand(bot) {
  bot.onText(/\/ping(?:@\w+)?$/, async (msg) => {
    const chatId = msg.chat.id;
    const start = Date.now();
    try {
      const info = await bot.getWebHookInfo();
      const ms = Date.now() - start;
      const webhookOk = info.url && info.url.length > 0;
      const lastError = info.last_error_message
        ? `\n⚠️ Last error: ${info.last_error_message}`
        : '';
      bot.sendMessage(
        chatId,
        `🟢 Bot is alive — ${ms}ms\nWebhook: ${webhookOk ? '✅ set' : '❌ missing'}${lastError}`,
      );
    } catch (err) {
      bot.sendMessage(chatId, `🔴 Ping failed: ${err.message}`);
    }
  });
};
