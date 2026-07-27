// @vitest-environment node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { weeklyPlanFixture } from "../../test/weeklyPlanFixture";

const weeklyPlansMigrationPath = fileURLToPath(new URL(
  "./20260727120000_create_weekly_plans.sql",
  import.meta.url,
));
const commandsMigrationPath = fileURLToPath(new URL(
  "./20260727130000_create_initial_generation_commands.sql",
  import.meta.url,
));

const userOne = "00000000-0000-4000-8000-000000000001";
const userTwo = "00000000-0000-4000-8000-000000000002";
const userThree = "00000000-0000-4000-8000-000000000003";
const commandOne = "10000000-0000-4000-8000-000000000001";
const commandTwo = "10000000-0000-4000-8000-000000000002";
const commandThree = "10000000-0000-4000-8000-000000000003";
const commandFour = "10000000-0000-4000-8000-000000000004";
const fingerprintOne = "a".repeat(64);
const fingerprintTwo = "b".repeat(64);

describe("initial Current Weekly Plan generation database contract", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite();
    await database.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users (id uuid primary key);
      insert into auth.users (id) values
        ('${userOne}'), ('${userTwo}'), ('${userThree}');
      create function auth.uid() returns uuid
      language sql stable
      as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
    `);
    await database.exec(await readFile(weeklyPlansMigrationPath, "utf8"));
    await database.exec(await readFile(commandsMigrationPath, "utf8"));
  });

  afterAll(async () => {
    await database.close();
  });

  const begin = async (userId: string, commandId: string, fingerprint: string) => {
    await database.exec("set role service_role;");
    try {
      const result = await database.query<{ outcome: Record<string, unknown> }>(`
        select public.begin_initial_weekly_plan_generation(
          '${userId}', '${commandId}', '${fingerprint}'
        ) as outcome
      `);
      return result.rows[0].outcome;
    } finally {
      await database.exec("reset role;");
    }
  };

  it("durably records a pending command without creating a placeholder plan", async () => {
    await expect(begin(userOne, commandOne, fingerprintOne)).resolves.toMatchObject({
      commandId: commandOne,
      status: "in_progress",
      result: null,
      error: null,
      shouldGenerate: true,
    });

    const commands = await database.query<{
      command_id: string;
      user_id: string;
      operation: string;
      input_fingerprint: string;
      status: string;
    }>(`
      select command_id, user_id, operation, input_fingerprint, status
      from public.weekly_plan_commands
      where command_id = '${commandOne}'
    `);
    expect(commands.rows).toEqual([{
      command_id: commandOne,
      user_id: userOne,
      operation: "generate_initial",
      input_fingerprint: fingerprintOne,
      status: "in_progress",
    }]);

    const plans = await database.query<{ count: number }>(
      `select count(*)::integer as count from public.weekly_plans where user_id = '${userOne}'`,
    );
    expect(plans.rows[0].count).toBe(0);
  });

  it("replays identical input without authorizing another provider operation", async () => {
    await expect(begin(userOne, commandOne, fingerprintOne)).resolves.toMatchObject({
      commandId: commandOne,
      status: "in_progress",
      shouldGenerate: false,
    });
  });

  it("rejects changed input under the same command ID", async () => {
    await expect(begin(userOne, commandOne, fingerprintTwo)).resolves.toMatchObject({
      commandId: commandOne,
      status: "failed",
      result: null,
      error: {
        code: "idempotency_key_reused",
        retryable: false,
      },
      shouldGenerate: false,
    });

    const recorded = await database.query<{ input_fingerprint: string; status: string }>(`
      select input_fingerprint, status
      from public.weekly_plan_commands
      where command_id = '${commandOne}'
    `);
    expect(recorded.rows).toEqual([{
      input_fingerprint: fingerprintOne,
      status: "in_progress",
    }]);
  });

  it("durably checkpoints a provider result so replay can finish without another call", async () => {
    const checkpoint = JSON.stringify({
      kind: "success",
      document: weeklyPlanFixture,
      usageRecord: {
        callId: "30000000-0000-4000-8000-000000000001",
        attempt: 1,
        provider: "openai",
        model: "gpt-5.6-sol",
        outcome: "success",
      },
    }).replaceAll("'", "''");
    await database.exec("set role service_role;");
    try {
      const result = await database.query<{ outcome: Record<string, unknown> }>(`
        select public.checkpoint_initial_weekly_plan_generation(
          '${userOne}', '${commandOne}', '${fingerprintOne}', '${checkpoint}'::jsonb
        ) as outcome
      `);
      expect(result.rows[0].outcome).toMatchObject({
        status: "in_progress",
        shouldGenerate: false,
        checkpoint: {
          kind: "success",
          document: weeklyPlanFixture,
        },
      });
    } finally {
      await database.exec("reset role;");
    }

    await expect(begin(userOne, commandOne, fingerprintOne)).resolves.toMatchObject({
      status: "in_progress",
      shouldGenerate: false,
      checkpoint: { kind: "success" },
    });
  });

  it("records a concurrent command but permits only one pending provider operation", async () => {
    const first = await begin(userTwo, commandTwo, fingerprintOne);
    const second = await begin(userTwo, commandThree, fingerprintTwo);

    expect(first).toMatchObject({ status: "in_progress", shouldGenerate: true });
    expect(second).toMatchObject({
      commandId: commandThree,
      status: "failed",
      error: { code: "plan_generation_locked", retryable: true },
      shouldGenerate: false,
    });

    const pending = await database.query<{ count: number }>(`
      select count(*)::integer as count
      from public.weekly_plan_commands
      where user_id = '${userTwo}' and status = 'in_progress'
    `);
    expect(pending.rows[0].count).toBe(1);
    const locked = await database.query<{ failure_evidence: unknown }>(`
      select failure_evidence
      from public.weekly_plan_commands
      where command_id = '${commandThree}'
    `);
    expect(locked.rows[0].failure_evidence).toEqual({
      stage: "start",
      reason: "generation_already_pending",
    });
  });

  it("atomically completes with one authoritative revision-0 plan and replays it", async () => {
    const document = JSON.stringify(weeklyPlanFixture).replaceAll("'", "''");
    await database.exec("set role service_role;");
    let completed: Record<string, unknown>;
    try {
      const result = await database.query<{ outcome: Record<string, unknown> }>(`
        select public.complete_initial_weekly_plan_generation(
          '${userOne}', '${commandOne}', '${fingerprintOne}', '${document}'::jsonb
        ) as outcome
      `);
      completed = result.rows[0].outcome;
    } finally {
      await database.exec("reset role;");
    }

    expect(completed).toMatchObject({
      commandId: commandOne,
      status: "succeeded",
      error: null,
      result: {
        userId: userOne,
        revision: 0,
        isActive: true,
        schemaVersion: 1,
        document: weeklyPlanFixture,
      },
    });

    await database.exec(`
      set role service_role;
      update public.weekly_plans
      set document = jsonb_set(document, '{weeklySummary}', '"Later mutation"'),
          revision = 1,
          updated_at = updated_at + interval '1 second'
      where user_id = '${userOne}' and is_active;
      reset role;
    `);
    expect(await begin(userOne, commandOne, fingerprintOne)).toEqual({
      ...completed,
      shouldGenerate: false,
    });

    const plans = await database.query<{ count: number }>(`
      select count(*)::integer as count
      from public.weekly_plans
      where user_id = '${userOne}' and is_active
    `);
    expect(plans.rows[0].count).toBe(1);
  });

  it("preserves confirmed-empty and stores only privacy-safe failure evidence", async () => {
    await begin(userThree, commandFour, fingerprintOne);
    await database.exec("set role service_role;");
    let failed: Record<string, unknown>;
    try {
      const result = await database.query<{ outcome: Record<string, unknown> }>(`
        select public.fail_initial_weekly_plan_generation(
          '${userThree}', '${commandFour}', '${fingerprintOne}',
          'generation_failed', 'The provider did not return a valid Weekly Plan.',
          false, '{"stage":"provider","providerRequestId":"req_safe"}'::jsonb
        ) as outcome
      `);
      failed = result.rows[0].outcome;
    } finally {
      await database.exec("reset role;");
    }

    expect(failed).toMatchObject({
      commandId: commandFour,
      status: "failed",
      result: null,
      error: { code: "generation_failed", retryable: false },
    });
    const evidence = await database.query<{ failure_evidence: unknown; count: number }>(`
      select failure_evidence,
        (select count(*)::integer from public.weekly_plans where user_id = '${userThree}') as count
      from public.weekly_plan_commands
      where command_id = '${commandFour}'
    `);
    expect(evidence.rows[0]).toEqual({
      failure_evidence: { stage: "provider", providerRequestId: "req_safe" },
      count: 0,
    });
    expect(JSON.stringify(evidence.rows[0].failure_evidence)).not.toContain("ingredient");
    expect(JSON.stringify(evidence.rows[0].failure_evidence)).not.toContain("profile");
  });

  it("denies authenticated clients direct command writes and service RPC execution", async () => {
    await database.exec(`
      set role authenticated;
      set "request.jwt.claim.sub" = '${userOne}';
    `);
    try {
      await expect(database.exec(`
        insert into public.weekly_plan_commands (
          command_id, user_id, operation, input_fingerprint, status
        ) values (
          '90000000-0000-4000-8000-000000000001', '${userOne}',
          'generate_initial', '${fingerprintOne}', 'in_progress'
        )
      `)).rejects.toThrow(/permission denied/);
      await expect(database.query(`
        select public.begin_initial_weekly_plan_generation(
          '${userOne}', '90000000-0000-4000-8000-000000000001', '${fingerprintOne}'
        )
      `)).rejects.toThrow(/permission denied/);
    } finally {
      await database.exec('reset role; reset "request.jwt.claim.sub";');
    }
  });
});
