# ScamShield Telegram Bot

AI-powered Telegram bot for detecting crypto and investment scams. Uses Claude Sonnet for risk analysis, VirusTotal for URL reputation, and pattern matching for fast detection.

## Commands

| Command | Description |
|---------|-------------|
| `/scan [text/url]` | Analyze content for scam indicators (risk score 1-10) |
| `/report [description]` | Submit a suspected scam to the community database |
| `/status` | Bot uptime and statistics |
| `/premium` | View premium features |
| `/help` | Command list |

## Setup

### 1. Prerequisites

- Node.js 18+
- Telegram bot token (from [@BotFather](https://t.me/BotFather))
- Anthropic API key
- Supabase project
- VirusTotal API key (free tier works)

### 2. Install Dependencies

```bash
cd scamshield-bot
npm install
```

### 3. Environment Variables

```bash
cp .env.example .env
```

Fill in your `.env`:

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | From BotFather |
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_KEY` | Yes | Supabase service role key |
| `VIRUSTOTAL_API_KEY` | No | VirusTotal API key (URL scanning) |
| `BOT_MODE` | No | `polling` (default) or `webhook` |
| `WEBHOOK_URL` | No | Required for webhook mode |
| `PORT` | No | Express port (default: 3000) |

### 4. Database Setup

Run `migrations/001_initial_schema.sql` in your Supabase SQL Editor. This creates:

- `scam_reports` — scan results and risk scores
- `scam_signatures` — known scam patterns
- `user_submissions` — user query tracking

### 5. Run Locally

```bash
npm run dev
```

The bot starts in polling mode by default. Open Telegram and send `/help` to your bot.

## Deploy to Railway

### Option A: Script

```bash
chmod +x deploy.sh
./deploy.sh
```

### Option B: Manual

1. Install Railway CLI: `npm install -g @railway/cli`
2. Login: `railway login`
3. Create project: `railway init`
4. Set env vars: `railway variables set KEY=value`
5. Set `BOT_MODE=webhook` and `WEBHOOK_URL=https://your-app.up.railway.app`
6. Deploy: `railway up`

## Architecture

```
bot.js                    Entry point (Telegram + Express)
├── commands/
│   ├── scan.js           /scan — full analysis pipeline
│   ├── report.js         /report — community submissions
│   ├── status.js         /status — stats from DB
│   ├── help.js           /help & /start
│   └── premium.js        /premium — upgrade prompt
├── scamDetector.js       Multi-stage detection engine
│   ├── VirusTotal        URL reputation check
│   ├── Keyword analysis  Weighted pattern matching
│   └── Claude Sonnet     AI risk scoring
├── database.js           Supabase queries
└── utils/
    ├── urlExtractor.js   URL parsing & VT encoding
    └── formatter.js      Telegram MarkdownV2 formatting
```

## Detection Pipeline

1. **Parse input** — extract URLs, determine content type
2. **VirusTotal** — check URL reputation (4 req/min rate limit)
3. **Keyword analysis** — weighted pattern matching (high/medium/low severity)
4. **Claude Sonnet** — AI analysis returning structured risk assessment
5. **Score aggregation** — Claude 60% + VT 25% + Keywords 15%

If any stage fails, the bot gracefully degrades and returns partial results.

## License

MIT
