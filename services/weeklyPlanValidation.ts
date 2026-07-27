import type {
  AuthoritativeWeeklyPlanRow,
  MacroNutrients,
  Meal,
  MealPlan,
} from "../types";

// Keep this boundary validator aligned with private.is_weekly_plan_document in
// the weekly_plans migration: the database protects writes and the client
// independently distrusts every loaded JSON document.
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isNonNegativeNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isNonEmptyString);

const ingredientIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isMacros = (value: unknown): value is MacroNutrients =>
  isRecord(value)
  && isNonNegativeNumber(value.calories)
  && isNonNegativeNumber(value.protein)
  && isNonNegativeNumber(value.carbs)
  && isNonNegativeNumber(value.fats);

const isMeal = (value: unknown): value is Meal => {
  if (!isRecord(value)
    || !isNonEmptyString(value.name)
    || !isNonEmptyString(value.description)
    || !isStringArray(value.ingredients)
    || value.ingredients.length === 0
    || !isStringArray(value.ingredientIds)
    || value.ingredientIds.length !== value.ingredients.length
    || value.ingredientIds.some((identity) => !ingredientIdPattern.test(identity))
    || new Set(value.ingredientIds).size !== value.ingredientIds.length
    || !isStringArray(value.checkedIngredientIds)
    || new Set(value.checkedIngredientIds).size !== value.checkedIngredientIds.length
    || value.checkedIngredientIds.some(
      (identity) => !(value.ingredientIds as string[]).includes(identity),
    )
    || !isStringArray(value.instructions)
    || value.instructions.length === 0
    || !isMacros(value.macros)
    || !isNonNegativeNumber(value.cookingTimeMinutes)
    || !isNonNegativeNumber(value.prepTimeMinutes)
    || !(
      value.portions === undefined
      || value.portions === null
      || (isNonNegativeNumber(value.portions) && value.portions > 0)
    )
    || (value.checkedIngredients !== undefined && !isStringArray(value.checkedIngredients))
  ) {
    return false;
  }

  return true;
};

export const isWeeklyPlan = (value: unknown): value is MealPlan => {
  if (!isRecord(value)
    || !isNonEmptyString(value.weeklySummary)
    || !Array.isArray(value.days)
    || value.days.length !== 7
  ) {
    return false;
  }

  const dayNames = new Set<string>();
  const ingredientIds = new Set<string>();
  for (const day of value.days) {
    if (!isRecord(day)
      || !isNonEmptyString(day.day)
      || !isMeal(day.breakfast)
      || !isMeal(day.lunch)
      || !isMeal(day.dinner)
      || !isMeal(day.snack)
      || !isMacros(day.dailySummary)
    ) {
      return false;
    }
    dayNames.add(day.day);
    for (const meal of [day.breakfast, day.lunch, day.dinner, day.snack]) {
      for (const ingredientId of meal.ingredientIds) {
        if (ingredientIds.has(ingredientId)) return false;
        ingredientIds.add(ingredientId);
      }
    }
  }

  return dayNames.size === 7;
};

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

export const isAuthoritativeWeeklyPlanRow = (
  value: unknown,
  expectedUserId?: string,
): value is AuthoritativeWeeklyPlanRow => {
  const hasGenerationLockFields = isRecord(value)
    && (
      value.nextGenerationId !== undefined
      || value.nextGenerationLockedAt !== undefined
    );
  if (!isRecord(value)
    || !isNonEmptyString(value.planId)
    || !isNonEmptyString(value.userId)
    || (expectedUserId !== undefined && value.userId !== expectedUserId)
    || value.schemaVersion !== 1
    || !Number.isSafeInteger(value.revision)
    || (value.revision as number) < 0
    || value.isActive !== true
    || value.deactivatedAt !== null
    || !isNonEmptyString(value.createdAt)
    || !isNonEmptyString(value.updatedAt)
    || !isNullableString(value.predecessorPlanId)
    || !isNullableString(value.generationId)
    || (
      hasGenerationLockFields
      && (
        !isNullableString(value.nextGenerationId)
        || !isNullableString(value.nextGenerationLockedAt)
        || ((value.nextGenerationId === null) !==
          (value.nextGenerationLockedAt === null))
      )
    )
  ) {
    return false;
  }

  return isWeeklyPlan(value.document);
};

export const requireAuthoritativeWeeklyPlanRow = (
  value: unknown,
  expectedUserId?: string,
): AuthoritativeWeeklyPlanRow => {
  if (!isAuthoritativeWeeklyPlanRow(value, expectedUserId)) {
    throw new Error("The authoritative store returned an invalid Weekly Plan.");
  }
  return value;
};
