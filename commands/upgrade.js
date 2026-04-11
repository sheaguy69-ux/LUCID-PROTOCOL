const { createCheckoutSession } = require('../billing');

module.exports = function registerUpgradeCommand(bot) {
  // /upgrade — show tier selection
  bot.onText(/\/upgrade(?:@\w+)?/, async (msg) => {
    const chatId = msg.chat.id;

    const text = [
      '🛡 *Upgrade ScamShield*',
      '',
      '*Pro \\($8/mo\\)* — 1,000 scans, API access, full Aegis oversight',
      '*Unlimited \\($17/mo\\)* — Unlimited scans, admin dashboard, custom policies',
      '',
      'Both include a *7\\-day free trial*\\. Cancel anytime\\.',
    ].join('\n');

    await bot.sendMessage(chatId, text, {
      parse_mode: 'MarkdownV2',
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Try Pro Free — $8/mo', callback_data: 'upgrade_pro' },
            { text: 'Try Unlimited Free — $17/mo', callback_data: 'upgrade_unlimited' },
          ],
        ],
      },
    });
  });

  // Handle upgrade button taps
  bot.on('callback_query', async (query) => {
    if (!query.data || !query.data.startsWith('upgrade_')) return;

    const tier = query.data.replace('upgrade_', '');
    if (tier !== 'pro' && tier !== 'unlimited') return;

    const userId = query.from.id;
    const username = query.from.username || '';

    await bot.answerCallbackQuery(query.id, { text: 'Creating checkout...' });

    try {
      const session = await createCheckoutSession(userId, username, tier);

      const tierLabel = tier === 'pro' ? 'Pro' : 'Unlimited';
      await bot.sendMessage(query.message.chat.id,
        `✅ Your ${tierLabel} checkout is ready (7-day free trial):\n\n${session.url}\n\nThis link expires in 24 hours.`
      );
    } catch (err) {
      console.error('Checkout session error:', err.message);
      await bot.sendMessage(query.message.chat.id,
        'Failed to create checkout. Please try again or contact support.'
      );
    }
  });
};
