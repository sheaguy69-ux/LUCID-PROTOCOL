-- Commission Transactions Schema v0.1
-- Tracks 17% commission on verified value saved by Abyssal Active Defense.
-- Run on your main Lucid Protocol Supabase project (not the threat-intel project).

create table if not exists public.commission_transactions (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null references public.subscribers(telegram_user_id),
  pool_address text not null,
  value_saved_wei text not null,       -- raw wei value saved
  commission_wei text not null,         -- 17% of value_saved_wei
  commission_rate numeric not null default 0.17,
  transaction_hash text,               -- on-chain TX if available
  attack_type text,                     -- 'sandwich','jit_liquidity','frontrun','backrun','unknown'
  status text not null default 'pending',  -- 'pending','invoiced','paid','void'
  invoice_id text,                      -- batch id or Stripe invoice id when invoiced
  invoice_url text,                     -- Stripe hosted invoice URL
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_commission_tx_user on public.commission_transactions(telegram_user_id);
create index if not exists idx_commission_tx_status on public.commission_transactions(status);

comment on table public.commission_transactions is
  'Tracks 17% commission on verified value saved by Abyssal Active Defense. One row per defense event.';
comment on column public.commission_transactions.commission_rate is
  'Rate applied to value_saved_wei. Default 0.17 (17%).';
comment on column public.commission_transactions.status is
  'pending = not yet invoiced, invoiced = batched into an invoice, paid = settled, void = written off.';
