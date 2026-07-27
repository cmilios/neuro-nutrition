// @vitest-environment node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { weeklyPlanFixture } from "../../test/weeklyPlanFixture";

const migrationPath = fileURLToPath(new URL(
  "./20260727120000_create_weekly_plans.sql",
  import.meta.url,
));

const userOne = "00000000-0000-4000-8000-000000000001";
const userTwo = "00000000-0000-4000-8000-000000000002";
const validDocument = JSON.stringify(weeklyPlanFixture).replaceAll("'", "''");

describe("Current Weekly Plan database contract", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite();
    await database.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users (id uuid primary key);
      insert into auth.users (id) values ('${userOne}'), ('${userTwo}');
      create function auth.uid() returns uuid
      language sql stable
      as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
    `);
    await database.exec(await readFile(migrationPath, "utf8"));
  });

  afterAll(async () => {
    await database.close();
  });

  const insertPlan = async (userId: string, active = true) => {
    await database.exec("set role service_role;");
    try {
      const result = await database.query<{ plan_id: string }>(`
        insert into public.weekly_plans (user_id, document, is_active, deactivated_at)
        values (
          '${userId}',
          '${validDocument}'::jsonb,
          ${active},
          ${active ? "null" : "now()"}
        )
        returning plan_id
      `);
      return result.rows[0].plan_id;
    } finally {
      await database.exec("reset role;");
    }
  };

  it("accepts a complete schema-version-1 Weekly Plan and rejects incomplete documents", async () => {
    await expect(insertPlan(userOne)).resolves.toEqual(expect.any(String));

    await expect(database.exec(`
      set role service_role;
      insert into public.weekly_plans (user_id, document)
      values ('${userTwo}', '{"weeklySummary":"incomplete","days":[]}'::jsonb);
    `)).rejects.toThrow(/weekly_plans_valid_document/);
    await database.exec("reset role;");

    await expect(database.exec(`
      set role service_role;
      insert into public.weekly_plans (user_id, document, schema_version)
      values ('${userTwo}', '${validDocument}'::jsonb, 2);
    `)).rejects.toThrow(/weekly_plans_valid_document/);
    await database.exec("reset role;");
  });

  it("enforces one active plan per owner and valid lifecycle metadata", async () => {
    await expect(insertPlan(userOne)).rejects.toThrow(/weekly_plans_one_active_per_user/);
    await expect(database.exec(`
      set role service_role;
      insert into public.weekly_plans (user_id, document, is_active, deactivated_at)
      values ('${userTwo}', '${validDocument}'::jsonb, true, now());
    `)).rejects.toThrow(/weekly_plans_lifecycle/);
    await database.exec("reset role;");
  });

  it("prevents revision metadata from moving backwards", async () => {
    const planId = await insertPlan(userTwo, false);
    await database.exec(`
      set role service_role;
      update public.weekly_plans
      set document = jsonb_set(document, '{weeklySummary}', '"First change"'),
          revision = 1,
          updated_at = updated_at + interval '1 second'
      where plan_id = '${planId}';
      reset role;
    `);

    await expect(database.exec(`
      set role service_role;
      update public.weekly_plans set revision = 0 where plan_id = '${planId}';
    `)).rejects.toThrow(/Weekly Plan revision cannot decrease/);
    await database.exec("reset role;");
  });

  it("requires exactly one revision increment for each document mutation", async () => {
    const result = await database.query<{ plan_id: string; document: string }>(`
      select plan_id, document::text as document
      from public.weekly_plans
      where user_id = '${userTwo}' and not is_active
      order by created_at desc
      limit 1
    `);
    const { plan_id: planId } = result.rows[0];

    await expect(database.exec(`
      set role service_role;
      update public.weekly_plans
      set document = jsonb_set(document, '{weeklySummary}', '"Changed"'),
          revision = revision + 2,
          updated_at = updated_at + interval '1 second'
      where plan_id = '${planId}';
    `)).rejects.toThrow(/exactly one revision increment/);
    await database.exec("reset role;");

    await expect(database.exec(`
      set role service_role;
      update public.weekly_plans
      set revision = revision + 1,
          updated_at = updated_at + interval '1 second'
      where plan_id = '${planId}';
    `)).rejects.toThrow(/cannot change without a document mutation/);
    await database.exec("reset role;");
  });

  it("rejects predecessor lineage owned by another user", async () => {
    const parent = await database.query<{ plan_id: string }>(`
      select plan_id from public.weekly_plans
      where user_id = '${userOne}'
      limit 1
    `);

    await expect(database.exec(`
      set role service_role;
      insert into public.weekly_plans (
        user_id, document, is_active, deactivated_at, predecessor_plan_id
      ) values (
        '${userTwo}', '${validDocument}'::jsonb, false, now(),
        '${parent.rows[0].plan_id}'
      );
    `)).rejects.toThrow(/weekly_plans_predecessor_owner/);
    await database.exec("reset role;");
  });

  it("lets authenticated users read only their own plans", async () => {
    await database.exec(`
      set role authenticated;
      set "request.jwt.claim.sub" = '${userOne}';
    `);
    try {
      const result = await database.query<{ user_id: string }>(
        "select user_id from public.weekly_plans order by user_id",
      );
      expect(result.rows).toEqual([{ user_id: userOne }]);
    } finally {
      await database.exec('reset role; reset "request.jwt.claim.sub";');
    }
  });

  it("denies authenticated clients every direct plan mutation", async () => {
    await database.exec(`
      set role authenticated;
      set "request.jwt.claim.sub" = '${userOne}';
    `);
    try {
      await expect(database.exec(`
        insert into public.weekly_plans (user_id, document)
        values ('${userOne}', '${validDocument}'::jsonb)
      `)).rejects.toThrow(/permission denied/);
      await expect(database.exec(
        "update public.weekly_plans set revision = revision + 1",
      )).rejects.toThrow(/permission denied/);
      await expect(database.exec(
        "delete from public.weekly_plans",
      )).rejects.toThrow(/permission denied/);
    } finally {
      await database.exec('reset role; reset "request.jwt.claim.sub";');
    }
  });
});
