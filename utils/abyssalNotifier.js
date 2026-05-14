/**
 * abyssalNotifier.js — Telegram alert dispatch for Abyssal MEV defense events.
 *
 * Never throws. Every send is wrapped with .catch(() => {}).
 *
 * Public API:
 *   sendAttackDetected(bot, telegramUserId, attack)
 *   sendDefenseResult(bot, telegramUserId, result)
 *   sendPoolAdded(bot, telegramUserId, poolAddress, isActive)
 */

// ── Helpers ──────────────────────────────────────────────────────────

function shortAddr(addr) {
  if (!addr || addr.length <= 10) return addr || 'unknown';
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

function weiToEth(wei) {
  if (!wei || wei === '0') return '0.000000';
  return (Number(wei) / 1e18).toFixed(6);
}

function ethscanTxLink(txHash) {
  if (!txHash) return 'unknown';
  return `https://etherscan.io/tx/${txHash}`;
}

/**
 * Send an attack-detected alert to a Telegram user.
 *
 * @param {Object} bot - Telegram bot instance
 * @param {number|string} telegramUserId - Telegram user ID (string or number)
 * @param {Object} attack - attack object from mempoolDetector
 * @param {string} attack.type - 'sandwich'|'jit_liquidity'|'frontrun'|'backrun'
 * @param {number} attack.confidence - 0-100 confidence score
 * @param {string} attack.estimatedValueAtRisk - wei string
 * @param {string} attack.txHash - transaction hash
 * @param {string} [attack.poolAddress] - optional pool address override
 */
async function sendAttackDetected(bot, telegramUserId, attack) {
  const poolAddr = attack.poolAddress || attack.pool_address || '';
  const ethValue = weiToEth(attack.estimatedValueAtRisk);
  const typeLabel = attack.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const text = [
    '🚨 *MEV Attack Detected*',
    '',
    `Pool: \`${shortAddr(poolAddr)}\``,
    `Type: ${typeLabel}`,
    `Value at Risk: ${ethValue} ETH`,
    `Confidence: ${attack.confidence}%`,
    `Tx: [${shortAddr(attack.txHash)}](${ethscanTxLink(attack.txHash)})`,
  ].join('\n');

  bot.sendMessage(telegramUserId, text, { parse_mode: 'Markdown' }).catch(() => {});
}

/**
 * Send a defense result (success or alert-only) to a Telegram user.
 *
 * @param {Object} bot
 * @param {number|string} telegramUserId
 * @param {Object} result
 * @param {boolean} result.success - whether active defense was triggered
 * @param {string} result.type - attack type
 * @param {string} result.estimatedValueAtRisk - wei string
 * @param {string} [result.poolAddress] - pool address
 * @param {string} [result.commissionEth] - optional: commission in ETH (pre-formatted)
 * @param {string} [result.commissionWei] - optional: commission in wei
 */
async function sendDefenseResult(bot, telegramUserId, result) {
  const poolAddr = result.poolAddress || '';
  const ethValue = weiToEth(result.estimatedValueAtRisk);
  const commEth = result.commissionEth || weiToEth(result.commissionWei || '0');

  let text;
  if (result.success) {
    text = [
      '✅ *Attack Defended!*',
      '',
      `Pool: \`${shortAddr(poolAddr)}\``,
      `Value Saved: ${ethValue} ETH`,
      `Commission earned: ${commEth} ETH (17%)`,
    ].join('\n');
  } else {
    const typeLabel = (result.type || 'mev attack').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    text = [
      '⚠️ *Attack Detected — Alert Only*',
      '',
      `Pool: \`${shortAddr(poolAddr)}\``,
      `Type: ${typeLabel}`,
      `Value at Risk: ${ethValue} ETH`,
      '',
      'Upgrade to Active Defense to auto-block.',
    ].join('\n');
  }

  bot.sendMessage(telegramUserId, text, { parse_mode: 'Markdown' }).catch(() => {});
}

/**
 * Send a "now watching" notification when a pool is added.
 *
 * @param {Object} bot
 * @param {number|string} telegramUserId
 * @param {string} poolAddress
 * @param {boolean} isActive - whether active defense is enabled
 */
async function sendPoolAdded(bot, telegramUserId, poolAddress, isActive) {
  const mode = isActive ? 'Active Defense' : 'Alert Only';

  const text = [
    '🔭 *Now Watching*',
    '',
    `Pool: \`${shortAddr(poolAddress)}\``,
    `Mode: ${mode}`,
  ].join('\n');

  bot.sendMessage(telegramUserId, text, { parse_mode: 'Markdown' }).catch(() => {});
}

module.exports = {
  sendAttackDetected,
  sendDefenseResult,
  sendPoolAdded,
};
