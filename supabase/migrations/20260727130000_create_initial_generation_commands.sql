create table public.weekly_plan_commands (
  command_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  operation text not null,
  input_fingerprint text not null,
  status text not null,
  result_plan_id uuid,
  result_snapshot jsonb,
  provider_checkpoint jsonb,
  error_code text,
  error_message text,
  error_retryable boolean,
  failure_evidence jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint weekly_plan_commands_operation
    check (operation in ('generate_initial')),
  constraint weekly_plan_commands_fingerprint
    check (input_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint weekly_plan_commands_status
    check (status in ('in_progress', 'succeeded', 'failed')),
  constraint weekly_plan_commands_outcome check (
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
      and result_plan_id is not null
      and result_snapshot is not null
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
  ),
  constraint weekly_plan_commands_failure_evidence
    check (failure_evidence is null or jsonb_typeof(failure_evidence) = 'object'),
  constraint weekly_plan_commands_provider_checkpoint
    check (
      provider_checkpoint is null
      or (
        status = 'in_progress'
        and jsonb_typeof(provider_checkpoint) = 'object'
        and provider_checkpoint ->> 'kind' in ('success', 'failure', 'unknown')
        and jsonb_typeof(provider_checkpoint -> 'usageRecord') = 'object'
      )
    ),
  constraint weekly_plan_commands_result_owner foreign key (result_plan_id, user_id)
    references public.weekly_plans (plan_id, user_id)
);

create unique index weekly_plan_commands_one_pending_initial_per_user
  on public.weekly_plan_commands (user_id)
  where operation = 'generate_initial' and status = 'in_progress';

create index weekly_plan_commands_user_created_at
  on public.weekly_plan_commands (user_id, created_at desc);

alter table public.weekly_plan_commands enable row level security;

revoke all on table public.weekly_plan_commands
  from public, anon, authenticated, service_role;

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
    'checkpoint', command.provider_checkpoint
  )
  from public.weekly_plan_commands as command
  where command.command_id = p_command_id
    and command.user_id = p_user_id
$$;

create or replace function private.begin_initial_weekly_plan_generation(
  p_user_id uuid,
  p_command_id uuid,
  p_input_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.weekly_plan_commands;
begin
  if p_input_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid input fingerprint';
  end if;

  -- Lock the durable owner row so distinct sessions serialize before either can
  -- authorize provider work. This transaction ends before the provider call.
  perform 1 from auth.users where id = p_user_id for update;
  if not found then
    raise exception 'Unknown command owner';
  end if;

  select * into existing
  from public.weekly_plan_commands
  where command_id = p_command_id;

  if found then
    if existing.user_id <> p_user_id
      or existing.operation <> 'generate_initial'
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

    return private.weekly_plan_command_outcome(
      p_user_id, p_command_id, false
    );
  end if;

  if exists (
    select 1 from public.weekly_plans
    where user_id = p_user_id and is_active
  ) then
    insert into public.weekly_plan_commands (
      command_id, user_id, operation, input_fingerprint, status,
      error_code, error_message, error_retryable, completed_at
    ) values (
      p_command_id, p_user_id, 'generate_initial', p_input_fingerprint, 'failed',
      'current_plan_exists', 'A Current Weekly Plan already exists.', false, now()
    );
    update public.weekly_plan_commands
    set failure_evidence = '{"stage":"start","reason":"current_plan_exists"}'::jsonb
    where command_id = p_command_id;
    return private.weekly_plan_command_outcome(
      p_user_id, p_command_id, false
    );
  end if;

  if exists (
    select 1 from public.weekly_plan_commands
    where user_id = p_user_id
      and operation = 'generate_initial'
      and status = 'in_progress'
  ) then
    insert into public.weekly_plan_commands (
      command_id, user_id, operation, input_fingerprint, status,
      error_code, error_message, error_retryable, completed_at
    ) values (
      p_command_id, p_user_id, 'generate_initial', p_input_fingerprint, 'failed',
      'plan_generation_locked',
      'Another Current Weekly Plan generation is already in progress.',
      true, now()
    );
    update public.weekly_plan_commands
    set failure_evidence =
      '{"stage":"start","reason":"generation_already_pending"}'::jsonb
    where command_id = p_command_id;
    return private.weekly_plan_command_outcome(
      p_user_id, p_command_id, false
    );
  end if;

  insert into public.weekly_plan_commands (
    command_id, user_id, operation, input_fingerprint, status
  ) values (
    p_command_id, p_user_id, 'generate_initial', p_input_fingerprint, 'in_progress'
  );

  return private.weekly_plan_command_outcome(
    p_user_id, p_command_id, true
  );
end;
$$;

create or replace function private.checkpoint_initial_weekly_plan_generation(
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
  safe_evidence jsonb;
begin
  perform 1 from auth.users where id = p_user_id for update;

  select * into command
  from public.weekly_plan_commands
  where command_id = p_command_id and user_id = p_user_id
  for update;

  if not found
    or command.operation <> 'generate_initial'
    or command.input_fingerprint <> p_input_fingerprint
  then
    return jsonb_build_object(
      'commandId', p_command_id,
      'status', 'failed',
      'result', null,
      'error', jsonb_build_object(
        'code', 'idempotency_key_reused',
        'message', 'That command ID does not match the recorded generation.',
        'retryable', false
      ),
      'shouldGenerate', false,
      'checkpoint', null
    );
  end if;

  if command.status <> 'in_progress' then
    return private.weekly_plan_command_outcome(
      p_user_id, p_command_id, false
    );
  end if;

  if jsonb_typeof(p_checkpoint) <> 'object'
    or p_checkpoint ->> 'kind' not in ('success', 'failure', 'unknown')
    or jsonb_typeof(p_checkpoint -> 'usageRecord') <> 'object'
  then
    raise exception 'Invalid provider checkpoint';
  end if;

  if command.provider_checkpoint is not null then
    if command.provider_checkpoint <> p_checkpoint then
      raise exception 'Provider checkpoint cannot change';
    end if;
    return private.weekly_plan_command_outcome(
      p_user_id, p_command_id, false
    );
  end if;

  safe_evidence = case
    when p_checkpoint ->> 'kind' in ('failure', 'unknown')
    then jsonb_strip_nulls(jsonb_build_object(
      'stage', p_checkpoint -> 'evidence' ->> 'stage',
      'reason', p_checkpoint -> 'evidence' ->> 'reason',
      'providerRequestId', p_checkpoint -> 'evidence' ->> 'providerRequestId',
      'providerResponseId', p_checkpoint -> 'evidence' ->> 'providerResponseId',
      'callId', p_checkpoint -> 'evidence' ->> 'callId',
      'attempt', p_checkpoint -> 'evidence' -> 'attempt'
    ))
    else null
  end;

  update public.weekly_plan_commands
  set provider_checkpoint = p_checkpoint,
      failure_evidence = coalesce(safe_evidence, failure_evidence),
      updated_at = now()
  where command_id = p_command_id;

  return private.weekly_plan_command_outcome(
    p_user_id, p_command_id, false
  );
end;
$$;

create or replace function private.complete_initial_weekly_plan_generation(
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
  plan public.weekly_plans;
  completed_result jsonb;
begin
  perform 1 from auth.users where id = p_user_id for update;

  select * into command
  from public.weekly_plan_commands
  where command_id = p_command_id and user_id = p_user_id
  for update;

  if not found
    or command.operation <> 'generate_initial'
    or command.input_fingerprint <> p_input_fingerprint
  then
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
    return private.weekly_plan_command_outcome(
      p_user_id, p_command_id, false
    );
  end if;

  if not private.is_weekly_plan_document(p_document) then
    update public.weekly_plan_commands
    set status = 'failed',
        error_code = 'invalid_plan_document',
        error_message = 'The generated Weekly Plan was incomplete or invalid.',
        error_retryable = false,
        failure_evidence = '{"stage":"validation"}'::jsonb,
        updated_at = now(),
        completed_at = now()
    where command_id = p_command_id;
    return private.weekly_plan_command_outcome(
      p_user_id, p_command_id, false
    );
  end if;

  if exists (
    select 1 from public.weekly_plans
    where user_id = p_user_id and is_active
  ) then
    update public.weekly_plan_commands
    set status = 'failed',
        error_code = 'generation_failed',
        error_message = 'A Current Weekly Plan was created before this command completed.',
        error_retryable = false,
        failure_evidence = '{"stage":"completion","reason":"active_plan_exists"}'::jsonb,
        updated_at = now(),
        completed_at = now()
    where command_id = p_command_id;
    return private.weekly_plan_command_outcome(
      p_user_id, p_command_id, false
    );
  end if;

  insert into public.weekly_plans (
    user_id, document, schema_version, revision, is_active, generation_id
  ) values (
    p_user_id, p_document, 1, 0, true, p_command_id
  )
  returning * into plan;

  completed_result = jsonb_build_object(
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
    'generationId', plan.generation_id
  );

  update public.weekly_plan_commands
  set status = 'succeeded',
      result_plan_id = plan.plan_id,
      result_snapshot = completed_result,
      provider_checkpoint = null,
      updated_at = now(),
      completed_at = now()
  where command_id = p_command_id;

  return private.weekly_plan_command_outcome(
    p_user_id, p_command_id, false
  );
end;
$$;

create or replace function private.fail_initial_weekly_plan_generation(
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
  perform 1 from auth.users where id = p_user_id for update;

  select * into command
  from public.weekly_plan_commands
  where command_id = p_command_id and user_id = p_user_id
  for update;

  if not found
    or command.operation <> 'generate_initial'
    or command.input_fingerprint <> p_input_fingerprint
  then
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
    return private.weekly_plan_command_outcome(
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

  update public.weekly_plan_commands
  set status = 'failed',
      error_code = p_error_code,
      error_message = p_error_message,
      error_retryable = p_retryable,
      failure_evidence = safe_evidence,
      provider_checkpoint = null,
      updated_at = now(),
      completed_at = now()
  where command_id = p_command_id;

  return private.weekly_plan_command_outcome(
    p_user_id, p_command_id, false
  );
end;
$$;

revoke all on function private.weekly_plan_command_outcome(uuid, uuid, boolean)
  from public, anon, authenticated;
revoke all on function private.begin_initial_weekly_plan_generation(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function private.checkpoint_initial_weekly_plan_generation(
  uuid, uuid, text, jsonb
) from public, anon, authenticated;
revoke all on function private.complete_initial_weekly_plan_generation(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function private.fail_initial_weekly_plan_generation(
  uuid, uuid, text, text, text, boolean, jsonb
) from public, anon, authenticated;

grant execute on function private.weekly_plan_command_outcome(uuid, uuid, boolean)
  to service_role;
grant execute on function private.begin_initial_weekly_plan_generation(uuid, uuid, text)
  to service_role;
grant execute on function private.checkpoint_initial_weekly_plan_generation(
  uuid, uuid, text, jsonb
) to service_role;
grant execute on function private.complete_initial_weekly_plan_generation(uuid, uuid, text, jsonb)
  to service_role;
grant execute on function private.fail_initial_weekly_plan_generation(
  uuid, uuid, text, text, text, boolean, jsonb
) to service_role;

-- PostgREST exposes RPCs from the public schema. These service-role-only
-- wrappers keep command internals private while giving the Edge Function a
-- transaction boundary for each phase.
create or replace function public.begin_initial_weekly_plan_generation(
  p_user_id uuid,
  p_command_id uuid,
  p_input_fingerprint text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.begin_initial_weekly_plan_generation(
    p_user_id, p_command_id, p_input_fingerprint
  )
$$;

create or replace function public.complete_initial_weekly_plan_generation(
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
  select private.complete_initial_weekly_plan_generation(
    p_user_id, p_command_id, p_input_fingerprint, p_document
  )
$$;

create or replace function public.checkpoint_initial_weekly_plan_generation(
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
  select private.checkpoint_initial_weekly_plan_generation(
    p_user_id, p_command_id, p_input_fingerprint, p_checkpoint
  )
$$;

create or replace function public.fail_initial_weekly_plan_generation(
  p_user_id uuid,
  p_command_id uuid,
  p_input_fingerprint text,
  p_error_code text,
  p_error_message text,
  p_retryable boolean,
  p_failure_evidence jsonb default '{}'::jsonb
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.fail_initial_weekly_plan_generation(
    p_user_id, p_command_id, p_input_fingerprint, p_error_code,
    p_error_message, p_retryable, p_failure_evidence
  )
$$;

revoke all on function public.begin_initial_weekly_plan_generation(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.complete_initial_weekly_plan_generation(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.checkpoint_initial_weekly_plan_generation(
  uuid, uuid, text, jsonb
) from public, anon, authenticated;
revoke all on function public.fail_initial_weekly_plan_generation(
  uuid, uuid, text, text, text, boolean, jsonb
) from public, anon, authenticated;

grant execute on function public.begin_initial_weekly_plan_generation(uuid, uuid, text)
  to service_role;
grant execute on function public.complete_initial_weekly_plan_generation(uuid, uuid, text, jsonb)
  to service_role;
grant execute on function public.checkpoint_initial_weekly_plan_generation(
  uuid, uuid, text, jsonb
) to service_role;
grant execute on function public.fail_initial_weekly_plan_generation(
  uuid, uuid, text, text, text, boolean, jsonb
) to service_role;
