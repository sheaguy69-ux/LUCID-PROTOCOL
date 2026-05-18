// /start — handles deep-link referral payloads (ref_<referrer_id>) and shows welcome.

const { grantReferralBonus } = require('../metering');

const REF_PATTERN = /^ref_(\d{5,20})$/;
const BONUS_PER_REFERRAL = 5;

module.exports = function registerStart(bot) {
  bot.onText(/^\/start(?:@\w+)?(?:\s+(.+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const param = (match && match[1] ? match[1] : '').trim();

    // 1. Referral payload → credit referrer
    const refMatch = param.match(REF_PATTERN);
    if (refMatch) {
      const referrerId = parseInt(refMatch[1], 10);
      try {
        const result = await grantReferralBonus(referrerId, userId, BONUS_PER_REFERRAL);
        if (result.credited) {
          // Notify referrer — best effort, silent fail (they may have blocked bot)
          bot.sendMessage(
            referrerId,
            `🎉 New referral! +${BONUS_PER_REFERRAL} bonus scans credited. Your balance: *${result.new_balance}*.`,
            { parse_mode: 'Markdown' }
          ).catch(() => {});
        }
        // Always thank the new user — whether credited or not
      } catch (err) {
        console.error('[start] grantReferralBonus failed:', err.message);
      }
    }

    const welcome = [
      `👋 *Welcome to Lucid Protocol.*`,
      ``,
      `Free AI-powered scam detection for crypto. No card required.`,
      ``,
      `*What you get for free, every day:*`,
      `• 3 deep AI scans — text, URL, contract, photo, voice note, PDF`,
      `• Live on-chain honeypot + rug pull detection across 7 EVM chains`,
      `• Real-time threat feed powered by all Lucid Protocol users`,
      ``,
      `*Try it now:*`,
      `• \`/scan\` [paste anything suspicious]`,
      `• \`/contract\` 0x… [check a token]`,
      `• Forward a DM, voice note, or PDF — I'll scan it`,
      ``,
      `*Earn bonus scans:*`,
      `/invite — share your link, get +${BONUS_PER_REFERRAL} bonus scans per friend`,
      ``,
      `*Commands:* /help /scan /contract /invite /upgrade /status`,
    ].join('\n');

    bot.sendMessage(chatId, welcome, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    }).catch((err) => {
      console.error('/start send failed:', err.message);
    });
  });
};
