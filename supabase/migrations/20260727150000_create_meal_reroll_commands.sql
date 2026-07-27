alter table public.weekly_plan_commands
  drop constraint weekly_plan_commands_operation;
alter table public.weekly_plan_commands
  add constraint weekly_plan_commands_operation
  check (operation in (
    'generate_initial',
    'set_ingredient_checked',
    'reroll_meal'
  ));

-- Ingredient progress updates preserve identities because, after identity
-- fields are ignored, the meal is unchanged. A Meal Reroll is a new recipe
-- and receives new identities even when its ingredient labels happen to match.
create or replace function private.normalize_weekly_plan_ingredient_identities()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  day_index integer;
  meal_type text;
  meal_value jsonb;
  old_meal_value jsonb;
begin
  if tg_op = 'INSERT' then
    new.document = private.strip_ingredient_identities(new.document);
  else
    for day_index in 0..jsonb_array_length(new.document -> 'days') - 1
    loop
      foreach meal_type in array array['breakfast', 'lunch', 'dinner', 'snack']
      loop
        meal_value = new.document #> array['days', day_index::text, meal_type];
        old_meal_value = old.document #> array['days', day_index::text, meal_type];
        if meal_value -> 'ingredients' = old_meal_value -> 'ingredients'
          and jsonb_typeof(old_meal_value -> 'ingredientIds') = 'array'
          and (
            meal_value - 'ingredientIds' - 'checkedIngredientIds'
          ) = (
            old_meal_value - 'ingredientIds' - 'checkedIngredientIds'
          )
        then
          meal_value = jsonb_set(
            meal_value,
            '{ingredientIds}',
            old_meal_value -> 'ingredientIds',
            true
          );
        else
          meal_value = meal_value - 'ingredientIds' - 'checkedIngredientIds';
        end if;
        new.document = jsonb_set(
          new.document,
          array['days', day_index::text, meal_type],
          meal_value
        );
      end loop;
    end loop;
  end if;
  new.document = private.ensure_ingredient_identities(new.document);
  return new;
end;
$$;

create table public.weekly_plan_meal_reroll_reservations (
  command_id uuid primary key
    references public.weekly_plan_commands (command_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id uuid not null,
  displayed_plan_id uuid not null,
  displayed_revision bigint not null check (displayed_revision >= 0),
  day text not null check (day <> ''),
  meal_type text not null
    check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack')),
  reserved_at timestamptz not null default now(),
  constraint weekly_plan_meal_reroll_reservation_owner
    foreign key (plan_id, user_id)
    references public.weekly_plans (plan_id, user_id),
  constraint weekly_plan_meal_reroll_displayed_owner
    foreign key (displayed_plan_id, user_id)
    references public.weekly_plans (plan_id, user_id),
  constraint weekly_plan_meal_reroll_slot_unique
    unique (plan_id, day, meal_type)
);

alter table public.weekly_plan_meal_reroll_reservations enable row level security;
alter table public.weekly_plan_meal_reroll_reservations replica identity full;

create policy weekly_plan_meal_reroll_reservations_select_own
on public.weekly_plan_meal_reroll_reservations
for select
to authenticated
using (user_id = auth.uid());

revoke all on public.weekly_plan_meal_reroll_reservations
  from public, anon, authenticated;
grant select on public.weekly_plan_meal_reroll_reservations to authenticated;

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

create or replace function private.fail_meal_reroll(
  p_user_id uuid,
  p_command_id uuid,
  p_input_fingerprint text,
  p_code text,
  p_message text,
  p_retryable boolean,
  p_evidence jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.weekly_plan_commands
  set status = 'failed',
      provider_checkpoint = null,
      error_code = p_code,
      error_message = p_message,
      error_retryable = p_retryable,
      failure_evidence = p_evidence,
      updated_at = clock_timestamp(),
      completed_at = clock_timestamp()
  where command_id = p_command_id
    and user_id = p_user_id
    and operation = 'reroll_meal'
    and input_fingerprint = p_input_fingerprint
    and status = 'in_progress';

  delete from public.weekly_plan_meal_reroll_reservations
  where command_id = p_command_id and user_id = p_user_id;

  return private.meal_reroll_command_outcome(p_user_id, p_command_id);
end;
$$;

create or replace function private.begin_meal_reroll(
  p_user_id uuid,
  p_command_id uuid,
  p_input_fingerprint text,
  p_displayed_plan_id uuid,
  p_displayed_revision bigint,
  p_day text,
  p_meal_type text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.weekly_plan_commands;
  displayed_plan public.weekly_plans;
  current_plan public.weekly_plans;
begin
  if p_input_fingerprint !~ '^[0-9a-f]{64}$'
    or p_displayed_plan_id is null
    or p_displayed_revision is null
    or p_displayed_revision < 0
    or p_day is null
    or p_day = ''
    or p_meal_type not in ('breakfast', 'lunch', 'dinner', 'snack')
  then
    raise exception 'Invalid Meal Reroll command';
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
      or existing.operation <> 'reroll_meal'
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
    return private.meal_reroll_command_outcome(p_user_id, p_command_id, false);
  end if;

  insert into public.weekly_plan_commands (
    command_id, user_id, operation, input_fingerprint, status
  ) values (
    p_command_id, p_user_id, 'reroll_meal', p_input_fingerprint, 'in_progress'
  );

  select * into displayed_plan
  from public.weekly_plans
  where plan_id = p_displayed_plan_id and user_id = p_user_id;
  if not found or p_displayed_revision > displayed_plan.revision then
    return private.fail_meal_reroll(
      p_user_id, p_command_id, p_input_fingerprint,
      'stale_plan', 'The displayed Weekly Plan is not recognized.', false
    );
  end if;

  select * into current_plan
  from public.weekly_plans
  where user_id = p_user_id and is_active
  for update;
  if not found then
    return private.fail_meal_reroll(
      p_user_id, p_command_id, p_input_fingerprint,
      'no_current_plan', 'There is no Current Weekly Plan.', false
    );
  end if;
  if current_plan.next_generation_id is not null then
    return private.fail_meal_reroll(
      p_user_id, p_command_id, p_input_fingerprint,
      'plan_generation_locked', 'A Next Weekly Plan is being generated.', false
    );
  end if;
  if not exists (
    select 1
    from jsonb_array_elements(current_plan.document -> 'days') as day_value(value)
    where day_value.value ->> 'day' = p_day
      and day_value.value ? p_meal_type
  ) then
    return private.fail_meal_reroll(
      p_user_id, p_command_id, p_input_fingerprint,
      'meal_slot_not_found', 'That Meal Slot is not in the Current Weekly Plan.', false
    );
  end if;

  begin
    insert into public.weekly_plan_meal_reroll_reservations (
      command_id, user_id, plan_id, displayed_plan_id,
      displayed_revision, day, meal_type
    ) values (
      p_command_id, p_user_id, current_plan.plan_id, p_displayed_plan_id,
      p_displayed_revision, p_day, p_meal_type
    );
  exception when unique_violation then
    return private.fail_meal_reroll(
      p_user_id, p_command_id, p_input_fingerprint,
      'meal_slot_busy', 'That Meal Slot is already being rerolled.', true
    );
  end;

  return private.meal_reroll_command_outcome(p_user_id, p_command_id, true);
end;
$$;

create or replace function private.checkpoint_meal_reroll(
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
begin
  if jsonb_typeof(p_checkpoint) is distinct from 'object'
    or p_checkpoint ->> 'kind' not in ('success', 'failure', 'unknown')
    or jsonb_typeof(p_checkpoint -> 'usageRecord') is distinct from 'object'
  then
    raise exception 'Invalid provider checkpoint';
  end if;

  update public.weekly_plan_commands
  set provider_checkpoint = p_checkpoint,
      updated_at = clock_timestamp()
  where command_id = p_command_id
    and user_id = p_user_id
    and operation = 'reroll_meal'
    and input_fingerprint = p_input_fingerprint
    and status = 'in_progress'
    and provider_checkpoint is null;

  return private.meal_reroll_command_outcome(p_user_id, p_command_id);
end;
$$;

create or replace function private.complete_meal_reroll(
  p_user_id uuid,
  p_command_id uuid,
  p_input_fingerprint text,
  p_meal jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  command public.weekly_plan_commands;
  reservation public.weekly_plan_meal_reroll_reservations;
  plan public.weekly_plans;
  day_index integer;
  day_value jsonb;
  meal_path text[];
  next_document jsonb;
  next_day jsonb;
  daily_summary jsonb;
begin
  select * into command
  from public.weekly_plan_commands
  where command_id = p_command_id
    and user_id = p_user_id
    and operation = 'reroll_meal'
    and input_fingerprint = p_input_fingerprint
  for update;

  if not found then
    raise exception 'Unknown Meal Reroll command';
  end if;
  if command.status <> 'in_progress' then
    return private.meal_reroll_command_outcome(p_user_id, p_command_id);
  end if;
  if private.is_weekly_plan_meal(p_meal) is distinct from true then
    return private.fail_meal_reroll(
      p_user_id, p_command_id, p_input_fingerprint,
      'invalid_plan_document', 'The generated meal is unusable.', false,
      '{"stage":"completion","reason":"invalid_generated_meal"}'::jsonb
    );
  end if;

  select * into reservation
  from public.weekly_plan_meal_reroll_reservations
  where command_id = p_command_id and user_id = p_user_id
  for update;
  if not found then
    return private.fail_meal_reroll(
      p_user_id, p_command_id, p_input_fingerprint,
      'meal_slot_not_found', 'The Meal Slot reservation is no longer valid.', false,
      '{"stage":"completion","reason":"reservation_missing"}'::jsonb
    );
  end if;

  select * into plan
  from public.weekly_plans
  where plan_id = reservation.plan_id
    and user_id = p_user_id
    and is_active
  for update;
  if not found or plan.next_generation_id is not null then
    return private.fail_meal_reroll(
      p_user_id, p_command_id, p_input_fingerprint,
      'stale_plan', 'The reserved Weekly Plan is no longer current.', false,
      '{"stage":"completion","reason":"target_changed"}'::jsonb
    );
  end if;

  select day_ordinal - 1, value
  into day_index, day_value
  from jsonb_array_elements(plan.document -> 'days')
    with ordinality as current_day(value, day_ordinal)
  where value ->> 'day' = reservation.day
  limit 1;
  if day_index is null or not day_value ? reservation.meal_type then
    return private.fail_meal_reroll(
      p_user_id, p_command_id, p_input_fingerprint,
      'meal_slot_not_found', 'The reserved Meal Slot no longer exists.', false,
      '{"stage":"completion","reason":"slot_missing"}'::jsonb
    );
  end if;

  meal_path = array['days', day_index::text, reservation.meal_type];
  next_document = jsonb_set(plan.document, meal_path, p_meal);
  next_day = next_document #> array['days', day_index::text];
  select jsonb_build_object(
    'calories', sum((meal -> 'macros' ->> 'calories')::numeric),
    'protein', sum((meal -> 'macros' ->> 'protein')::numeric),
    'carbs', sum((meal -> 'macros' ->> 'carbs')::numeric),
    'fats', sum((meal -> 'macros' ->> 'fats')::numeric)
  )
  into daily_summary
  from (
    select next_day -> meal_type as meal
    from unnest(array['breakfast', 'lunch', 'dinner', 'snack']) as meal_type
  ) as meals;
  next_document = jsonb_set(
    next_document,
    array['days', day_index::text, 'dailySummary'],
    daily_summary
  );

  perform set_config('app.meal_reroll_command_id', p_command_id::text, true);
  update public.weekly_plans
  set document = next_document,
      revision = revision + 1,
      updated_at = greatest(clock_timestamp(), updated_at + interval '1 millisecond')
  where plan_id = plan.plan_id
  returning * into plan;

  update public.weekly_plan_commands
  set status = 'succeeded',
      result_plan_id = plan.plan_id,
      result_snapshot = private.authoritative_weekly_plan_row(plan),
      provider_checkpoint = null,
      updated_at = clock_timestamp(),
      completed_at = clock_timestamp()
  where command_id = p_command_id;

  delete from public.weekly_plan_meal_reroll_reservations
  where command_id = p_command_id;

  return private.meal_reroll_command_outcome(p_user_id, p_command_id);
end;
$$;

create or replace function private.enforce_meal_reroll_reservations()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  reservation public.weekly_plan_meal_reroll_reservations;
  old_meal jsonb;
  new_meal jsonb;
begin
  for reservation in
    select *
    from public.weekly_plan_meal_reroll_reservations
    where plan_id = old.plan_id
  loop
    if not new.is_active
      or new.next_generation_id is distinct from old.next_generation_id
    then
      raise exception 'Weekly Plan mutation blocked by Meal Reroll reservation'
        using errcode = 'P0001';
    end if;
    select value -> reservation.meal_type into old_meal
    from jsonb_array_elements(old.document -> 'days') as day_value(value)
    where value ->> 'day' = reservation.day;
    select value -> reservation.meal_type into new_meal
    from jsonb_array_elements(new.document -> 'days') as day_value(value)
    where value ->> 'day' = reservation.day;
    if new_meal is distinct from old_meal
      and current_setting('app.meal_reroll_command_id', true)
        is distinct from reservation.command_id::text
    then
      raise exception 'meal_slot_busy'
        using errcode = 'P0001';
    end if;
  end loop;
  return new;
end;
$$;

create trigger weekly_plans_enforce_meal_reroll_reservations
before update on public.weekly_plans
for each row execute function private.enforce_meal_reroll_reservations();

create or replace function public.begin_meal_reroll(
  p_user_id uuid,
  p_command_id uuid,
  p_input_fingerprint text,
  p_displayed_plan_id uuid,
  p_displayed_revision bigint,
  p_day text,
  p_meal_type text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.begin_meal_reroll(
    p_user_id, p_command_id, p_input_fingerprint, p_displayed_plan_id,
    p_displayed_revision, p_day, p_meal_type
  )
$$;

create or replace function public.checkpoint_meal_reroll(
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
  select private.checkpoint_meal_reroll(
    p_user_id, p_command_id, p_input_fingerprint, p_checkpoint
  )
$$;

create or replace function public.complete_meal_reroll(
  p_user_id uuid,
  p_command_id uuid,
  p_input_fingerprint text,
  p_meal jsonb
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.complete_meal_reroll(
    p_user_id, p_command_id, p_input_fingerprint, p_meal
  )
$$;

create or replace function public.fail_meal_reroll(
  p_user_id uuid,
  p_command_id uuid,
  p_input_fingerprint text,
  p_code text,
  p_message text,
  p_retryable boolean,
  p_evidence jsonb
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.fail_meal_reroll(
    p_user_id, p_command_id, p_input_fingerprint, p_code,
    p_message, p_retryable, p_evidence
  )
$$;

revoke all on function public.begin_meal_reroll(
  uuid, uuid, text, uuid, bigint, text, text
) from public, anon, authenticated;
revoke all on function public.checkpoint_meal_reroll(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.complete_meal_reroll(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.fail_meal_reroll(
  uuid, uuid, text, text, text, boolean, jsonb
) from public, anon, authenticated;
grant execute on function public.begin_meal_reroll(
  uuid, uuid, text, uuid, bigint, text, text
) to service_role;
grant execute on function public.checkpoint_meal_reroll(uuid, uuid, text, jsonb)
  to service_role;
grant execute on function public.complete_meal_reroll(uuid, uuid, text, jsonb)
  to service_role;
grant execute on function public.fail_meal_reroll(
  uuid, uuid, text, text, text, boolean, jsonb
) to service_role;

do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'weekly_plan_meal_reroll_reservations'
  ) then
    alter publication supabase_realtime
      add table public.weekly_plan_meal_reroll_reservations;
  end if;
end
$$;

revoke all on function private.meal_reroll_command_outcome(uuid, uuid, boolean)
  from public, anon, authenticated;
revoke all on function private.fail_meal_reroll(
  uuid, uuid, text, text, text, boolean, jsonb
) from public, anon, authenticated;
revoke all on function private.begin_meal_reroll(
  uuid, uuid, text, uuid, bigint, text, text
) from public, anon, authenticated;
revoke all on function private.checkpoint_meal_reroll(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function private.complete_meal_reroll(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function private.enforce_meal_reroll_reservations()
  from public, anon, authenticated;

grant execute on function private.meal_reroll_command_outcome(uuid, uuid, boolean)
  to service_role;
grant execute on function private.fail_meal_reroll(
  uuid, uuid, text, text, text, boolean, jsonb
) to service_role;
grant execute on function private.begin_meal_reroll(
  uuid, uuid, text, uuid, bigint, text, text
) to service_role;
grant execute on function private.checkpoint_meal_reroll(uuid, uuid, text, jsonb)
  to service_role;
grant execute on function private.complete_meal_reroll(uuid, uuid, text, jsonb)
  to service_role;
