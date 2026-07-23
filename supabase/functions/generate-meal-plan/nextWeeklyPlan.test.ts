// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  NextWeeklyPlanValidationError,
  validateNextWeeklyPlan,
} from "./nextWeeklyPlan";

const mealTypes = ["breakfast", "lunch", "dinner", "snack"] as const;
const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const meal = (id: string) => ({
  name: `Meal ${id}`,
  description: `Description ${id}`,
  ingredients: [`Ingredient ${id}`, "Salt"],
  instructions: [`Prepare ${id}`, "Serve"],
  macros: { calories: 100, protein: 10, carbs: 20, fats: 5 },
  cookingTimeMinutes: 10,
  prepTimeMinutes: 5,
});

const plan = (prefix: string) => ({
  weeklySummary: `${prefix} week`,
  days: days.map((day, dayIndex) => ({
    day,
    ...Object.fromEntries(mealTypes.map((type) => [type, meal(`${prefix}-${dayIndex}-${type}`)])),
    dailySummary: { calories: 0, protein: 0, carbs: 0, fats: 0 },
  })),
});

const currentPlan = plan("old");

const withCarryovers = (count: number) => {
  const candidate = plan("new");
  for (let index = 0; index < count; index += 1) {
    const type = mealTypes[index % mealTypes.length];
    const oldDay = Math.floor(index / mealTypes.length);
    const newDay = (oldDay + 1) % days.length;
    candidate.days[newDay][type] = structuredClone(currentPlan.days[oldDay][type]);
  }
  return candidate;
};

const feedback = (likedSlots: number[]) =>
  currentPlan.days.flatMap((day, dayIndex) =>
    mealTypes.map((type, typeIndex) => ({
      day: day.day,
      type,
      name: day[type].name,
      cooked: likedSlots.includes(dayIndex * mealTypes.length + typeIndex),
      liked: likedSlots.includes(dayIndex * mealTypes.length + typeIndex),
    }))
  );

describe("Next Weekly Plan validation", () => {
  it.each([0, 7])("accepts and assembles a plan with %i intentionally retained Same Meals", (count) => {
    const result = validateNextWeeklyPlan(currentPlan, withCarryovers(count));

    expect(result.days).toHaveLength(7);
    expect(result.days[0].dailySummary).toEqual({
      calories: 400,
      protein: 40,
      carbs: 80,
      fats: 20,
    });
  });

  it("rejects more than seven Same Meals and fewer than twenty-one changes", () => {
    expect(() => validateNextWeeklyPlan(currentPlan, withCarryovers(8)))
      .toThrowError(expect.objectContaining({
        codes: expect.arrayContaining(["too_many_same_meals", "too_few_changes"]),
      }));
  });

  it("requires retained Same Meals to move to another day", () => {
    const candidate = withCarryovers(0);
    candidate.days[0].breakfast = structuredClone(currentPlan.days[0].breakfast);

    expect(() => validateNextWeeklyPlan(currentPlan, candidate))
      .toThrowError(expect.objectContaining({ codes: ["retained_meal_not_rotated"] }));
  });

  it("recognizes renamed meals by normalized ingredients and preparation", () => {
    const candidate = withCarryovers(0);
    candidate.days[1].breakfast = {
      ...structuredClone(currentPlan.days[0].breakfast),
      name: "A completely different display name",
      ingredients: [" salt ", "INGREDIENT OLD-0-BREAKFAST"],
      instructions: [" prepare   old-0-breakfast! ", "SERVE"],
    };

    expect(() => validateNextWeeklyPlan(currentPlan, candidate))
      .toThrowError(expect.objectContaining({ codes: ["same_meal_not_exact_copy"] }));
  });

  it("accepts a qualifying rotated source when the prior week contains duplicate recipes", () => {
    const previous = structuredClone(currentPlan);
    previous.days[1].breakfast = structuredClone(previous.days[0].breakfast);
    const candidate = withCarryovers(0);
    candidate.days[0].breakfast = structuredClone(previous.days[0].breakfast);

    expect(() => validateNextWeeklyPlan(previous, candidate)).not.toThrow();
  });

  it("does not retain one predecessor Meal in multiple Meal Slots", () => {
    const candidate = withCarryovers(0);
    candidate.days[1].breakfast = structuredClone(currentPlan.days[0].breakfast);
    candidate.days[2].breakfast = structuredClone(currentPlan.days[0].breakfast);

    expect(() => validateNextWeeklyPlan(currentPlan, candidate))
      .toThrowError(expect.objectContaining({ codes: ["retained_meal_source_reused"] }));
  });

  it("reports incomplete plan structure", () => {
    const candidate = withCarryovers(0);
    candidate.days.pop();

    expect(() => validateNextWeeklyPlan(currentPlan, candidate))
      .toThrow(NextWeeklyPlanValidationError);
  });

  it("retains exactly the Liked Meals and replaces Disliked and Uncooked Meals", () => {
    const candidate = withCarryovers(0);
    candidate.days[1].breakfast = structuredClone(currentPlan.days[0].breakfast);
    candidate.days[2].lunch = structuredClone(currentPlan.days[1].lunch);

    const result = validateNextWeeklyPlan(
      currentPlan,
      candidate,
      feedback([0, 5]),
      "partial",
    );

    expect(result.days[1].breakfast).toEqual(currentPlan.days[0].breakfast);
    expect(result.days[2].lunch).toEqual(currentPlan.days[1].lunch);
  });

  it("rejects a Partial Meal Review result that drops a Liked Meal or retains an Uncooked Meal", () => {
    const candidate = withCarryovers(0);
    candidate.days[1].lunch = structuredClone(currentPlan.days[1].lunch);

    expect(() => validateNextWeeklyPlan(
      currentPlan,
      candidate,
      feedback([0]),
      "partial",
    )).toThrowError(expect.objectContaining({
      codes: expect.arrayContaining([
        "liked_meal_not_retained",
        "reviewed_meal_not_replaced",
      ]),
    }));
  });

  it("accepts a Proven Weekly Plan successor with all exact recipes rotated by day", () => {
    const candidate = withCarryovers(28);

    const result = validateNextWeeklyPlan(
      currentPlan,
      candidate,
      feedback(Array.from({ length: 28 }, (_, index) => index)),
      "partial",
    );

    expect(result.days).toHaveLength(7);
  });

  it("rejects a successor whose daily calories are not balanced around the preceding plan", () => {
    const candidate = withCarryovers(0);
    candidate.days[0].breakfast.macros.calories = 5_000;

    expect(() => validateNextWeeklyPlan(currentPlan, candidate))
      .toThrowError(expect.objectContaining({
        codes: expect.arrayContaining(["nutritionally_unbalanced"]),
      }));
  });
});
