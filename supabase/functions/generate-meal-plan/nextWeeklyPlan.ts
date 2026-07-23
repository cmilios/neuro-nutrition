const mealTypes = ["breakfast", "lunch", "dinner", "snack"] as const;

type MealType = typeof mealTypes[number];

interface Macros {
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
}

interface Meal {
  name: string;
  description: string;
  ingredients: string[];
  instructions: string[];
  macros: Macros;
  cookingTimeMinutes: number;
  prepTimeMinutes: number;
}

interface DayPlan {
  day: string;
  breakfast: Meal;
  lunch: Meal;
  dinner: Meal;
  snack: Meal;
  dailySummary: Macros;
}

export interface WeeklyPlan {
  weeklySummary: string;
  days: DayPlan[];
}

export class NextWeeklyPlanValidationError extends Error {
  constructor(readonly codes: string[]) {
    super(`Next Weekly Plan failed validation: ${codes.join(", ")}`);
  }
}

const normalize = (value: string) =>
  value.toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const sameMealIdentity = (meal: Meal) => JSON.stringify({
  ingredients: meal.ingredients.map(normalize).sort(),
  preparation: meal.instructions.map(normalize),
});

const exactRecipe = (meal: Meal) => JSON.stringify({
  name: meal.name,
  description: meal.description,
  ingredients: meal.ingredients,
  instructions: meal.instructions,
  macros: meal.macros,
  cookingTimeMinutes: meal.cookingTimeMinutes,
  prepTimeMinutes: meal.prepTimeMinutes,
});

const validMeal = (value: unknown): value is Meal => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const meal = value as Partial<Meal>;
  return typeof meal.name === "string" &&
    typeof meal.description === "string" &&
    Array.isArray(meal.ingredients) &&
    meal.ingredients.every((item) => typeof item === "string") &&
    Array.isArray(meal.instructions) &&
    meal.instructions.every((item) => typeof item === "string") &&
    Boolean(meal.macros) &&
    ["calories", "protein", "carbs", "fats"].every(
      (key) => typeof meal.macros?.[key as keyof Macros] === "number",
    ) &&
    typeof meal.cookingTimeMinutes === "number" &&
    typeof meal.prepTimeMinutes === "number";
};

const validPlan = (value: unknown): value is WeeklyPlan => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const plan = value as Partial<WeeklyPlan>;
  return typeof plan.weeklySummary === "string" &&
    Array.isArray(plan.days) &&
    plan.days.length === 7 &&
    plan.days.every((day) =>
      Boolean(day) &&
      typeof day.day === "string" &&
      mealTypes.every((type) => validMeal(day[type]))
    );
};

const sumMacros = (day: DayPlan): Macros =>
  mealTypes.reduce<Macros>((total, type) => ({
    calories: total.calories + day[type].macros.calories,
    protein: total.protein + day[type].macros.protein,
    carbs: total.carbs + day[type].macros.carbs,
    fats: total.fats + day[type].macros.fats,
  }), { calories: 0, protein: 0, carbs: 0, fats: 0 });

export function validateNextWeeklyPlan(
  currentPlan: WeeklyPlan,
  candidate: unknown,
): WeeklyPlan {
  if (!validPlan(currentPlan) || !validPlan(candidate)) {
    throw new NextWeeklyPlanValidationError(["invalid_weekly_plan_structure"]);
  }

  const previousMeals = currentPlan.days.flatMap((day, dayIndex) =>
    mealTypes.map((mealType) => ({
      dayIndex,
      mealType,
      meal: day[mealType],
      identity: sameMealIdentity(day[mealType]),
      exact: exactRecipe(day[mealType]),
    }))
  );
  const codes = new Set<string>();
  let sameMealCount = 0;
  const retainedMealSources: number[][] = [];

  candidate.days.forEach((day, dayIndex) => {
    mealTypes.forEach((mealType) => {
      const nextMeal = day[mealType];
      const matches = previousMeals.filter(
        (previous) => previous.identity === sameMealIdentity(nextMeal),
      );
      if (matches.length === 0) return;

      sameMealCount += 1;
      const exactMatches = matches.filter(
        (previous) => previous.exact === exactRecipe(nextMeal),
      );
      if (exactMatches.length === 0) {
        codes.add("same_meal_not_exact_copy");
        return;
      }
      const sameTypeMatches = exactMatches.filter(
        (previous) => previous.mealType === mealType,
      );
      if (sameTypeMatches.length === 0) {
        codes.add("retained_meal_changed_meal_type");
        return;
      }
      const rotatedMatches = sameTypeMatches.filter(
        (previous) => previous.dayIndex !== dayIndex,
      );
      if (rotatedMatches.length === 0) {
        codes.add("retained_meal_not_rotated");
        return;
      }
      retainedMealSources.push(rotatedMatches.map((match) => previousMeals.indexOf(match)));
    });
  });

  const sourceAssignments = new Map<number, number>();
  const assignSource = (candidateIndex: number, visited: Set<number>): boolean => {
    for (const sourceIndex of retainedMealSources[candidateIndex]) {
      if (visited.has(sourceIndex)) continue;
      visited.add(sourceIndex);
      const assignedCandidate = sourceAssignments.get(sourceIndex);
      if (
        assignedCandidate === undefined ||
        assignSource(assignedCandidate, visited)
      ) {
        sourceAssignments.set(sourceIndex, candidateIndex);
        return true;
      }
    }
    return false;
  };
  if (
    retainedMealSources.some((_, candidateIndex) =>
      !assignSource(candidateIndex, new Set())
    )
  ) {
    codes.add("retained_meal_source_reused");
  }

  if (sameMealCount > 7) codes.add("too_many_same_meals");
  if (28 - sameMealCount < 21) codes.add("too_few_changes");
  if (codes.size > 0) throw new NextWeeklyPlanValidationError([...codes]);

  return {
    ...candidate,
    days: candidate.days.map((day) => ({
      ...day,
      dailySummary: sumMacros(day),
    })),
  };
}
