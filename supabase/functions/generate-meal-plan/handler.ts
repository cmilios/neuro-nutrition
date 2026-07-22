export interface GenerationUser {
  id: string;
}

export interface GenerationRequest {
  action: "plan" | "meal";
  profile: Record<string, unknown>;
  feedback?: unknown[];
  mealType?: string;
}

export interface GenerationRecord {
  userId: string;
  action: GenerationRequest["action"];
  outcome: "success" | "failure";
  errorCode?: string;
}

export interface GenerateMealPlanDependencies {
  authenticate(request: Request): Promise<GenerationUser>;
  generate(request: GenerationRequest): Promise<unknown>;
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
  if (body.action === "meal" && (typeof body.mealType !== "string" || !allowedMealTypes.has(body.mealType))) {
    throw new HttpError("Invalid mealType.", 400, "invalid_meal_type");
  }

  return body as unknown as GenerationRequest;
}

export function createGenerateMealPlanHandler(dependencies: GenerateMealPlanDependencies) {
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

      const data = await dependencies.generate(generationRequest);
      await dependencies.persist({ userId: user.id, action: generationRequest.action, outcome: "success" });
      return json({ data });
    } catch (error) {
      if (user && generationRequest) {
        const errorCode = error instanceof HttpError ? error.code : "internal_error";
        try {
          await dependencies.persist({
            userId: user.id,
            action: generationRequest.action,
            outcome: "failure",
            errorCode,
          });
        } catch (persistenceError) {
          console.error("Failed to persist generation outcome:", persistenceError);
        }
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
