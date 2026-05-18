-- Lucid Protocol Bot Database Schema
-- Run this in Supabase SQL Editor

-- scam_reports: stores every scan result
CREATE TABLE scam_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL,
  content TEXT NOT NULL,
  content_type TEXT CHECK (content_type IN ('url', 'text', 'mixed')) DEFAULT 'text',
  risk_score SMALLINT CHECK (risk_score BETWEEN 1 AND 10),
  confidence SMALLINT CHECK (confidence BETWEEN 0 AND 100),
  flags JSONB DEFAULT '[]',
  reasoning TEXT,
  verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- scam_signatures: known scam patterns for fast matching
CREATE TABLE scam_signatures (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pattern_type TEXT NOT NULL CHECK (pattern_type IN ('url', 'keyword', 'phrase', 'domain')),
  pattern TEXT NOT NULL,
  severity SMALLINT CHECK (severity BETWEEN 1 AND 10) DEFAULT 5,
  sources TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- user_submissions: tracks what users queried and if results were helpful
CREATE TABLE user_submissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL,
  query TEXT NOT NULL,
  result JSONB,
  helpful BOOLEAN,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_scam_reports_user ON scam_reports (telegram_user_id);
CREATE INDEX idx_scam_reports_created ON scam_reports (created_at DESC);
CREATE INDEX idx_scam_reports_risk ON scam_reports (risk_score DESC);
CREATE INDEX idx_scam_signatures_type ON scam_signatures (pattern_type);
CREATE INDEX idx_user_submissions_user ON user_submissions (telegram_user_id);

-- Row Level Security
ALTER TABLE scam_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE scam_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_submissions ENABLE ROW LEVEL SECURITY;

-- Service role policies (bot uses service key)
CREATE POLICY "service_all_scam_reports" ON scam_reports FOR ALL USING (true);
CREATE POLICY "service_all_scam_signatures" ON scam_signatures FOR ALL USING (true);
CREATE POLICY "service_all_user_submissions" ON user_submissions FOR ALL USING (true);
