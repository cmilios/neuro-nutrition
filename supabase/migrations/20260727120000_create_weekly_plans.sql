create schema if not exists private;

create or replace function private.is_weekly_plan_macros(value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(value) = 'object'
    and jsonb_typeof(value -> 'calories') = 'number'
    and (value ->> 'calories')::numeric >= 0
    and jsonb_typeof(value -> 'protein') = 'number'
    and (value ->> 'protein')::numeric >= 0
    and jsonb_typeof(value -> 'carbs') = 'number'
    and (value ->> 'carbs')::numeric >= 0
    and jsonb_typeof(value -> 'fats') = 'number'
    and (value ->> 'fats')::numeric >= 0;
$$;

create or replace function private.is_weekly_plan_string_array(value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(value) = 'array'
    and not exists (
      select 1
      from jsonb_array_elements(value) as item
      where jsonb_typeof(item) <> 'string' or item = '""'::jsonb
    );
$$;

create or replace function private.is_weekly_plan_meal(value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(value) = 'object'
    and jsonb_typeof(value -> 'name') = 'string'
    and value ->> 'name' <> ''
    and jsonb_typeof(value -> 'description') = 'string'
    and value ->> 'description' <> ''
    and private.is_weekly_plan_string_array(value -> 'ingredients')
    and jsonb_array_length(value -> 'ingredients') > 0
    and private.is_weekly_plan_string_array(value -> 'instructions')
    and jsonb_array_length(value -> 'instructions') > 0
    and private.is_weekly_plan_macros(value -> 'macros')
    and jsonb_typeof(value -> 'cookingTimeMinutes') = 'number'
    and (value ->> 'cookingTimeMinutes')::numeric >= 0
    and jsonb_typeof(value -> 'prepTimeMinutes') = 'number'
    and (value ->> 'prepTimeMinutes')::numeric >= 0
    and (
      not value ? 'portions'
      or value -> 'portions' = 'null'::jsonb
      or (
        jsonb_typeof(value -> 'portions') = 'number'
        and (value ->> 'portions')::numeric > 0
      )
    )
    and (
      not value ? 'checkedIngredients'
      or private.is_weekly_plan_string_array(value -> 'checkedIngredients')
    );
$$;

create or replace function private.is_weekly_plan_document(value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  day_value jsonb;
  meal_type text;
begin
  if jsonb_typeof(value) <> 'object'
    or jsonb_typeof(value -> 'weeklySummary') <> 'string'
    or value ->> 'weeklySummary' = ''
    or jsonb_typeof(value -> 'days') <> 'array'
    or jsonb_array_length(value -> 'days') <> 7
  then
    return false;
  end if;

  if (
    select count(distinct day ->> 'day')
    from jsonb_array_elements(value -> 'days') as day
  ) <> 7 then
    return false;
  end if;

  for day_value in select * from jsonb_array_elements(value -> 'days')
  loop
    if jsonb_typeof(day_value) <> 'object'
      or jsonb_typeof(day_value -> 'day') <> 'string'
      or day_value ->> 'day' = ''
      or not private.is_weekly_plan_macros(day_value -> 'dailySummary')
    then
      return false;
    end if;

    foreach meal_type in array array['breakfast', 'lunch', 'dinner', 'snack']
    loop
      if not private.is_weekly_plan_meal(day_value -> meal_type) then
        return false;
      end if;
    end loop;
  end loop;

  return true;
end;
$$;

create table public.weekly_plans (
  plan_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  document jsonb not null,
  schema_version smallint not null default 1,
  revision bigint not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deactivated_at timestamptz,
  predecessor_plan_id uuid,
  generation_id uuid,
  next_generation_id uuid,
  next_generation_locked_at timestamptz,
  constraint weekly_plans_valid_document
    check (schema_version = 1 and private.is_weekly_plan_document(document)),
  constraint weekly_plans_revision_nonnegative check (revision >= 0),
  constraint weekly_plans_lifecycle check (
    (is_active and deactivated_at is null)
    or (not is_active and deactivated_at is not null)
  ),
  constraint weekly_plans_timestamp_order check (
    updated_at >= created_at
    and (deactivated_at is null or deactivated_at >= created_at)
  ),
  constraint weekly_plans_predecessor_not_self check (
    predecessor_plan_id is null or predecessor_plan_id <> plan_id
  ),
  constraint weekly_plans_next_generation_lock check (
    (next_generation_id is null) = (next_generation_locked_at is null)
  ),
  constraint weekly_plans_plan_owner_unique unique (plan_id, user_id),
  constraint weekly_plans_predecessor_owner foreign key (predecessor_plan_id, user_id)
    references public.weekly_plans (plan_id, user_id)
);

create unique index weekly_plans_one_active_per_user
  on public.weekly_plans (user_id)
  where is_active;

create index weekly_plans_user_history
  on public.weekly_plans (user_id, created_at desc);

create or replace function private.enforce_weekly_plan_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.plan_id <> old.plan_id
    or new.user_id <> old.user_id
    or new.schema_version <> old.schema_version
    or new.created_at <> old.created_at
  then
    raise exception 'Weekly Plan identity metadata is immutable';
  end if;

  if new.revision < old.revision then
    raise exception 'Weekly Plan revision cannot decrease';
  end if;

  if new.updated_at < old.updated_at then
    raise exception 'Weekly Plan updated timestamp cannot decrease';
  end if;

  if new.document is distinct from old.document then
    if new.revision <> old.revision + 1 then
      raise exception 'Weekly Plan document changes require exactly one revision increment';
    end if;
    if new.updated_at <= old.updated_at then
      raise exception 'Weekly Plan document changes require a newer updated timestamp';
    end if;
  elsif new.revision <> old.revision then
    raise exception 'Weekly Plan revision cannot change without a document mutation';
  end if;

  return new;
end;
$$;

create trigger weekly_plans_enforce_update
before update on public.weekly_plans
for each row execute function private.enforce_weekly_plan_update();

alter table public.weekly_plans enable row level security;

create policy "Users can read own Weekly Plans"
  on public.weekly_plans
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.weekly_plans from public, anon, authenticated;
grant select on table public.weekly_plans to authenticated;
grant select, insert, update, delete on table public.weekly_plans to service_role;

grant usage on schema private to service_role;
revoke all on function private.is_weekly_plan_macros(jsonb)
  from public, anon, authenticated;
revoke all on function private.is_weekly_plan_string_array(jsonb)
  from public, anon, authenticated;
revoke all on function private.is_weekly_plan_meal(jsonb)
  from public, anon, authenticated;
revoke all on function private.is_weekly_plan_document(jsonb)
  from public, anon, authenticated;
revoke all on function private.enforce_weekly_plan_update()
  from public, anon, authenticated;
grant execute on function private.is_weekly_plan_macros(jsonb) to service_role;
grant execute on function private.is_weekly_plan_string_array(jsonb) to service_role;
grant execute on function private.is_weekly_plan_meal(jsonb) to service_role;
grant execute on function private.is_weekly_plan_document(jsonb) to service_role;
grant execute on function private.enforce_weekly_plan_update() to service_role;
