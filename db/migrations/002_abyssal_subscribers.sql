-- Abyssal Subscribers Schema v0.1
-- Adds JSONB metadata for Abyssal tier to existing subscribers table.
-- Run on your main ScamShield Supabase project (not the threat-intel project).

alter table if exists public.subscribers
  add column if not exists abyssal jsonb default null;

comment on column public.subscribers.abyssal is
  'Abyssal tier metadata: { "abyssal_tier": "active"|"free", "active_pool_count": int, "commission_rate": float }';
