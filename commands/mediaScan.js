const { analyzeMultimodalContent } = require('../scamDetector');
const { insertScamReport, insertUserSubmission } = require('../database');
const { formatMultimodalScanResult, escapeMarkdownV2 } = require('../utils/formatter');
const { downloadTelegramFile, extractMediaInfo, isSupportedForEmbedding } = require('../mediaHandler');
const { reviewScanResult, AEGIS_STATUS } = require('../aegisAgent');
const { checkScanAllowance } = require('../metering');

module.exports = function registerMediaScanCommand(bot) {
  // Handle photos
  bot.on('photo', async (msg) => {
    await handleMediaMessage(bot, msg);
  });

  // Handle voice messages
  bot.on('voice', async (msg) => {
    await handleMediaMessage(bot, msg);
  });

  // Handle audio files
  bot.on('audio', async (msg) => {
    await handleMediaMessage(bot, msg);
  });

  // Handle documents (PDFs, images sent as files)
  bot.on('document', async (msg) => {
    await handleMediaMessage(bot, msg);
  });
};

async function handleMediaMessage(bot, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // Extract media info from the message
  const mediaInfo = extractMediaInfo(msg);

  if (!mediaInfo) {
    bot.sendMessage(chatId, 'Unsupported media type. Send a photo, voice message, audio file, or PDF.');
    return;
  }

  if (!isSupportedForEmbedding(mediaInfo)) {
    bot.sendMessage(chatId, `Sorry, ${mediaInfo.type} files aren't supported for scam analysis yet. Try sending a photo, voice message, or PDF.`);
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
    // Download the file from Telegram
    const { error, data } = await downloadTelegramFile(bot, mediaInfo.fileId);

    if (error || !data) {
      bot.sendMessage(chatId, `Failed to download file: ${error || 'unknown error'}`);
      return;
    }

    // Check audio duration limit (Gemini supports up to 80 seconds)
    if (mediaInfo.type === 'audio' && mediaInfo.duration && mediaInfo.duration > 80) {
      bot.sendMessage(chatId, 'Audio files must be under 80 seconds for analysis. Please send a shorter clip.');
      return;
    }

    // Run multimodal analysis
    const result = await analyzeMultimodalContent(data, mediaInfo.caption);

    // Aegis: review the scan result before sending to user
    const aegis = await reviewScanResult(result, { input: mediaInfo.caption || '', userId });

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

    // Store in database (fire and forget)
    const contentDescription = `[${mediaInfo.type}] ${mediaInfo.caption || mediaInfo.fileName || 'media file'}`;

    const reportPromise = insertScamReport({
      telegramUserId: userId,
      content: contentDescription.slice(0, 2000),
      contentType: `media_${mediaInfo.type}`,
      riskScore: result.riskScore,
      confidence: result.confidence,
      flags: result.indicators,
      reasoning: result.reasoning,
    });

    const submissionPromise = insertUserSubmission({
      telegramUserId: userId,
      query: contentDescription.slice(0, 2000),
      result: {
        riskScore: result.riskScore,
        confidence: result.confidence,
        indicators: result.indicators,
        source: result.source,
        mediaType: mediaInfo.type,
      },
    });

    // Build formatted response with Aegis notice if flagged
    let formatted = formatMultimodalScanResult(result, mediaInfo.type);

    if (aegis.status === AEGIS_STATUS.FLAGGED) {
      const notice = aegis.violations[0]?.message || 'Result may be unreliable.';
      formatted = `⚠️ _${escapeMarkdownV2(notice)}_\n\n${formatted}`;
    }

    await bot.sendMessage(chatId, formatted, { parse_mode: 'MarkdownV2' });

    // Wait for DB writes in background
    await Promise.allSettled([reportPromise, submissionPromise]);
  } catch (err) {
    console.error('Media scan error:', err.message);
    bot.sendMessage(chatId, 'An error occurred during media analysis. Please try again.');
  }
}
