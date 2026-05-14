# ScamShield Telegram Bot

AI-powered Telegram bot for detecting crypto and investment scams. Combines Claude Sonnet for deep analysis, VirusTotal for URL reputation, blockchain security APIs, and pattern matching for fast, layered detection.

---

## What Is ScamShield?

ScamShield is a security-first Telegram bot that helps users identify crypto scams, phishing links, honeypot tokens, rug pulls, and social engineering attacks in real time. It is designed for:

- Individual crypto users who need fast on-demand risk checks
- Community admins who want automated threat monitoring
- Pro and Unlimited subscribers who get daily Portfolio Shield alerts and advanced features
- Abyssal MEV Defense subscribers who protect DeFi positions from sandwich attacks and drain attempts

ScamShield does not require a wallet signature or private key access for any scan — all scanning is read-only.

---

## Commands

### Core Scan Commands

| Command | Description |
|---------|-------------|
| `/scan [text or URL]` | Analyze content for scam indicators — returns a risk score (1–10) with confidence and reasoning |
| `/contract <address> [chain]` | Deep-scan a token contract for honeypot mechanics, ownership issues, and on-chain red flags |
| `/report [description]` | Submit a suspected scam to the community database to help train detection |
| `/learn` | Return similar known scams for a piece of content (semantic search) |

### Portfolio Shield

| Command | Description |
|---------|-------------|
| `/portfolio <address> [chain]` | One-shot scan of a wallet's holdings for honeypots, rugs, and drainers |
| `/portfolio watch <address> [chain]` | Subscribe to daily DM alerts if any holding crosses Critical risk (Pro/Unlimited) |
| `/portfolio list` | List your watched wallets |
| `/portfolio remove <address>` | Stop watching a wallet |

Supported chains: `eth`, `bsc`, `polygon`, `arb`, `base`, `op`, `avax`, `sol`.

### Account & Billing

| Command | Description |
|---------|-------------|
| `/upgrade` | View Pro and Unlimited subscription plans (powered by Stripe) |
| `/manage` | Manage your active subscription — upgrade, downgrade, or cancel |
| `/apikey` | Generate an API key for the HTTP scan API |
| `/apikey list` | List your API keys |
| `/apikey test` | Verify an API key is active |
| `/usage` | View your API usage and billing for the current month |

### Abyssal MEV Defense

| Command | Description |
|---------|-------------|
| `/abyssal` | Activate Abyssal tier — real-time MEV intercept and DeFi pool protection |

Abyssal is a commission-only tier ($0/month). ScamShield takes 17% of verified value saved from intercepted attacks.

### Invite & Referrals

| Command | Description |
|---------|-------------|
| `/invite` | Generate a referral link — earn bonus scans for each signup |

### Privacy & Data

| Command | Description |
|---------|-------------|
| `/security` | View ScamShield's security posture and how your data is handled |
| `/privacy` | View the privacy policy |
| `/optout` | Opt out of anonymous analytics |
| `/delete` | Permanently delete all your data (GDPR compliant) |

### Utility

| Command | Description |
|---------|-------------|
| `/start` | Onboarding message and quick start |
| `/help` | Full command reference |
| `/ping` | Check bot latency and status |
| `/status` | Bot uptime, scan stats, and system health |

---

## Environment Variables

Set these in your `.env` file or Railway environment variables.

### Required

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `ANTHROPIC_API_KEY` | Claude Sonnet API key for AI-powered scan analysis |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_KEY` | Supabase service role key |
| `STRIPE_SECRET_KEY` | Stripe secret key for billing |

### Billing — Stripe Price IDs

| Variable | Description |
|----------|-------------|
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret from the Stripe dashboard |
| `STRIPE_PRO_PRICE_ID` | Stripe Price ID for the Pro plan |
| `STRIPE_UNLIMITED_PRICE_ID` | Stripe Price ID for the Unlimited plan |
| `STRIPE_ABYSSAL_ACTIVE_PRICE_ID` | Stripe Price ID for Abyssal Active (commission-only, $0/mo) |

### Optional — Expand Scan Coverage

| Variable | Description |
|----------|-------------|
| `VIRUSTOTAL_API_KEY` | VirusTotal API key for URL reputation checks (free tier works) |
| `ALCHEMY_API_KEY` | Alchemy API key for Portfolio Shield on-chain token scanning |
| `WALLET_HASH_SECRET` | Secret for HMAC-hashing watched wallet addresses (required for Portfolio Shield watch lists) |

### Bot Mode

| Variable | Description |
|----------|-------------|
| `BOT_MODE` | `polling` (default, for local dev) or `webhook` (for Railway/production) |
| `PORT` | Express server port (default `3000`) |
| `WEBHOOK_URL` | Public HTTPS URL of your deployment, required when `BOT_MODE=webhook` |

### Threat-Intel Integration

| Variable | Description |
|----------|-------------|
| `THREAT_INTEL_URL` | Supabase URL for the shared threat-intel project |
| `THREAT_INTEL_SERVICE_KEY` | Service role key for the threat-intel project |
| `THREAT_INTEL_RISK_THRESHOLD` | Risk score (1–10) at which scans are forwarded to threat-intel (default `7`) |
| `INTERCEPT_USER_HASH_SALT` | Optional salt for SHA-256 user ID hashing before logging to threat-intel |

### Internal API

| Variable | Description |
|----------|-------------|
| `INTERNAL_SCAN_SECRET` | Shared secret for `/internal/scan`, used by the Discord bot and Flutter backend |

---

## Development Setup

```bash
# 1. Clone and install
cd scamshield-bot
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — at minimum set:
#   TELEGRAM_BOT_TOKEN, ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_KEY, STRIPE_SECRET_KEY

# 3. Apply database migrations (see MIGRATIONS.md)
# Run each SQL file in order via the Supabase SQL Editor

# 4. Start in polling mode
npm start
```

Health check: `http://localhost:3000/health`

---

## Deployment to Railway

ScamShield is configured for Railway deployment via `railway.toml` (Nixpacks build, `node bot.js` start command, `/health` health check, restart on failure up to 5 times).

1. Push the repo to GitHub.
2. Create a Railway project and connect the GitHub repo.
3. Add all required environment variables in the Railway dashboard.
4. Set `BOT_MODE=webhook` and `WEBHOOK_URL=https://<your-app>.up.railway.app`.
5. Deploy. The bot sets and verifies its own Telegram webhook on startup.

---

## Database Migrations

See [MIGRATIONS.md](./MIGRATIONS.md) for the complete guide.

**Short version:**

1. Apply `migrations/001` through `migrations/007` on your main Supabase project (core schema).
2. Apply `db/migrations/002` through `db/migrations/006` on the same project (feature extensions).
3. Apply `db/migrations/007_protected_pools.sql` on the **threat-intel Supabase project** only.

---

## Portfolio Shield

Portfolio Shield scans a wallet's on-chain token holdings for:

- Honeypot tokens (blocked sell transactions)
- Rug pull mechanics (unrenounced ownership, hidden minting)
- Known drainer contracts
- High-risk liquidity patterns

**Privacy design:** Wallet addresses in watch lists are stored as HMAC-SHA-256 hashes (`WALLET_HASH_SECRET`). Raw addresses are never persisted to the database. A database breach does not reveal which wallets are being monitored.

**Background scheduler:** Runs every 60 minutes. If a watched wallet's most recent scan (from a user-triggered `/portfolio` command) shows Critical-risk holdings, the user receives a DM alert. Operates in log-only degraded mode when `ALCHEMY_API_KEY` is not configured.

---

## Abyssal MEV Defense

Abyssal is the top tier for active DeFi participants:

- Real-time mempool monitoring for sandwich attacks on your pool positions
- Automatic intercept transactions to front-run drain attempts
- Commission-based billing: 17% of verified value saved, tracked in `commission_transactions`
- Protected pool addresses stored in the threat-intel Supabase project (`protected_pools` table)
- Activate with `/abyssal`

---

## HTTP API

Pro and Unlimited subscribers can call the scan API programmatically.

```
POST /api/scan
Authorization: Bearer <api_key>
Content-Type: application/json

{ "content": "text or URL to scan" }
```

Generate keys with `/apikey`. View usage with `/usage`. The internal endpoint `/internal/scan` uses `INTERNAL_SCAN_SECRET` for machine-to-machine calls (Discord bot, Flutter backend).

---

## Dependency Freeze Policy

- Lock files (`package-lock.json`) are committed on first install and tracked in version control.
- Unexpected lock file changes are treated as a build failure signal.
- `npm install --latest` and unsolicited dependency upgrades require explicit operator approval before merging.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Bot framework | `node-telegram-bot-api` |
| AI analysis | `@anthropic-ai/sdk` (Claude Sonnet) |
| Database | Supabase (PostgreSQL + RLS) |
| Billing | Stripe |
| Web server | Express |
| Blockchain data | Alchemy API (EVM + Solana) |
| URL reputation | VirusTotal API |
| Runtime | Node.js 18+ |
| Deployment | Railway |

---

## License

Proprietary. All rights reserved.
