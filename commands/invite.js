// /invite — share referral link. Each new signup via the link grants +5 bonus scans.

const { getReferralStats } = require('../metering');

const BOT_USERNAME = process.env.BOT_USERNAME || 'LucidProtocol_bot';
const BONUS_PER_REFERRAL = 5;

module.exports = function registerInvite(bot) {
  bot.onText(/^\/invite(?:@\w+)?\b/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    let stats = { balance: 0, referrals: 0 };
    try {
      stats = await getReferralStats(userId);
    } catch (_e) { /* fall through with zeros */ }

    const link = `https://t.me/${BOT_USERNAME}?start=ref_${userId}`;

    const body = [
      `🎁 *Invite friends → earn bonus scans*`,
      ``,
      `Every friend who joins Lucid Protocol via your link gets you *+${BONUS_PER_REFERRAL} bonus scans*.`,
      `Bonus scans stack on top of your 3 free daily and never expire.`,
      ``,
      `Your stats:`,
      `• *${stats.referrals}* friends referred`,
      `• *${stats.balance}* bonus scans remaining`,
      ``,
      `Your link:`,
      `\`${link}\``,
      ``,
      `Copy + paste it anywhere — Twitter, Telegram, Discord, wherever crypto people live.`,
    ].join('\n');

    bot.sendMessage(chatId, body, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    }).catch((err) => {
      console.error('/invite send failed:', err.message);
    });
  });
};
