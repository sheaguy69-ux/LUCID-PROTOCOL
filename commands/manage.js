const { getSubscriberTier, createPortalSession } = require('../billing');

module.exports = function registerManageCommand(bot) {
  bot.onText(/\/manage(?:@\w+)?/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    bot.sendChatAction(chatId, 'typing');

    const sub = await getSubscriberTier(userId);

    if (!sub.stripeCustomerId) {
      return bot.sendMessage(chatId,
        "You don't have an active subscription. Type /upgrade to get started."
      );
    }

    try {
      const session = await createPortalSession(sub.stripeCustomerId);

      await bot.sendMessage(chatId,
        `Manage your subscription, update payment method, or cancel:\n\n${session.url}`
      );
    } catch (err) {
      console.error('Portal session error:', err.message);
      await bot.sendMessage(chatId,
        'Failed to open billing portal. Please try again.'
      );
    }
  });
};
