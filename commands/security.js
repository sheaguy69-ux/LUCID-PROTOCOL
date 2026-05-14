// /security — receive responsible-disclosure reports and forward to the operator privately.

const { notifyOperator } = require('../utils/operatorNotify');

module.exports = function registerSecurity(bot) {
  bot.onText(/^\/security(?:@\w+)?(?:\s+([\s\S]+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const body = (match && match[1] ? match[1] : '').trim();

    if (!body) {
      const help = [
        `🛡 *Security disclosure*`,
        ``,
        `Found a vulnerability? Send your report in one message:`,
        ``,
        `\`/security <describe the issue, steps to reproduce, impact>\``,
        ``,
        `We respond within 48 hours and don't pursue good-faith researchers.`,
        `Please don't share details publicly until we've had a chance to fix it.`,
      ].join('\n');
      bot.sendMessage(chatId, help, { parse_mode: 'Markdown', disable_web_page_preview: true })
        .catch((err) => console.error('/security help send failed:', err.message));
      return;
    }

    const forwarded = await notifyOperator(bot, 'SECURITY DISCLOSURE', msg, body);
    const reply = forwarded
      ? '✅ Report received and forwarded to the operator privately. Expect a response within 48 hours.'
      : '⚠️ Report received but the operator notification failed. Please try again or contact us via the website.';

    bot.sendMessage(chatId, reply).catch((err) => console.error('/security ack send failed:', err.message));
  });
};
