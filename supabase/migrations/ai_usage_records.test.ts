// @vitest-environment node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(new URL(
  "./20260722193317_create_ai_usage_records.sql",
  import.meta.url,
));

const userOne = "00000000-0000-4000-8000-000000000001";
const userTwo = "00000000-0000-4000-8000-000000000002";

describe("AI Usage Record database contract", () => {
  let database: PGlite;
  let callSequence = 10;

  beforeAll(async () => {
    database = new PGlite();
    await database.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users (id uuid primary key);
      insert into auth.users (id) values ('${userOne}'), ('${userTwo}');
    `);
    await database.exec(await readFile(migrationPath, "utf8"));
  });

  afterAll(async () => {
    await database.close();
  });

  const insertRecord = async (
    userId: string,
    responseId: string,
    outcome: "success" | "failure",
    estimatedCost: number | null,
  ) => {
    const callId = `00000000-0000-4000-8000-${String(callSequence++).padStart(12, "0")}`;
    await database.exec(`
      set role service_role;
      insert into public.ai_usage_records (
        call_id, user_id, action, attempt, provider, model, provider_response_id,
        input_tokens, output_tokens, total_tokens, outcome,
        estimated_cost_usd, pricing_version, pricing_snapshot
      ) values (
        '${callId}', '${userId}', 'plan', 1, 'openai', 'gpt-5.6-sol', '${responseId}',
        100, 25, 125, '${outcome}',
        ${estimatedCost === null ? "null" : estimatedCost},
        ${estimatedCost === null ? "null" : "'openai-standard-2026-07-22'"},
        ${estimatedCost === null ? "null" : "'{\"inputPerMillionUsd\":5}'::jsonb"}
      );
      reset role;
    `);
  };

  it("prevents public clients from reading or altering usage records", async () => {
    for (const role of ["anon", "authenticated"]) {
      await database.exec(`set role ${role};`);
      try {
        await expect(database.query("select * from public.ai_usage_records"))
          .rejects.toThrow(/permission denied/);
        await expect(database.exec(`
          insert into public.ai_usage_records
            (user_id, action, attempt, provider, model, outcome)
          values ('${userOne}', 'plan', 1, 'openai', 'gpt-5.6-sol', 'success')
        `)).rejects.toThrow(/permission denied/);
        await expect(database.exec("update public.ai_usage_records set attempt = 2"))
          .rejects.toThrow(/permission denied/);
        await expect(database.exec("delete from public.ai_usage_records"))
          .rejects.toThrow(/permission denied/);
        await expect(database.query("select * from public.ai_usage_by_user"))
          .rejects.toThrow(/permission denied/);
      } finally {
        await database.exec("reset role;");
      }
    }
  });

  it("keeps records immutable even for privileged operators", async () => {
    await insertRecord(userOne, "resp_immutable", "success", 0.00125);

    await expect(database.exec(`
      update public.ai_usage_records set attempt = 2
      where provider_response_id = 'resp_immutable'
    `)).rejects.toThrow("AI Usage Records are immutable");
    await expect(database.exec(`
      delete from public.ai_usage_records
      where provider_response_id = 'resp_immutable'
    `)).rejects.toThrow("AI Usage Records are immutable");
    await expect(database.exec("truncate public.ai_usage_records"))
      .rejects.toThrow("AI Usage Records are immutable");
  });

  it("gives the operator role read-only access", async () => {
    await database.exec("set role ai_usage_reader;");
    try {
      const result = await database.query<{ provider_response_id: string }>(`
        select provider_response_id from public.ai_usage_records
        where provider_response_id = 'resp_immutable'
      `);
      expect(result.rows).toEqual([{ provider_response_id: "resp_immutable" }]);

      await expect(database.exec(`
        insert into public.ai_usage_records
          (call_id, user_id, action, attempt, provider, model, outcome)
        values (
          '00000000-0000-4000-8000-000000000099', '${userOne}',
          'plan', 1, 'openai', 'gpt-5.6-sol', 'success'
        )
      `)).rejects.toThrow(/permission denied/);
      await expect(database.exec("update public.ai_usage_records set attempt = 2"))
        .rejects.toThrow(/permission denied/);
      await expect(database.exec("delete from public.ai_usage_records"))
        .rejects.toThrow(/permission denied/);
    } finally {
      await database.exec("reset role;");
    }
  });

  it("deduplicates repeated persistence attempts by call ID", async () => {
    const callId = "00000000-0000-4000-8000-000000000098";
    await database.exec(`
      set role service_role;
      insert into public.ai_usage_records
        (call_id, user_id, action, attempt, provider, model, outcome)
      values
        ('${callId}', '${userOne}', 'meal', 1, 'openai', 'gpt-5.6-sol', 'success')
      on conflict (call_id) do nothing;
      insert into public.ai_usage_records
        (call_id, user_id, action, attempt, provider, model, outcome)
      values
        ('${callId}', '${userOne}', 'meal', 1, 'openai', 'gpt-5.6-sol', 'failure')
      on conflict (call_id) do nothing;
      reset role;
    `);

    const result = await database.query<{ count: number; outcome: string }>(`
      select count(*)::integer as count, min(outcome) as outcome
      from public.ai_usage_records
      where call_id = '${callId}'
    `);
    expect(result.rows).toEqual([{ count: 1, outcome: "success" }]);
  });

  it("aggregates calls, measured tokens, and available cost by user", async () => {
    await insertRecord(userTwo, "resp_aggregate_success", "success", 0.00125);
    await insertRecord(userTwo, "resp_aggregate_failure", "failure", null);

    await database.exec("set role ai_usage_reader;");
    try {
      const result = await database.query<{
        user_id: string;
        call_count: number;
        successful_call_count: number;
        failed_call_count: number;
        priced_call_count: number;
        input_tokens: number;
        output_tokens: number;
        total_tokens: number;
        estimated_cost_usd: string;
      }>(`select * from public.ai_usage_by_user where user_id = '${userTwo}'`);

      expect(result.rows).toEqual([expect.objectContaining({
        user_id: userTwo,
        call_count: 2,
        successful_call_count: 1,
        failed_call_count: 1,
        priced_call_count: 1,
        input_tokens: 200,
        output_tokens: 50,
        total_tokens: 250,
        estimated_cost_usd: "0.001250000000",
      })]);
    } finally {
      await database.exec("reset role;");
    }
  });
});
