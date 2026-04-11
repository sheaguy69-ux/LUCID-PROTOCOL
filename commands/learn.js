const { insertSignature } = require('../database');
const { generateEmbedding, storeEmbedding } = require('../embeddingEngine');
const { escapeMarkdownV2 } = require('../utils/formatter');
const { reviewPattern, AEGIS_STATUS } = require('../aegisAgent');

module.exports = function registerLearnCommand(bot) {
  bot.onText(/\/learn(?:@\w+)?\s+severity:(\d+)\s+(.+)/s, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const severity = parseInt(match[1], 10);
    const pattern = match[2].trim();

    if (severity < 1 || severity > 10) {
      return bot.sendMessage(chatId, 'Severity must be between 1 and 10\\.', { parse_mode: 'MarkdownV2' });
    }

    if (pattern.length < 10) {
      return bot.sendMessage(chatId, 'Pattern must be at least 10 characters\\. Add more context\\!', { parse_mode: 'MarkdownV2' });
    }

    if (pattern.length > 500) {
      return bot.sendMessage(chatId, 'Pattern too long \\(max 500 chars\\)\\. Summarize it\\.', { parse_mode: 'MarkdownV2' });
    }

    bot.sendChatAction(chatId, 'typing');

    try {
      // Aegis: review pattern before storing
      const aegis = await reviewPattern(pattern, severity, { userId });

      if (aegis.status === AEGIS_STATUS.BLOCKED) {
        const reason = aegis.violations[0]?.message || 'Pattern rejected by policy.';
        return bot.sendMessage(chatId, `🛡 *Aegis blocked this pattern*\n\n${escapeMarkdownV2(reason)}`, { parse_mode: 'MarkdownV2' });
      }

      // Generate embedding for the new pattern
      const embedding = await generateEmbedding(pattern);

      // Store in database
      const result = await insertSignature({
        patternType: 'phrase',
        pattern,
        severity,
        sources: [`user_${userId}`],
      });

      if (!result) {
        return bot.sendMessage(chatId, 'Failed to save pattern\\. Try again\\.');
      }

      // Store embedding
      if (embedding) {
        await storeEmbedding('scam_signatures', result.id, pattern, embedding);
      }

      const e = escapeMarkdownV2;
      const aegisNote = aegis.status === AEGIS_STATUS.FLAGGED
        ? `\n⚠️ _${e(aegis.violations[0]?.message || 'Under review')}_\n`
        : '';

      const lines = [
        `*✅ Pattern Added to Knowledge Base*`,
        ``,
        `Pattern: ${e(pattern)}`,
        `Severity: ${e(String(severity))}/10`,
        `Embedded: ${embedding ? 'Yes' : 'No \\(will use keyword matching\\)'}`,
        aegisNote,
        `This pattern will now be detected in future scans via semantic similarity\\!`,
      ];

      await bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'MarkdownV2' });
    } catch (err) {
      console.error('Learn command error:', err.message);
      bot.sendMessage(chatId, 'Error saving pattern\\. Try again later\\.');
    }
  });

  // Show usage
  bot.onText(/\/learn(?:@\w+)?$/, (msg) => {
    const lines = [
      `*🧠 Teach ScamShield*`,
      ``,
      `Help us detect new scams by teaching the bot\\!`,
      ``,
      `Usage:`,
      `/learn severity:8 Double your Bitcoin\\. Send 0\\.5 BTC to 3J4b\\.\\.\\.`,
      ``,
      `Parameters:`,
      `• severity: 1\\-10 \\(how dangerous is this scam?\\)`,
      `• pattern: text description of the scam message`,
      ``,
      `Example:`,
      `/learn severity:9 "Join our exclusive crypto group \\- guaranteed 100x returns in 30 days\\"`,
      ``,
      `Your contributions help protect the entire community\\!`,
    ].join('\n');

    bot.sendMessage(msg.chat.id, lines, { parse_mode: 'MarkdownV2' });
  });
};
