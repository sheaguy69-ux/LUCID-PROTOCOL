-- Free-tier harvest: 3 deep Claude scans/day for non-subscribers.
-- Tracked per (telegram_user_id, scan_date). Enables upsell pressure
-- while still firing intercepts to threat-intel.

create table if not exists free_scan_usage (
  telegram_user_id bigint not null,
  scan_date date not null default (now() at time zone 'UTC')::date,
  scan_count int not null default 0,
  last_scan_at timestamptz not null default now(),
  primary key (telegram_user_id, scan_date)
);

create index if not exists idx_free_scan_usage_date on free_scan_usage(scan_date desc);

-- Atomic bump + current-count return. Insert-or-increment, then return new count.
create or replace function public.bump_free_scan_usage(p_user_id bigint)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date := (now() at time zone 'UTC')::date;
  v_count int;
begin
  insert into free_scan_usage(telegram_user_id, scan_date, scan_count, last_scan_at)
  values (p_user_id, v_date, 1, now())
  on conflict (telegram_user_id, scan_date) do update
    set scan_count = free_scan_usage.scan_count + 1,
        last_scan_at = now()
  returning scan_count into v_count;
  return v_count;
end;
$$;

grant execute on function public.bump_free_scan_usage(bigint) to service_role;

-- Peek (read-only) current count.
create or replace function public.get_free_scan_count(p_user_id bigint)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(scan_count, 0)
  from free_scan_usage
  where telegram_user_id = p_user_id
    and scan_date = (now() at time zone 'UTC')::date;
$$;

grant execute on function public.get_free_scan_count(bigint) to service_role;

alter table free_scan_usage enable row level security;
