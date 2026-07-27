alter table public.weekly_plan_commands
  drop constraint weekly_plan_commands_operation;
alter table public.weekly_plan_commands
  add constraint weekly_plan_commands_operation
  check (operation in (
    'generate_initial',
    'set_ingredient_checked',
    'reroll_meal',
    'generate_next',
    'start_over'
  ));

alter table public.weekly_plan_commands
  drop constraint weekly_plan_commands_outcome;
alter table public.weekly_plan_commands
  add constraint weekly_plan_commands_outcome check (
    (
      status = 'in_progress'
      and result_plan_id is null
      and result_snapshot is null
      and error_code is null
      and error_message is null
      and error_retryable is null
      and completed_at is null
    )
    or (
      status = 'succeeded'
      and (
        (
          operation = 'start_over'
          and result_plan_id is null
          and result_snapshot is null
        )
        or (
          operation <> 'start_over'
          and result_plan_id is not null
          and result_snapshot is not null
        )
      )
      and provider_checkpoint is null
      and error_code is null
      and error_message is null
      and error_retryable is null
      and completed_at is not null
    )
    or (
      status = 'failed'
      and result_plan_id is null
      and result_snapshot is null
      and provider_checkpoint is null
      and error_code is not null
      and error_message is not null
      and error_retryable is not null
      and completed_at is not null
    )
  );

create or replace function private.start_over_command_outcome(
  p_user_id uuid,
  p_command_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'commandId', command.command_id,
    'status', command.status,
    'result', null,
    'error', case
      when command.error_code is null then null
      else jsonb_build_object(
        'code', command.error_code,
        'message', command.error_message,
        'retryable', command.error_retryable
      )
    end
  )
  from public.weekly_plan_commands command
  where command.command_id = p_command_id
    and command.user_id = p_user_id
    and command.operation = 'start_over'
$$;

drop function public.start_over_weekly_plan(uuid);

create function public.start_over_weekly_plan(
  p_displayed_plan_id uuid,
  p_displayed_revision bigint,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid = auth.uid();
  input_fingerprint text =
    md5('start-over-plan:' || p_displayed_plan_id::text)
    || md5('start-over-revision:' || p_displayed_revision::text);
  existing public.weekly_plan_commands;
  plan public.weekly_plans;
  error_code text;
  error_message text;
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;
  if p_displayed_revision < 0 then
    raise exception 'Displayed revision must be non-negative';
  end if;

  perform 1 from auth.users where id = caller_id for update;

  select * into existing
  from public.weekly_plan_commands
  where command_id = p_command_id
  for update;
  if found then
    if existing.user_id <> caller_id
      or existing.operation <> 'start_over'
      or existing.input_fingerprint <> input_fingerprint
    then
      return jsonb_build_object(
        'commandId', p_command_id, 'status', 'failed', 'result', null,
        'error', jsonb_build_object(
          'code', 'idempotency_key_reused',
          'message', 'This command ID belongs to a different request.',
          'retryable', false
        )
      );
    end if;
    return private.start_over_command_outcome(caller_id, p_command_id);
  end if;

  select * into plan
  from public.weekly_plans
  where plan_id = p_displayed_plan_id
    and user_id = caller_id
  for update;

  if not found or not plan.is_active then
    error_code = 'stale_plan';
    error_message =
      'The displayed Weekly Plan is no longer the Current Weekly Plan.';
  elsif plan.next_generation_id is not null then
    error_code = 'plan_generation_locked';
    error_message = 'A Next Weekly Plan is being generated.';
  elsif exists (
    select 1
    from public.weekly_plan_meal_reroll_reservations
    where plan_id = plan.plan_id
  ) then
    error_code = 'meal_reroll_pending';
    error_message = 'A Meal Reroll is still in progress.';
  end if;

  if error_code is not null then
    insert into public.weekly_plan_commands (
      command_id, user_id, operation, input_fingerprint, status,
      error_code, error_message, error_retryable, completed_at
    ) values (
      p_command_id, caller_id, 'start_over', input_fingerprint, 'failed',
      error_code, error_message, true, clock_timestamp()
    );
    return private.start_over_command_outcome(caller_id, p_command_id);
  end if;

  update public.weekly_plans
  set is_active = false,
      deactivated_at = clock_timestamp(),
      updated_at = greatest(clock_timestamp(), updated_at)
  where plan_id = plan.plan_id;

  insert into public.weekly_plan_commands (
    command_id, user_id, operation, input_fingerprint, status, completed_at
  ) values (
    p_command_id, caller_id, 'start_over', input_fingerprint,
    'succeeded', clock_timestamp()
  );

  return private.start_over_command_outcome(caller_id, p_command_id);
end;
$$;

revoke all on function public.start_over_weekly_plan(uuid, bigint, uuid)
  from public, anon;
grant execute on function public.start_over_weekly_plan(uuid, bigint, uuid)
  to authenticated;

revoke all on function private.start_over_command_outcome(uuid, uuid)
  from public, anon, authenticated;
