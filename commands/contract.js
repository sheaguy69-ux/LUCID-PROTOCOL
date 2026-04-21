const { scanWeb3Addresses } = require('../web3Scanner');
const { formatContractResult, escapeMarkdownV2 } = require('../utils/formatter');
const { checkScanAllowance, bumpFreeScanUsage } = require('../metering');
const { buildUpsellMessage } = require('../utils/upsell');
const { fireIntercept } = require('../intelClient');

const EVM_ADDRESS_RE = /\b(0x[a-fA-F0-9]{40})\b/;

const CHAIN_HINTS = {
  eth: 1, ethereum: 1,
  bsc: 56, bnb: 56, binance: 56,
  polygon: 137, matic: 137,
  arb: 42161, arbitrum: 42161,
  base: 8453,
  op: 10, optimism: 10,
  avax: 43114, avalanche: 43114,
};

module.exports = function registerContractCommand(bot) {
  bot.onText(/\/contract(?:@\w+)?\s+(.+)/s, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const input = match[1].trim();

    if (!EVM_ADDRESS_RE.test(input)) {
      return bot.sendMessage(
        chatId,
        'No valid EVM address found\\.\n\nUsage: `/contract [address] [chain?]`\n\nExamples:\n`/contract 0xdAC17F958D2ee523a2206206994597C13D831ec7`\n`/contract 0x\\.\\.\\. bsc`',
        { parse_mode: 'MarkdownV2' }
      );
    }

    const check = await checkScanAllowance(userId);
    if (!check.allowed) {
      return bot.sendMessage(chatId, buildUpsellMessage(check), { parse_mode: 'Markdown' });
    }

    // Parse optional chain hint from end of input
    const tokens = input.toLowerCase().split(/\s+/);
    const chainHint = CHAIN_HINTS[tokens[tokens.length - 1]] || null;

    bot.sendChatAction(chatId, 'typing');

    try {
      const blockchainResult = await scanWeb3Addresses(input, chainHint);

      if (!blockchainResult) {
        return bot.sendMessage(chatId, 'Could not extract a valid address. Please try again.');
      }

      const formatted = formatContractResult(blockchainResult);
      await bot.sendMessage(chatId, formatted, { parse_mode: 'MarkdownV2' });

      // Harvest intercept — honeypot/malicious wallet = high-value intel.
      // intelClient gates internally on risk threshold.
      const risk = blockchainResult.honeypotDetected ? 9
        : blockchainResult.maliciousWalletDetected ? 8
        : (blockchainResult.highestRisk || 0);
      fireIntercept({
        rawText: input,
        urls: [],
        contracts: blockchainResult.addresses || [],
        risk,
        sourceProduct: 'scamshield_tg',
        userId,
        mediaType: 'contract',
      }).catch(() => { /* swallow */ });

      // Free-tier: bonus first, else bump daily.
      if (check.isFree) {
        if (check.isBonus) {
          consumeBonusScan(userId).then((newBalance) => {
            bot.sendMessage(
              chatId,
              `_Bonus scan used. ${newBalance ?? 0} bonus remaining. /invite friends for +5 each._`,
              { parse_mode: 'Markdown' }
            ).catch(() => {});
          }).catch(() => {});
        } else {
          bumpFreeScanUsage(userId).then((newCount) => {
            bot.sendMessage(
              chatId,
              `_${newCount}/${check.limit} free scans today${newCount >= check.limit ? ' — next reset 00:00 UTC. /invite for bonus scans.' : ''}. /upgrade for unlimited._`,
              { parse_mode: 'Markdown' }
            ).catch(() => {});
          }).catch(() => {});
        }
      }
    } catch (err) {
      console.error('Contract command error:', err.message);
      bot.sendMessage(chatId, 'An error occurred during on-chain analysis. Please try again.');
    }
  });

  bot.onText(/\/contract(?:@\w+)?$/, (msg) => {
    bot.sendMessage(
      msg.chat.id,
      'Usage: `/contract [address] [chain?]`\n\nExamples:\n`/contract 0xdAC17F958D2ee523a2206206994597C13D831ec7`\n`/contract 0x... bsc`\n`/contract 0x... polygon`',
      { parse_mode: 'Markdown' }
    );
  });
};
