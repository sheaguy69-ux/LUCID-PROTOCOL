// /optout — user opts out of having their scans used for model improvement.

const { notifyOperator } = require('../utils/operatorNotify');

module.exports = function registerOptout(bot) {
  bot.onText(/^\/optout(?:@\w+)?(?:\s+([\s\S]+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const body = (match && match[1] ? match[1] : '').trim();

    const forwarded = await notifyOperator(
      bot,
      'MODEL TRAINING OPT-OUT',
      msg,
      body || '(user requested opt-out of model improvement)'
    );

    const reply = forwarded
      ? [
          `🚫 *Opt-out request received.*`,
          ``,
          `Your scans will still run normally — they just won't be used to improve our models.`,
          `We'll process this within 7 days and confirm.`,
          ``,
          `Changed your mind? Send \`/optout cancel\` to revert.`,
        ].join('\n')
      : '⚠️ Request received but operator notification failed. Please try again later.';

    bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' })
      .catch((err) => console.error('/optout ack send failed:', err.message));
  });
};
