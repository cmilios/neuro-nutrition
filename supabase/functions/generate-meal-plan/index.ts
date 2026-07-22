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

const OPENAI_API_URL = "https://api.openai.com/v1/responses";
// The current recommended GPT-5.6 coding/reasoning model is the default. The
// OPENAI_MODEL secret can override it without a code deployment.
const DEFAULT_MODEL = "gpt-5.6-sol";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

class FunctionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

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
  },
  required: [
    "name",
    "description",
    "ingredients",
    "instructions",
    "macros",
    "cookingTimeMinutes",
    "prepTimeMinutes",
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
    throw new FunctionError("Missing profile.", 400, "invalid_profile");
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
      throw new FunctionError(`Invalid ${field}.`, 400, "invalid_profile");
    }
  }

  if (profile.targetWeightKg !== undefined) {
    const target = profile.targetWeightKg;
    if (typeof target !== "number" || !Number.isFinite(target) || target < 20 || target > 500) {
      throw new FunctionError("Invalid targetWeightKg.", 400, "invalid_profile");
    }
  }

  for (const field of ["gender", "activityLevel", "goal", "dietType"]) {
    if (typeof profile[field] !== "string" || !profile[field]) {
      throw new FunctionError(`Invalid ${field}.`, 400, "invalid_profile");
    }
  }
}

async function requireAuthenticatedUser(req: Request): Promise<void> {
  const authorization = req.headers.get("Authorization");
  const token = authorization?.replace(/^Bearer\s+/i, "");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!token || !supabaseUrl || !anonKey) {
    throw new FunctionError("Authentication required.", 401, "unauthorized");
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
    },
  });

  if (!response.ok) {
    throw new FunctionError("Your session is invalid or expired. Please log in again.", 401, "unauthorized");
  }
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
): Promise<unknown> {
  const res = await fetch(OPENAI_API_URL, {
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

  if (!res.ok) {
    const errText = await res.text();
    let providerMessage = "";
    let providerCode = "";
    let requestId = "";

    try {
      const body = JSON.parse(errText);
      providerMessage = body?.error?.message || "";
      providerCode = body?.error?.code || body?.error?.type || "";
      requestId = res.headers.get("x-request-id") || "";
    } catch {
      // The provider occasionally returns a non-JSON gateway response.
    }

    console.error("OpenAI request failed", {
      status: res.status,
      providerCode,
      requestId,
    });

    const normalizedMessage = providerMessage.toLowerCase();
    if (
      providerCode === "insufficient_quota" ||
      normalizedMessage.includes("quota") ||
      normalizedMessage.includes("billing") ||
      normalizedMessage.includes("credit")
    ) {
      throw new FunctionError(
        "Meal generation is unavailable because the OpenAI API account has no remaining quota. Add API billing or credits in the OpenAI Platform, then try again.",
        402,
        "ai_credits_exhausted",
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new FunctionError(
        "The AI provider credentials are invalid. Update the server-side OpenAI API key.",
        503,
        "ai_provider_auth_failed",
      );
    }
    if (res.status === 429) {
      throw new FunctionError(
        "The AI provider is rate-limiting requests. Please wait a moment and try again.",
        429,
        "ai_rate_limited",
      );
    }

    throw new FunctionError(
      "The AI provider rejected the generation request. Please try again later.",
      502,
      "ai_provider_error",
    );
  }

  const data = await res.json();

  if (
    data.status === "incomplete" &&
    data.incomplete_details?.reason === "max_output_tokens"
  ) {
    throw new FunctionError("The response was too long and was cut off. Please retry.", 502, "ai_response_truncated");
  }

  const contentBlocks = (data.output || [])
    .filter((item: { type?: string }) => item.type === "message")
    .flatMap((item: { content?: unknown[] }) => item.content || []);
  const refusalBlock = contentBlocks.find(
    (block: { type?: string }) => block.type === "refusal",
  ) as { refusal?: string } | undefined;
  if (refusalBlock) {
    throw new FunctionError("The AI declined to generate this content.", 422, "ai_refusal");
  }

  const textBlock = contentBlocks.find(
    (block: { type?: string }) => block.type === "output_text",
  ) as { text?: string } | undefined;
  if (!textBlock?.text) {
    throw new FunctionError("No content returned from the AI.", 502, "ai_empty_response");
  }

  try {
    return JSON.parse(textBlock.text);
  } catch {
    throw new FunctionError("The AI returned an invalid structured response. Please retry.", 502, "ai_invalid_response");
  }
}

// ---- HTTP handler -----------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });

  try {
    if (req.method !== "POST") {
      throw new FunctionError("Method not allowed.", 405, "method_not_allowed");
    }

    await requireAuthenticatedUser(req);

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      throw new FunctionError(
        "Meal generation is not configured. Add the server-side OpenAI API key.",
        503,
        "ai_not_configured",
      );
    }
    const model = Deno.env.get("OPENAI_MODEL") || DEFAULT_MODEL;

    let requestBody: Record<string, unknown>;
    try {
      const parsedBody = await req.json();
      if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
        throw new Error("Invalid JSON object");
      }
      requestBody = parsedBody;
    } catch {
      throw new FunctionError("Request body must be valid JSON.", 400, "invalid_json");
    }

    const { action, profile, feedback, mealType } = requestBody;
    assertValidProfile(profile);

    if (feedback !== undefined && (!Array.isArray(feedback) || feedback.length > 28)) {
      throw new FunctionError("Invalid meal feedback.", 400, "invalid_feedback");
    }

    if (action === "meal") {
      if (typeof mealType !== "string" || !allowedMealTypes.has(mealType)) {
        throw new FunctionError("Invalid mealType.", 400, "invalid_meal_type");
      }
      const meal = await callOpenAI(
        apiKey,
        model,
        buildMealPrompt(profile, mealType),
        "meal",
        mealSchema,
        4000,
      );
      return json({ data: meal });
    }

    if (action !== "plan") {
      throw new FunctionError("Invalid action.", 400, "invalid_action");
    }

    // Default: full 7-day plan
    const plan = await callOpenAI(
      apiKey,
      model,
      buildPlanPrompt(profile, feedback as Feedback[] | undefined),
      "meal_plan",
      mealPlanSchema,
      16000,
    );
    return json({ data: plan });
  } catch (err) {
    console.error("generate-meal-plan error:", err);
    if (err instanceof FunctionError) {
      return json(
        { error: { code: err.code, message: err.message } },
        err.status,
      );
    }
    if (err instanceof DOMException && err.name === "TimeoutError") {
      return json(
        { error: { code: "ai_timeout", message: "Meal generation took too long. Please try again." } },
        504,
      );
    }
    return json(
      { error: { code: "internal_error", message: "Meal generation failed unexpectedly. Please try again." } },
      500,
    );
  }
});
