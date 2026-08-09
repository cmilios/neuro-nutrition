import {
  UserProfile,
  MealPlan,
  Meal,
  MealFeedback,
  WeeklyPlanCommandOutcome,
  MealRerollCommand,
  NextWeeklyPlanCommand,
  HealthProfilePlanReplacementCommand,
} from "../types";
import { supabase } from "./supabaseClient";

// All AI generation goes through the `generate-meal-plan` Supabase Edge Function,
// which holds the OpenAI API key server-side. supabase-js automatically attaches
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

async function invokeCommand(
  body: Record<string, unknown>,
): Promise<WeeklyPlanCommandOutcome> {
  const { data, error } = await supabase.functions.invoke("generate-meal-plan", {
    body,
  });

  if (error) {
    let message = error.message;
    try {
      const context = (error as { context?: Response }).context;
      const parsed = context && typeof context.json === "function"
        ? await context.json()
        : undefined;
      if (typeof parsed?.error?.message === "string") {
        message = parsed.error.message;
      }
    } catch {
      // A transport failure has an unknown command outcome. The caller retains
      // the command ID and retries the same intent.
    }
    throw new Error(message || "Weekly Plan generation outcome is unknown.");
  }

  if (
    !data ||
    typeof data.commandId !== "string" ||
    !["succeeded", "in_progress", "failed"].includes(data.status)
  ) {
    throw new Error("The Weekly Plan command returned an invalid response.");
  }
  return data as WeeklyPlanCommandOutcome;
}

export const generateInitialWeeklyPlan = (
  profile: UserProfile,
  commandId: string,
): Promise<WeeklyPlanCommandOutcome> =>
  invokeCommand({ action: "plan", commandId, profile });

export const recoverInitialWeeklyPlan = (
  commandId: string,
): Promise<WeeklyPlanCommandOutcome> =>
  invokeCommand({
    action: "plan",
    commandId,
    profile: {},
    resumeExisting: true,
  });

export const generateMealPlan = async (
  profile: UserProfile,
  feedback?: MealFeedback[],
  currentPlan?: MealPlan,
  reviewType?: "empty" | "partial",
): Promise<MealPlan> => {
  const plan = await invokeAI<MealPlan>({
    action: "plan",
    profile,
    feedback,
    currentPlan,
    reviewType,
  });

  if (!Array.isArray(plan.days) || plan.days.length !== 7) {
    throw new Error("The AI returned an incomplete weekly plan. Please try again.");
  }

  return plan;
};

export const generateNextWeeklyPlan = (
  profile: UserProfile,
  command: NextWeeklyPlanCommand,
): Promise<WeeklyPlanCommandOutcome> =>
  invokeCommand({
    action: "plan",
    commandId: command.commandId,
    profile,
    displayedPlanId: command.displayedPlanId,
    displayedRevision: command.displayedRevision,
    feedback: command.feedback,
    currentPlan: command.currentPlan,
    reviewType: command.reviewType,
    resumeExisting: command.resumeExisting,
  });

export const replaceWeeklyPlanFromProfile = (
  profile: UserProfile,
  command: HealthProfilePlanReplacementCommand,
): Promise<WeeklyPlanCommandOutcome> =>
  invokeCommand({
    action: "plan",
    operation: "health_profile_plan_replacement",
    commandId: command.commandId,
    resumeExisting: command.resumeExisting,
    profile,
    displayedPlanId: command.displayedPlanId,
    displayedRevision: command.displayedRevision,
  });

export const regenerateSingleMeal = async (
  profile: UserProfile,
  mealType: string,
  currentMeal: Meal,
): Promise<Meal> => {
  return invokeAI<Meal>({ action: "meal", profile, mealType, currentMeal });
};

export const rerollMeal = (
  profile: UserProfile,
  command: MealRerollCommand,
): Promise<WeeklyPlanCommandOutcome> =>
  invokeCommand({
    action: "meal",
    commandId: command.commandId,
    profile,
    displayedPlanId: command.displayedPlanId,
    displayedRevision: command.displayedRevision,
    day: command.day,
    mealType: command.mealType,
    resumeExisting: command.resumeExisting,
  });
