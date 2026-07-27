// @vitest-environment node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { weeklyPlanFixture } from "../../test/weeklyPlanFixture";

const migrations = [
  "./0001_user_data.sql",
  "./20260722193317_create_ai_usage_records.sql",
  "./20260727120000_create_weekly_plans.sql",
  "./20260727130000_create_initial_generation_commands.sql",
  "./20260727140000_create_ingredient_progress_commands.sql",
  "./20260727150000_create_meal_reroll_commands.sql",
  "./20260727160000_create_next_weekly_plan_commands.sql",
  "./20260727170000_create_start_over_commands.sql",
].map((path) => fileURLToPath(new URL(path, import.meta.url)));

const userId = "00000000-0000-4000-8000-000000000001";
const activePlanId = "20000000-0000-4000-8000-000000000001";
const predecessorPlanId = "20000000-0000-4000-8000-000000000002";
const commandId = "10000000-0000-4000-8000-000000000001";

describe("Start Over database command", () => {
  let database: PGlite;

  const startOver = async (
    displayedPlanId = activePlanId,
    id = commandId,
    displayedRevision = 0,
  ) => {
    await database.exec(`
      set role authenticated;
      set "request.jwt.claim.sub" = '${userId}';
    `);
    try {
      const result = await database.query<{ outcome: Record<string, unknown> }>(`
        select public.start_over_weekly_plan(
          '${displayedPlanId}', ${displayedRevision}, '${id}'
        ) as outcome
      `);
      return result.rows[0].outcome;
    } finally {
      await database.exec('reset role; reset "request.jwt.claim.sub";');
    }
  };

  beforeEach(async () => {
    database = new PGlite();
    await database.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users (id uuid primary key);
      insert into auth.users (id) values ('${userId}');
      create function auth.uid() returns uuid
      language sql stable
      as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
    `);
    for (const migration of migrations) {
      await database.exec(await readFile(migration, "utf8"));
    }
    const document = JSON.stringify(weeklyPlanFixture).replaceAll("'", "''");
    await database.exec(`
      set role service_role;
      insert into public.weekly_plans (
        plan_id, user_id, document, revision, is_active, created_at, updated_at,
        deactivated_at
      ) values (
        '${predecessorPlanId}', '${userId}', '${document}'::jsonb, 0,
        false, now() - interval '2 days', now() - interval '1 day',
        now() - interval '1 day'
      ), (
        '${activePlanId}', '${userId}', '${document}'::jsonb, 4,
        true, now(), now(), null
      );
      reset role;
    `);
    await database.exec(`
      insert into public.user_data (user_id, profile, meal_plan, milestones)
      values (
        '${userId}',
        '{"dietType":"Mediterranean"}',
        '{"legacy":"preserved"}',
        '[{"id":"milestone-1"}]'
      );
      set role service_role;
      insert into public.ai_usage_records (
        call_id, user_id, action, attempt, provider, model, outcome
      ) values (
        '30000000-0000-4000-8000-000000000001',
        '${userId}', 'plan', 1, 'test-provider', 'test-model', 'success'
      );
      reset role;
    `);
  });

  afterEach(async () => {
    await database.close();
  });

  it("accepts a newer revision of the displayed active plan and rejects an inactive predecessor", async () => {
    await expect(startOver()).resolves.toMatchObject({
      commandId,
      status: "succeeded",
      result: null,
      error: null,
    });

    const otherCommandId = "10000000-0000-4000-8000-000000000002";
    await database.exec(`
      update public.weekly_plans
      set is_active = true, deactivated_at = null
      where plan_id = '${activePlanId}'
    `);
    await expect(startOver(
      predecessorPlanId,
      otherCommandId,
    )).resolves.toMatchObject({
      status: "failed",
      error: { code: "stale_plan", retryable: true },
    });
  });

  it("rejects Start Over while Next Weekly Plan generation or a Meal Reroll is pending", async () => {
    await database.exec(`
      insert into public.weekly_plan_commands (
        command_id, user_id, operation, input_fingerprint, status
      ) values (
        '10000000-0000-4000-8000-000000000010',
        '${userId}', 'generate_next', '${"a".repeat(64)}', 'in_progress'
      );
      update public.weekly_plans
      set next_generation_id = '10000000-0000-4000-8000-000000000010',
          next_generation_locked_at = now()
      where plan_id = '${activePlanId}';
    `);
    await expect(startOver()).resolves.toMatchObject({
      status: "failed",
      error: { code: "plan_generation_locked", retryable: true },
    });

    await database.exec(`
      update public.weekly_plans
      set next_generation_id = null, next_generation_locked_at = null
      where plan_id = '${activePlanId}';
      update public.weekly_plan_commands
      set status = 'failed', error_code = 'cancelled',
          error_message = 'Cancelled for test.', error_retryable = true,
          completed_at = now()
      where command_id = '10000000-0000-4000-8000-000000000010';
      insert into public.weekly_plan_commands (
        command_id, user_id, operation, input_fingerprint, status
      ) values (
        '10000000-0000-4000-8000-000000000011',
        '${userId}', 'reroll_meal', '${"b".repeat(64)}', 'in_progress'
      );
      insert into public.weekly_plan_meal_reroll_reservations (
        command_id, user_id, plan_id, displayed_plan_id,
        displayed_revision, day, meal_type
      ) values (
        '10000000-0000-4000-8000-000000000011',
        '${userId}', '${activePlanId}', '${activePlanId}',
        4, 'Monday', 'breakfast'
      );
    `);
    await expect(startOver(
      activePlanId,
      "10000000-0000-4000-8000-000000000012",
      4,
    )).resolves.toMatchObject({
      status: "failed",
      error: { code: "meal_reroll_pending", retryable: true },
    });

    const plan = await database.query<{ is_active: boolean }>(`
      select is_active from public.weekly_plans where plan_id = '${activePlanId}'
    `);
    expect(plan.rows[0].is_active).toBe(true);
  });

  it("atomically records and replays success while preserving all unrelated user data", async () => {
    const first = await startOver(activePlanId, commandId, 4);
    expect(first).toMatchObject({
      commandId,
      status: "succeeded",
      result: null,
      error: null,
    });

    const stateAfterFirst = await database.query<{
      is_active: boolean;
      deactivated_at: string;
      command_count: number;
      profile: unknown;
      milestones: unknown;
      legacy_meal_plan: unknown;
      usage_count: number;
      inactive_plan_count: number;
    }>(`
      select plan.is_active, plan.deactivated_at,
        (select count(*)::integer from public.weekly_plan_commands
          where command_id = '${commandId}' and status = 'succeeded')
          as command_count,
        data.profile,
        data.milestones,
        data.meal_plan as legacy_meal_plan,
        (select count(*)::integer from public.ai_usage_records
          where user_id = '${userId}') as usage_count,
        (select count(*)::integer from public.weekly_plans
          where user_id = '${userId}' and not is_active) as inactive_plan_count
      from public.weekly_plans plan
      join public.user_data data on data.user_id = plan.user_id
      where plan.plan_id = '${activePlanId}'
    `);
    expect(stateAfterFirst.rows[0]).toMatchObject({
      is_active: false,
      command_count: 1,
      profile: { dietType: "Mediterranean" },
      milestones: [{ id: "milestone-1" }],
      legacy_meal_plan: { legacy: "preserved" },
      usage_count: 1,
      inactive_plan_count: 2,
    });

    await expect(startOver(activePlanId, commandId, 4)).resolves.toEqual(first);
    const replayed = await database.query<{
      deactivated_at: string;
      command_count: number;
    }>(`
      select deactivated_at,
        (select count(*)::integer from public.weekly_plan_commands
          where command_id = '${commandId}') as command_count
      from public.weekly_plans where plan_id = '${activePlanId}'
    `);
    expect(replayed.rows[0]).toEqual({
      deactivated_at: stateAfterFirst.rows[0].deactivated_at,
      command_count: 1,
    });
  });
});
