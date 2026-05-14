# ScamShield Database Migrations

The bot uses two migration directories with overlapping numbers but different purposes.
Apply `migrations/` first (core schema), then `db/migrations/` (feature extensions).

---

## Migration Directories

### `migrations/` — Core Schema (apply first, in order)

These define the base tables and must run before any other migrations.

| File | Description |
|------|-------------|
| `001_initial_schema.sql` | `scam_reports`, `scam_signatures`, `user_submissions` tables + indexes + RLS policies |
| `002_api_keys_and_usage.sql` | `api_keys` table for bring-your-own-key feature |
| `003_gemini_embedding2_multimodal.sql` | Adds `media_type` column for multimodal scan support |
| `004_subscribers.sql` | `subscribers` table for Stripe billing (pro/unlimited tiers) |
| `005_discord_guilds.sql` | `discord_guilds` table for Discord integration (WS5) |
| `006_free_scan_tier.sql` | `free_scan_usage` table for daily free scan limits |
| `007_tracked_wallets.sql` | `tracked_wallets` table for Portfolio Shield watch lists |

### `db/migrations/` — Feature Extensions (apply second, in order)

These extend the schema after the core tables exist. Numbering starts at 002 but is independent of `migrations/002`.

| File | Description |
|------|-------------|
| `002_abyssal_subscribers.sql` | Adds `abyssal` JSONB column to `subscribers` for Abyssal tier metadata |
| `003_commission_transactions.sql` | `commission_transactions` table for 17% MEV defense commissions |
| `004_fix_tier_check.sql` | Patches `subscribers.subscription_tier` CHECK constraint to include `abyssal_active` |
| `005_fix_fk_cascade.sql` | Adds `ON DELETE CASCADE` to `commission_transactions` FK |
| `006_referral_bonus.sql` | Adds `bonus_scan_balance` to `free_scan_usage` + `referrals` table |
| `007_protected_pools.sql` | `protected_pools` table — see note below about which project to target |

---

## Correct Application Order

Run in the following sequence in your Supabase SQL Editor (main ScamShield project):

```
migrations/001_initial_schema.sql
migrations/002_api_keys_and_usage.sql
migrations/003_gemini_embedding2_multimodal.sql
migrations/004_subscribers.sql
migrations/005_discord_guilds.sql
migrations/006_free_scan_tier.sql
migrations/007_tracked_wallets.sql

db/migrations/002_abyssal_subscribers.sql
db/migrations/003_commission_transactions.sql
db/migrations/004_fix_tier_check.sql
db/migrations/005_fix_fk_cascade.sql
db/migrations/006_referral_bonus.sql
```

---

## Special Cases

### `db/migrations/004_fix_tier_check.sql` and `005_fix_fk_cascade.sql`

These are **patches** for tables created by `migrations/004_subscribers.sql` and
`db/migrations/003_commission_transactions.sql` respectively. They must run after
the tables they patch exist.

### `db/migrations/007_protected_pools.sql` — Threat-Intel Project

This migration targets the **threat-intel Supabase project** (`THREAT_INTEL_URL` /
`THREAT_INTEL_SERVICE_KEY`) — **not** the main ScamShield project. Apply it separately
in the threat-intel project's SQL Editor.

```
# Apply to: https://kociyrlnqlnqxgwqvvga.supabase.co
db/migrations/007_protected_pools.sql
```

### Abyssal Schema — Enterprise Scaffold

The enterprise scaffold at `../../scamshield/scamshield-enterprise/db/migrations/`
contains `001_abyssal_schema.sql` which defines `protected_pools` with a UUID primary
key (an earlier version of the schema). This file exists and targets the same
threat-intel project. If you are setting up the enterprise tier from scratch, prefer
`db/migrations/007_protected_pools.sql` (uses BIGINT identity PK) over the enterprise
scaffold version, or reconcile the schema difference manually.

---

## Notes

- All migrations are idempotent where possible (`CREATE TABLE IF NOT EXISTS`,
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS`).
- The `migrations/` numbering and `db/migrations/` numbering overlap by design —
  they are separate concerns and should not be merged or renumbered.
- No migration runner is configured; apply SQL files manually via the Supabase
  dashboard SQL Editor or the Supabase CLI (`supabase db push`).
