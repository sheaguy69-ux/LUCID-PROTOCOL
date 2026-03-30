const { analyzeContent } = require('../scamDetector');
const { insertScamReport, insertUserSubmission } = require('../database');
const { formatScanResult } = require('../utils/formatter');

module.exports = function registerScanCommand(bot) {
  // Match /scan followed by any text
  bot.onText(/\/scan(?:@\w+)?\s+(.+)/s, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const input = match[1].trim();

    if (input.length > 4000) {
      bot.sendMessage(chatId, 'Input too long. Please limit to 4000 characters.');
      return;
    }

    // Show typing indicator
    bot.sendChatAction(chatId, 'typing');

    try {
      const result = await analyzeContent(input);

      // Store in database (fire and forget — don't block the response)
      const reportPromise = insertScamReport({
        telegramUserId: userId,
        content: input.slice(0, 2000),
        contentType: result.contentType,
        riskScore: result.riskScore,
        confidence: result.confidence,
        flags: result.indicators,
        reasoning: result.reasoning,
      });

      const submissionPromise = insertUserSubmission({
        telegramUserId: userId,
        query: input.slice(0, 2000),
        result: {
          riskScore: result.riskScore,
          confidence: result.confidence,
          indicators: result.indicators,
          source: result.source,
        },
      });

      // Send response immediately, don't wait for DB
      const formatted = formatScanResult(result);
      await bot.sendMessage(chatId, formatted, { parse_mode: 'MarkdownV2' });

      // Wait for DB writes to complete in background
      await Promise.allSettled([reportPromise, submissionPromise]);
    } catch (err) {
      console.error('Scan command error:', err.message);
      bot.sendMessage(chatId, 'An error occurred during analysis. Please try again.');
    }
  });

  // Handle /scan with no arguments
  bot.onText(/\/scan(?:@\w+)?$/, (msg) => {
    bot.sendMessage(
      msg.chat.id,
      'Usage: `/scan [text or URL]`\n\nExample: `/scan Check out this amazing crypto opportunity at example.com`',
      { parse_mode: 'Markdown' }
    );
  });
};
