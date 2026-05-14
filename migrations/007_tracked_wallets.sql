-- Portfolio Shield: wallets users have asked us to watch.
-- We do NOT store raw addresses. address_hash = HMAC-SHA-256(WALLET_HASH_SECRET, address).
-- This means a database leak does not expose the wallets we're tracking.
-- Lookups work by re-hashing whatever the user submits.

CREATE TABLE tracked_wallets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL,
  address_hash TEXT NOT NULL,
  chain TEXT NOT NULL,
  label TEXT,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  last_scanned_at TIMESTAMPTZ,
  last_risk_summary JSONB,
  UNIQUE (telegram_user_id, address_hash, chain)
);

CREATE INDEX idx_tracked_wallets_user ON tracked_wallets (telegram_user_id);
CREATE INDEX idx_tracked_wallets_scan_due ON tracked_wallets (last_scanned_at NULLS FIRST);
