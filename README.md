# ScamShield Telegram Bot

AI-powered Telegram bot for detecting crypto and investment scams. Uses Claude Sonnet for risk analysis, VirusTotal for URL reputation, and pattern matching for fast detection.

## Commands

| Command | Description |
|---------|-------------|
| `/scan [text/url]` | Analyze content for scam indicators (risk score 1-10) |
| `/report [description]` | Submit a suspected scam to the community database |
| `/apikey` | Generate an API key (also: `/apikey list`, `/apikey test`) |
| `/usage` | View API usage and billing for current month |
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

Run both migrations in your Supabase SQL Editor:

- `migrations/001_initial_schema.sql` — scam_reports, scam_signatures, user_submissions
- `migrations/002_api_keys_and_usage.sql` — api_keys, api_scans, api_usage_monthly

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

## API Access (for Developers)

ScamShield exposes a REST API for third-party integrations. Users generate API keys via the `/apikey` Telegram command.

### Authentication

Pass your API key via either header:

```
Authorization: Bearer sg_live_abc123...
X-API-Key: sg_live_abc123...
```

### POST /api/scan

Analyze content for scam indicators.

**Request:**

```bash
curl -X POST https://your-app.up.railway.app/api/scan \
  -H "Authorization: Bearer sg_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"content": "Double your BTC! Send 0.1 ETH to 0xABC and get 1 ETH back!"}'
```

**Response:**

```json
{
  "success": true,
  "data": {
    "risk_score": 9,
    "confidence": 92,
    "indicators": ["guaranteed returns", "send crypto to", "double your money"],
    "reasoning": "Classic crypto doubling scam pattern...",
    "advice": "Do not send any funds. This is almost certainly a scam.",
    "content_type": "text",
    "virus_total": null,
    "analysis_source": "full_analysis",
    "response_time_ms": 2340
  },
  "usage": {
    "scans_used": 42,
    "scans_remaining": 58,
    "overage_cost": 0,
    "billing_status": "free"
  }
}
```

**Response Headers:**

| Header | Description |
|--------|-------------|
| `X-Scans-Used` | Total scans this month |
| `X-Scans-Remaining` | Free tier scans remaining |
| `X-Billing-Status` | `free` or `overage` |
| `X-Test-Mode` | Present if using a test key |

### GET /api/usage

Check your current month's usage and billing.

```bash
curl https://your-app.up.railway.app/api/usage \
  -H "Authorization: Bearer sg_live_YOUR_KEY"
```

### Pricing

| Tier | Scans | Cost |
|------|-------|------|
| Free | First 100/month | $0 |
| Overage | Each scan after 100 | $0.05/scan |

### Key Types

| Prefix | Type | Description |
|--------|------|-------------|
| `sg_live_` | Live | Production use, counts toward billing |
| `sg_test_` | Test | Testing, flagged with `X-Test-Mode` header |

### Error Responses

```json
{"error": "Missing API key. Provide via Authorization: Bearer <key> or X-API-Key header."}  // 401
{"error": "Invalid or revoked API key."}  // 401
{"error": "Missing required field: content (string)"}  // 400
{"error": "Content exceeds 4000 character limit."}  // 400
```

## Architecture

```
bot.js                    Entry point (Telegram + Express + API)
├── routes/
│   └── api.js            POST /api/scan, GET /api/usage
├── commands/
│   ├── scan.js           /scan — full analysis pipeline
│   ├── report.js         /report — community submissions
│   ├── apikey.js         /apikey — generate/list API keys
│   ├── usage.js          /usage — view usage & billing
│   ├── status.js         /status — stats from DB
│   ├── help.js           /help & /start
│   └── premium.js        /premium — upgrade prompt
├── scamDetector.js       Multi-stage detection engine
├── apiKeySystem.js       Key generation (sg_live_/sg_test_), SHA-256 hashing
├── usageTracking.js      Batch scan logging (flush every 60s)
├── metering.js           Monthly usage tracking & overage billing
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
