create or replace function private.ensure_ingredient_identities(value jsonb)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  normalized jsonb := value;
  day_index integer;
  meal_type text;
  meal_value jsonb;
  labels jsonb;
  identities jsonb;
  checked_labels jsonb;
  checked_identities jsonb;
begin
  if jsonb_typeof(value -> 'days') is distinct from 'array' then
    return value;
  end if;

  for day_index in 0..jsonb_array_length(value -> 'days') - 1
  loop
    foreach meal_type in array array['breakfast', 'lunch', 'dinner', 'snack']
    loop
      meal_value = normalized #> array['days', day_index::text, meal_type];
      labels = meal_value -> 'ingredients';

      if jsonb_typeof(labels) is distinct from 'array' then
        continue;
      end if;

      identities = meal_value -> 'ingredientIds';
      if jsonb_typeof(identities) is distinct from 'array'
        or jsonb_array_length(identities) <> jsonb_array_length(labels)
        or (
          select count(distinct identity)
          from jsonb_array_elements_text(identities) as identity
        ) <> jsonb_array_length(labels)
      then
        select coalesce(jsonb_agg(gen_random_uuid()::text order by ordinal), '[]'::jsonb)
        into identities
        from jsonb_array_elements(labels) with ordinality as ingredient(label, ordinal);
      end if;

      checked_identities = meal_value -> 'checkedIngredientIds';
      if jsonb_typeof(checked_identities) is distinct from 'array'
        or (
          select count(distinct identity)
          from jsonb_array_elements_text(checked_identities) as identity
        ) <> coalesce(jsonb_array_length(checked_identities), 0)
        or exists (
          select 1
          from jsonb_array_elements_text(checked_identities) as checked(identity)
          where not identities ? checked.identity
        )
      then
        checked_labels = coalesce(meal_value -> 'checkedIngredients', '[]'::jsonb);
        select coalesce(jsonb_agg(identity order by ordinal), '[]'::jsonb)
        into checked_identities
        from (
          select identity, ordinal
          from jsonb_array_elements_text(labels) with ordinality as ingredient(label, ordinal)
          join jsonb_array_elements_text(identities) with ordinality
            as identified(identity, identity_ordinal)
            on identity_ordinal = ordinal
          where checked_labels ? ingredient.label
        ) as checked;
      end if;

      meal_value = jsonb_set(meal_value, '{ingredientIds}', identities, true);
      meal_value = jsonb_set(
        meal_value - 'checkedIngredients',
        '{checkedIngredientIds}',
        checked_identities,
        true
      );
      normalized = jsonb_set(
        normalized,
        array['days', day_index::text, meal_type],
        meal_value
      );
    end loop;
  end loop;

  return normalized;
end;
$$;

create or replace function private.has_stable_ingredient_identities(value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  with meals as (
    select day_value -> meal_type as meal
    from jsonb_array_elements(value -> 'days') as day_value
    cross join unnest(array['breakfast', 'lunch', 'dinner', 'snack']) as meal_type
  ),
  identities as (
    select identity
    from meals
    cross join lateral jsonb_array_elements_text(meal -> 'ingredientIds') as identity
  )
  select not exists (
    select 1
    from meals
    where jsonb_typeof(meal -> 'ingredientIds') is distinct from 'array'
      or jsonb_array_length(meal -> 'ingredientIds')
        <> jsonb_array_length(meal -> 'ingredients')
      or exists (
        select 1
        from jsonb_array_elements_text(meal -> 'ingredientIds') as identity
        where identity !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
      or jsonb_typeof(meal -> 'checkedIngredientIds') is distinct from 'array'
      or (
        select count(distinct identity)
        from jsonb_array_elements_text(meal -> 'checkedIngredientIds') as identity
      ) <> jsonb_array_length(meal -> 'checkedIngredientIds')
      or exists (
        select 1
        from jsonb_array_elements_text(meal -> 'checkedIngredientIds') as checked(identity)
        where not (meal -> 'ingredientIds') ? checked.identity
      )
  )
  and (select count(*) from identities)
    = (select count(distinct identity) from identities);
$$;

create or replace function private.normalize_weekly_plan_ingredient_identities()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  day_index integer;
  meal_type text;
  meal_value jsonb;
begin
  if tg_op = 'INSERT' then
    for day_index in 0..jsonb_array_length(new.document -> 'days') - 1
    loop
      foreach meal_type in array array['breakfast', 'lunch', 'dinner', 'snack']
      loop
        meal_value = new.document #> array['days', day_index::text, meal_type];
        meal_value = meal_value - 'ingredientIds' - 'checkedIngredientIds';
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

create trigger weekly_plans_add_ingredient_identities
before insert or update of document on public.weekly_plans
for each row execute function private.normalize_weekly_plan_ingredient_identities();

update public.weekly_plans
set document = private.ensure_ingredient_identities(document),
    revision = revision + 1,
    updated_at = greatest(clock_timestamp(), updated_at + interval '1 millisecond')
where not private.has_stable_ingredient_identities(
  private.ensure_ingredient_identities(document)
)
or document is distinct from private.ensure_ingredient_identities(document);

alter table public.weekly_plans
  drop constraint weekly_plans_valid_document;
alter table public.weekly_plans
  add constraint weekly_plans_valid_document
  check (
    schema_version = 1
    and private.is_weekly_plan_document(document)
    and private.has_stable_ingredient_identities(document)
  );

alter table public.weekly_plan_commands
  drop constraint weekly_plan_commands_operation;
alter table public.weekly_plan_commands
  add constraint weekly_plan_commands_operation
  check (operation in ('generate_initial', 'set_ingredient_checked'));

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
    'generationId', plan.generation_id
  )
$$;

create or replace function private.ingredient_progress_command_outcome(
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
    'result', command.result_snapshot,
    'error', case
      when command.error_code is null then null
      else jsonb_build_object(
        'code', command.error_code,
        'message', command.error_message,
        'retryable', command.error_retryable
      )
    end
  )
  from public.weekly_plan_commands as command
  where command.command_id = p_command_id
    and command.user_id = p_user_id
    and command.operation = 'set_ingredient_checked'
$$;

create or replace function private.fail_ingredient_progress_command(
  p_user_id uuid,
  p_command_id uuid,
  p_fingerprint text,
  p_code text,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.weekly_plan_commands
  set status = 'failed',
      error_code = p_code,
      error_message = p_message,
      error_retryable = false,
      updated_at = clock_timestamp(),
      completed_at = clock_timestamp()
  where command_id = p_command_id
    and user_id = p_user_id
    and operation = 'set_ingredient_checked'
    and input_fingerprint = p_fingerprint
    and status = 'in_progress';
  return private.ingredient_progress_command_outcome(p_user_id, p_command_id);
end;
$$;

create or replace function public.set_ingredient_checked(
  p_plan_id uuid,
  p_displayed_revision bigint,
  p_day text,
  p_meal_type text,
  p_ingredient_id uuid,
  p_checked boolean,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  fingerprint_source text;
  fingerprint text;
  inserted_command boolean;
  existing public.weekly_plan_commands;
  plan public.weekly_plans;
  meal_path text[];
  meal_value jsonb;
  checked_identities jsonb;
  next_document jsonb;
  command_result_snapshot jsonb;
begin
  if caller_id is null then
    return jsonb_build_object(
      'commandId', p_command_id,
      'status', 'failed',
      'result', null,
      'error', jsonb_build_object(
        'code', 'authentication_required',
        'message', 'Authentication is required.',
        'retryable', false
      )
    );
  end if;
  if p_command_id is null
    or p_plan_id is null
    or p_displayed_revision is null
    or p_displayed_revision < 0
    or p_day is null
    or p_day = ''
    or p_meal_type is null
    or p_meal_type not in ('breakfast', 'lunch', 'dinner', 'snack')
    or p_ingredient_id is null
    or p_checked is null
  then
    return jsonb_build_object(
      'commandId', p_command_id,
      'status', 'failed',
      'result', null,
      'error', jsonb_build_object(
        'code', 'invalid_command',
        'message', 'The ingredient progress command is incomplete or invalid.',
        'retryable', false
      )
    );
  end if;

  fingerprint_source = concat_ws(
    '|',
    p_plan_id::text,
    p_displayed_revision::text,
    p_day,
    p_meal_type,
    p_ingredient_id::text,
    p_checked::text
  );
  fingerprint = md5(fingerprint_source) || md5('ingredient-progress|' || fingerprint_source);

  insert into public.weekly_plan_commands (
    command_id, user_id, operation, input_fingerprint, status
  ) values (
    p_command_id, caller_id, 'set_ingredient_checked', fingerprint, 'in_progress'
  )
  on conflict (command_id) do nothing
  returning true into inserted_command;

  if not coalesce(inserted_command, false) then
    select * into existing
    from public.weekly_plan_commands
    where command_id = p_command_id;
    if existing.user_id <> caller_id
      or existing.operation <> 'set_ingredient_checked'
      or existing.input_fingerprint <> fingerprint
    then
      return jsonb_build_object(
        'commandId', p_command_id,
        'status', 'failed',
        'result', null,
        'error', jsonb_build_object(
          'code', 'idempotency_key_reused',
          'message', 'That command ID was already used with different input.',
          'retryable', false
        )
      );
    end if;
    return private.ingredient_progress_command_outcome(caller_id, p_command_id);
  end if;

  select * into plan
  from public.weekly_plans
  where plan_id = p_plan_id
    and user_id = caller_id
    and is_active
  for update;

  if not found then
    return private.fail_ingredient_progress_command(
      caller_id,
      p_command_id,
      fingerprint,
      'stale_plan',
      'That Weekly Plan is no longer current.'
    );
  end if;

  if p_displayed_revision > plan.revision then
    return private.fail_ingredient_progress_command(
      caller_id,
      p_command_id,
      fingerprint,
      'stale_plan',
      'The displayed revision is not authoritative.'
    );
  end if;

  if plan.next_generation_id is not null then
    return private.fail_ingredient_progress_command(
      caller_id,
      p_command_id,
      fingerprint,
      'plan_generation_locked',
      'A Next Weekly Plan is being generated.'
    );
  end if;

  select array['days', (day_ordinal - 1)::text, p_meal_type]
  into meal_path
  from jsonb_array_elements(plan.document -> 'days')
    with ordinality as day_value(value, day_ordinal)
  where day_value.value ->> 'day' = p_day
  limit 1;

  if meal_path is null then
    return private.fail_ingredient_progress_command(
      caller_id,
      p_command_id,
      fingerprint,
      'meal_slot_not_found',
      'That Meal Slot is not in the Current Weekly Plan.'
    );
  end if;

  meal_value = plan.document #> meal_path;
  if not coalesce(meal_value -> 'ingredientIds', '[]'::jsonb) ? p_ingredient_id::text then
    return private.fail_ingredient_progress_command(
      caller_id,
      p_command_id,
      fingerprint,
      'ingredient_not_found',
      'That ingredient is not in the Current Weekly Plan Meal Slot.'
    );
  end if;

  checked_identities = coalesce(meal_value -> 'checkedIngredientIds', '[]'::jsonb);
  if p_checked = (checked_identities ? p_ingredient_id::text) then
    command_result_snapshot = private.authoritative_weekly_plan_row(plan);
  else
    if p_checked then
      checked_identities = checked_identities || to_jsonb(p_ingredient_id::text);
    else
      select coalesce(jsonb_agg(identity), '[]'::jsonb)
      into checked_identities
      from jsonb_array_elements_text(checked_identities) as checked(identity)
      where checked.identity <> p_ingredient_id::text;
    end if;

    meal_value = jsonb_set(
      meal_value,
      '{checkedIngredientIds}',
      checked_identities
    );
    next_document = jsonb_set(plan.document, meal_path, meal_value);
    update public.weekly_plans
    set document = next_document,
        revision = revision + 1,
        updated_at = greatest(clock_timestamp(), updated_at + interval '1 millisecond')
    where plan_id = plan.plan_id
    returning * into plan;
    command_result_snapshot = private.authoritative_weekly_plan_row(plan);
  end if;

  update public.weekly_plan_commands
  set status = 'succeeded',
      result_plan_id = plan.plan_id,
      result_snapshot = command_result_snapshot,
      updated_at = clock_timestamp(),
      completed_at = clock_timestamp()
  where command_id = p_command_id
    and user_id = caller_id
    and operation = 'set_ingredient_checked'
    and input_fingerprint = fingerprint
    and status = 'in_progress';

  return private.ingredient_progress_command_outcome(caller_id, p_command_id);
end;
$$;

revoke all on function public.set_ingredient_checked(
  uuid, bigint, text, text, uuid, boolean, uuid
) from public, anon;
grant execute on function public.set_ingredient_checked(
  uuid, bigint, text, text, uuid, boolean, uuid
) to authenticated;

revoke all on function private.ensure_ingredient_identities(jsonb)
  from public, anon, authenticated;
revoke all on function private.has_stable_ingredient_identities(jsonb)
  from public, anon, authenticated;
revoke all on function private.normalize_weekly_plan_ingredient_identities()
  from public, anon, authenticated;
revoke all on function private.authoritative_weekly_plan_row(public.weekly_plans)
  from public, anon, authenticated;
revoke all on function private.ingredient_progress_command_outcome(uuid, uuid)
  from public, anon, authenticated;
revoke all on function private.fail_ingredient_progress_command(
  uuid, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function private.ensure_ingredient_identities(jsonb)
  to service_role;
grant execute on function private.has_stable_ingredient_identities(jsonb)
  to service_role;
grant execute on function private.normalize_weekly_plan_ingredient_identities()
  to service_role;
grant execute on function private.authoritative_weekly_plan_row(public.weekly_plans)
  to service_role;
grant execute on function private.ingredient_progress_command_outcome(uuid, uuid)
  to service_role;
grant execute on function private.fail_ingredient_progress_command(
  uuid, uuid, text, text, text
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
      and tablename = 'weekly_plans'
  ) then
    alter publication supabase_realtime add table public.weekly_plans;
  end if;
end;
$$;
