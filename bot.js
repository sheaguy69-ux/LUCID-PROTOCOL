require('dotenv').config({ override: true });

const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

// --- Validate required env vars ---

const REQUIRED_VARS = ['TELEGRAM_BOT_TOKEN', 'ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_KEY', 'STRIPE_SECRET_KEY'];
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
const registerLearn = require('./commands/learn');
const registerMediaScan = require('./commands/mediaScan');
const registerUpgrade = require('./commands/upgrade');
const registerManage = require('./commands/manage');
const registerContract = require('./commands/contract');
const registerInvite = require('./commands/invite');
const registerStart = require('./commands/start');
const registerPing = require('./commands/ping');
const registerSecurity = require('./commands/security');
const registerPrivacy = require('./commands/privacy');
const registerOptout = require('./commands/optout');
const registerDelete = require('./commands/delete');
const registerPortfolio = require('./commands/portfolio');
const registerAbyssal = require('./commands/abyssal');
const registerStars = require('./commands/stars');
const { sendStarsInvoice, handlePreCheckoutQuery, handleSuccessfulPayment } = require('./starsPayment');

registerStart(bot);
registerPing(bot);
registerHelp(bot);
registerScan(bot);
registerContract(bot);
registerReport(bot);
registerStatus(bot);
registerPremium(bot);
registerApiKey(bot);
registerUsage(bot);
registerLearn(bot);
registerMediaScan(bot);
registerUpgrade(bot);
registerManage(bot);
registerInvite(bot);
registerSecurity(bot);
registerPrivacy(bot);
registerOptout(bot);
registerDelete(bot);
registerPortfolio(bot);
registerAbyssal(bot);
registerStars(bot);

// --- Register Stars payment handlers ---

bot.on('pre_checkout_query', (query) => handlePreCheckoutQuery(bot, query));
bot.on('successful_payment', (msg) => handleSuccessfulPayment(bot, msg));

// --- Initialize Aegis multi-agent oversight ---

const aegis = require('./aegisAgent');
aegis.init();

// --- Start Portfolio Shield daily alert scheduler ---

const { startPortfolioScheduler } = require('./utils/portfolioScheduler');
const portfolioScheduler = startPortfolioScheduler(bot);

// --- Start usage tracking batch flush ---

const { startBatchFlush, flushBuffer } = require('./usageTracking');
startBatchFlush();

// --- Start Telegram Stars poller ---

const { startStarPoller, stopStarPoller } = require('./stars');
const starPoller = startStarPoller(bot, 60);

// ── Mempool Detector ──
const { createMempoolDetector } = require('./utils/mempoolDetector');
const detector = createMempoolDetector(bot);
detector.start();

const shutdown = async (signal) => {
  console.log(`${signal} received, shutting down...`);
  detector.stop();
  stopStarPoller();
  await flushBuffer();
  aegis.shutdown();
  portfolioScheduler.stop();
  bot.stopPolling();
  process.exit(0);
};
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

// --- Express server (webhook mode + health check) ---

const path = require('path');
const app = express();
const apiRouter = require('./routes/api');
const internalScanRouter = require('./routes/internalScan');

// Serve static files (landing page, logo, etc.)
app.use(express.static(path.join(__dirname, 'public')));

// Stripe webhook — must be mounted with raw body BEFORE any express.json() middleware
const createWebhookRouter = require('./routes/webhook');
app.use('/webhooks/stripe', express.raw({ type: 'application/json' }), createWebhookRouter(bot));

app.use('/api', apiRouter);
app.use('/internal', internalScanRouter);

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
    try {
      await bot.setWebHook(webhookUrl);
      // Verify it actually stuck
      const info = await bot.getWebHookInfo();
      if (!info.url || !info.url.includes(TOKEN)) {
        console.error(`[FATAL] Webhook verification failed. Expected token in URL, got: ${info.url}`);
        process.exit(1);
      }
      console.log(`ScamShield bot running in webhook mode on port ${PORT}`);
      console.log(`Webhook verified: ${WEBHOOK_URL}/webhook/***`);
    } catch (err) {
      console.error(`[FATAL] Failed to set webhook: ${err.message}`);
      process.exit(1);
    }
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

// Daily TikTok content engine — fires at 12:45pm CT
require('./contentScheduler');

// X/Twitter scan reply engine — polls every 30 min
require('./twitterScheduler');


