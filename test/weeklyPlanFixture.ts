import type { DayPlan, Meal, MealPlan } from "../types";

let ingredientSequence = 1;
const meal = (name: string): Meal => {
  const ingredientId =
    `00000000-0000-4000-8000-${ingredientSequence.toString().padStart(12, "0")}`;
  ingredientSequence += 1;
  return {
    name,
    description: `${name} description`,
    ingredients: ["ingredient"],
    ingredientIds: [ingredientId],
    checkedIngredientIds: [],
    instructions: ["Prepare and serve"],
    macros: { calories: 400, protein: 30, carbs: 40, fats: 12 },
    cookingTimeMinutes: 20,
    prepTimeMinutes: 10,
    portions: 1,
  };
};

const day = (name: string, index: number): DayPlan => ({
  day: name,
  breakfast: meal(index === 0 ? "Test Berry Breakfast" : `${name} Breakfast`),
  lunch: meal(`${name} Lunch`),
  dinner: meal(`${name} Dinner`),
  snack: meal(`${name} Snack`),
  dailySummary: { calories: 1600, protein: 120, carbs: 160, fats: 48 },
});

export const weeklyPlanFixture: MealPlan = {
  weeklySummary: "A balanced test week.",
  days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    .map(day),
};
