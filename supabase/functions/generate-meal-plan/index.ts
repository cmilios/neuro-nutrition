// Supabase Edge Function: generate-meal-plan
//
// Server-side proxy to the Anthropic (Claude) Messages API. The Claude API key
// lives ONLY here, as a Supabase secret (ANTHROPIC_API_KEY) — it is never shipped
// to the browser. The browser calls this function with the signed-in user's
// Supabase JWT; the platform verifies that JWT (keep `verify_jwt` enabled), so
// only authenticated users can generate plans.
//
// Deploy:  supabase functions deploy generate-meal-plan --project-ref <ref>
// Secrets: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...  --project-ref <ref>
//          (optional) supabase secrets set ANTHROPIC_MODEL=claude-sonnet-5

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
// Default per Anthropic guidance. For this workload (large structured meal plans,
// user-triggered) `claude-sonnet-5` is ~5x cheaper and faster and works very well —
// set the ANTHROPIC_MODEL secret to switch without a code change.
const DEFAULT_MODEL = "claude-opus-4-8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
    days: { type: "array", items: dayPlanSchema },
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

// ---- Anthropic call ---------------------------------------------------------

async function callClaude(
  apiKey: string,
  model: string,
  prompt: string,
  schema: unknown,
  maxTokens: number,
): Promise<unknown> {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      // No temperature/top_p — rejected (400) on Opus 4.8 / Sonnet 5.
      output_config: { format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${errText}`);
  }

  const data = await res.json();

  if (data.stop_reason === "refusal") {
    throw new Error("The AI declined to generate this content.");
  }
  if (data.stop_reason === "max_tokens") {
    throw new Error("The response was too long and was cut off. Please retry.");
  }

  const textBlock = (data.content || []).find(
    (b: { type: string }) => b.type === "text",
  );
  if (!textBlock?.text) {
    throw new Error("No content returned from the AI.");
  }

  return JSON.parse(textBlock.text);
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
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return json({ error: "Server is missing ANTHROPIC_API_KEY." }, 500);
    }
    const model = Deno.env.get("ANTHROPIC_MODEL") || DEFAULT_MODEL;

    const { action, profile, feedback, mealType } = await req.json();

    if (!profile) {
      return json({ error: "Missing profile." }, 400);
    }

    if (action === "meal") {
      if (!mealType) return json({ error: "Missing mealType." }, 400);
      const meal = await callClaude(
        apiKey,
        model,
        buildMealPrompt(profile, mealType),
        mealSchema,
        4000,
      );
      return json({ data: meal });
    }

    // Default: full 7-day plan
    const plan = await callClaude(
      apiKey,
      model,
      buildPlanPrompt(profile, feedback),
      mealPlanSchema,
      16000,
    );
    return json({ data: plan });
  } catch (err) {
    console.error("generate-meal-plan error:", err);
    return json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      500,
    );
  }
});
