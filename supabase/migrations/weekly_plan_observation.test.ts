// @vitest-environment node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { weeklyPlanFixture } from "../../test/weeklyPlanFixture";
import { CLIENT_INCIDENT_CONTEXT_KEYS } from "../../services/clientIncidentContext";

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
  "20260808120000_record_unauthenticated_oauth_incidents.sql",
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

    // Built from the client's own contract rather than hand-written, so a key
    // added on either side without the other fails here instead of silently
    // losing incidents in production.
    const fullContext = JSON.stringify(
      Object.fromEntries(
        CLIENT_INCIDENT_CONTEXT_KEYS.map((key) => [key, "sample-value"]),
      ),
    );
    await database.exec(`
      set role authenticated;
      select public.record_weekly_plan_client_incident(
        'oauth_auth_failure',
        '${fullContext}'
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

  it("records signed-out OAuth failures and nothing else anonymously", async () => {
    // The callback, session-restore and redirect-start failures all report with
    // no session, so `anon` must be able to record them unattributed.
    await database.exec(`
      select set_config('request.jwt.claim.sub', '', false);
      set role anon;
      select public.record_weekly_plan_client_incident(
        'oauth_auth_failure',
        '{"provider":"google","lifecycleStage":"callback","errorCode":"oauth_callback_failed"}'
      );
      reset role;
    `);
    const anonymous = await database.query<{ count: number }>(`
      select count(*)::integer as count
      from public.weekly_plan_client_incidents
      where user_id is null and event_type = 'oauth_auth_failure'
    `);
    expect(anonymous.rows[0].count).toBe(1);

    // Every other event type still requires a session.
    await expect(database.exec(`
      set role anon;
      select public.record_weekly_plan_client_incident(
        'authoritative_load_failure',
        '{"phase":"initial_load"}'
      );
    `)).rejects.toThrow(/Authentication is required/);
    await database.exec("reset role;");

    // The anonymous write path stays bounded.
    await database.exec(`
      insert into public.weekly_plan_client_incidents (user_id, event_type, context)
      select null, 'oauth_auth_failure', '{}'::jsonb from generate_series(1, 120);
      set role anon;
      select public.record_weekly_plan_client_incident('oauth_auth_failure', '{}');
      reset role;
    `);
    const capped = await database.query<{ count: number }>(`
      select count(*)::integer as count
      from public.weekly_plan_client_incidents
      where user_id is null
    `);
    expect(capped.rows[0].count).toBe(121);

    await database.exec(`
      delete from public.weekly_plan_client_incidents where user_id is null;
      select set_config('request.jwt.claim.sub', '${userId}', false);
    `);
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
