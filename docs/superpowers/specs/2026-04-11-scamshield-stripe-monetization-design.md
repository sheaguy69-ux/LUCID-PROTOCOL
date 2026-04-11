# ScamShield Stripe Monetization — Design Spec

**Date:** 2026-04-11
**Status:** Draft
**Goal:** Wire up Stripe payments via Telegram so ScamShield can charge for Pro ($8/mo) and Unlimited ($17/mo) tiers, with a 7-day free trial. No free tier — all scans require an active subscription.

---

## Context

ScamShield has a working Telegram bot and REST API with AI-powered scam detection. Pricing tiers are designed (Free/Pro/Unlimited), metering and API key systems are built, but there's no payment collection or tier enforcement. Users currently get unlimited access for free.

This spec adds the minimum needed to start charging: Stripe integration via Telegram, subscription lifecycle handling, and scan gating by tier.

---

## Pricing Tiers

| Tier | Price | Scans/Month | Features | Trial |
|------|-------|-------------|----------|-------|
| Pro | $8/mo | 1,000 | Telegram bot + API access + full Aegis oversight | 7 days free |
| Unlimited | $17/mo | Unlimited | Everything in Pro + admin dashboard, custom Aegis policies | 7 days free |

**No free tier.** All scans require an active subscription (including trialing). Non-subscribers are blocked with an upgrade prompt directing them to start a 7-day free trial.

---

## Architecture

### New Files
- `commands/upgrade.js` — `/upgrade` command with inline keyboard for tier selection
- `commands/manage.js` — `/manage` command to open Stripe Customer Portal
- `routes/webhook.js` — Stripe webhook handler for subscription events
- `billing.js` — Stripe client setup, checkout session creation, portal session creation
- `migrations/003_subscribers.sql` — subscribers table

### Modified Files
- `metering.js` — add tier lookup before scan counting; enforce limits per tier
- `bot.js` — register `/upgrade` and `/manage` commands, mount webhook route
- `routes/api.js` — check subscriber tier before allowing API scans
- `.env` / `.env.example` — add Stripe env vars

---

## Database: `subscribers` Table

```sql
-- migrations/003_subscribers.sql
CREATE TABLE IF NOT EXISTS subscribers (
  telegram_user_id BIGINT PRIMARY KEY,
  telegram_username TEXT,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT,
  subscription_tier TEXT NOT NULL DEFAULT 'none'
    CHECK (subscription_tier IN ('none', 'pro', 'unlimited')),
  subscription_status TEXT NOT NULL DEFAULT 'none'
    CHECK (subscription_status IN ('active', 'trialing', 'canceled', 'past_due', 'none')),
  trial_ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_subscribers_stripe_customer ON subscribers(stripe_customer_id);
```

---

## Stripe Setup (Manual Steps)

1. Create two Products in Stripe Dashboard:
   - **ScamShield Pro** — $8/mo recurring
   - **ScamShield Unlimited** — $17/mo recurring
2. Copy the Price IDs
3. Add to `.env`:
   ```
   STRIPE_SECRET_KEY=sk_live_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   STRIPE_PRO_PRICE_ID=price_...
   STRIPE_UNLIMITED_PRICE_ID=price_...
   ```
4. After deploying, create webhook in Stripe Dashboard pointing to `https://<bot-host>/webhooks/stripe` with events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`

---

## Flow: `/upgrade` Command

1. User sends `/upgrade` in Telegram
2. Bot replies with message showing both tiers + inline keyboard:
   ```
   🛡️ Upgrade ScamShield

   Pro ($8/mo) — 1,000 scans, API access, full Aegis
   Unlimited ($17/mo) — Unlimited scans, admin dashboard

   Both include a 7-day free trial. Cancel anytime.

   [Try Pro Free] [Try Unlimited Free]
   ```
3. User taps a button → bot receives callback query
4. Bot calls `billing.createCheckoutSession(telegramUserId, telegramUsername, tier)`
5. `billing.js` creates Stripe Checkout Session:
   ```js
   const session = await stripe.checkout.sessions.create({
     mode: 'subscription',
     payment_method_types: ['card'],
     line_items: [{ price: priceId, quantity: 1 }],
     subscription_data: { trial_period_days: 7 },
     client_reference_id: String(telegramUserId),
     metadata: { telegram_user_id: String(telegramUserId), tier },
     success_url: `${BASE_URL}/payment-success`,
     cancel_url: `${BASE_URL}/payment-cancel`,
   });
   ```
6. Bot sends checkout URL to user:
   ```
   ✅ Your checkout link is ready (valid for 24 hours):
   [Pay with Stripe →](session.url)
   ```
7. User opens browser, completes payment
8. Stripe fires `checkout.session.completed` webhook

---

## Flow: Webhook Handler (`/webhooks/stripe`)

All events verified with `stripe.webhooks.constructEvent()` using the webhook secret.

### `checkout.session.completed`
- Extract `telegram_user_id` from `client_reference_id` or `metadata`
- Extract `stripe_customer_id` from `session.customer`
- Extract `stripe_subscription_id` from `session.subscription`
- Retrieve subscription to check trial status
- Upsert into `subscribers`:
  - `subscription_tier` from metadata
  - `subscription_status`: 'trialing' if in trial, 'active' if charged
  - `trial_ends_at`: from subscription.trial_end
- Send Telegram confirmation message to user:
  ```
  🎉 Welcome to ScamShield Pro! Your 7-day trial starts now.
  You won't be charged until [trial_end_date].
  Use /usage to check your scan balance.
  ```

### `customer.subscription.updated`
- Look up subscriber by `stripe_customer_id`
- Update `subscription_status` (active, past_due, canceled, trialing)
- If downgraded/changed, update `subscription_tier`

### `customer.subscription.deleted`
- Look up subscriber by `stripe_customer_id`
- Set `subscription_tier = 'none'`, `subscription_status = 'none'`
- Notify user via Telegram:
  ```
  Your ScamShield subscription has ended. You'll need to resubscribe to scan.
  Type /upgrade anytime to start a new subscription.
  ```

### `invoice.payment_failed`
- Look up subscriber by `stripe_customer_id`
- Update `subscription_status = 'past_due'`
- Notify user via Telegram:
  ```
  ⚠️ Your ScamShield payment failed. Please update your payment method:
  Type /manage to update your billing info.
  ```

---

## Flow: `/manage` Command

1. User sends `/manage`
2. Bot looks up `stripe_customer_id` from `subscribers` table
3. If no customer ID → reply "You don't have an active subscription. Type /upgrade to get started."
4. Creates Stripe Customer Portal session:
   ```js
   const portalSession = await stripe.billingPortal.sessions.create({
     customer: stripeCustomerId,
     return_url: `${BASE_URL}`,
   });
   ```
5. Sends portal URL to user:
   ```
   Manage your subscription, update payment method, or cancel:
   [Manage Billing →](portalSession.url)
   ```

---

## Tier Enforcement

### Gate Logic (used by both bot and API)

```
getSubscriberTier(telegramUserId) → { tier, status }

if status NOT IN ('active', 'trialing'):
  → BLOCK: "ScamShield requires a subscription. Type /upgrade to start your free 7-day trial."

if tier == 'pro' AND scans_this_month >= 1000:
  → BLOCK: "You've used all 1,000 scans this month. Type /upgrade to go Unlimited."

if tier == 'unlimited':
  → ALLOW (no limit)

→ ALLOW and increment scan count
```

### In `metering.js`

Replace the existing free-tier + overage logic entirely:
1. Call `getSubscriberTier(telegramUserId)`
2. If not active/trialing → return `{ allowed: false, reason: 'no_subscription' }`
3. If pro and scans >= 1,000 → return `{ allowed: false, reason: 'limit_exceeded', used, limit: 1000 }`
4. If unlimited → always allow
5. Increment scan count and return `{ allowed: true }`
6. Remove all $0.05 overage billing logic

### In `bot.js` (Telegram `/scan` command)

Before running the scan:
```js
const check = await checkScanAllowance(telegramUserId);
if (!check.allowed) {
  const msg = check.reason === 'no_subscription'
    ? 'ScamShield requires a subscription.\nType /upgrade to start your free 7-day trial.'
    : `You've used all ${check.limit} scans this month.\nType /upgrade to go Unlimited.`;
  return bot.sendMessage(chatId, msg);
}
```

### In `routes/api.js` (REST API `/api/scan`)

Before running the scan:
- Look up the API key's `telegram_user_id`
- Run same gate check
- Return 402 with JSON: `{ error: "subscription_required" }` or 429 with `{ error: "scan_limit_exceeded", used, limit }`

---

## Updated `/usage` Command

Enhance existing `/usage` to show tier info:
```
📊 ScamShield Usage (April 2026)

Tier: Pro (trial ends Apr 18)
Scans used: 47 / 1,000
API keys: 2 active

Type /manage to manage your subscription.
```

---

## File Structure

```
scamshield-bot/
├── billing.js              # NEW: Stripe client, checkout, portal
├── commands/
│   ├── upgrade.js          # NEW: /upgrade with tier selection
│   └── manage.js           # NEW: /manage billing portal
├── routes/
│   ├── api.js              # MODIFIED: add tier check
│   └── webhook.js          # NEW: Stripe webhook handler
├── metering.js             # MODIFIED: tier-aware scan limits
├── bot.js                  # MODIFIED: register commands, mount webhook
└── migrations/
    └── 003_subscribers.sql # NEW: subscribers table
```

---

## Verification Plan

1. **Stripe setup**: Create test products/prices in Stripe test mode first
2. **Upgrade flow**: Run bot locally, type `/upgrade`, verify checkout URL opens Stripe
3. **Webhook**: Use Stripe CLI (`stripe listen --forward-to localhost:PORT/webhooks/stripe`) to forward test events
4. **Tier gating**: After "subscribing" in test mode, verify scan limit increases from 100 → 1,000
5. **No-subscription enforcement**: Without subscribing, verify `/scan` is blocked with upgrade prompt
6. **Manage flow**: Type `/manage`, verify portal URL opens Stripe Customer Portal
7. **Cancellation**: Cancel via portal, verify tier resets to free
8. **Usage display**: Type `/usage`, verify tier and scan count display correctly
9. **API enforcement**: Hit `/api/scan` with API key, verify same tier limits apply
10. **Deploy**: Push to Railway, configure production Stripe webhook, run end-to-end test
