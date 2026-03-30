const { insertScamReport } = require('../database');
const { analyzeKeywords } = require('../scamDetector');
const { formatReportConfirmation } = require('../utils/formatter');

module.exports = function registerReportCommand(bot) {
  bot.onText(/\/report(?:@\w+)?\s+(.+)/s, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const description = match[1].trim();

    bot.sendChatAction(chatId, 'typing');

    try {
      // Lightweight keyword scan (no Claude call)
      const keywordResult = analyzeKeywords(description);

      const report = await insertScamReport({
        telegramUserId: userId,
        content: description.slice(0, 2000),
        contentType: 'text',
        riskScore: keywordResult.score > 0 ? keywordResult.score : null,
        confidence: keywordResult.score > 0 ? 30 : null,
        flags: keywordResult.matches,
        reasoning: keywordResult.matches.length > 0
          ? `Auto-detected keywords: ${keywordResult.matches.join(', ')}`
          : null,
        verified: false,
      });

      const reportId = report?.id || null;
      const formatted = formatReportConfirmation(reportId, keywordResult.matches);
      await bot.sendMessage(chatId, formatted, { parse_mode: 'MarkdownV2' });
    } catch (err) {
      console.error('Report command error:', err.message);
      bot.sendMessage(chatId, 'Failed to submit report. Please try again.');
    }
  });

  bot.onText(/\/report(?:@\w+)?$/, (msg) => {
    bot.sendMessage(
      msg.chat.id,
      'Usage: `/report [description]`\n\nExample: `/report Someone on Twitter is promoting a fake BTC giveaway claiming to be Elon Musk`',
      { parse_mode: 'Markdown' }
    );
  });
};
