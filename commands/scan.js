const { analyzeContent } = require('../scamDetector');
const { insertScamReport, insertUserSubmission } = require('../database');
const { formatScanResult, escapeMarkdownV2 } = require('../utils/formatter');
const { reviewScanResult, AEGIS_STATUS } = require('../aegisAgent');
const { checkScanAllowance } = require('../metering');

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

    // Check subscription
    const check = await checkScanAllowance(userId);
    if (!check.allowed) {
      const msg = check.reason === 'no_subscription'
        ? 'ScamShield requires a subscription.\nType /upgrade to start your free 7-day trial.'
        : `You've used all ${check.limit} scans this month.\nType /upgrade to go Unlimited.`;
      return bot.sendMessage(chatId, msg);
    }

    // Show typing indicator
    bot.sendChatAction(chatId, 'typing');

    try {
      const result = await analyzeContent(input);

      // Aegis: review the scan result before sending to user
      const aegis = await reviewScanResult(result, { input, userId });

      if (aegis.status === AEGIS_STATUS.BLOCKED) {
        const reason = aegis.violations[0]?.message || 'Policy violation detected.';
        const e = escapeMarkdownV2;
        const blocked = [
          `*🛡 Aegis Security Alert*`,
          ``,
          e(reason),
          ``,
          `_This scan was flagged by Aegis, ScamShield's oversight system\\._`,
        ].join('\n');
        await bot.sendMessage(chatId, blocked, { parse_mode: 'MarkdownV2' });
        return;
      }

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

      // Build formatted response with Aegis notice if flagged
      let formatted = formatScanResult(result);

      if (aegis.status === AEGIS_STATUS.FLAGGED) {
        const notice = aegis.violations[0]?.message || 'Result may be unreliable.';
        formatted = `⚠️ _${escapeMarkdownV2(notice)}_\n\n${formatted}`;
      }

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
