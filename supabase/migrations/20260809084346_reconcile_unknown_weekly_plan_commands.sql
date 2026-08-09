create or replace function private.weekly_plan_command_outcome(
  p_user_id uuid,
  p_command_id uuid,
  p_should_generate boolean
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
    'result', command.result_snapshot,
    'error', case
      when command.error_code is null then null
      else jsonb_build_object(
        'code', command.error_code,
        'message', command.error_message,
        'retryable', command.error_retryable
      )
    end,
    'shouldGenerate', p_should_generate,
    'checkpoint', command.provider_checkpoint,
    'inputFingerprint', command.input_fingerprint
  )
  from public.weekly_plan_commands as command
  where command.command_id = p_command_id
    and command.user_id = p_user_id
$$;

create or replace function private.recover_stale_initial_weekly_plan_generation(
  p_user_id uuid,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  command public.weekly_plan_commands;
  committed_plan public.weekly_plans;
begin
  perform 1 from auth.users where id = p_user_id for update;
  select * into command
  from public.weekly_plan_commands
  where command_id = p_command_id
    and user_id = p_user_id
    and operation = 'generate_initial'
  for update;

  if not found then
    raise exception 'Unknown initial Weekly Plan generation command';
  end if;
  if command.status <> 'in_progress'
    or command.provider_checkpoint ->> 'kind' in ('success', 'failure')
    or command.updated_at > clock_timestamp() - interval '10 minutes'
  then
    return private.weekly_plan_command_outcome(
      p_user_id, p_command_id, false
    );
  end if;

  select * into committed_plan
  from public.weekly_plans
  where user_id = p_user_id and generation_id = p_command_id
  for update;

  if found then
    update public.weekly_plan_commands
    set status = 'succeeded',
        result_plan_id = committed_plan.plan_id,
        result_snapshot = private.authoritative_weekly_plan_row(committed_plan),
        provider_checkpoint = null,
        failure_evidence =
          '{"stage":"recovery","reason":"committed_result_repaired"}'::jsonb,
        updated_at = clock_timestamp(),
        completed_at = clock_timestamp()
    where command_id = p_command_id;
  else
    update public.weekly_plan_commands
    set status = 'failed',
        provider_checkpoint = null,
        error_code = 'provider_outcome_unrecoverable',
        error_message =
          'The provider outcome could not be recovered and no Current Weekly Plan was committed.',
        error_retryable = false,
        failure_evidence = jsonb_build_object(
          'stage', 'recovery',
          'reason', case
            when command.provider_checkpoint ->> 'kind' = 'unknown'
              then 'unknown_provider_outcome_without_committed_result'
            else 'missing_provider_checkpoint_without_committed_result'
          end
        ),
        updated_at = clock_timestamp(),
        completed_at = clock_timestamp()
    where command_id = p_command_id;
  end if;

  return private.weekly_plan_command_outcome(
    p_user_id, p_command_id, false
  );
end;
$$;

create or replace function public.recover_stale_initial_weekly_plan_generation(
  p_user_id uuid,
  p_command_id uuid
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.recover_stale_initial_weekly_plan_generation(
    p_user_id, p_command_id
  )
$$;

revoke all on function public.recover_stale_initial_weekly_plan_generation(
  uuid, uuid
) from public, anon, authenticated;
grant execute on function public.recover_stale_initial_weekly_plan_generation(
  uuid, uuid
) to service_role;
revoke all on function private.recover_stale_initial_weekly_plan_generation(
  uuid, uuid
) from public, anon, authenticated;

create or replace function public.get_pending_initial_weekly_plan_generation()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('commandId', command.command_id)
  from public.weekly_plan_commands as command
  where command.user_id = (select auth.uid())
    and command.operation = 'generate_initial'
    and command.status = 'in_progress'
  order by command.created_at, command.command_id
  limit 1
$$;

revoke all on function public.get_pending_initial_weekly_plan_generation()
  from public, anon;
grant execute on function public.get_pending_initial_weekly_plan_generation()
  to authenticated;

create or replace function private.meal_reroll_command_outcome(
  p_user_id uuid,
  p_command_id uuid,
  p_should_generate boolean default false
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
    'result', command.result_snapshot,
    'error', case
      when command.error_code is null then null
      else jsonb_build_object(
        'code', command.error_code,
        'message', command.error_message,
        'retryable', command.error_retryable
      )
    end,
    'shouldGenerate', p_should_generate,
    'checkpoint', command.provider_checkpoint,
    'inputFingerprint', command.input_fingerprint,
    'target', case
      when p_should_generate then (
        select jsonb_build_object(
          'planId', reservation.plan_id,
          'day', reservation.day,
          'mealType', reservation.meal_type,
          'meal', day_value.value -> reservation.meal_type
        )
        from public.weekly_plan_meal_reroll_reservations as reservation
        join public.weekly_plans as plan
          on plan.plan_id = reservation.plan_id
          and plan.user_id = reservation.user_id
        cross join lateral jsonb_array_elements(plan.document -> 'days')
          as day_value(value)
        where reservation.command_id = command.command_id
          and day_value.value ->> 'day' = reservation.day
      )
      else null
    end
  )
  from public.weekly_plan_commands as command
  where command.command_id = p_command_id
    and command.user_id = p_user_id
    and command.operation = 'reroll_meal'
$$;

create or replace function private.recover_stale_meal_reroll(
  p_user_id uuid,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  command public.weekly_plan_commands;
begin
  perform 1 from auth.users where id = p_user_id for update;
  select * into command
  from public.weekly_plan_commands
  where command_id = p_command_id
    and user_id = p_user_id
    and operation = 'reroll_meal'
  for update;

  if not found then
    raise exception 'Unknown Meal Reroll command';
  end if;
  if command.status <> 'in_progress' then
    delete from public.weekly_plan_meal_reroll_reservations
    where command_id = p_command_id and user_id = p_user_id;
    return private.meal_reroll_command_outcome(
      p_user_id, p_command_id, false
    );
  end if;
  if command.provider_checkpoint ->> 'kind' in ('success', 'failure')
    or command.updated_at > clock_timestamp() - interval '10 minutes'
  then
    return private.meal_reroll_command_outcome(
      p_user_id, p_command_id, false
    );
  end if;

  delete from public.weekly_plan_meal_reroll_reservations
  where command_id = p_command_id and user_id = p_user_id;

  update public.weekly_plan_commands
  set status = 'failed',
      provider_checkpoint = null,
      error_code = 'provider_outcome_unrecoverable',
      error_message =
        'The provider outcome could not be recovered and the Meal Slot was not changed.',
      error_retryable = false,
      failure_evidence = jsonb_build_object(
        'stage', 'recovery',
        'reason', case
          when command.provider_checkpoint ->> 'kind' = 'unknown'
            then 'unknown_provider_outcome_without_committed_result'
          else 'missing_provider_checkpoint_without_committed_result'
        end
      ),
      updated_at = clock_timestamp(),
      completed_at = clock_timestamp()
  where command_id = p_command_id;

  return private.meal_reroll_command_outcome(
    p_user_id, p_command_id, false
  );
end;
$$;

create or replace function public.recover_stale_meal_reroll(
  p_user_id uuid,
  p_command_id uuid
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.recover_stale_meal_reroll(p_user_id, p_command_id)
$$;

revoke all on function public.recover_stale_meal_reroll(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.recover_stale_meal_reroll(uuid, uuid)
  to service_role;
revoke all on function private.recover_stale_meal_reroll(uuid, uuid)
  from public, anon, authenticated;

create or replace function private.next_weekly_plan_command_outcome(
  p_user_id uuid,
  p_command_id uuid,
  p_should_generate boolean default false
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
    'result', command.result_snapshot,
    'error', case
      when command.error_code is null then null
      else jsonb_build_object(
        'code', command.error_code,
        'message', command.error_message,
        'retryable', command.error_retryable
      )
    end,
    'shouldGenerate', p_should_generate,
    'checkpoint', command.provider_checkpoint,
    'inputFingerprint', command.input_fingerprint,
    'source', case when p_should_generate then (
      select jsonb_build_object(
        'planId', plan.plan_id,
        'revision', plan.revision,
        'document', plan.document
      )
      from public.weekly_plans as plan
      where plan.user_id = command.user_id
        and plan.next_generation_id = command.command_id
    ) else null end
  )
  from public.weekly_plan_commands as command
  where command.command_id = p_command_id
    and command.user_id = p_user_id
    and command.operation = 'generate_next'
$$;

create or replace function private.recover_stale_next_weekly_plan_generation(
  p_user_id uuid,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  command public.weekly_plan_commands;
  source_plan public.weekly_plans;
  successor public.weekly_plans;
begin
  perform 1 from auth.users where id = p_user_id for update;
  select * into command
  from public.weekly_plan_commands
  where command_id = p_command_id
    and user_id = p_user_id
    and operation = 'generate_next'
  for update;

  if not found then
    raise exception 'Unknown Next Weekly Plan command';
  end if;
  if command.status <> 'in_progress' then
    update public.weekly_plans
    set next_generation_id = null,
        next_generation_locked_at = null,
        updated_at = greatest(clock_timestamp(), updated_at)
    where user_id = p_user_id and next_generation_id = p_command_id;
    return private.next_weekly_plan_command_outcome(
      p_user_id, p_command_id, false
    );
  end if;
  if command.provider_checkpoint ->> 'kind' in ('success', 'failure')
    or command.updated_at > clock_timestamp() - interval '10 minutes'
  then
    return private.next_weekly_plan_command_outcome(
      p_user_id, p_command_id, false
    );
  end if;

  select * into successor
  from public.weekly_plans
  where user_id = p_user_id and generation_id = p_command_id
  for update;

  if found then
    update public.weekly_plans
    set is_active = false,
        deactivated_at = coalesce(deactivated_at, clock_timestamp()),
        next_generation_id = null,
        next_generation_locked_at = null,
        updated_at = greatest(clock_timestamp(), updated_at)
    where plan_id = successor.predecessor_plan_id
      and user_id = p_user_id;

    update public.weekly_plan_commands
    set status = 'succeeded',
        result_plan_id = successor.plan_id,
        result_snapshot = private.authoritative_weekly_plan_row(successor),
        provider_checkpoint = null,
        failure_evidence =
          '{"stage":"recovery","reason":"committed_result_repaired"}'::jsonb,
        updated_at = clock_timestamp(),
        completed_at = clock_timestamp()
    where command_id = p_command_id;
  else
    select * into source_plan
    from public.weekly_plans
    where user_id = p_user_id and next_generation_id = p_command_id
    for update;
    if found then
      update public.weekly_plans
      set next_generation_id = null,
          next_generation_locked_at = null,
          updated_at = greatest(clock_timestamp(), updated_at)
      where plan_id = source_plan.plan_id;
    end if;

    update public.weekly_plan_commands
    set status = 'failed',
        provider_checkpoint = null,
        error_code = 'provider_outcome_unrecoverable',
        error_message =
          'The provider outcome could not be recovered and no Next Weekly Plan was committed.',
        error_retryable = false,
        failure_evidence = jsonb_build_object(
          'stage', 'recovery',
          'reason', case
            when command.provider_checkpoint ->> 'kind' = 'unknown'
              then 'unknown_provider_outcome_without_committed_result'
            else 'missing_provider_checkpoint_without_committed_result'
          end
        ),
        updated_at = clock_timestamp(),
        completed_at = clock_timestamp()
    where command_id = p_command_id;
  end if;

  return private.next_weekly_plan_command_outcome(
    p_user_id, p_command_id, false
  );
end;
$$;

revoke all on function public.recover_stale_next_weekly_plan_generation(
  uuid, uuid
) from public, anon, authenticated;
grant execute on function public.recover_stale_next_weekly_plan_generation(
  uuid, uuid
) to service_role;
revoke all on function private.recover_stale_next_weekly_plan_generation(
  uuid, uuid
) from public, anon, authenticated;
