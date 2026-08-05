alter table public.weekly_plan_client_incidents
  drop constraint weekly_plan_client_incidents_event_type_check;

alter table public.weekly_plan_client_incidents
  add constraint weekly_plan_client_incidents_event_type_check
  check (event_type in (
    'authoritative_load_failure',
    'authoritative_refetch_failure',
    'realtime_recovery_succeeded',
    'realtime_recovery_failure',
    'unknown_command_outcome',
    'revision_mismatch',
    'forced_reload_failure',
    'oauth_auth_failure'
  ));

create or replace function private.is_privacy_limited_client_context(
  p_context jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  entry record;
begin
  if jsonb_typeof(p_context) <> 'object' or pg_column_size(p_context) > 2048 then
    return false;
  end if;
  for entry in select * from jsonb_each(p_context)
  loop
    if entry.key not in ('provider', 'phase', 'operation', 'authorityStatus', 'errorCode')
      or jsonb_typeof(entry.value) <> 'string'
      or length(entry.value #>> '{}') > 80
    then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

create or replace function public.get_weekly_plan_observation_snapshot(
  p_since timestamptz default now() - interval '15 minutes'
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'checkedAt', now(),
    'rolloutState', public.get_weekly_plan_rollout_state(),
    'planInvariants', jsonb_build_object(
      'violations',
      (select count(*) from (
        select plan.user_id
        from public.weekly_plans plan
        where plan.is_active
        group by plan.user_id
        having count(*) > 1
      ) duplicates)
      + (select count(*) from public.weekly_plans plan
          where private.is_weekly_plan_document(plan.document) is distinct from true
             or private.has_stable_ingredient_identities(plan.document) is distinct from true
             or (plan.is_active and plan.deactivated_at is not null)
             or (not plan.is_active and plan.deactivated_at is null))
    ),
    'commands', jsonb_build_object(
      'stale', (select count(*) from public.weekly_plan_commands command
        where command.status = 'in_progress'
          and command.updated_at < now() - interval '10 minutes'),
      'invalidStatus', (select count(*) from public.weekly_plan_commands command
        where command.status not in ('in_progress', 'succeeded', 'failed'))
    ),
    'locks', jsonb_build_object(
      'stale', (select count(*) from public.weekly_plans plan
        where plan.next_generation_locked_at < now() - interval '10 minutes')
    ),
    'reservations', jsonb_build_object(
      'stale', (select count(*)
        from public.weekly_plan_meal_reroll_reservations reservation
        left join public.weekly_plan_commands command
          on command.command_id = reservation.command_id
        where reservation.reserved_at < now() - interval '10 minutes'
           or command.status is distinct from 'in_progress')
    ),
    'aiUsageLinkage', jsonb_build_object(
      'unlinked', (select count(*) from public.weekly_plan_commands command
        where command.created_at >= p_since
          and command.operation in ('generate_initial', 'reroll_meal', 'generate_next')
          and command.status in ('succeeded', 'failed')
          and not exists (
            select 1 from public.ai_usage_records usage
            where usage.command_id = command.command_id
          ))
    ),
    'migrationEvidence', jsonb_build_object(
      'valid',
      not exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'user_data'
          and column_name = 'meal_plan'
      )
      and exists (
        select 1 from public.weekly_plan_commands
        where operation = 'legacy_migration' and status = 'succeeded'
      )
    ),
    'clientIncidents', jsonb_build_object(
      'critical', (select count(*) from public.weekly_plan_client_incidents
        where created_at >= p_since
          and event_type in (
            'realtime_recovery_failure',
            'unknown_command_outcome',
            'revision_mismatch',
            'forced_reload_failure',
            'oauth_auth_failure'
          )),
      'total', (select count(*) from public.weekly_plan_client_incidents
        where created_at >= p_since)
    )
  )
$$;
