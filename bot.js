require('dotenv').config({ override: true });

const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

// --- Validate required env vars ---

const REQUIRED_VARS = ['TELEGRAM_BOT_TOKEN', 'ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_KEY'];
const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BOT_MODE = process.env.BOT_MODE || 'polling';
const PORT = parseInt(process.env.PORT, 10) || 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

// --- Create bot instance ---

let bot;

if (BOT_MODE === 'webhook') {
  bot = new TelegramBot(TOKEN, { webHook: true });
} else {
  bot = new TelegramBot(TOKEN, { polling: true });
}

// --- Register command handlers ---

const registerHelp = require('./commands/help');
const registerScan = require('./commands/scan');
const registerReport = require('./commands/report');
const registerStatus = require('./commands/status');
const registerPremium = require('./commands/premium');
const registerApiKey = require('./commands/apikey');
const registerUsage = require('./commands/usage');

registerHelp(bot);
registerScan(bot);
registerReport(bot);
registerStatus(bot);
registerPremium(bot);
registerApiKey(bot);
registerUsage(bot);

// --- Start usage tracking batch flush ---

const { startBatchFlush, flushBuffer } = require('./usageTracking');
startBatchFlush();

// --- Express server (webhook mode + health check) ---

const app = express();
const apiRouter = require('./routes/api');

app.use('/api', apiRouter);

app.get('/', (req, res) => {
  res.json({
    name: 'ScamShield Bot',
    description: 'AI-powered scam detection for crypto & investment fraud',
    status: 'online',
    endpoints: {
      'POST /api/scan': 'Analyze content for scam indicators (API key required)',
      'GET /api/usage': 'Check your API usage and billing (API key required)',
      'GET /health': 'Service health check',
    },
    telegram: 'Search @YourBotUsername on Telegram to use for free',
    docs: 'Pass Authorization: Bearer <your_api_key> header to authenticate',
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', mode: BOT_MODE, uptime: process.uptime() });
});

if (BOT_MODE === 'webhook') {
  app.use(express.json());

  app.post(`/webhook/${TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });

  app.listen(PORT, async () => {
    const webhookUrl = `${WEBHOOK_URL}/webhook/${TOKEN}`;
    await bot.setWebHook(webhookUrl);
    console.log(`ScamShield bot running in webhook mode on port ${PORT}`);
    console.log(`Webhook set to ${WEBHOOK_URL}/webhook/***`);
  });
} else {
  // In polling mode, still start Express for health checks
  app.listen(PORT, () => {
    console.log(`ScamShield bot running in polling mode`);
    console.log(`Health check available at http://localhost:${PORT}/health`);
  });
}

// --- Error handling ---

bot.on('polling_error', (err) => {
  console.error('Polling error:', err.message);
});

bot.on('webhook_error', (err) => {
  console.error('Webhook error:', err.message);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err.message);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down...');
  await flushBuffer();
  bot.stopPolling();
  process.exit(0);
});
