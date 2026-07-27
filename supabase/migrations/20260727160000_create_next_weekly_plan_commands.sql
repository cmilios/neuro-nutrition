alter table public.weekly_plan_commands
  drop constraint weekly_plan_commands_operation;
alter table public.weekly_plan_commands
  add constraint weekly_plan_commands_operation
  check (operation in (
    'generate_initial',
    'set_ingredient_checked',
    'reroll_meal',
    'generate_next'
  ));

create unique index weekly_plan_commands_one_pending_next_per_user
  on public.weekly_plan_commands (user_id)
  where operation = 'generate_next' and status = 'in_progress';

create unique index weekly_plans_generation_per_user
  on public.weekly_plans (user_id, generation_id)
  where generation_id is not null;

create or replace function private.authoritative_weekly_plan_row(
  plan public.weekly_plans
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'planId', plan.plan_id,
    'userId', plan.user_id,
    'document', plan.document,
    'schemaVersion', plan.schema_version,
    'revision', plan.revision,
    'isActive', plan.is_active,
    'createdAt', plan.created_at,
    'updatedAt', plan.updated_at,
    'deactivatedAt', plan.deactivated_at,
    'predecessorPlanId', plan.predecessor_plan_id,
    'generationId', plan.generation_id,
    'nextGenerationId', plan.next_generation_id,
    'nextGenerationLockedAt', plan.next_generation_locked_at
  )
$$;

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

create or replace function private.fail_next_weekly_plan_generation(
  p_user_id uuid,
  p_command_id uuid,
  p_input_fingerprint text,
  p_error_code text,
  p_error_message text,
  p_retryable boolean,
  p_failure_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  command public.weekly_plan_commands;
  safe_evidence jsonb;
begin
  select * into command
  from public.weekly_plan_commands
  where command_id = p_command_id
    and user_id = p_user_id
    and operation = 'generate_next'
    and input_fingerprint = p_input_fingerprint
  for update;

  if not found then
    return jsonb_build_object(
      'commandId', p_command_id,
      'status', 'failed',
      'result', null,
      'error', jsonb_build_object(
        'code', 'idempotency_key_reused',
        'message', 'That command ID does not match the recorded generation.',
        'retryable', false
      ),
      'shouldGenerate', false
    );
  end if;
  if command.status <> 'in_progress' then
    return private.next_weekly_plan_command_outcome(
      p_user_id, p_command_id, false
    );
  end if;

  safe_evidence = jsonb_strip_nulls(jsonb_build_object(
    'stage', p_failure_evidence ->> 'stage',
    'reason', p_failure_evidence ->> 'reason',
    'providerRequestId', p_failure_evidence ->> 'providerRequestId',
    'providerResponseId', p_failure_evidence ->> 'providerResponseId',
    'callId', p_failure_evidence ->> 'callId',
    'attempt', p_failure_evidence -> 'attempt'
  ));

  update public.weekly_plans
  set next_generation_id = null,
      next_generation_locked_at = null,
      updated_at = greatest(clock_timestamp(), updated_at)
  where user_id = p_user_id
    and next_generation_id = p_command_id;

  update public.weekly_plan_commands
  set status = 'failed',
      provider_checkpoint = null,
      error_code = p_error_code,
      error_message = p_error_message,
      error_retryable = p_retryable,
      failure_evidence = safe_evidence,
      updated_at = clock_timestamp(),
      completed_at = clock_timestamp()
  where command_id = p_command_id;

  return private.next_weekly_plan_command_outcome(
    p_user_id, p_command_id, false
  );
end;
$$;

create or replace function private.begin_next_weekly_plan_generation(
  p_user_id uuid,
  p_command_id uuid,
  p_input_fingerprint text,
  p_source_plan_id uuid,
  p_source_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.weekly_plan_commands;
  source_plan public.weekly_plans;
begin
  if p_input_fingerprint !~ '^[0-9a-f]{64}$'
    or p_source_plan_id is null
    or p_source_revision is null
    or p_source_revision < 0
  then
    raise exception 'Invalid Next Weekly Plan command';
  end if;

  perform 1 from auth.users where id = p_user_id for update;
  if not found then
    raise exception 'Unknown command owner';
  end if;

  select * into existing
  from public.weekly_plan_commands
  where command_id = p_command_id;
  if found then
    if existing.user_id <> p_user_id
      or existing.operation <> 'generate_next'
      or existing.input_fingerprint <> p_input_fingerprint
    then
      return jsonb_build_object(
        'commandId', p_command_id,
        'status', 'failed',
        'result', null,
        'error', jsonb_build_object(
          'code', 'idempotency_key_reused',
          'message', 'That command ID was already used with different input.',
          'retryable', false
        ),
        'shouldGenerate', false
      );
    end if;
    return private.next_weekly_plan_command_outcome(
      p_user_id, p_command_id, false
    );
  end if;

  select * into source_plan
  from public.weekly_plans
  where plan_id = p_source_plan_id
    and user_id = p_user_id
    and is_active
  for update;

  if not found or source_plan.revision <> p_source_revision then
    insert into public.weekly_plan_commands (
      command_id, user_id, operation, input_fingerprint, status,
      error_code, error_message, error_retryable, failure_evidence, completed_at
    ) values (
      p_command_id, p_user_id, 'generate_next', p_input_fingerprint, 'failed',
      'stale_plan', 'The reviewed Weekly Plan is no longer current.', false,
      '{"stage":"start","reason":"source_not_current"}'::jsonb, clock_timestamp()
    );
    return private.next_weekly_plan_command_outcome(p_user_id, p_command_id, false);
  end if;
  if source_plan.next_generation_id is not null then
    insert into public.weekly_plan_commands (
      command_id, user_id, operation, input_fingerprint, status,
      error_code, error_message, error_retryable, failure_evidence, completed_at
    ) values (
      p_command_id, p_user_id, 'generate_next', p_input_fingerprint, 'failed',
      'plan_generation_locked', 'A Next Weekly Plan is already being generated.',
      true, '{"stage":"start","reason":"generation_already_pending"}'::jsonb,
      clock_timestamp()
    );
    return private.next_weekly_plan_command_outcome(p_user_id, p_command_id, false);
  end if;
  if exists (
    select 1 from public.weekly_plan_meal_reroll_reservations
    where plan_id = source_plan.plan_id
  ) then
    insert into public.weekly_plan_commands (
      command_id, user_id, operation, input_fingerprint, status,
      error_code, error_message, error_retryable, failure_evidence, completed_at
    ) values (
      p_command_id, p_user_id, 'generate_next', p_input_fingerprint, 'failed',
      'meal_reroll_pending', 'A Meal Reroll is still in progress.', true,
      '{"stage":"start","reason":"meal_reroll_pending"}'::jsonb,
      clock_timestamp()
    );
    return private.next_weekly_plan_command_outcome(p_user_id, p_command_id, false);
  end if;

  insert into public.weekly_plan_commands (
    command_id, user_id, operation, input_fingerprint, status
  ) values (
    p_command_id, p_user_id, 'generate_next', p_input_fingerprint, 'in_progress'
  );

  update public.weekly_plans
  set next_generation_id = p_command_id,
      next_generation_locked_at = clock_timestamp(),
      updated_at = greatest(clock_timestamp(), updated_at)
  where plan_id = source_plan.plan_id;

  return private.next_weekly_plan_command_outcome(
    p_user_id, p_command_id, true
  );
end;
$$;

create or replace function private.checkpoint_next_weekly_plan_generation(
  p_user_id uuid,
  p_command_id uuid,
  p_input_fingerprint text,
  p_checkpoint jsonb
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
    and operation = 'generate_next'
    and input_fingerprint = p_input_fingerprint
  for update;

  if not found then
    return jsonb_build_object(
      'commandId', p_command_id,
      'status', 'failed',
      'result', null,
      'error', jsonb_build_object(
        'code', 'idempotency_key_reused',
        'message', 'That command ID does not match the recorded generation.',
        'retryable', false
      ),
      'shouldGenerate', false
    );
  end if;
  if command.status <> 'in_progress' then
    return private.next_weekly_plan_command_outcome(
      p_user_id, p_command_id, false
    );
  end if;
  if jsonb_typeof(p_checkpoint) is distinct from 'object'
    or p_checkpoint ->> 'kind' not in ('success', 'failure', 'unknown')
    or jsonb_typeof(p_checkpoint -> 'usageRecord') is distinct from 'object'
  then
    raise exception 'Invalid provider checkpoint';
  end if;
  if command.provider_checkpoint is not null then
    if command.provider_checkpoint <> p_checkpoint then
      raise exception 'Provider checkpoint cannot change';
    end if;
    return private.next_weekly_plan_command_outcome(
      p_user_id, p_command_id, false
    );
  end if;

  update public.weekly_plan_commands
  set provider_checkpoint = p_checkpoint,
      updated_at = clock_timestamp()
  where command_id = p_command_id;

  return private.next_weekly_plan_command_outcome(
    p_user_id, p_command_id, false
  );
end;
$$;

create or replace function private.complete_next_weekly_plan_generation(
  p_user_id uuid,
  p_command_id uuid,
  p_input_fingerprint text,
  p_document jsonb
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
    and input_fingerprint = p_input_fingerprint
  for update;
  if not found then
    return jsonb_build_object(
      'commandId', p_command_id,
      'status', 'failed',
      'result', null,
      'error', jsonb_build_object(
        'code', 'idempotency_key_reused',
        'message', 'That command ID does not match the recorded generation.',
        'retryable', false
      ),
      'shouldGenerate', false
    );
  end if;
  if command.status <> 'in_progress' then
    return private.next_weekly_plan_command_outcome(
      p_user_id, p_command_id, false
    );
  end if;
  if not private.is_weekly_plan_document(p_document) then
    return private.fail_next_weekly_plan_generation(
      p_user_id, p_command_id, p_input_fingerprint,
      'invalid_plan_document', 'The generated Weekly Plan is unusable.', false,
      '{"stage":"completion","reason":"invalid_plan_document"}'::jsonb
    );
  end if;

  select * into source_plan
  from public.weekly_plans
  where user_id = p_user_id
    and is_active
    and next_generation_id = p_command_id
  for update;
  if not found then
    return private.fail_next_weekly_plan_generation(
      p_user_id, p_command_id, p_input_fingerprint,
      'generation_lock_lost', 'The generation lock is no longer valid.', false,
      '{"stage":"completion","reason":"lock_missing"}'::jsonb
    );
  end if;

  update public.weekly_plans
  set is_active = false,
      deactivated_at = clock_timestamp(),
      next_generation_id = null,
      next_generation_locked_at = null,
      updated_at = greatest(clock_timestamp(), updated_at)
  where plan_id = source_plan.plan_id;

  insert into public.weekly_plans (
    user_id, document, schema_version, revision, is_active,
    predecessor_plan_id, generation_id
  ) values (
    p_user_id, p_document, 1, 0, true,
    source_plan.plan_id, p_command_id
  )
  returning * into successor;

  update public.weekly_plan_commands
  set status = 'succeeded',
      result_plan_id = successor.plan_id,
      result_snapshot = private.authoritative_weekly_plan_row(successor),
      provider_checkpoint = null,
      updated_at = clock_timestamp(),
      completed_at = clock_timestamp()
  where command_id = p_command_id;

  return private.next_weekly_plan_command_outcome(
    p_user_id, p_command_id, false
  );
end;
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
    return private.next_weekly_plan_command_outcome(
      p_user_id, p_command_id, false
    );
  end if;
  if command.updated_at > clock_timestamp() - interval '10 minutes' then
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
    return private.next_weekly_plan_command_outcome(
      p_user_id, p_command_id, false
    );
  end if;

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
      error_code = 'stale_generation_recovered',
      error_message = 'The stale generation had no committed result. Try Again.',
      error_retryable = true,
      failure_evidence =
        '{"stage":"recovery","reason":"no_committed_result"}'::jsonb,
      updated_at = clock_timestamp(),
      completed_at = clock_timestamp()
  where command_id = p_command_id;

  return private.next_weekly_plan_command_outcome(
    p_user_id, p_command_id, false
  );
end;
$$;

create or replace function public.start_over_weekly_plan(p_command_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid = auth.uid();
  plan public.weekly_plans;
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;
  perform 1 from auth.users where id = caller_id for update;
  select * into plan
  from public.weekly_plans
  where user_id = caller_id and is_active
  for update;
  if not found then
    return jsonb_build_object(
      'commandId', p_command_id, 'status', 'succeeded',
      'result', null, 'error', null
    );
  end if;
  if plan.next_generation_id is not null then
    return jsonb_build_object(
      'commandId', p_command_id, 'status', 'failed', 'result', null,
      'error', jsonb_build_object(
        'code', 'plan_generation_locked',
        'message', 'A Next Weekly Plan is being generated.',
        'retryable', true
      )
    );
  end if;
  if exists (
    select 1 from public.weekly_plan_meal_reroll_reservations
    where plan_id = plan.plan_id
  ) then
    return jsonb_build_object(
      'commandId', p_command_id, 'status', 'failed', 'result', null,
      'error', jsonb_build_object(
        'code', 'meal_reroll_pending',
        'message', 'A Meal Reroll is still in progress.',
        'retryable', true
      )
    );
  end if;

  update public.weekly_plans
  set is_active = false,
      deactivated_at = clock_timestamp(),
      updated_at = greatest(clock_timestamp(), updated_at)
  where plan_id = plan.plan_id;
  return jsonb_build_object(
    'commandId', p_command_id, 'status', 'succeeded',
    'result', null, 'error', null
  );
end;
$$;

create or replace function public.begin_next_weekly_plan_generation(
  p_user_id uuid,
  p_command_id uuid,
  p_input_fingerprint text,
  p_source_plan_id uuid,
  p_source_revision bigint
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.begin_next_weekly_plan_generation(
    p_user_id, p_command_id, p_input_fingerprint,
    p_source_plan_id, p_source_revision
  )
$$;

create or replace function public.checkpoint_next_weekly_plan_generation(
  p_user_id uuid,
  p_command_id uuid,
  p_input_fingerprint text,
  p_checkpoint jsonb
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.checkpoint_next_weekly_plan_generation(
    p_user_id, p_command_id, p_input_fingerprint, p_checkpoint
  )
$$;

create or replace function public.complete_next_weekly_plan_generation(
  p_user_id uuid,
  p_command_id uuid,
  p_input_fingerprint text,
  p_document jsonb
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.complete_next_weekly_plan_generation(
    p_user_id, p_command_id, p_input_fingerprint, p_document
  )
$$;

create or replace function public.fail_next_weekly_plan_generation(
  p_user_id uuid,
  p_command_id uuid,
  p_input_fingerprint text,
  p_error_code text,
  p_error_message text,
  p_retryable boolean,
  p_failure_evidence jsonb
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.fail_next_weekly_plan_generation(
    p_user_id, p_command_id, p_input_fingerprint, p_error_code,
    p_error_message, p_retryable, p_failure_evidence
  )
$$;

create or replace function public.recover_stale_next_weekly_plan_generation(
  p_user_id uuid,
  p_command_id uuid
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.recover_stale_next_weekly_plan_generation(
    p_user_id, p_command_id
  )
$$;

revoke all on function public.start_over_weekly_plan(uuid)
  from public, anon;
grant execute on function public.start_over_weekly_plan(uuid)
  to authenticated;

revoke all on function public.begin_next_weekly_plan_generation(
  uuid, uuid, text, uuid, bigint
) from public, anon, authenticated;
revoke all on function public.checkpoint_next_weekly_plan_generation(
  uuid, uuid, text, jsonb
) from public, anon, authenticated;
revoke all on function public.complete_next_weekly_plan_generation(
  uuid, uuid, text, jsonb
) from public, anon, authenticated;
revoke all on function public.fail_next_weekly_plan_generation(
  uuid, uuid, text, text, text, boolean, jsonb
) from public, anon, authenticated;
revoke all on function public.recover_stale_next_weekly_plan_generation(
  uuid, uuid
) from public, anon, authenticated;

grant execute on function public.begin_next_weekly_plan_generation(
  uuid, uuid, text, uuid, bigint
) to service_role;
grant execute on function public.checkpoint_next_weekly_plan_generation(
  uuid, uuid, text, jsonb
) to service_role;
grant execute on function public.complete_next_weekly_plan_generation(
  uuid, uuid, text, jsonb
) to service_role;
grant execute on function public.fail_next_weekly_plan_generation(
  uuid, uuid, text, text, text, boolean, jsonb
) to service_role;
grant execute on function public.recover_stale_next_weekly_plan_generation(
  uuid, uuid
) to service_role;

revoke all on function private.next_weekly_plan_command_outcome(
  uuid, uuid, boolean
) from public, anon, authenticated;
revoke all on function private.fail_next_weekly_plan_generation(
  uuid, uuid, text, text, text, boolean, jsonb
) from public, anon, authenticated;
revoke all on function private.begin_next_weekly_plan_generation(
  uuid, uuid, text, uuid, bigint
) from public, anon, authenticated;
revoke all on function private.checkpoint_next_weekly_plan_generation(
  uuid, uuid, text, jsonb
) from public, anon, authenticated;
revoke all on function private.complete_next_weekly_plan_generation(
  uuid, uuid, text, jsonb
) from public, anon, authenticated;
revoke all on function private.recover_stale_next_weekly_plan_generation(
  uuid, uuid
) from public, anon, authenticated;
