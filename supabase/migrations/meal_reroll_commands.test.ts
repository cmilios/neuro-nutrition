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
].map((path) => fileURLToPath(new URL(path, import.meta.url)));

const userId = "00000000-0000-4000-8000-000000000001";
const displayedPlanId = "20000000-0000-4000-8000-000000000001";
const currentPlanId = "20000000-0000-4000-8000-000000000002";
const commandId = "10000000-0000-4000-8000-000000000001";
const otherCommandId = "10000000-0000-4000-8000-000000000002";
const unrelatedCommandId = "10000000-0000-4000-8000-000000000003";
const fingerprint = "a".repeat(64);

describe("Meal Reroll database command", () => {
  let database: PGlite;

  const rpc = async (name: string, args: string) => {
    const result = await database.query<{ outcome: Record<string, unknown> }>(
      `select private.${name}(${args}) as outcome`,
    );
    return result.rows[0].outcome;
  };

  const begin = (
    id = commandId,
    day = "Monday",
    mealType = "breakfast",
  ) => rpc("begin_meal_reroll", [
    `'${userId}'`,
    `'${id}'`,
    `'${id === commandId ? fingerprint : id === otherCommandId ? "b".repeat(64) : "c".repeat(64)}'`,
    `'${displayedPlanId}'`,
    "0",
    `'${day}'`,
    `'${mealType}'`,
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
    for (const migration of migrations.slice(0, 3)) {
      await database.exec(await readFile(migration, "utf8"));
    }

    const displayed = JSON.stringify(weeklyPlanFixture).replaceAll("'", "''");
    const current = structuredClone(weeklyPlanFixture);
    current.days[0].breakfast.name = "Authoritative breakfast";
    const serializedCurrent = JSON.stringify(current).replaceAll("'", "''");
    await database.exec(`
      set role service_role;
      insert into public.weekly_plans (
        plan_id, user_id, document, is_active, deactivated_at
      ) values (
        '${displayedPlanId}', '${userId}', '${displayed}'::jsonb, false, now()
      );
      insert into public.weekly_plans (plan_id, user_id, document)
      values ('${currentPlanId}', '${userId}', '${serializedCurrent}'::jsonb);
      reset role;
    `);
    await database.exec(await readFile(migrations[3], "utf8"));
  });

  afterEach(async () => {
    await database.close();
  });

  it("resolves an inactive displayed plan to the authoritative Meal Slot and reserves only it", async () => {
    const outcome = await begin();

    expect(outcome).toMatchObject({
      commandId,
      status: "in_progress",
      shouldGenerate: true,
      target: {
        planId: currentPlanId,
        day: "Monday",
        mealType: "breakfast",
        meal: { name: "Authoritative breakfast" },
      },
    });
    await expect(begin(otherCommandId)).resolves.toMatchObject({
      status: "failed",
      error: { code: "meal_slot_busy" },
    });
    await expect(begin(unrelatedCommandId, "Monday", "lunch")).resolves.toMatchObject({
      status: "in_progress",
      shouldGenerate: true,
    });
  });

  it("commits one replacement with server identities and one revision increment, then replays", async () => {
    await begin();
    const before = await database.query<{
      revision: number;
      document: typeof weeklyPlanFixture;
    }>(`select revision, document from public.weekly_plans where plan_id = '${currentPlanId}'`);
    const replacement = structuredClone(weeklyPlanFixture.days[0].breakfast);
    replacement.name = "Replacement breakfast";
    replacement.ingredients = [...before.rows[0].document.days[0].breakfast.ingredients];
    replacement.instructions = ["Prepare the same labels as a new recipe"];
    replacement.ingredientIds = [
      "30000000-0000-4000-8000-000000000001",
    ];
    replacement.checkedIngredientIds = [];
    replacement.macros = { calories: 111, protein: 22, carbs: 33, fats: 4 };
    const encoded = JSON.stringify(replacement).replaceAll("'", "''");

    const completed = await rpc("complete_meal_reroll", [
      `'${userId}'`,
      `'${commandId}'`,
      `'${fingerprint}'`,
      `'${encoded}'::jsonb`,
    ].join(", "));
    const replay = await begin();
    const after = await database.query<{
      revision: number;
      document: typeof weeklyPlanFixture;
    }>(`select revision, document from public.weekly_plans where plan_id = '${currentPlanId}'`);

    expect(completed).toMatchObject({
      commandId,
      status: "succeeded",
      result: { planId: currentPlanId, revision: before.rows[0].revision + 1 },
    });
    expect(replay).toEqual(completed);
    expect(after.rows[0].revision).toBe(before.rows[0].revision + 1);
    expect(after.rows[0].document.days[0].breakfast.name).toBe("Replacement breakfast");
    expect(after.rows[0].document.days[0].lunch)
      .toEqual(before.rows[0].document.days[0].lunch);
    expect(after.rows[0].document.days[0].breakfast.ingredientIds)
      .not.toEqual(replacement.ingredientIds);
    expect(after.rows[0].document.days[0].dailySummary).toEqual({
      calories: 111
        + before.rows[0].document.days[0].lunch.macros.calories
        + before.rows[0].document.days[0].dinner.macros.calories
        + before.rows[0].document.days[0].snack.macros.calories,
      protein: 22
        + before.rows[0].document.days[0].lunch.macros.protein
        + before.rows[0].document.days[0].dinner.macros.protein
        + before.rows[0].document.days[0].snack.macros.protein,
      carbs: 33
        + before.rows[0].document.days[0].lunch.macros.carbs
        + before.rows[0].document.days[0].dinner.macros.carbs
        + before.rows[0].document.days[0].snack.macros.carbs,
      fats: 4
        + before.rows[0].document.days[0].lunch.macros.fats
        + before.rows[0].document.days[0].dinner.macros.fats
        + before.rows[0].document.days[0].snack.macros.fats,
    });
  });

  it("records an unusable generated result and releases the reservation without mutation", async () => {
    await begin();
    const before = await database.query<{ revision: number; document: unknown }>(
      `select revision, document from public.weekly_plans where plan_id = '${currentPlanId}'`,
    );

    const outcome = await rpc("complete_meal_reroll", [
      `'${userId}'`,
      `'${commandId}'`,
      `'${fingerprint}'`,
      `'{"name":"incomplete"}'::jsonb`,
    ].join(", "));
    const after = await database.query<{ revision: number; document: unknown }>(
      `select revision, document from public.weekly_plans where plan_id = '${currentPlanId}'`,
    );
    const reservations = await database.query<{ count: number }>(
      "select count(*)::integer as count from public.weekly_plan_meal_reroll_reservations",
    );

    expect(outcome).toMatchObject({
      status: "failed",
      error: { code: "invalid_plan_document", retryable: false },
    });
    expect(after.rows[0]).toEqual(before.rows[0]);
    expect(reservations.rows[0].count).toBe(0);
  });
});
