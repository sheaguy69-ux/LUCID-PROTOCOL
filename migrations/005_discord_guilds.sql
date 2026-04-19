-- WS5: Discord guild subscription + shadow-audit tables.
-- Apply via Supabase MCP / dashboard.

create table if not exists discord_guilds (
  guild_id text primary key,
  guild_name text,
  owner_discord_id text,
  tier text not null default 'free' check (tier in ('free','paid','cancelled','past_due')),
  subscription_status text not null default 'none' check (subscription_status in ('none','trialing','active','past_due','cancelled')),
  stripe_customer_id text,
  stripe_subscription_id text,
  shadow_mode boolean not null default false,
  shadow_ends_at timestamptz,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_discord_guilds_sub on discord_guilds(stripe_subscription_id) where stripe_subscription_id is not null;
create index if not exists idx_discord_guilds_status on discord_guilds(subscription_status);

create table if not exists shadow_audits (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null references discord_guilds(guild_id) on delete cascade,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active','reported','cancelled')),
  report_sent_at timestamptz,
  report_pdf_url text,
  created_at timestamptz not null default now()
);

create index if not exists idx_shadow_audits_guild on shadow_audits(guild_id);
create index if not exists idx_shadow_audits_ends on shadow_audits(ends_at) where status = 'active';

create table if not exists shadow_audit_events (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null references discord_guilds(guild_id) on delete cascade,
  audit_id uuid references shadow_audits(id) on delete set null,
  channel_id text,
  message_id text,
  user_discord_hash text,
  would_have_blocked boolean not null default true,
  risk_score int not null,
  attack_type text,
  matched_pattern text,
  pattern_source text,
  raw_excerpt text,
  detected_at timestamptz not null default now()
);

create index if not exists idx_shadow_events_guild on shadow_audit_events(guild_id, detected_at desc);
create index if not exists idx_shadow_events_audit on shadow_audit_events(audit_id);

create table if not exists discord_guild_usage (
  guild_id text not null references discord_guilds(guild_id) on delete cascade,
  usage_date date not null default (now() at time zone 'UTC')::date,
  claude_calls int not null default 0,
  embedding_calls int not null default 0,
  cache_hits int not null default 0,
  blocked_count int not null default 0,
  shadow_count int not null default 0,
  primary key (guild_id, usage_date)
);

create index if not exists idx_discord_usage_date on discord_guild_usage(usage_date desc);

create or replace function touch_discord_guilds_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_discord_guilds_touch on discord_guilds;
create trigger trg_discord_guilds_touch
before update on discord_guilds
for each row execute function touch_discord_guilds_updated_at();

alter table discord_guilds enable row level security;
alter table shadow_audits enable row level security;
alter table shadow_audit_events enable row level security;
alter table discord_guild_usage enable row level security;

-- Atomic counter bump — avoids read-modify-write races under auto-mod burst.
create or replace function public.bump_discord_guild_usage(
  p_guild_id text,
  p_date date,
  p_field text,
  p_amount int default 1
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_field not in ('claude_calls','embedding_calls','cache_hits','blocked_count','shadow_count') then
    raise exception 'invalid field: %', p_field;
  end if;

  insert into discord_guild_usage(guild_id, usage_date)
  values (p_guild_id, p_date)
  on conflict (guild_id, usage_date) do nothing;

  execute format(
    'update discord_guild_usage set %I = %I + $3 where guild_id = $1 and usage_date = $2',
    p_field, p_field
  ) using p_guild_id, p_date, p_amount;
end;
$$;

grant execute on function public.bump_discord_guild_usage(text, date, text, int) to service_role;
