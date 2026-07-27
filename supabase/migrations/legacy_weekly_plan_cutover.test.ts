// @vitest-environment node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { weeklyPlanFixture } from "../../test/weeklyPlanFixture";

const migrationPaths = [
  "./20260722091747_user_data.sql",
  "./20260722193317_create_ai_usage_records.sql",
  "./20260727120000_create_weekly_plans.sql",
  "./20260727130000_create_initial_generation_commands.sql",
  "./20260727140000_create_ingredient_progress_commands.sql",
  "./20260727150000_create_meal_reroll_commands.sql",
  "./20260727160000_create_next_weekly_plan_commands.sql",
  "./20260727170000_create_start_over_commands.sql",
  "./20260727175000_create_weekly_plan_rollout.sql",
  "./20260727177500_enter_weekly_plan_maintenance.sql",
  "./20260727180000_cut_over_legacy_weekly_plans.sql",
  "./20260727180100_finalize_legacy_weekly_plan_cutover.sql",
].map((path) => fileURLToPath(new URL(path, import.meta.url)));

const userId = "00000000-0000-4000-8000-000000000001";
const secondUserId = "00000000-0000-4000-8000-000000000002";

describe("legacy Weekly Plan cutover", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users (id uuid primary key);
      insert into auth.users (id) values ('${userId}'), ('${secondUserId}');
      create function auth.uid() returns uuid
      language sql stable
      as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
    `);
  });

  afterEach(async () => {
    await database.close();
  });

  const applyThrough = async (lastIndex: number) => {
    for (const path of migrationPaths.slice(0, lastIndex + 1)) {
      await database.exec(await readFile(path, "utf8"));
    }
  };

  const runCutover = async () => {
    await database.exec(await readFile(migrationPaths.at(-2)!, "utf8"));
    return database.exec(await readFile(migrationPaths.at(-1)!, "utf8"));
  };

  const seedLegacyPlan = async (
    id: string,
    document: unknown = weeklyPlanFixture,
  ) => {
    const serialized = JSON.stringify(document).replaceAll("'", "''");
    await database.exec(`
      select set_config('app.weekly_plan_cutover', 'on', false);
      insert into public.user_data (user_id, profile, meal_plan, milestones)
      values (
        '${id}', '{"dietType":"Mediterranean"}', '${serialized}'::jsonb,
        '[{"id":"milestone-1"}]'::jsonb
      );
      reset "app.weekly_plan_cutover";
    `);
  };

  it("migrates every legacy plan once with stable identities and a linked operation", async () => {
    await applyThrough(migrationPaths.length - 3);
    await seedLegacyPlan(userId);
    await seedLegacyPlan(secondUserId);

    await runCutover();

    const plans = await database.query<{
      user_id: string;
      schema_version: number;
      revision: number;
      is_active: boolean;
      stable: boolean;
      canonical_match: boolean;
    }>(`
      select
        plan.user_id,
        plan.schema_version,
        plan.revision,
        plan.is_active,
        private.has_stable_ingredient_identities(plan.document) as stable,
        private.strip_ingredient_identities(plan.document) =
          private.strip_ingredient_identities(
            '${JSON.stringify(weeklyPlanFixture).replaceAll("'", "''")}'::jsonb
          )
          as canonical_match
      from public.weekly_plans as plan
      order by plan.user_id
    `);
    expect(plans.rows).toHaveLength(2);
    expect(plans.rows).toEqual([
      expect.objectContaining({
        user_id: userId,
        schema_version: 1,
        revision: 0,
        is_active: true,
        stable: true,
        canonical_match: true,
      }),
      expect.objectContaining({
        user_id: secondUserId,
        schema_version: 1,
        revision: 0,
        is_active: true,
        stable: true,
        canonical_match: true,
      }),
    ]);

    const operations = await database.query<{ count: number }>(`
      select count(*)::int as count
      from public.weekly_plan_commands
      where operation = 'legacy_migration'
        and status = 'succeeded'
        and result_plan_id is not null
    `);
    expect(operations.rows[0].count).toBe(2);

    const retained = await database.query<{
      profile: unknown;
      milestones: unknown;
    }>(`
      select profile, milestones
      from public.user_data
      where user_id = '${userId}'
    `);
    expect(retained.rows[0]).toEqual({
      profile: { dietType: "Mediterranean" },
      milestones: [{ id: "milestone-1" }],
    });

    const legacyColumn = await database.query<{ count: number }>(`
      select count(*)::int as count
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'user_data'
        and column_name = 'meal_plan'
    `);
    expect(legacyColumn.rows[0].count).toBe(0);
    await expect(database.query(`select public.get_weekly_plan_rollout_state()`))
      .resolves.toMatchObject({ rows: [{ get_weekly_plan_rollout_state: "authoritative" }] });
  });

  it.each([
    ["invalid source", { weeklySummary: "Incomplete", days: [] }],
    ["existing destination", weeklyPlanFixture],
  ])("aborts the whole migration for %s", async (caseName, document) => {
    await applyThrough(migrationPaths.length - 3);
    await seedLegacyPlan(userId, document);
    if (caseName === "existing destination") {
      await database.exec(`
        select set_config('app.weekly_plan_cutover', 'on', false);
        set role service_role;
        insert into public.weekly_plans (user_id, document)
        values ('${userId}', '${JSON.stringify(weeklyPlanFixture).replaceAll("'", "''")}'::jsonb);
        reset role;
        reset "app.weekly_plan_cutover";
      `);
    }

    await expect(runCutover()).rejects.toThrow("cutover aborted");

    const column = await database.query<{ count: number }>(`
      select count(*)::int as count
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'user_data'
        and column_name = 'meal_plan'
    `);
    expect(column.rows[0].count).toBe(1);
    const source = await database.query<{ meal_plan: unknown }>(
      `select meal_plan from public.user_data where user_id = '${userId}'`,
    );
    expect(source.rows[0].meal_plan).toEqual(document);
    await expect(database.query(`select public.get_weekly_plan_rollout_state()`))
      .resolves.toMatchObject({
        rows: [{ get_weekly_plan_rollout_state: "legacy" }],
      });
    await expect(database.exec(`
      update public.user_data
      set meal_plan = jsonb_set(meal_plan, '{weeklySummary}', '"Usable after rollback"')
      where user_id = '${userId}'
    `)).resolves.toBeDefined();
    const destinations = await database.query<{ count: number }>(`
      select count(*)::int as count
      from public.weekly_plans
      where user_id = '${userId}'
    `);
    expect(destinations.rows[0].count).toBe(
      caseName === "existing destination" ? 1 : 0,
    );
  });

  it("aborts when transformation cannot produce a valid destination", async () => {
    await applyThrough(migrationPaths.length - 3);
    const unidentified = structuredClone(weeklyPlanFixture);
    for (const day of unidentified.days) {
      for (const mealType of ["breakfast", "lunch", "dinner", "snack"] as const) {
        delete (day[mealType] as Partial<typeof day[typeof mealType]>).ingredientIds;
        delete (day[mealType] as Partial<typeof day[typeof mealType]>).checkedIngredientIds;
      }
    }
    await seedLegacyPlan(userId, unidentified);
    await database.exec(`
      create or replace function private.ensure_ingredient_identities(value jsonb)
      returns jsonb language sql volatile set search_path = ''
      as $$ select value $$;
    `);

    await expect(runCutover()).rejects.toThrow("cutover aborted");

    const source = await database.query<{ meal_plan: unknown }>(
      `select meal_plan from public.user_data where user_id = '${userId}'`,
    );
    expect(source.rows[0].meal_plan).toEqual(unidentified);
  });

  it("aborts when transformed content differs canonically", async () => {
    await applyThrough(migrationPaths.length - 3);
    await seedLegacyPlan(userId);
    await database.exec(`
      create or replace function private.normalize_weekly_plan_ingredient_identities()
      returns trigger language plpgsql set search_path = ''
      as $$
      begin
        new.document = jsonb_set(
          private.ensure_ingredient_identities(new.document),
          '{weeklySummary}',
          '"Changed by faulty transform"'
        );
        return new;
      end
      $$;
    `);

    await expect(runCutover()).rejects.toThrow("cutover aborted");

    const source = await database.query<{ meal_plan: unknown }>(
      `select meal_plan from public.user_data where user_id = '${userId}'`,
    );
    expect(source.rows[0].meal_plan).toEqual(weeklyPlanFixture);
  });

  it("retries the finalizer after legacy recovery", async () => {
    await applyThrough(migrationPaths.length - 3);
    await seedLegacyPlan(userId, { weeklySummary: "Incomplete", days: [] });
    await expect(runCutover()).rejects.toThrow("cutover aborted");

    const serialized = JSON.stringify(weeklyPlanFixture).replaceAll("'", "''");
    await database.exec(`
      update public.user_data
      set meal_plan = '${serialized}'::jsonb
      where user_id = '${userId}'
    `);
    await database.exec(await readFile(migrationPaths.at(-1)!, "utf8"));

    await expect(database.query(`select public.get_weekly_plan_rollout_state()`))
      .resolves.toMatchObject({
        rows: [{ get_weekly_plan_rollout_state: "authoritative" }],
      });
  });

  it("preserves legacy checked progress while assigning stable identities", async () => {
    await applyThrough(migrationPaths.length - 3);
    const checkedLegacy = structuredClone(weeklyPlanFixture);
    const breakfast = checkedLegacy.days[0].breakfast;
    breakfast.ingredients = ["salt", "pepper"];
    breakfast.checkedIngredients = ["pepper"];
    delete (breakfast as Partial<typeof breakfast>).ingredientIds;
    delete (breakfast as Partial<typeof breakfast>).checkedIngredientIds;
    await seedLegacyPlan(userId, checkedLegacy);

    await runCutover();

    const result = await database.query<{
      ingredients: string[];
      ingredient_ids: string[];
      checked_ids: string[];
    }>(`
      select
        array(select jsonb_array_elements_text(document #> '{days,0,breakfast,ingredients}'))
          as ingredients,
        array(select jsonb_array_elements_text(document #> '{days,0,breakfast,ingredientIds}'))
          as ingredient_ids,
        array(select jsonb_array_elements_text(document #> '{days,0,breakfast,checkedIngredientIds}'))
          as checked_ids
      from public.weekly_plans
      where user_id = '${userId}' and is_active
    `);
    const migrated = result.rows[0];
    expect(migrated.checked_ids).toEqual([migrated.ingredient_ids[1]]);
  });

  it.each(["destination count", "operation ownership"] as const)(
    "rolls back when the %s assertion fails",
    async (assertion) => {
      await applyThrough(migrationPaths.length - 3);
      await seedLegacyPlan(userId);
      if (assertion === "destination count") {
        await database.exec(`
          create function private.skip_cutover_plan()
          returns trigger language plpgsql set search_path = ''
          as $$
          begin
            if current_setting('app.weekly_plan_cutover', true) = 'on' then
              return null;
            end if;
            return new;
          end
          $$;
          create trigger aaa_skip_cutover_plan
          before insert on public.weekly_plans
          for each row execute function private.skip_cutover_plan();
        `);
      } else {
        await database.exec(`
          create function private.skip_cutover_operation()
          returns trigger language plpgsql set search_path = ''
          as $$
          begin
            if new.operation = 'legacy_migration' then
              return null;
            end if;
            return new;
          end
          $$;
          create trigger aaa_skip_cutover_operation
          before insert on public.weekly_plan_commands
          for each row execute function private.skip_cutover_operation();
        `);
      }

      await expect(runCutover()).rejects.toThrow("cutover aborted");

      const column = await database.query<{ count: number }>(`
        select count(*)::int as count
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'user_data'
          and column_name = 'meal_plan'
      `);
      expect(column.rows[0].count).toBe(1);
    },
  );

  it("denies authenticated direct mutation after cutover", async () => {
    await applyThrough(migrationPaths.length - 3);
    await seedLegacyPlan(userId);
    await runCutover();
    await database.exec(`
      set role authenticated;
      set "request.jwt.claim.sub" = '${userId}';
    `);
    await expect(database.exec(`
      update public.weekly_plans set revision = revision + 1
      where user_id = '${userId}'
    `)).rejects.toThrow();
  });

  it("gates legacy and authoritative mutations during rollout", async () => {
    await applyThrough(migrationPaths.length - 4);
    const serialized = JSON.stringify(weeklyPlanFixture).replaceAll("'", "''");

    await seedLegacyPlan(userId);
    await database.exec("set role service_role");
    await expect(database.exec(`
      insert into public.weekly_plans (user_id, document)
      values ('${secondUserId}', '${serialized}'::jsonb)
    `)).rejects.toThrow("disabled in legacy");
    await database.exec("reset role");

    await database.exec(await readFile(migrationPaths.at(-3)!, "utf8"));
    await expect(database.query(`select public.get_weekly_plan_rollout_state()`))
      .resolves.toMatchObject({
        rows: [{ get_weekly_plan_rollout_state: "maintenance" }],
      });
    await expect(database.exec(`
      update public.user_data
      set meal_plan = jsonb_set(meal_plan, '{weeklySummary}', '"Changed"')
      where user_id = '${userId}'
    `)).rejects.toThrow("disabled in maintenance");
    await database.exec("set role service_role");
    await expect(database.exec(`
      insert into public.weekly_plans (user_id, document)
      values ('${secondUserId}', '${serialized}'::jsonb)
    `)).rejects.toThrow("disabled in maintenance");
    await database.exec("reset role");
  });

  it("drains pre-maintenance writers before taking the migration snapshot", async () => {
    await applyThrough(migrationPaths.length - 3);
    await seedLegacyPlan(userId);
    await runCutover();

    const definition = await database.query<{ definition: string }>(`
      select pg_get_functiondef(
        'public.migrate_legacy_weekly_plans()'::regprocedure
      ) as definition
    `);
    expect(definition.rows[0].definition)
      .toContain("lock table public.user_data in share row exclusive mode");
  });
});
