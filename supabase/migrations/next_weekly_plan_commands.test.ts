// @vitest-environment node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { weeklyPlanFixture } from "../../test/weeklyPlanFixture";

const migrations = [
  "./20260727120000_create_weekly_plans.sql",
  "./20260727130000_create_initial_generation_commands.sql",
  "./20260727140000_create_ingredient_progress_commands.sql",
  "./20260727150000_create_meal_reroll_commands.sql",
  "./20260727160000_create_next_weekly_plan_commands.sql",
  "./20260809084346_reconcile_unknown_weekly_plan_commands.sql",
].map((path) => fileURLToPath(new URL(path, import.meta.url)));

const userId = "00000000-0000-4000-8000-000000000001";
const sourcePlanId = "20000000-0000-4000-8000-000000000001";
const commandId = "10000000-0000-4000-8000-000000000001";
const otherCommandId = "10000000-0000-4000-8000-000000000002";
const fingerprint = "a".repeat(64);

describe("Next Weekly Plan database command", () => {
  let database: PGlite;

  const rpc = async (name: string, args: string) => {
    await database.exec("set role service_role;");
    try {
      const result = await database.query<{ outcome: Record<string, unknown> }>(
        `select public.${name}(${args}) as outcome`,
      );
      return result.rows[0].outcome;
    } finally {
      await database.exec("reset role;");
    }
  };

  const begin = (id = commandId, inputFingerprint = fingerprint) =>
    rpc("begin_next_weekly_plan_generation", [
      `'${userId}'`,
      `'${id}'`,
      `'${inputFingerprint}'`,
      `'${sourcePlanId}'`,
      "0",
    ].join(", "));

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
    for (const migration of migrations.slice(0, -1)) {
      await database.exec(await readFile(migration, "utf8"));
    }
    const document = JSON.stringify(weeklyPlanFixture).replaceAll("'", "''");
    await database.exec(`
      set role service_role;
      insert into public.weekly_plans (plan_id, user_id, document)
      values ('${sourcePlanId}', '${userId}', '${document}'::jsonb);
      reset role;
    `);
    await database.exec(await readFile(migrations.at(-1)!, "utf8"));
  });

  afterEach(async () => {
    await database.close();
  });

  it("atomically records the operation and exposes the matching lock", async () => {
    await expect(begin()).resolves.toMatchObject({
      commandId,
      status: "in_progress",
      shouldGenerate: true,
      source: {
        planId: sourcePlanId,
        revision: 0,
        document: {
          weeklySummary: weeklyPlanFixture.weeklySummary,
        },
      },
    });

    const plan = await database.query<{
      next_generation_id: string | null;
      next_generation_locked_at: string | null;
    }>(`
      select next_generation_id, next_generation_locked_at
      from public.weekly_plans where plan_id = '${sourcePlanId}'
    `);
    expect(plan.rows[0].next_generation_id).toBe(commandId);
    expect(plan.rows[0].next_generation_locked_at).not.toBeNull();

    await expect(begin()).resolves.toMatchObject({
      status: "in_progress",
      shouldGenerate: false,
    });
    await expect(begin(otherCommandId, "b".repeat(64))).resolves.toMatchObject({
      status: "failed",
      error: { code: "plan_generation_locked" },
      shouldGenerate: false,
    });
  });

  it("rejects other mutations while preserving reads", async () => {
    await begin();

    await database.exec(`
      set role authenticated;
      set "request.jwt.claim.sub" = '${userId}';
    `);
    try {
      const visible = await database.query<{
        plan_id: string;
        next_generation_id: string;
      }>(`
        select plan_id, next_generation_id
        from public.weekly_plans where is_active
      `);
      expect(visible.rows).toEqual([{
        plan_id: sourcePlanId,
        next_generation_id: commandId,
      }]);

      const ingredientId = weeklyPlanFixture.days[0].breakfast.ingredientIds[0];
      const ingredient = await database.query<{ outcome: Record<string, unknown> }>(`
        select public.set_ingredient_checked(
          '${sourcePlanId}', 0, 'Monday', 'breakfast', '${ingredientId}',
          true, '10000000-0000-4000-8000-000000000010'
        ) as outcome
      `);
      expect(ingredient.rows[0].outcome).toMatchObject({
        status: "failed",
        error: { code: "plan_generation_locked" },
      });

      const startOver = await database.query<{ outcome: Record<string, unknown> }>(`
        select public.start_over_weekly_plan(
          '10000000-0000-4000-8000-000000000011'
        ) as outcome
      `);
      expect(startOver.rows[0].outcome).toMatchObject({
        status: "failed",
        error: { code: "plan_generation_locked" },
      });
    } finally {
      await database.exec('reset role; reset "request.jwt.claim.sub";');
    }
  });

  it("atomically replaces the source with exactly one revision-0 successor", async () => {
    await begin();
    const successor = structuredClone(weeklyPlanFixture);
    successor.weeklySummary = "Successor";
    const document = JSON.stringify(successor).replaceAll("'", "''");
    const completed = await rpc("complete_next_weekly_plan_generation", [
      `'${userId}'`,
      `'${commandId}'`,
      `'${fingerprint}'`,
      `'${document}'::jsonb`,
    ].join(", "));

    expect(completed).toMatchObject({
      status: "succeeded",
      result: {
        revision: 0,
        isActive: true,
        predecessorPlanId: sourcePlanId,
        generationId: commandId,
        document: {
          weeklySummary: "Successor",
        },
      },
    });
    expect(await begin()).toEqual(completed);

    const plans = await database.query<{
      plan_id: string;
      is_active: boolean;
      predecessor_plan_id: string | null;
      generation_id: string | null;
      next_generation_id: string | null;
    }>(`
      select plan_id, is_active, predecessor_plan_id, generation_id,
        next_generation_id
      from public.weekly_plans where user_id = '${userId}'
      order by created_at, plan_id
    `);
    expect(plans.rows).toHaveLength(2);
    expect(plans.rows.find((row) => row.plan_id === sourcePlanId)).toMatchObject({
      is_active: false,
      next_generation_id: null,
    });
    expect(plans.rows.filter((row) => row.predecessor_plan_id === sourcePlanId))
      .toHaveLength(1);
  });

  it("terminal failure preserves the source, clears the lock, and requires a new command ID", async () => {
    await begin();
    const failed = await rpc("fail_next_weekly_plan_generation", [
      `'${userId}'`,
      `'${commandId}'`,
      `'${fingerprint}'`,
      "'generation_failed'",
      "'No usable result was produced.'",
      "true",
      `'{"stage":"provider","providerRequestId":"req_safe"}'::jsonb`,
    ].join(", "));
    expect(failed).toMatchObject({
      status: "failed",
      error: { code: "generation_failed", retryable: true },
    });
    await expect(begin()).resolves.toMatchObject({
      status: "failed",
      shouldGenerate: false,
    });
    await expect(begin(otherCommandId, "b".repeat(64))).resolves.toMatchObject({
      status: "in_progress",
      shouldGenerate: true,
    });

    const source = await database.query<{
      is_active: boolean;
      next_generation_id: string | null;
    }>(`select is_active, next_generation_id from public.weekly_plans where plan_id = '${sourcePlanId}'`);
    expect(source.rows[0]).toEqual({
      is_active: true,
      next_generation_id: otherCommandId,
    });
  });

  it("service-only stale recovery repairs a committed result without creating another successor", async () => {
    await begin();
    const successor = JSON.stringify({
      ...weeklyPlanFixture,
      weeklySummary: "Committed result",
    }).replaceAll("'", "''");
    await database.exec(`
      update public.weekly_plans
      set is_active = false, deactivated_at = now(),
          next_generation_id = null, next_generation_locked_at = null
      where plan_id = '${sourcePlanId}';
      insert into public.weekly_plans (
        user_id, document, predecessor_plan_id, generation_id
      ) values (
        '${userId}', '${successor}'::jsonb, '${sourcePlanId}', '${commandId}'
      );
      update public.weekly_plan_commands
      set updated_at = now() - interval '11 minutes'
      where command_id = '${commandId}';
    `);

    const recovered = await rpc(
      "recover_stale_next_weekly_plan_generation",
      `'${userId}', '${commandId}'`,
    );
    expect(recovered).toMatchObject({
      status: "succeeded",
      result: {
        predecessorPlanId: sourcePlanId,
        generationId: commandId,
      },
    });
    const evidence = await database.query<{ failure_evidence: unknown; count: number }>(`
      select failure_evidence,
        (select count(*)::integer from public.weekly_plans
          where predecessor_plan_id = '${sourcePlanId}') as count
      from public.weekly_plan_commands where command_id = '${commandId}'
    `);
    expect(evidence.rows[0]).toEqual({
      failure_evidence: {
        stage: "recovery",
        reason: "committed_result_repaired",
      },
      count: 1,
    });
  });

  it("service-only stale recovery records no-result evidence and releases the lock", async () => {
    await begin();
    await database.exec(`
      update public.weekly_plan_commands
      set updated_at = now() - interval '11 minutes'
      where command_id = '${commandId}';
    `);

    const recovered = await rpc(
      "recover_stale_next_weekly_plan_generation",
      `'${userId}', '${commandId}'`,
    );
    expect(recovered).toMatchObject({
      status: "failed",
      error: { code: "provider_outcome_unrecoverable", retryable: false },
    });
    const recorded = await database.query<{
      failure_evidence: unknown;
      next_generation_id: string | null;
    }>(`
      select command.failure_evidence, plan.next_generation_id
      from public.weekly_plan_commands command
      join public.weekly_plans plan on plan.plan_id = '${sourcePlanId}'
      where command.command_id = '${commandId}'
    `);
    expect(recorded.rows[0]).toEqual({
      failure_evidence: {
        stage: "recovery",
        reason: "missing_provider_checkpoint_without_committed_result",
      },
      next_generation_id: null,
    });
  });
});
