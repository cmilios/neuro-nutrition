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
  portions?: number | null;
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

export interface MealReviewFeedback {
  day: string;
  type: string;
  name: string;
  cooked: boolean;
  liked: boolean;
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
  portions: meal.portions ?? null,
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
      (key) => {
        const value = meal.macros?.[key as keyof Macros];
        return typeof value === "number" && Number.isFinite(value) && value >= 0;
      },
    ) &&
    typeof meal.cookingTimeMinutes === "number" &&
    typeof meal.prepTimeMinutes === "number" &&
    (meal.portions === undefined || meal.portions === null ||
      (typeof meal.portions === "number" && meal.portions > 0));
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
  feedback: MealReviewFeedback[] = [],
  reviewType: "empty" | "partial" = "empty",
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
  const candidateMeals: Array<{
    dayIndex: number;
    mealType: MealType;
    identity: string;
    exact: string;
  }> = [];

  candidate.days.forEach((day, dayIndex) => {
    mealTypes.forEach((mealType) => {
      const nextMeal = day[mealType];
      candidateMeals.push({
        dayIndex,
        mealType,
        identity: sameMealIdentity(nextMeal),
        exact: exactRecipe(nextMeal),
      });
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

  if (reviewType === "partial") {
    const feedbackBySlot = new Map(
      feedback.map((item) => [
        `${item.day}|${item.type.toLocaleLowerCase("en-US")}`,
        item,
      ]),
    );
    if (feedbackBySlot.size !== 28) {
      codes.add("invalid_partial_meal_review");
    } else {
      previousMeals.forEach((previous) => {
        const day = currentPlan.days[previous.dayIndex];
        const outcome = feedbackBySlot.get(`${day.day}|${previous.mealType}`);
        if (!outcome) {
          codes.add("invalid_partial_meal_review");
          return;
        }

        const matches = candidateMeals.filter(
          (next) => next.identity === previous.identity,
        );
        if (outcome.liked) {
          const retainedExactly = matches.some(
            (next) =>
              next.exact === previous.exact &&
              next.mealType === previous.mealType &&
              next.dayIndex !== previous.dayIndex,
          );
          if (!outcome.cooked || !retainedExactly) {
            codes.add("liked_meal_not_retained");
          }
        }
      });

      const identities = new Set(previousMeals.map((previous) => previous.identity));
      identities.forEach((identity) => {
        const likedCount = previousMeals.filter((previous) => {
          if (previous.identity !== identity) return false;
          const day = currentPlan.days[previous.dayIndex];
          return feedbackBySlot.get(`${day.day}|${previous.mealType}`)?.liked === true;
        }).length;
        const retainedCount = candidateMeals.filter(
          (next) => next.identity === identity,
        ).length;
        if (retainedCount > likedCount) {
          codes.add("reviewed_meal_not_replaced");
        }
      });

      const exactRecipeGroups = new Set(
        previousMeals.map((previous) => `${previous.mealType}|${previous.exact}`),
      );
      exactRecipeGroups.forEach((group) => {
        const separator = group.indexOf("|");
        const mealType = group.slice(0, separator) as MealType;
        const exact = group.slice(separator + 1);
        const likedCount = previousMeals.filter((previous) => {
          if (previous.mealType !== mealType || previous.exact !== exact) return false;
          const day = currentPlan.days[previous.dayIndex];
          return feedbackBySlot.get(`${day.day}|${previous.mealType}`)?.liked === true;
        }).length;
        const retainedCount = candidateMeals.filter(
          (next) => next.mealType === mealType && next.exact === exact,
        ).length;
        if (retainedCount < likedCount) {
          codes.add("liked_meal_not_retained");
        }
      });
    }
  } else {
    if (sameMealCount > 7) codes.add("too_many_same_meals");
    if (28 - sameMealCount < 21) codes.add("too_few_changes");
  }

  const precedingAverageCalories =
    currentPlan.days.reduce((total, day) => total + sumMacros(day).calories, 0) /
    currentPlan.days.length;
  const calorieFloor = precedingAverageCalories * 0.7;
  const calorieCeiling = precedingAverageCalories * 1.3;
  if (
    precedingAverageCalories <= 0 ||
    candidate.days.some((day) => {
      const calories = sumMacros(day).calories;
      return calories < calorieFloor || calories > calorieCeiling;
    })
  ) {
    codes.add("nutritionally_unbalanced");
  }
  if (codes.size > 0) throw new NextWeeklyPlanValidationError([...codes]);

  return {
    ...candidate,
    days: candidate.days.map((day) => ({
      ...day,
      dailySummary: sumMacros(day),
    })),
  };
}
