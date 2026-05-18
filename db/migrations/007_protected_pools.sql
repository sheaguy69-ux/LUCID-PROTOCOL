-- Protected pools table for Abyssal MEV Defense
-- This goes on the threat-intel Supabase project (THREAT_INTEL_URL / THREAT_INTEL_SERVICE_KEY)
-- NOT the main Lucid Protocol Supabase

create table if not exists public.protected_pools (
  id bigint generated always as identity primary key,
  user_id bigint not null,
  pool_address text not null,
  chain_id text not null default '1',
  active_defense boolean not null default false,
  created_at timestamptz not null default now(),
  unique(pool_address)
);

create index if not exists idx_protected_pools_user on public.protected_pools(user_id);
create index if not exists idx_protected_pools_address on public.protected_pools(pool_address);

alter table public.protected_pools enable row level security;

-- Allow service_role full access
create policy "service_role all" on public.protected_pools
  for all to service_role using (true) with check (true);
