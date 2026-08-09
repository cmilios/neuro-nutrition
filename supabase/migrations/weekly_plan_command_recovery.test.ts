// @vitest-environment node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
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
const otherUserId = "00000000-0000-4000-8000-000000000002";
const commandId = "10000000-0000-4000-8000-000000000001";
const planId = "20000000-0000-4000-8000-000000000001";
const fingerprint = "a".repeat(64);

describe("unknown Weekly Plan command recovery database contract", () => {
  let database: PGlite | undefined;

  afterEach(async () => {
    await database?.close();
  });

  const createDatabase = async () => {
    database = new PGlite();
    await database.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users (id uuid primary key);
      insert into auth.users (id) values ('${userId}'), ('${otherUserId}');
      create function auth.uid() returns uuid
      language sql stable
      as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
    `);
    for (const migration of migrations) {
      await database.exec(await readFile(migration, "utf8"));
    }
    return database;
  };

  it("terminally releases a stale unknown initial generation without another provider attempt", async () => {
    const db = await createDatabase();
    await db.exec("set role service_role;");
    await db.query(`
      select public.begin_initial_weekly_plan_generation(
        '${userId}', '${commandId}', '${fingerprint}'
      )
    `);
    await db.query(`
      select public.checkpoint_initial_weekly_plan_generation(
        '${userId}', '${commandId}', '${fingerprint}',
        '{
          "kind":"unknown",
          "usageRecord":{
            "callId":"30000000-0000-4000-8000-000000000001",
            "attempt":1,
            "provider":"openai",
            "model":"gpt-5.6-sol",
            "outcome":"failure",
            "errorCode":"ai_provider_error"
          },
          "error":{
            "code":"generation_outcome_unknown",
            "message":"The provider outcome is unknown.",
            "retryable":false
          },
          "evidence":{
            "stage":"provider",
            "providerRequestId":"req_safe"
          }
        }'::jsonb
      )
    `);
    await db.exec("reset role;");
    await db.exec(`
      update public.weekly_plan_commands
      set updated_at = now() - interval '11 minutes'
      where command_id = '${commandId}'
    `);

    await db.exec("set role service_role;");
    const result = await db.query<{ outcome: Record<string, unknown> }>(`
      select public.recover_stale_initial_weekly_plan_generation(
        '${userId}', '${commandId}'
      ) as outcome
    `);
    await db.exec("reset role;");

    expect(result.rows[0].outcome).toMatchObject({
      commandId,
      status: "failed",
      error: {
        code: "provider_outcome_unrecoverable",
        retryable: false,
      },
      shouldGenerate: false,
      checkpoint: null,
      inputFingerprint: fingerprint,
    });
    const evidence = await db.query<{
      failure_evidence: unknown;
      plan_count: number;
    }>(`
      select failure_evidence,
        (select count(*)::integer from public.weekly_plans) as plan_count
      from public.weekly_plan_commands
      where command_id = '${commandId}'
    `);
    expect(evidence.rows[0]).toEqual({
      failure_evidence: {
        stage: "recovery",
        reason: "unknown_provider_outcome_without_committed_result",
      },
      plan_count: 0,
    });
  });

  it("lets an authenticated user rediscover only their pending initial command identity", async () => {
    const db = await createDatabase();
    await db.exec("set role service_role;");
    await db.query(`
      select public.begin_initial_weekly_plan_generation(
        '${userId}', '${commandId}', '${fingerprint}'
      )
    `);
    await db.exec("reset role;");

    await db.exec(`
      set role authenticated;
      set "request.jwt.claim.sub" = '${userId}';
    `);
    const owner = await db.query<{ pending: Record<string, unknown> | null }>(`
      select public.get_pending_initial_weekly_plan_generation() as pending
    `);
    await db.exec(`
      set "request.jwt.claim.sub" = '${otherUserId}';
    `);
    const other = await db.query<{ pending: Record<string, unknown> | null }>(`
      select public.get_pending_initial_weekly_plan_generation() as pending
    `);
    await db.exec('reset role; reset "request.jwt.claim.sub";');

    expect(owner.rows[0].pending).toEqual({ commandId });
    expect(other.rows[0].pending).toBeNull();
  });

  it("terminally releases a stale unknown Meal Reroll reservation without mutating the plan", async () => {
    const db = await createDatabase();
    const document = JSON.stringify(weeklyPlanFixture).replaceAll("'", "''");
    await db.exec(`
      insert into public.weekly_plans (plan_id, user_id, document)
      values ('${planId}', '${userId}', '${document}'::jsonb)
    `);
    await db.exec("set role service_role;");
    await db.query(`
      select public.begin_meal_reroll(
        '${userId}', '${commandId}', '${fingerprint}',
        '${planId}', 0, 'Monday', 'breakfast'
      )
    `);
    await db.query(`
      select public.checkpoint_meal_reroll(
        '${userId}', '${commandId}', '${fingerprint}',
        '{
          "kind":"unknown",
          "usageRecord":{
            "callId":"30000000-0000-4000-8000-000000000001",
            "attempt":1,
            "provider":"openai",
            "model":"gpt-5.6-sol",
            "outcome":"failure",
            "errorCode":"ai_provider_error"
          },
          "error":{
            "code":"generation_outcome_unknown",
            "message":"The provider outcome is unknown.",
            "retryable":false
          },
          "evidence":{"stage":"provider"}
        }'::jsonb
      )
    `);
    await db.exec("reset role;");
    await db.exec(`
      update public.weekly_plan_commands
      set updated_at = now() - interval '11 minutes'
      where command_id = '${commandId}'
    `);

    await db.exec("set role service_role;");
    const result = await db.query<{ outcome: Record<string, unknown> }>(`
      select public.recover_stale_meal_reroll(
        '${userId}', '${commandId}'
      ) as outcome
    `);
    await db.exec("reset role;");

    expect(result.rows[0].outcome).toMatchObject({
      commandId,
      status: "failed",
      error: {
        code: "provider_outcome_unrecoverable",
        retryable: false,
      },
      checkpoint: null,
      inputFingerprint: fingerprint,
    });
    const recorded = await db.query<{
      failure_evidence: unknown;
      reservation_count: number;
      revision: number;
    }>(`
      select command.failure_evidence,
        (select count(*)::integer
          from public.weekly_plan_meal_reroll_reservations) as reservation_count,
        plan.revision
      from public.weekly_plan_commands command
      join public.weekly_plans plan on plan.plan_id = '${planId}'
      where command.command_id = '${commandId}'
    `);
    expect(recorded.rows[0]).toEqual({
      failure_evidence: {
        stage: "recovery",
        reason: "unknown_provider_outcome_without_committed_result",
      },
      reservation_count: 0,
      revision: 0,
    });

    await db.exec(`
      insert into public.weekly_plan_meal_reroll_reservations (
        plan_id, user_id, command_id, displayed_plan_id, displayed_revision,
        day, meal_type
      ) values (
        '${planId}', '${userId}', '${commandId}', '${planId}', 0,
        'Monday', 'breakfast'
      )
    `);
    await db.exec("set role service_role;");
    await db.query(`
      select public.recover_stale_meal_reroll('${userId}', '${commandId}')
    `);
    await db.exec("reset role;");
    const orphanedReservation = await db.query<{ count: number }>(`
      select count(*)::integer as count
      from public.weekly_plan_meal_reroll_reservations
      where command_id = '${commandId}'
    `);
    expect(orphanedReservation.rows[0].count).toBe(0);
  });

  it("terminally releases a stale unknown Next Weekly Plan lock without replacing the source", async () => {
    const db = await createDatabase();
    const document = JSON.stringify(weeklyPlanFixture).replaceAll("'", "''");
    await db.exec(`
      insert into public.weekly_plans (plan_id, user_id, document)
      values ('${planId}', '${userId}', '${document}'::jsonb)
    `);
    await db.exec("set role service_role;");
    await db.query(`
      select public.begin_next_weekly_plan_generation(
        '${userId}', '${commandId}', '${fingerprint}', '${planId}', 0
      )
    `);
    await db.query(`
      select public.checkpoint_next_weekly_plan_generation(
        '${userId}', '${commandId}', '${fingerprint}',
        '{
          "kind":"unknown",
          "usageRecord":{
            "callId":"30000000-0000-4000-8000-000000000001",
            "attempt":1,
            "provider":"openai",
            "model":"gpt-5.6-sol",
            "outcome":"failure",
            "errorCode":"ai_provider_error"
          },
          "error":{
            "code":"generation_outcome_unknown",
            "message":"The provider outcome is unknown.",
            "retryable":false
          },
          "evidence":{"stage":"provider"}
        }'::jsonb
      )
    `);
    await db.exec("reset role;");
    await db.exec(`
      update public.weekly_plan_commands
      set updated_at = now() - interval '11 minutes'
      where command_id = '${commandId}'
    `);

    await db.exec("set role service_role;");
    const result = await db.query<{ outcome: Record<string, unknown> }>(`
      select public.recover_stale_next_weekly_plan_generation(
        '${userId}', '${commandId}'
      ) as outcome
    `);
    await db.exec("reset role;");

    expect(result.rows[0].outcome).toMatchObject({
      commandId,
      status: "failed",
      error: {
        code: "provider_outcome_unrecoverable",
        retryable: false,
      },
      checkpoint: null,
      inputFingerprint: fingerprint,
    });
    const recorded = await db.query<{
      failure_evidence: unknown;
      next_generation_id: string | null;
      plan_count: number;
    }>(`
      select command.failure_evidence, plan.next_generation_id,
        (select count(*)::integer from public.weekly_plans) as plan_count
      from public.weekly_plan_commands command
      join public.weekly_plans plan on plan.plan_id = '${planId}'
      where command.command_id = '${commandId}'
    `);
    expect(recorded.rows[0]).toEqual({
      failure_evidence: {
        stage: "recovery",
        reason: "unknown_provider_outcome_without_committed_result",
      },
      next_generation_id: null,
      plan_count: 1,
    });

    await db.exec(`
      update public.weekly_plans
      set next_generation_id = '${commandId}',
          next_generation_locked_at = now()
      where plan_id = '${planId}'
    `);
    await db.exec("set role service_role;");
    await db.query(`
      select public.recover_stale_next_weekly_plan_generation(
        '${userId}', '${commandId}'
      )
    `);
    await db.exec("reset role;");
    const orphanedLock = await db.query<{ next_generation_id: string | null }>(`
      select next_generation_id
      from public.weekly_plans where plan_id = '${planId}'
    `);
    expect(orphanedLock.rows[0].next_generation_id).toBeNull();
  });
});
