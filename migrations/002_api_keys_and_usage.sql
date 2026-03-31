-- API Keys table
CREATE TABLE api_keys (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  label TEXT DEFAULT 'default',
  is_test BOOLEAN DEFAULT FALSE,
  active BOOLEAN DEFAULT TRUE,
  free_tier_limit INT DEFAULT 100,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

-- API scan usage logs
CREATE TABLE api_scans (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  api_key_id UUID NOT NULL REFERENCES api_keys(id),
  query TEXT NOT NULL,
  risk_score SMALLINT,
  response_time_ms INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Monthly usage aggregates (updated by batch process)
CREATE TABLE api_usage_monthly (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  api_key_id UUID NOT NULL REFERENCES api_keys(id),
  month TEXT NOT NULL,
  scan_count INT DEFAULT 0,
  overage_count INT DEFAULT 0,
  overage_cost NUMERIC(10,2) DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(api_key_id, month)
);

-- Indexes
CREATE INDEX idx_api_keys_user ON api_keys (telegram_user_id);
CREATE INDEX idx_api_keys_hash ON api_keys (key_hash);
CREATE INDEX idx_api_scans_key ON api_scans (api_key_id);
CREATE INDEX idx_api_scans_created ON api_scans (created_at DESC);
CREATE INDEX idx_api_usage_key_month ON api_usage_monthly (api_key_id, month);

-- RLS
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_usage_monthly ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_all_api_keys" ON api_keys FOR ALL USING (true);
CREATE POLICY "service_all_api_scans" ON api_scans FOR ALL USING (true);
CREATE POLICY "service_all_api_usage_monthly" ON api_usage_monthly FOR ALL USING (true);
