const { createApiKey, getKeysByUser } = require('../apiKeySystem');
const { escapeMarkdownV2 } = require('../utils/formatter');

module.exports = function registerApiKeyCommand(bot) {
  bot.onText(/\/apikey(?:@\w+)?(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const arg = (match[1] || '').trim().toLowerCase();

    // /apikey list — show existing keys
    if (arg === 'list') {
      const keys = await getKeysByUser(userId);
      if (keys.length === 0) {
        return bot.sendMessage(chatId, 'You have no API keys\\. Use `/apikey` to generate one\\.', { parse_mode: 'MarkdownV2' });
      }

      const lines = ['*Your API Keys:*', ''];
      for (const key of keys) {
        const status = key.active ? '\\u2705' : '\\u274C';
        const type = key.is_test ? 'TEST' : 'LIVE';
        lines.push(`${status} \`${escapeMarkdownV2(key.key_prefix)}\\.\\.\\.\` \\[${escapeMarkdownV2(type)}\\] ${escapeMarkdownV2(key.label)}`);
      }

      return bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'MarkdownV2' });
    }

    // /apikey test — generate test key
    const isTest = arg === 'test';

    bot.sendChatAction(chatId, 'typing');

    const result = await createApiKey(userId, { isTest });

    if (!result) {
      return bot.sendMessage(chatId, 'Failed to generate API key. Please try again.');
    }

    const e = escapeMarkdownV2;
    const typeLabel = isTest ? 'TEST' : 'LIVE';

    const message = [
      `*${e(typeLabel)} API Key Generated*`,
      '',
      `\`${e(result.rawKey)}\``,
      '',
      `Save this key now \\-\\- it cannot be shown again\\.`,
      '',
      `*Endpoint:* \`POST /api/scan\``,
      `*Scans:* Based on your subscription tier`,
      `*Subscribe:* Use /upgrade if you haven\\'t already`,
      '',
      `*Quick start:*`,
      '```',
      `curl \\-X POST https://your\\-app\\.up\\.railway\\.app/api/scan \\\\`,
      `  \\-H "Authorization: Bearer YOUR\\_KEY" \\\\`,
      `  \\-H "Content\\-Type: application/json" \\\\`,
      `  \\-d \'\\{"content": "Check this crypto offer"\\}\'`,
      '```',
      '',
      `Commands: \`/apikey list\` \\| \`/apikey test\` \\| \`/usage\``,
    ].join('\n');

    await bot.sendMessage(chatId, message, { parse_mode: 'MarkdownV2' });
  });
};
