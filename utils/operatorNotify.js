// Forward privacy/security/data requests to the operator's personal Telegram.
//
// Set OPERATOR_CHAT_ID in env to your own Telegram user ID. To find it: message
// @userinfobot on Telegram and copy the numeric ID it replies with.

function operatorChatId() {
  const raw = process.env.OPERATOR_CHAT_ID;
  if (!raw) return null;
  const id = parseInt(raw, 10);
  return Number.isFinite(id) ? id : null;
}

function describeUser(msg) {
  const u = msg.from || {};
  const handle = u.username ? `@${u.username}` : '(no username)';
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || '(no name)';
  return `${name} ${handle} · id ${u.id}`;
}

async function notifyOperator(bot, kind, msg, body) {
  const opId = operatorChatId();
  if (!opId) {
    console.warn(`[operatorNotify] OPERATOR_CHAT_ID not set — ${kind} request from ${msg.from?.id} not forwarded`);
    return false;
  }
  const text = [
    `🔔 *${kind}* request`,
    ``,
    `*From:* ${describeUser(msg)}`,
    `*Chat:* ${msg.chat.id}`,
    `*When:* ${new Date().toISOString()}`,
    body ? `\n*Message:*\n${body}` : '',
  ].join('\n');
  try {
    await bot.sendMessage(opId, text, { parse_mode: 'Markdown', disable_web_page_preview: true });
    return true;
  } catch (err) {
    console.error(`[operatorNotify] failed to forward ${kind}:`, err.message);
    return false;
  }
}

module.exports = { notifyOperator };
