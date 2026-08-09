alter function public.get_weekly_plan_observation_snapshot(timestamptz)
  rename to get_weekly_plan_observation_snapshot_v1;

create function public.get_weekly_plan_observation_snapshot(
  p_since timestamptz default now() - interval '15 minutes'
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.get_weekly_plan_observation_snapshot_v1(p_since)
    || jsonb_build_object(
      'recovery', jsonb_build_object(
        'repaired', (
          select count(*)
          from public.weekly_plan_commands as command
          where command.completed_at >= p_since
            and command.operation in (
              'generate_initial', 'reroll_meal', 'generate_next'
            )
            and command.failure_evidence @> '{
              "stage":"recovery",
              "reason":"committed_result_repaired"
            }'::jsonb
        ),
        'unrecoverable', (
          select count(*)
          from public.weekly_plan_commands as command
          where command.completed_at >= p_since
            and command.operation in (
              'generate_initial', 'reroll_meal', 'generate_next'
            )
            and command.error_code = 'provider_outcome_unrecoverable'
        )
      )
    )
$$;

revoke all on function public.get_weekly_plan_observation_snapshot(timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_weekly_plan_observation_snapshot(timestamptz)
  to weekly_plan_monitor, service_role;
