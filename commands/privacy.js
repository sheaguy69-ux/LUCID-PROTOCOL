// /privacy — accept GDPR-style data access/copy requests and forward to the operator.

const { notifyOperator } = require('../utils/operatorNotify');

module.exports = function registerPrivacy(bot) {
  bot.onText(/^\/privacy(?:@\w+)?(?:\s+([\s\S]+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const body = (match && match[1] ? match[1] : '').trim();

    const forwarded = await notifyOperator(
      bot,
      'PRIVACY / DATA REQUEST',
      msg,
      body || '(no additional details — user requested a copy of their data)'
    );

    const reply = forwarded
      ? [
          `🔐 *Privacy request received.*`,
          ``,
          `We'll prepare a copy of the data we hold for your Telegram ID and respond within 30 days, as required by our [Privacy Policy](https://scamshield.dev/privacy).`,
          ``,
          `Want to opt out of model improvement instead? \`/optout\``,
          `Want to delete your account entirely? \`/delete\``,
        ].join('\n')
      : '⚠️ Request received but operator notification failed. Please try again later.';

    bot.sendMessage(chatId, reply, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    }).catch((err) => console.error('/privacy ack send failed:', err.message));
  });
};
