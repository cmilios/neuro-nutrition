// @vitest-environment node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { weeklyPlanFixture } from "../../test/weeklyPlanFixture";

const migrations = [
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
  "./20260729120000_create_weekly_plan_observation.sql",
  "./20260729135108_create_health_profile_plan_replacement_commands.sql",
].map((path) => fileURLToPath(new URL(path, import.meta.url)));

const userId = "00000000-0000-4000-8000-000000000001";
const sourcePlanId = "20000000-0000-4000-8000-000000000001";
const commandId = "10000000-0000-4000-8000-000000000001";
const fingerprint = "a".repeat(64);

describe("Health Profile Plan Replacement database command", () => {
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

  const begin = () => rpc("begin_health_profile_plan_replacement", [
    `'${userId}'`,
    `'${commandId}'`,
    `'${fingerprint}'`,
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
      create function auth.uid() returns uuid language sql stable as $$
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

  it("durably locks the authoritative source without storing raw Health Profile data", async () => {
    await expect(begin()).resolves.toMatchObject({
      commandId,
      status: "in_progress",
      shouldGenerate: true,
      source: { planId: sourcePlanId, revision: 0 },
    });
    await expect(begin()).resolves.toMatchObject({
      status: "in_progress",
      shouldGenerate: false,
    });

    const plan = await database.query<{ health_profile_replacement_id: string }>(`
      select health_profile_replacement_id
      from public.weekly_plans where plan_id = '${sourcePlanId}'
    `);
    expect(plan.rows[0].health_profile_replacement_id).toBe(commandId);

    const command = await database.query<Record<string, unknown>>(`
      select * from public.weekly_plan_commands where command_id = '${commandId}'
    `);
    expect(JSON.stringify(command.rows[0])).not.toContain("weightKg");
    expect(command.rows[0]).toMatchObject({
      operation: "replace_from_health_profile",
      input_fingerprint: fingerprint,
    });
  });

  it("atomically activates one revision-zero successor and replays its result", async () => {
    await begin();
    const successor = structuredClone(weeklyPlanFixture);
    successor.weeklySummary = "Tailored to the corrected Health Profile";
    const document = JSON.stringify(successor).replaceAll("'", "''");

    const completeArgs = [
      `'${userId}'`,
      `'${commandId}'`,
      `'${fingerprint}'`,
      `'${document}'::jsonb`,
    ].join(", ");
    await expect(rpc("complete_health_profile_plan_replacement", completeArgs))
      .resolves.toMatchObject({
        status: "succeeded",
        result: {
          revision: 0,
          isActive: true,
          predecessorPlanId: sourcePlanId,
          generationId: commandId,
          document: { weeklySummary: successor.weeklySummary },
        },
      });
    await expect(rpc("complete_health_profile_plan_replacement", completeArgs))
      .resolves.toMatchObject({ status: "succeeded" });

    const active = await database.query<{ count: number }>(`
      select count(*)::int as count from public.weekly_plans where user_id = '${userId}' and is_active
    `);
    expect(active.rows[0].count).toBe(1);
  });

  it("clears the lock and preserves the source plan on terminal failure", async () => {
    await begin();
    const outcome = await rpc("fail_health_profile_plan_replacement", [
      `'${userId}'`,
      `'${commandId}'`,
      `'${fingerprint}'`,
      "'generation_failed'",
      "'Provider unavailable'",
      "true",
      `'{"stage":"generation","reason":"provider","profile":{"weightKg":70}}'::jsonb`,
    ].join(", "));
    expect(outcome).toMatchObject({
      status: "failed",
      error: { code: "generation_failed", retryable: true },
    });

    const source = await database.query<{
      is_active: boolean;
      health_profile_replacement_id: string | null;
    }>(`
      select is_active, health_profile_replacement_id
      from public.weekly_plans where plan_id = '${sourcePlanId}'
    `);
    expect(source.rows[0]).toEqual({
      is_active: true,
      health_profile_replacement_id: null,
    });
    const evidence = await database.query<{ failure_evidence: Record<string, unknown> }>(`
      select failure_evidence from public.weekly_plan_commands where command_id = '${commandId}'
    `);
    expect(evidence.rows[0].failure_evidence).toEqual({
      stage: "generation",
      reason: "provider",
    });
  });

  it("recovers a stale command without removing the source", async () => {
    await begin();
    await database.exec(`
      update public.weekly_plan_commands
      set updated_at = clock_timestamp() - interval '11 minutes'
      where command_id = '${commandId}';
    `);

    await expect(rpc(
      "recover_stale_health_profile_plan_replacement",
      `'${userId}', '${commandId}'`,
    )).resolves.toMatchObject({
      status: "failed",
      error: { code: "stale_generation_recovered", retryable: true },
    });
  });

  it("keeps command lifecycle RPCs service-only", async () => {
    await database.exec(`
      set role authenticated;
      set "request.jwt.claim.sub" = '${userId}';
    `);
    await expect(database.query(`
      select public.begin_health_profile_plan_replacement(
        '${userId}', '${commandId}', '${fingerprint}', '${sourcePlanId}', 0
      )
    `)).rejects.toThrow(/permission denied/i);
    await database.exec('reset role; reset "request.jwt.claim.sub";');
  });

  it("preserves the historical legacy migration command operation", async () => {
    const constraint = await database.query<{ definition: string }>(`
      select pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conrelid = 'public.weekly_plan_commands'::regclass
        and conname = 'weekly_plan_commands_operation'
    `);

    expect(constraint.rows[0].definition).toContain("legacy_migration");
  });
});
