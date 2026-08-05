// @vitest-environment node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { weeklyPlanFixture } from "../../test/weeklyPlanFixture";

const migrationNames = [
  "20260722091747_user_data.sql",
  "20260722193317_create_ai_usage_records.sql",
  "20260727120000_create_weekly_plans.sql",
  "20260727130000_create_initial_generation_commands.sql",
  "20260727140000_create_ingredient_progress_commands.sql",
  "20260727150000_create_meal_reroll_commands.sql",
  "20260727160000_create_next_weekly_plan_commands.sql",
  "20260727170000_create_start_over_commands.sql",
  "20260727175000_create_weekly_plan_rollout.sql",
  "20260727177500_enter_weekly_plan_maintenance.sql",
  "20260727180000_cut_over_legacy_weekly_plans.sql",
  "20260727180100_finalize_legacy_weekly_plan_cutover.sql",
  "20260729120000_create_weekly_plan_observation.sql",
  "20260730071049_add_observation_function_failure_probe.sql",
  "20260805120000_allow_oauth_auth_failure_incident.sql",
];
const migrationPaths = migrationNames.map((name) =>
  fileURLToPath(new URL(`./${name}`, import.meta.url))
);
const userId = "00000000-0000-4000-8000-000000000001";

describe("Weekly Plan observation database contract", () => {
  let database: PGlite;

  beforeAll(async () => {
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
    for (const path of migrationPaths.slice(0, 8)) {
      await database.exec(await readFile(path, "utf8"));
    }
    const document = JSON.stringify(weeklyPlanFixture).replaceAll("'", "''");
    await database.exec(`
      insert into public.user_data (user_id, profile, meal_plan, milestones)
      values ('${userId}', '{}', '${document}'::jsonb, '[]');
    `);
    for (const path of migrationPaths.slice(8)) {
      await database.exec(await readFile(path, "utf8"));
    }
  });

  afterAll(async () => database.close());

  it("records only allow-listed authenticated client telemetry", async () => {
    await database.exec(`
      select set_config('request.jwt.claim.sub', '${userId}', false);
      set role authenticated;
      select public.record_weekly_plan_client_incident(
        'authoritative_load_failure',
        '{"phase":"initial_load","operation":"load"}'
      );
      reset role;
    `);
    const incidents = await database.query<{ count: number }>(
      "select count(*)::integer as count from public.weekly_plan_client_incidents",
    );
    expect(incidents.rows[0].count).toBe(1);

    await database.exec(`
      set role authenticated;
      select public.record_weekly_plan_client_incident(
        'oauth_auth_failure',
        '{"provider":"google","phase":"session_restore","errorCode":"unverified_email"}'
      );
      reset role;
    `);
    const oauthIncidents = await database.query<{ count: number }>(
      "select count(*)::integer as count from public.weekly_plan_client_incidents where event_type = 'oauth_auth_failure'",
    );
    expect(oauthIncidents.rows[0].count).toBe(1);

    await expect(database.exec(`
      set role authenticated;
      select public.record_weekly_plan_client_incident(
        'authoritative_load_failure',
        '{"plan":"private content"}'
      );
    `)).rejects.toThrow();
    await database.exec("reset role;");
    await expect(database.exec(`
      set role authenticated;
      select public.record_weekly_plan_client_incident(
        'authoritative_load_failure',
        '{"phase":{"plan":"private content"}}'
      );
    `)).rejects.toThrow();
    await database.exec("reset role;");
  });

  it("exposes an aggregate read-only snapshot to the monitor role", async () => {
    await database.exec("set role weekly_plan_monitor;");
    const result = await database.query<{ snapshot: Record<string, unknown> }>(`
      select public.get_weekly_plan_observation_snapshot() as snapshot
    `);
    await database.exec("reset role;");

    expect(result.rows[0].snapshot).toEqual(expect.objectContaining({
      rolloutState: "authoritative",
      planInvariants: { violations: 0 },
      migrationEvidence: { valid: true },
    }));
    const functionFailures = await database.query<{
      failures: { critical: number; total: number };
    }>(`
      select public.get_weekly_plan_function_failures() as failures
    `);
    expect(functionFailures.rows[0].failures).toEqual({
      critical: 0,
      total: 0,
    });
    await database.exec("set role weekly_plan_monitor;");
    await expect(database.query("select * from public.weekly_plans"))
      .rejects.toThrow();
    await database.exec("reset role;");
  });
});
