// /delete — account deletion. Confirms, then walks every user-scoped table
// in Supabase and removes the rows. Operator is notified with the deletion
// receipt for audit.

const { notifyOperator } = require('../utils/operatorNotify');
const { deleteUserData } = require('../database');

module.exports = function registerDelete(bot) {
  bot.onText(/^\/delete(?:@\w+)?(?:\s+(.+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const arg = (match && match[1] ? match[1] : '').trim().toLowerCase();

    if (arg !== 'confirm') {
      const warning = [
        `⚠️ *Account deletion*`,
        ``,
        `This will permanently delete your ScamShield data, including scan history, API keys, and any subscription state. This cannot be undone.`,
        ``,
        `If you're sure, send:`,
        `\`/delete confirm\``,
        ``,
        `If you only want to opt out of model improvement (keep your account): \`/optout\``,
      ].join('\n');
      bot.sendMessage(chatId, warning, { parse_mode: 'Markdown' })
        .catch((err) => console.error('/delete prompt send failed:', err.message));
      return;
    }

    let receipt;
    try {
      receipt = await deleteUserData(msg.from.id);
    } catch (err) {
      console.error('/delete cascade failed:', err.message);
      bot.sendMessage(
        chatId,
        '⚠️ Deletion failed mid-flight. The operator has been notified and will complete it manually within 30 days.'
      ).catch(() => {});
      await notifyOperator(bot, 'ACCOUNT DELETION (CASCADE FAILED)', msg, err.message || String(err));
      return;
    }

    const tableLines = Object.entries(receipt.tables)
      .map(([t, n]) => `  • ${t}: ${n} row(s)`)
      .join('\n');
    const errorLines = receipt.errors.length
      ? `\n\n⚠️ Errors:\n${receipt.errors.map((e) => `  • ${e.table}: ${e.message}`).join('\n')}`
      : '';

    await notifyOperator(
      bot,
      'ACCOUNT DELETION (CASCADE COMPLETED)',
      msg,
      `Receipt:\n${tableLines}${errorLines}`
    );

    const totalDeleted = Object.values(receipt.tables).reduce((a, b) => a + (b || 0), 0);
    const reply = receipt.errors.length === 0
      ? [
          `🗑 *Deletion complete.*`,
          ``,
          `Removed ${totalDeleted} row(s) across ${Object.keys(receipt.tables).length} tables. Your account, scan history, API keys, subscription state, and any tracked-wallet hashes have been deleted from our database.`,
          ``,
          `Sub-processor reminder: data we shared with Anthropic, GoPlus, Stripe, Telegram, etc. is governed by their own retention. See our [Privacy Policy](https://scamshield.dev/privacy).`,
          ``,
          `If you change your mind, just /start again — but you'll be a fresh user with no history.`,
        ].join('\n')
      : [
          `🗑 *Partial deletion.*`,
          ``,
          `Removed ${totalDeleted} row(s) but ${receipt.errors.length} table(s) errored. The operator has been notified and will finish the deletion within 30 days, as required by our [Privacy Policy](https://scamshield.dev/privacy).`,
        ].join('\n');

    bot.sendMessage(chatId, reply, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    }).catch((err) => console.error('/delete ack send failed:', err.message));
  });
};
