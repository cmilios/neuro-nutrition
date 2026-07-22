import { UserProfile, MealPlan, Meal, MealFeedback } from "../types";
import { supabase } from "./supabaseClient";

// All AI generation goes through the `generate-meal-plan` Supabase Edge Function,
// which holds the Claude API key server-side. supabase-js automatically attaches
// the signed-in user's access token, so only authenticated users can call it.

async function invokeAI<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("generate-meal-plan", {
    body,
  });

  if (error) {
    // Try to surface the function's own error message (it's in the response body).
    let message = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        const parsed = await ctx.json();
        if (typeof parsed?.error === "string") {
          message = parsed.error;
        } else if (typeof parsed?.error?.message === "string") {
          message = parsed.error.message;
        }
      }
    } catch {
      // ignore — fall back to the generic message
    }
    throw new Error(message || "AI request failed");
  }

  if (data?.error) throw new Error(data.error);
  if (!data?.data) throw new Error("No data returned from AI service.");

  return data.data as T;
}

export const generateMealPlan = async (
  profile: UserProfile,
  feedback?: MealFeedback[],
): Promise<MealPlan> => {
  const plan = await invokeAI<MealPlan>({ action: "plan", profile, feedback });

  if (!Array.isArray(plan.days) || plan.days.length !== 7) {
    throw new Error("The AI returned an incomplete weekly plan. Please try again.");
  }

  return plan;
};

export const regenerateSingleMeal = async (
  profile: UserProfile,
  mealType: string,
): Promise<Meal> => {
  return invokeAI<Meal>({ action: "meal", profile, mealType });
};
