// @vitest-environment node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { weeklyPlanFixture } from "../../test/weeklyPlanFixture";

const weeklyPlansMigrationPath = fileURLToPath(new URL(
  "./20260727120000_create_weekly_plans.sql",
  import.meta.url,
));
const commandsMigrationPath = fileURLToPath(new URL(
  "./20260727130000_create_initial_generation_commands.sql",
  import.meta.url,
));
const ingredientProgressMigrationPath = fileURLToPath(new URL(
  "./20260727140000_create_ingredient_progress_commands.sql",
  import.meta.url,
));

const userOne = "00000000-0000-4000-8000-000000000001";
const userTwo = "00000000-0000-4000-8000-000000000002";
const commandOne = "10000000-0000-4000-8000-000000000001";
const commandTwo = "10000000-0000-4000-8000-000000000002";
const commandThree = "10000000-0000-4000-8000-000000000003";
const commandFour = "10000000-0000-4000-8000-000000000004";

type PlanState = {
  plan_id: string;
  revision: number;
  document: {
    days: Array<{
      day: string;
      breakfast: {
        ingredients: string[];
        ingredientIds: string[];
        checkedIngredientIds: string[];
      };
    }>;
  };
};

describe("ingredient progress database command", () => {
  let database: PGlite;
  let planId: string;

  const currentPlan = async () => {
    const result = await database.query<PlanState>(`
      select plan_id, revision, document
      from public.weekly_plans
      where user_id = '${userOne}'
      order by created_at desc
      limit 1
    `);
    return result.rows[0];
  };

  const setIngredientChecked = async (input: {
    userId?: string;
    commandId: string;
    displayedRevision: number;
    ingredientId: string;
    checked: boolean;
    targetPlanId?: string;
  }) => {
    await database.exec(`
      set role authenticated;
      set "request.jwt.claim.sub" = '${input.userId ?? userOne}';
    `);
    try {
      const result = await database.query<{ outcome: Record<string, unknown> }>(`
        select public.set_ingredient_checked(
          '${input.targetPlanId ?? planId}',
          ${input.displayedRevision},
          'Monday',
          'breakfast',
          '${input.ingredientId}',
          ${input.checked},
          '${input.commandId}'
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
      insert into auth.users (id) values ('${userOne}'), ('${userTwo}');
      create function auth.uid() returns uuid
      language sql stable
      as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
    `);
    await database.exec(await readFile(weeklyPlansMigrationPath, "utf8"));
    await database.exec(await readFile(commandsMigrationPath, "utf8"));

    const legacyDocument = structuredClone(weeklyPlanFixture);
    legacyDocument.days[0].breakfast.ingredients = ["salt", "salt", "pepper"];
    legacyDocument.days[0].breakfast.checkedIngredients = ["salt"];
    delete (legacyDocument.days[0].breakfast as Partial<
      typeof legacyDocument.days[0]["breakfast"]
    >).ingredientIds;
    delete (legacyDocument.days[0].breakfast as Partial<
      typeof legacyDocument.days[0]["breakfast"]
    >).checkedIngredientIds;
    const serialized = JSON.stringify(legacyDocument).replaceAll("'", "''");
    await database.exec("set role service_role;");
    const inserted = await database.query<{ plan_id: string }>(`
      insert into public.weekly_plans (user_id, document)
      values ('${userOne}', '${serialized}'::jsonb)
      returning plan_id
    `);
    await database.exec("reset role;");
    planId = inserted.rows[0].plan_id;

    await database.exec(await readFile(ingredientProgressMigrationPath, "utf8"));
  });

  afterEach(async () => {
    await database.close();
  });

  it("assigns a stable identity to every occurrence and preserves repeated-label progress", async () => {
    const plan = await currentPlan();
    const breakfast = plan.document.days[0].breakfast;

    expect(breakfast.ingredientIds).toHaveLength(3);
    expect(new Set(breakfast.ingredientIds).size).toBe(3);
    expect(breakfast.checkedIngredientIds).toEqual([
      breakfast.ingredientIds[0],
      breakfast.ingredientIds[1],
    ]);
  });

  it("sets one repeated occurrence explicitly and increments revision exactly once", async () => {
    const before = await currentPlan();
    const breakfast = before.document.days[0].breakfast;

    const outcome = await setIngredientChecked({
      commandId: commandOne,
      displayedRevision: before.revision,
      ingredientId: breakfast.ingredientIds[1],
      checked: false,
    });

    expect(outcome).toMatchObject({
      commandId: commandOne,
      status: "succeeded",
      error: null,
      result: {
        planId,
        revision: before.revision + 1,
      },
    });
    const after = await currentPlan();
    expect(after.revision).toBe(before.revision + 1);
    expect(after.document.days[0].breakfast.checkedIngredientIds).toEqual([
      breakfast.ingredientIds[0],
    ]);
  });

  it("replays safely, treats an existing state as success, and accepts an older active revision", async () => {
    const initial = await currentPlan();
    const ingredientId = initial.document.days[0].breakfast.ingredientIds[2];
    const first = await setIngredientChecked({
      commandId: commandOne,
      displayedRevision: initial.revision,
      ingredientId,
      checked: true,
    });

    await expect(setIngredientChecked({
      commandId: commandOne,
      displayedRevision: initial.revision,
      ingredientId,
      checked: true,
    })).resolves.toEqual(first);

    const afterFirst = await currentPlan();
    await expect(setIngredientChecked({
      commandId: commandTwo,
      displayedRevision: afterFirst.revision,
      ingredientId,
      checked: true,
    })).resolves.toMatchObject({
      status: "succeeded",
      result: { revision: afterFirst.revision },
    });
    expect((await currentPlan()).revision).toBe(afterFirst.revision);

    await expect(setIngredientChecked({
      commandId: commandThree,
      displayedRevision: initial.revision,
      ingredientId,
      checked: false,
    })).resolves.toMatchObject({
      status: "succeeded",
      result: { revision: afterFirst.revision + 1 },
    });
  });

  it("rejects command ID reuse, missing ingredients, inactive plans, and another user's target without mutation", async () => {
    const initial = await currentPlan();
    const ingredientId = initial.document.days[0].breakfast.ingredientIds[2];
    await setIngredientChecked({
      commandId: commandOne,
      displayedRevision: initial.revision,
      ingredientId,
      checked: true,
    });
    const changed = await currentPlan();

    await expect(setIngredientChecked({
      commandId: commandOne,
      displayedRevision: initial.revision,
      ingredientId,
      checked: false,
    })).resolves.toMatchObject({
      status: "failed",
      error: { code: "idempotency_key_reused", retryable: false },
    });
    await expect(setIngredientChecked({
      commandId: commandTwo,
      displayedRevision: changed.revision,
      ingredientId: "20000000-0000-4000-8000-000000000099",
      checked: true,
    })).resolves.toMatchObject({
      status: "failed",
      error: { code: "ingredient_not_found", retryable: false },
    });
    await expect(setIngredientChecked({
      userId: userTwo,
      commandId: commandThree,
      displayedRevision: changed.revision,
      ingredientId,
      checked: false,
    })).resolves.toMatchObject({
      status: "failed",
      error: { code: "stale_plan", retryable: false },
    });
    expect((await currentPlan()).revision).toBe(changed.revision);

    await database.exec(`
      set role service_role;
      update public.weekly_plans
      set is_active = false, deactivated_at = now()
      where plan_id = '${planId}';
      reset role;
    `);
    await expect(setIngredientChecked({
      commandId: commandFour,
      displayedRevision: changed.revision,
      ingredientId,
      checked: false,
    })).resolves.toMatchObject({
      status: "failed",
      error: { code: "stale_plan", retryable: false },
    });
    expect((await currentPlan()).revision).toBe(changed.revision);
  });
});
