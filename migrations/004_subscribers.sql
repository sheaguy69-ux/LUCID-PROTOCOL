-- Migration 004: Subscribers table for Stripe billing
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

ALTER TABLE subscribers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all_subscribers" ON subscribers FOR ALL USING (true);
