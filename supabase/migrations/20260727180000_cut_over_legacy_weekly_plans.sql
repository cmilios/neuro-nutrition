create or replace function public.migrate_legacy_weekly_plans()
returns boolean
language plpgsql
security definer
set search_path = ''
as $migration$
declare
  source_count integer;
  destination_count integer;
  ownership_count integer;
  canonical_count integer;
begin
  if public.get_weekly_plan_rollout_state() <> 'maintenance' then
    raise exception 'Weekly Plan cutover must begin in maintenance state';
  end if;

  perform set_config('app.weekly_plan_cutover', 'on', true);

  -- Drain writes that began before maintenance committed and prevent another
  -- legacy writer from changing the snapshot during cutover.
  lock table public.user_data in share row exclusive mode;

  begin
    if exists (
      select 1
      from public.user_data
      where meal_plan is not null
        and private.is_weekly_plan_document(meal_plan) is distinct from true
    ) then
      raise exception 'Invalid legacy Weekly Plan source';
    end if;

    if exists (
      select 1
      from public.user_data as source
      join public.weekly_plans as plan
        on plan.user_id = source.user_id and plan.is_active
      where source.meal_plan is not null
    ) then
      raise exception 'Legacy Weekly Plan already has an active destination';
    end if;

    create temporary table legacy_weekly_plan_migration_source
    on commit drop
    as
    select
      source.user_id,
      source.meal_plan as canonical_document,
      gen_random_uuid() as plan_id,
      gen_random_uuid() as command_id
    from public.user_data as source
    where source.meal_plan is not null;

    select count(*) into source_count
    from legacy_weekly_plan_migration_source;

    insert into public.weekly_plans (
      plan_id, user_id, document, schema_version, revision, is_active
    )
    select plan_id, user_id, canonical_document, 1, 0, true
    from legacy_weekly_plan_migration_source;

    alter table public.weekly_plan_commands
      drop constraint weekly_plan_commands_operation;
    alter table public.weekly_plan_commands
      add constraint weekly_plan_commands_operation
      check (operation in (
        'generate_initial',
        'set_ingredient_checked',
        'reroll_meal',
        'generate_next',
        'start_over',
        'legacy_migration'
      ));

    insert into public.weekly_plan_commands (
      command_id,
      user_id,
      operation,
      input_fingerprint,
      status,
      result_plan_id,
      result_snapshot,
      created_at,
      updated_at,
      completed_at
    )
    select
      source.command_id,
      source.user_id,
      'legacy_migration',
      repeat('0', 64),
      'succeeded',
      plan.plan_id,
      private.authoritative_weekly_plan_row(plan),
      plan.created_at,
      plan.updated_at,
      plan.updated_at
    from legacy_weekly_plan_migration_source as source
    join public.weekly_plans as plan
      on plan.plan_id = source.plan_id
      and plan.user_id = source.user_id;

    select count(*) into destination_count
    from legacy_weekly_plan_migration_source as source
    join public.weekly_plans as plan
      on plan.plan_id = source.plan_id
      and plan.user_id = source.user_id
      and plan.is_active
      and plan.schema_version = 1
      and plan.revision = 0;

    select count(*) into ownership_count
    from legacy_weekly_plan_migration_source as source
    join public.weekly_plan_commands as command
      on command.command_id = source.command_id
      and command.user_id = source.user_id
      and command.result_plan_id = source.plan_id
      and command.operation = 'legacy_migration'
      and command.status = 'succeeded';

    select count(*) into canonical_count
    from legacy_weekly_plan_migration_source as source
    join public.weekly_plans as plan on plan.plan_id = source.plan_id
    where private.strip_ingredient_identities(plan.document)
      = private.strip_ingredient_identities(
          private.ensure_ingredient_identities(source.canonical_document)
        )
      and private.has_stable_ingredient_identities(plan.document);

    if source_count <> destination_count
      or source_count <> ownership_count
      or source_count <> canonical_count
    then
      raise exception
        'Weekly Plan cutover assertion failed: source %, destination %, ownership %, canonical %',
        source_count, destination_count, ownership_count, canonical_count;
    end if;

    drop trigger user_data_enforce_weekly_plan_rollout on public.user_data;
    drop function private.enforce_legacy_weekly_plan_rollout();
    alter table public.user_data drop column meal_plan;

    update public.weekly_plan_rollout
    set state = 'authoritative', updated_at = clock_timestamp()
    where singleton and state = 'maintenance';
  exception
    when others then
      -- This block is a subtransaction: all cutover changes above have rolled
      -- back before normal legacy service is restored.
      update public.weekly_plan_rollout
      set state = 'legacy', updated_at = clock_timestamp()
      where singleton and state = 'maintenance';
      return false;
  end;

  return true;
end
$migration$;

revoke all on function public.migrate_legacy_weekly_plans()
  from public, anon, authenticated;
grant execute on function public.migrate_legacy_weekly_plans()
  to service_role;

select public.migrate_legacy_weekly_plans();
