create table public.weekly_plan_rollout (
  singleton boolean primary key default true check (singleton),
  state text not null check (state in ('legacy', 'maintenance', 'authoritative')),
  updated_at timestamptz not null default now()
);

insert into public.weekly_plan_rollout (singleton, state)
values (true, 'legacy');

alter table public.weekly_plan_rollout enable row level security;

revoke all on table public.weekly_plan_rollout
  from public, anon, authenticated, service_role;
grant select, update on table public.weekly_plan_rollout to service_role;

create or replace function public.get_weekly_plan_rollout_state()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select rollout.state
  from public.weekly_plan_rollout as rollout
  where rollout.singleton
$$;

revoke all on function public.get_weekly_plan_rollout_state()
  from public, anon;
grant execute on function public.get_weekly_plan_rollout_state()
  to authenticated, service_role;

create or replace function private.enforce_legacy_weekly_plan_rollout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rollout_state text := public.get_weekly_plan_rollout_state();
begin
  if current_setting('app.weekly_plan_cutover', true) = 'on' then
    return new;
  end if;

  if (
    (tg_op = 'INSERT' and new.meal_plan is not null)
    or (tg_op = 'UPDATE' and new.meal_plan is distinct from old.meal_plan)
  ) and rollout_state <> 'legacy' then
    raise exception 'Legacy Weekly Plan mutation is disabled in %', rollout_state
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger user_data_enforce_weekly_plan_rollout
before insert or update on public.user_data
for each row execute function private.enforce_legacy_weekly_plan_rollout();

create or replace function private.enforce_authoritative_weekly_plan_rollout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rollout_state text := public.get_weekly_plan_rollout_state();
begin
  if current_setting('app.weekly_plan_cutover', true) = 'on' then
    return coalesce(new, old);
  end if;
  if rollout_state <> 'authoritative' then
    raise exception 'Authoritative Weekly Plan mutation is disabled in %', rollout_state
      using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger weekly_plans_enforce_rollout
before insert or update or delete on public.weekly_plans
for each row execute function private.enforce_authoritative_weekly_plan_rollout();

revoke all on function private.enforce_legacy_weekly_plan_rollout()
  from public, anon, authenticated;
revoke all on function private.enforce_authoritative_weekly_plan_rollout()
  from public, anon, authenticated;
