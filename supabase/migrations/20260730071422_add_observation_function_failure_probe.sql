create or replace function public.get_weekly_plan_function_failures(
  p_since timestamptz default now() - interval '15 minutes'
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'critical',
    (select count(*)
      from public.weekly_plan_commands command
      where command.status = 'failed'
        and command.completed_at >= p_since
        and command.error_retryable is distinct from true),
    'total',
    (select count(*)
      from public.weekly_plan_commands command
      where command.status = 'failed'
        and command.completed_at >= p_since)
  )
$$;

revoke all on function public.get_weekly_plan_function_failures(timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_weekly_plan_function_failures(timestamptz)
  to weekly_plan_monitor, service_role;
