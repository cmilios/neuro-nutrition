import {
  NextWeeklyPlanValidationError,
  validateNextWeeklyPlan,
  type WeeklyPlan,
  type MealReviewFeedback,
} from "./nextWeeklyPlan.ts";

export interface GenerationUser {
  id: string;
}

export interface GenerationRequest {
  action: "plan" | "meal";
  profile: Record<string, unknown>;
  feedback?: MealReviewFeedback[];
  mealType?: string;
  currentPlan?: WeeklyPlan;
  reviewType?: "empty" | "partial";
  attempt?: number;
  validationDetails?: string[];
}

export interface ProviderUsageRecord {
  callId: string;
  attempt: number;
  model: string;
  provider: string;
  providerResponseId?: string;
  providerRequestId?: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  totalTokens?: number;
  rawUsage?: Record<string, unknown>;
  outcome: "success" | "failure";
  validationCodes?: string[];
  errorCode?: string;
  estimatedCostUsd?: number;
  pricingVersion?: string;
  pricingSnapshot?: Record<string, unknown>;
}

export interface GenerationResult {
  data: unknown;
  usageRecord: ProviderUsageRecord;
}

export interface GenerationRecord extends ProviderUsageRecord {
  userId: string;
  action: GenerationRequest["action"];
}

export interface GenerateMealPlanDependencies {
  authenticate(request: Request): Promise<GenerationUser>;
  generate(request: GenerationRequest): Promise<GenerationResult>;
  persist(record: GenerationRecord): Promise<void>;
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

export class ProviderGenerationError extends HttpError {
  constructor(
    message: string,
    status: number,
    code: string,
    readonly usageRecord: ProviderUsageRecord,
  ) {
    super(message, status, code);
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "content-type": "application/json" },
});

const allowedMealTypes = new Set(["breakfast", "lunch", "dinner", "snack"]);

function parseGenerationRequest(value: unknown): GenerationRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError("Request body must be valid JSON.", 400, "invalid_json");
  }

  const body = value as Record<string, unknown>;
  if (body.action !== "plan" && body.action !== "meal") {
    throw new HttpError("Invalid action.", 400, "invalid_action");
  }
  if (!body.profile || typeof body.profile !== "object" || Array.isArray(body.profile)) {
    throw new HttpError("Missing profile.", 400, "invalid_profile");
  }
  if (body.feedback !== undefined && (!Array.isArray(body.feedback) || body.feedback.length > 28)) {
    throw new HttpError("Invalid meal feedback.", 400, "invalid_feedback");
  }
  if (body.reviewType !== undefined && body.reviewType !== "empty" && body.reviewType !== "partial") {
    throw new HttpError("Invalid Meal Review type.", 400, "invalid_review_type");
  }
  if (
    body.reviewType === "partial" &&
    (
      !Array.isArray(body.feedback) ||
      body.feedback.length !== 28 ||
      body.feedback.some((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return true;
        const feedback = item as Record<string, unknown>;
        return typeof feedback.day !== "string" ||
          typeof feedback.type !== "string" ||
          typeof feedback.name !== "string" ||
          typeof feedback.cooked !== "boolean" ||
          typeof feedback.liked !== "boolean" ||
          (feedback.liked && !feedback.cooked);
      })
    )
  ) {
    throw new HttpError("Invalid Partial Meal Review.", 400, "invalid_feedback");
  }
  if (
    (body.reviewType === "empty" || body.reviewType === "partial") &&
    (!body.currentPlan || typeof body.currentPlan !== "object" || Array.isArray(body.currentPlan))
  ) {
    throw new HttpError("The current Weekly Plan is required.", 400, "missing_current_plan");
  }
  if (body.reviewType === "partial") {
    const currentPlan = body.currentPlan as { days?: unknown[] };
    const days = Array.isArray(currentPlan.days) ? currentPlan.days : [];
    const expectedSlots = new Map<string, string>();
    for (const value of days) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const day = value as Record<string, unknown>;
      if (typeof day.day !== "string") continue;
      for (const type of allowedMealTypes) {
        const meal = day[type];
        if (meal && typeof meal === "object" && !Array.isArray(meal)) {
          const name = (meal as Record<string, unknown>).name;
          if (typeof name === "string") expectedSlots.set(`${day.day}|${type}`, name);
        }
      }
    }
    const suppliedSlots = new Set<string>();
    for (const value of body.feedback as MealReviewFeedback[]) {
      const type = value.type.toLocaleLowerCase("en-US");
      const key = `${value.day}|${type}`;
      if (
        !allowedMealTypes.has(type) ||
        suppliedSlots.has(key) ||
        expectedSlots.get(key) !== value.name
      ) {
        throw new HttpError("Invalid Partial Meal Review.", 400, "invalid_feedback");
      }
      suppliedSlots.add(key);
    }
    if (expectedSlots.size !== 28 || suppliedSlots.size !== expectedSlots.size) {
      throw new HttpError("Invalid Partial Meal Review.", 400, "invalid_feedback");
    }
  }
  if (body.action === "meal" && (typeof body.mealType !== "string" || !allowedMealTypes.has(body.mealType))) {
    throw new HttpError("Invalid mealType.", 400, "invalid_meal_type");
  }

  return body as unknown as GenerationRequest;
}

export function createGenerateMealPlanHandler(dependencies: GenerateMealPlanDependencies) {
  const persist = async (
    user: GenerationUser,
    request: GenerationRequest,
    usageRecord: ProviderUsageRecord,
  ) => dependencies.persist({
    userId: user.id,
    action: request.action,
    ...usageRecord,
  });
  const persistAndReport = async (
    user: GenerationUser,
    request: GenerationRequest,
    usageRecord: ProviderUsageRecord,
  ) => {
    try {
      await persist(user, request, usageRecord);
    } catch {
      console.error("Failed to persist AI Usage Record after retries", {
        userId: user.id,
        action: request.action,
        callId: usageRecord.callId,
        attempt: usageRecord.attempt,
        providerRequestId: usageRecord.providerRequestId,
        providerResponseId: usageRecord.providerResponseId,
      });
    }
  };

  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    let user: GenerationUser | undefined;
    let generationRequest: GenerationRequest | undefined;
    try {
      if (request.method !== "POST") {
        throw new HttpError("Method not allowed.", 405, "method_not_allowed");
      }

      try {
        user = await dependencies.authenticate(request);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(
          "Your session is invalid or expired. Please log in again.",
          401,
          "unauthorized",
        );
      }

      try {
        generationRequest = parseGenerationRequest(await request.json());
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError("Request body must be valid JSON.", 400, "invalid_json");
      }

      const isNextWeeklyPlanReview =
        generationRequest.action === "plan" &&
        (generationRequest.reviewType === "empty" || generationRequest.reviewType === "partial") &&
        generationRequest.currentPlan;
      let validationDetails: string[] | undefined;

      for (let attempt = 1; attempt <= (isNextWeeklyPlanReview ? 2 : 1); attempt += 1) {
        const attemptRequest = { ...generationRequest, attempt, validationDetails };
        const result = await dependencies.generate(attemptRequest);

        if (isNextWeeklyPlanReview) {
          try {
            const assembledPlan = validateNextWeeklyPlan(
              generationRequest.currentPlan!,
              result.data,
              generationRequest.feedback,
              generationRequest.reviewType,
            );
            await persistAndReport(user, generationRequest, result.usageRecord);
            return json({ data: assembledPlan });
          } catch (error) {
            if (!(error instanceof NextWeeklyPlanValidationError)) throw error;
            validationDetails = error.codes;
            const failedUsage = {
              ...result.usageRecord,
              outcome: "failure" as const,
              validationCodes: error.codes,
              errorCode: "invalid_next_weekly_plan",
            };
            await persistAndReport(user, generationRequest, failedUsage);
            console.error("Next Weekly Plan validation failed", {
              userId: user.id,
              attempt,
              failedRules: error.codes,
              timestamp: new Date().toISOString(),
              providerRequestId: result.usageRecord.providerRequestId,
              providerResponseId: result.usageRecord.providerResponseId,
            });
          }
        } else {
          await persistAndReport(user, generationRequest, result.usageRecord);
          return json({ data: result.data });
        }
      }

      throw new HttpError(
        "A valid Next Weekly Plan was not created. Your current plan is unchanged.",
        422,
        "invalid_next_weekly_plan",
      );
    } catch (error) {
      if (error instanceof ProviderGenerationError && user && generationRequest) {
        try {
          await persist(user, generationRequest, error.usageRecord);
        } catch {
          console.error("Failed to persist AI Usage Record after retries", {
            userId: user.id,
            action: generationRequest.action,
            callId: error.usageRecord.callId,
            attempt: error.usageRecord.attempt,
            providerRequestId: error.usageRecord.providerRequestId,
            providerResponseId: error.usageRecord.providerResponseId,
          });
        }
        console.error("AI provider call failed", {
          userId: user.id,
          action: generationRequest.action,
          attempt: error.usageRecord.attempt,
          errorCode: error.code,
          providerRequestId: error.usageRecord.providerRequestId,
          providerResponseId: error.usageRecord.providerResponseId,
        });
      }

      if (error instanceof HttpError) {
        return json({ error: { code: error.code, message: error.message } }, error.status);
      }
      if (error instanceof DOMException && error.name === "TimeoutError") {
        return json({ error: { code: "ai_timeout", message: "Meal generation took too long. Please try again." } }, 504);
      }
      console.error("generate-meal-plan error:", error);
      return json({
        error: { code: "internal_error", message: "Meal generation failed unexpectedly. Please try again." },
      }, 500);
    }
  };
}
