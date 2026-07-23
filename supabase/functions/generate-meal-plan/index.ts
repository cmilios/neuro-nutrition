// Supabase Edge Function: generate-meal-plan
//
// Server-side proxy to the OpenAI Responses API. The OpenAI API key lives ONLY
// here, as a Supabase secret (OPENAI_API_KEY) — it is never shipped
// to the browser. The browser calls this function with the signed-in user's
// Supabase JWT; the platform verifies that JWT (keep `verify_jwt` enabled), so
// only authenticated users can generate plans.
//
// Deploy:  supabase functions deploy generate-meal-plan --project-ref <ref>
// Secrets: supabase secrets set OPENAI_API_KEY=sk-...  --project-ref <ref>
//          (optional) supabase secrets set OPENAI_MODEL=gpt-5.6-sol

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createGenerateMealPlanHandler,
  HttpError,
  ProviderGenerationError,
  type GenerationRecord,
  type GenerationRequest,
  type GenerationResult,
} from "./handler.ts";
import { createOpenAIUsageRecord } from "./usage.ts";
import { persistUsageRecordToSupabase } from "./persistence.ts";

const OPENAI_API_URL = "https://api.openai.com/v1/responses";
// The current recommended GPT-5.6 coding/reasoning model is the default. The
// OPENAI_MODEL secret can override it without a code deployment.
const DEFAULT_MODEL = "gpt-5.6-sol";

// ---- JSON schemas (structured outputs) -------------------------------------
// Every object needs additionalProperties:false and a full `required` list.

const macroSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    calories: { type: "number" },
    protein: { type: "number" },
    carbs: { type: "number" },
    fats: { type: "number" },
  },
  required: ["calories", "protein", "carbs", "fats"],
};

const mealSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    ingredients: { type: "array", items: { type: "string" } },
    instructions: {
      type: "array",
      items: { type: "string" },
      description: "Step-by-step cooking instructions.",
    },
    macros: macroSchema,
    cookingTimeMinutes: { type: "number" },
    prepTimeMinutes: { type: "number" },
    portions: {
      type: ["number", "null"],
      description: "Number of servings produced by this recipe.",
    },
  },
  required: [
    "name",
    "description",
    "ingredients",
    "instructions",
    "macros",
    "cookingTimeMinutes",
    "prepTimeMinutes",
    "portions",
  ],
};

const dayPlanSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    day: { type: "string", description: "Day of the week (e.g., Monday)" },
    breakfast: mealSchema,
    lunch: mealSchema,
    dinner: mealSchema,
    snack: mealSchema,
    dailySummary: macroSchema,
  },
  required: ["day", "breakfast", "lunch", "dinner", "snack", "dailySummary"],
};

const mealPlanSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    weeklySummary: {
      type: "string",
      description: "A brief nutritional advice summary based on biometrics.",
    },
    days: {
      type: "array",
      items: dayPlanSchema,
      description: "Exactly seven entries, one for each day of the week.",
    },
  },
  required: ["weeklySummary", "days"],
};

// ---- Prompt building --------------------------------------------------------

interface Profile {
  age: number;
  gender: string;
  heightCm: number;
  weightKg: number;
  targetWeightKg?: number;
  activityLevel: string;
  goal: string;
  dietType: string;
  allergies?: string;
}

interface Feedback {
  name: string;
  cooked: boolean;
  liked: boolean;
}

const allowedMealTypes = new Set(["breakfast", "lunch", "dinner", "snack"]);

function assertValidProfile(value: unknown): asserts value is Profile {
  if (!value || typeof value !== "object") {
    throw new HttpError("Missing profile.", 400, "invalid_profile");
  }

  const profile = value as Record<string, unknown>;
  const numericRanges: Array<[string, number, number]> = [
    ["age", 10, 120],
    ["heightCm", 80, 250],
    ["weightKg", 20, 500],
  ];

  for (const [field, min, max] of numericRanges) {
    const number = profile[field];
    if (typeof number !== "number" || !Number.isFinite(number) || number < min || number > max) {
      throw new HttpError(`Invalid ${field}.`, 400, "invalid_profile");
    }
  }

  if (profile.targetWeightKg !== undefined) {
    const target = profile.targetWeightKg;
    if (typeof target !== "number" || !Number.isFinite(target) || target < 20 || target > 500) {
      throw new HttpError("Invalid targetWeightKg.", 400, "invalid_profile");
    }
  }

  for (const field of ["gender", "activityLevel", "goal", "dietType"]) {
    if (typeof profile[field] !== "string" || !profile[field]) {
      throw new HttpError(`Invalid ${field}.`, 400, "invalid_profile");
    }
  }
}

async function requireAuthenticatedUser(req: Request): Promise<{ id: string }> {
  const authorization = req.headers.get("Authorization");
  const token = authorization?.replace(/^Bearer\s+/i, "");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!token || !supabaseUrl || !anonKey) {
    throw new HttpError("Authentication required.", 401, "unauthorized");
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
    },
  });

  if (!response.ok) {
    throw new HttpError("Your session is invalid or expired. Please log in again.", 401, "unauthorized");
  }

  const user = await response.json();
  if (!user?.id) {
    throw new HttpError("Your session is invalid or expired. Please log in again.", 401, "unauthorized");
  }
  return { id: user.id };
}

function buildPlanPrompt(profile: Profile, feedback?: Feedback[]): string {
  let feedbackPrompt = "";
  if (feedback && feedback.length > 0) {
    const liked = feedback.filter((f) => f.liked).map((f) => f.name).join(", ");
    const disliked = feedback
      .filter((f) => f.cooked && !f.liked)
      .map((f) => f.name)
      .join(", ");
    const skipped = feedback
      .filter((f) => !f.cooked)
      .map((f) => f.name)
      .join(", ");
    feedbackPrompt = `
    PREVIOUS WEEK REVIEW:
    - LIKED (do more of this style/ingredients): ${liked || "None"}
    - COOKED BUT DISLIKED (avoid this style): ${disliked || "None"}
    - SKIPPED/DID NOT COOK (maybe too complex or unappealing): ${skipped || "None"}

    Optimize the new plan to lean towards the LIKED meals and avoid the DISLIKED ones.
    `;
  }

  return `
    Act as a world-class nutritionist.
    Generate a 7-day meal plan for a user with the following biometrics:
    - Age: ${profile.age}
    - Gender: ${profile.gender}
    - Height: ${profile.heightCm} cm
    - Current Weight: ${profile.weightKg} kg
    - Target Weight: ${profile.targetWeightKg ? profile.targetWeightKg + " kg" : "Not specified"}
    - Activity Level: ${profile.activityLevel}
    - Goal: ${profile.goal}
    - Diet Preference: ${profile.dietType}
    - Allergies/Restrictions: ${profile.allergies || "None"}

    ${feedbackPrompt}

    Calculate their TDEE (Total Daily Energy Expenditure) and adjust the daily caloric
    intake according to their Goal (deficit for weight loss, surplus for muscle gain).
    Ensure each day has a Breakfast, Lunch, Dinner, and Snack.
    Provide step-by-step cooking instructions and separate prep time vs cooking time.
    Ensure the dailySummary macros are the sum of that day's four meals.
  `;
}

function buildNextWeeklyPlanPrompt(request: GenerationRequest, profile: Profile): string {
  const currentPlan = JSON.stringify(request.currentPlan);
  const review = request.reviewType === "partial"
    ? `
    This is a Partial Meal Review. Its normalized outcomes for all twenty-eight
    Meal Slots are:
    ${JSON.stringify(request.feedback)}

    Retain every Liked Meal as an exact recipe copy, including its ingredients,
    preparation, portions, and macros. Keep its meal type and move it to a
    different day. Replace every Disliked and Uncooked Meal with a meal that is
    not the Same Meal. If all twenty-eight meals are liked, create a Proven
    Weekly Plan successor by retaining and rotating all twenty-eight exact recipes.
    `
    : `
    This is an Empty Meal Review. Intentionally retain between zero and seven
    Same Meals only when doing so improves nutritional balance and weekly variety.
    Do not choose retained meals randomly. Change at least twenty-one meals.
    `;
  const repair = request.validationDetails?.length
    ? `The previous result failed these rules: ${request.validationDetails.join(", ")}. Repair every listed rule.`
    : "";

  return `
    Act as a world-class nutritionist.
    Create the Next Weekly Plan from the immediately preceding Weekly Plan only.
    The complete immediately preceding Weekly Plan is:
    ${currentPlan}

    ${review}

    A retained Same Meal must be an exact recipe copy, keep its meal type, and move to a
    different day. A renamed meal with the same normalized ingredients and
    preparation is still the Same Meal.
    Return exactly seven days with breakfast, lunch, dinner, and snack, and
    recalculate each daily macro summary from those four meals.
    Build replacement meals around the retained meals so each day remains
    nutritionally balanced for the user's profile and goal.

    Continue to respect this profile:
    - Age: ${profile.age}
    - Gender: ${profile.gender}
    - Height: ${profile.heightCm} cm
    - Current Weight: ${profile.weightKg} kg
    - Target Weight: ${profile.targetWeightKg ? profile.targetWeightKg + " kg" : "Not specified"}
    - Activity Level: ${profile.activityLevel}
    - Goal: ${profile.goal}
    - Diet Preference: ${profile.dietType}
    - Allergies/Restrictions: ${profile.allergies || "None"}

    ${repair}
  `;
}

function buildMealPrompt(profile: Profile, mealType: string): string {
  return `
    Act as a world-class nutritionist.
    Generate a single delicious ${mealType} option for a user with this profile:
    - Goal: ${profile.goal}
    - Diet: ${profile.dietType}
    - Allergies: ${profile.allergies || "None"}

    Ensure the meal is balanced and appropriate for the requested meal type.
    Include detailed step-by-step cooking instructions and prep/cook times.
  `;
}

// ---- OpenAI call ------------------------------------------------------------

async function callOpenAI(
  apiKey: string,
  model: string,
  prompt: string,
  schemaName: string,
  schema: unknown,
  maxTokens: number,
  attempt = 1,
): Promise<GenerationResult> {
  const callId = crypto.randomUUID();
  let res: Response;
  try {
    res = await fetch(OPENAI_API_URL, {
      method: "POST",
      signal: AbortSignal.timeout(120_000),
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        // Profiles contain health-related data; do not retain API responses.
        store: false,
        input: [{ role: "user", content: prompt }],
        reasoning: { effort: "low" },
        max_output_tokens: maxTokens,
        text: {
          format: {
            type: "json_schema",
            name: schemaName,
            strict: true,
            schema,
          },
        },
      }),
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    const code = timedOut ? "ai_timeout" : "ai_provider_error";
    throw new ProviderGenerationError(
      timedOut
        ? "Meal generation took too long. Please try again."
        : "The AI provider request failed. Please try again later.",
      timedOut ? 504 : 502,
      code,
      createOpenAIUsageRecord({
        callId,
        attempt,
        configuredModel: model,
        outcome: "failure",
        errorCode: code,
      }),
    );
  }

  const requestId = res.headers.get("x-request-id") || undefined;

  if (!res.ok) {
    let errText = "";
    try {
      errText = await res.text();
    } catch {
      // The status and request ID still identify this provider attempt even if
      // the response body stream cannot be read.
    }
    let providerMessage = "";
    let providerCode = "";
    let errorBody: Record<string, unknown> | undefined;

    try {
      const parsed = JSON.parse(errText);
      if (parsed && typeof parsed === "object") errorBody = parsed;
      const providerError = errorBody?.error as Record<string, unknown> | undefined;
      providerMessage = typeof providerError?.message === "string" ? providerError.message : "";
      const rawProviderCode = providerError?.code ?? providerError?.type;
      providerCode = typeof rawProviderCode === "string" ? rawProviderCode : "";
    } catch {
      // The provider occasionally returns a non-JSON gateway response.
    }

    const normalizedMessage = providerMessage.toLowerCase();
    let httpError: HttpError;
    if (
      providerCode === "insufficient_quota" ||
      normalizedMessage.includes("quota") ||
      normalizedMessage.includes("billing") ||
      normalizedMessage.includes("credit")
    ) {
      httpError = new HttpError(
        "Meal generation is unavailable because the OpenAI API account has no remaining quota. Add API billing or credits in the OpenAI Platform, then try again.",
        402,
        "ai_credits_exhausted",
      );
    } else if (res.status === 401 || res.status === 403) {
      httpError = new HttpError(
        "The AI provider credentials are invalid. Update the server-side OpenAI API key.",
        503,
        "ai_provider_auth_failed",
      );
    } else if (res.status === 429) {
      httpError = new HttpError(
        "The AI provider is rate-limiting requests. Please wait a moment and try again.",
        429,
        "ai_rate_limited",
      );
    } else {
      httpError = new HttpError(
        "The AI provider rejected the generation request. Please try again later.",
        502,
        "ai_provider_error",
      );
    }

    throw new ProviderGenerationError(
      httpError.message,
      httpError.status,
      httpError.code,
      createOpenAIUsageRecord({
        callId,
        attempt,
        configuredModel: model,
        providerRequestId: requestId,
        response: errorBody,
        outcome: "failure",
        errorCode: httpError.code,
      }),
    );
  }

  let responseBody: Record<string, unknown>;
  try {
    const parsed: unknown = await res.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new TypeError("Provider response must be a JSON object");
    }
    responseBody = parsed as Record<string, unknown>;
  } catch {
    throw new ProviderGenerationError(
      "The AI returned an invalid response. Please retry.",
      502,
      "ai_invalid_response",
      createOpenAIUsageRecord({
        callId,
        attempt,
        configuredModel: model,
        providerRequestId: requestId,
        outcome: "failure",
        errorCode: "ai_invalid_response",
      }),
    );
  }
  const failure = (message: string, status: number, code: string) =>
    new ProviderGenerationError(
      message,
      status,
      code,
      createOpenAIUsageRecord({
        callId,
        attempt,
        configuredModel: model,
        providerRequestId: requestId,
        response: responseBody,
        outcome: "failure",
        errorCode: code,
      }),
    );

  if (
    responseBody.status === "incomplete" &&
    (responseBody.incomplete_details as { reason?: string } | undefined)?.reason === "max_output_tokens"
  ) {
    throw failure("The response was too long and was cut off. Please retry.", 502, "ai_response_truncated");
  }

  const output = Array.isArray(responseBody.output) ? responseBody.output : [];
  const contentBlocks = output
    .filter((item): item is { type?: string; content?: unknown[] } =>
      Boolean(item && typeof item === "object" && (item as { type?: string }).type === "message")
    )
    .flatMap((item) => item.content || [])
    .filter((block): block is Record<string, unknown> =>
      Boolean(block && typeof block === "object")
    );
  const refusalBlock = contentBlocks.find((block) => block.type === "refusal");
  if (refusalBlock) {
    throw failure("The AI declined to generate this content.", 422, "ai_refusal");
  }

  const textBlock = contentBlocks.find((block) => block.type === "output_text");
  if (typeof textBlock?.text !== "string" || !textBlock.text) {
    throw failure("No content returned from the AI.", 502, "ai_empty_response");
  }

  try {
    return {
      data: JSON.parse(textBlock.text),
      usageRecord: createOpenAIUsageRecord({
        callId,
        attempt,
        configuredModel: model,
        providerRequestId: requestId,
        response: responseBody,
        outcome: "success",
      }),
    };
  } catch {
    throw failure("The AI returned an invalid structured response. Please retry.", 502, "ai_invalid_response");
  }
}

// ---- Deployed dependency wiring --------------------------------------------

async function generate(request: GenerationRequest): Promise<GenerationResult> {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      throw new HttpError(
        "Meal generation is not configured. Add the server-side OpenAI API key.",
        503,
        "ai_not_configured",
      );
    }
    const model = Deno.env.get("OPENAI_MODEL") || DEFAULT_MODEL;

    const { action, profile, feedback, mealType, attempt = 1 } = request;
    assertValidProfile(profile);

    if (action === "meal") {
      if (typeof mealType !== "string" || !allowedMealTypes.has(mealType)) {
        throw new HttpError("Invalid mealType.", 400, "invalid_meal_type");
      }
      return callOpenAI(
        apiKey,
        model,
        buildMealPrompt(profile, mealType),
        "meal",
        mealSchema,
        4000,
        attempt,
      );
    }

    return callOpenAI(
      apiKey,
      model,
      request.reviewType === "empty" || request.reviewType === "partial"
        ? buildNextWeeklyPlanPrompt(request, profile)
        : buildPlanPrompt(profile, feedback as Feedback[] | undefined),
      "meal_plan",
      mealPlanSchema,
      16000,
      attempt,
    );
}

async function persistUsageRecord(record: GenerationRecord): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("AI usage persistence is not configured");
  }

  await persistUsageRecordToSupabase(record, { supabaseUrl, serviceRoleKey });
}

const handler = createGenerateMealPlanHandler({
  authenticate: requireAuthenticatedUser,
  generate,
  persist: persistUsageRecord,
});

Deno.serve(handler);
