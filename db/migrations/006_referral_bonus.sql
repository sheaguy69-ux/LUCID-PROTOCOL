-- Referral bonus system
-- Adds bonus_scan_balance to free_scan_usage + RPC functions for referral flow

-- Add bonus_scan_balance column to free_scan_usage
alter table if exists public.free_scan_usage
  add column if not exists bonus_scan_balance int not null default 0;

-- Referrals tracking table
create table if not exists public.referrals (
  id bigint generated always as identity primary key,
  referrer_id bigint not null references public.subscribers(telegram_user_id),
  referred_id bigint not null unique references public.subscribers(telegram_user_id),
  bonus_amount int not null default 5,
  created_at timestamptz not null default now()
);

create index if not exists idx_referrals_referrer on public.referrals(referrer_id);

-- Get referral stats for a user
create or replace function public.get_referral_stats(p_user bigint)
returns table(balance bigint, referrals bigint)
language sql stable
as $$
  select
    coalesce((select bonus_scan_balance from public.free_scan_usage where telegram_user_id = p_user limit 1), 0)::bigint,
    (select count(*)::bigint from public.referrals where referrer_id = p_user);
$$;

-- Grant referral bonus (idempotent on referred_id)
create or replace function public.grant_referral_bonus(
  p_referrer bigint,
  p_referred bigint,
  p_bonus int default 5
)
returns jsonb
language plpgsql
as $$
declare
  v_exists boolean;
  v_new_balance int;
begin
  -- Check if already referred
  select exists(select 1 from public.referrals where referred_id = p_referred) into v_exists;
  if v_exists then
    return jsonb_build_object('credited', false, 'already_referred', true);
  end if;

  -- Insert the referral
  insert into public.referrals(referrer_id, referred_id, bonus_amount)
  values (p_referrer, p_referred, p_bonus);

  -- Bump bonus balance on free_scan_usage
  insert into public.free_scan_usage(telegram_user_id, scan_date, scan_count, last_scan_at, bonus_scan_balance)
  values (p_referrer, current_date, 0, now(), p_bonus)
  on conflict (telegram_user_id, scan_date)
  do update set bonus_scan_balance = free_scan_usage.bonus_scan_balance + p_bonus;

  select bonus_scan_balance into v_new_balance
  from public.free_scan_usage
  where telegram_user_id = p_referrer
  order by scan_date desc
  limit 1;

  return jsonb_build_object('credited', true, 'new_balance', v_new_balance);
end;
$$;

-- Consume one bonus scan (returns new balance, or null if none)
create or replace function public.consume_bonus_scan(p_user bigint)
returns int
language plpgsql
as $$
declare
  v_current int;
  v_updated int;
begin
  select bonus_scan_balance into v_current
  from public.free_scan_usage
  where telegram_user_id = p_user
  order by scan_date desc
  limit 1;

  if v_current is null or v_current <= 0 then
    return null;
  end if;

  update public.free_scan_usage
  set bonus_scan_balance = bonus_scan_balance - 1
  where telegram_user_id = p_user
    and scan_date = (select scan_date from public.free_scan_usage
                     where telegram_user_id = p_user
                     order by scan_date desc limit 1)
  returning bonus_scan_balance into v_updated;

  return v_updated;
end;
$$;

grant execute on function public.get_referral_stats(bigint) to service_role;
grant execute on function public.grant_referral_bonus(bigint, bigint, int) to service_role;
grant execute on function public.consume_bonus_scan(bigint) to service_role;
