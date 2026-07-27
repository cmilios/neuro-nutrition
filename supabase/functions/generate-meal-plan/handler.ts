import {
  NextWeeklyPlanValidationError,
  validateNextWeeklyPlan,
  isSameMeal,
  validMeal,
  type Meal,
  type WeeklyPlan,
  type MealReviewFeedback,
} from "./nextWeeklyPlan.ts";

export interface GenerationUser {
  id: string;
}

export interface GenerationRequest {
  action: "plan" | "meal";
  commandId?: string;
  profile: Record<string, unknown>;
  feedback?: MealReviewFeedback[];
  mealType?: string;
  currentMeal?: Meal;
  currentPlan?: WeeklyPlan;
  displayedPlanId?: string;
  displayedRevision?: number;
  day?: string;
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
  initialGeneration?: InitialGenerationCommandStore;
  nextGeneration?: NextWeeklyPlanCommandStore;
  mealReroll?: MealRerollCommandStore;
}

export interface WeeklyPlanCommandError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface InitialGenerationCommandOutcome {
  commandId: string;
  status: "succeeded" | "in_progress" | "failed";
  result: unknown | null;
  error: WeeklyPlanCommandError | null;
  shouldGenerate: boolean;
  checkpoint?: InitialGenerationCheckpoint | null;
}

export interface MealRerollTarget {
  planId: string;
  day: string;
  mealType: string;
  meal: Meal;
}

export interface MealRerollCommandOutcome extends InitialGenerationCommandOutcome {
  target?: MealRerollTarget | null;
}

export interface NextWeeklyPlanSource {
  planId: string;
  revision: number;
  document: WeeklyPlan;
}

export interface NextWeeklyPlanCommandOutcome extends InitialGenerationCommandOutcome {
  source?: NextWeeklyPlanSource | null;
}

export interface NextWeeklyPlanCommandStore {
  begin(
    identity: InitialGenerationCommandIdentity & {
      sourcePlanId: string;
      sourceRevision: number;
    },
  ): Promise<NextWeeklyPlanCommandOutcome>;
  checkpoint(
    command: InitialGenerationCommandIdentity & {
      checkpoint: InitialGenerationCheckpoint;
    },
  ): Promise<NextWeeklyPlanCommandOutcome>;
  complete(
    command: InitialGenerationCommandIdentity & { document: unknown },
  ): Promise<NextWeeklyPlanCommandOutcome>;
  fail(
    command: InitialGenerationCommandIdentity & {
      errorCode: string;
      errorMessage: string;
      retryable: boolean;
      evidence: Record<string, unknown>;
    },
  ): Promise<NextWeeklyPlanCommandOutcome>;
}

export interface MealRerollCommandStore {
  begin(
    identity: InitialGenerationCommandIdentity & {
      displayedPlanId: string;
      displayedRevision: number;
      day: string;
      mealType: string;
    },
  ): Promise<MealRerollCommandOutcome>;
  checkpoint(
    command: InitialGenerationCommandIdentity & {
      checkpoint: InitialGenerationCheckpoint;
    },
  ): Promise<MealRerollCommandOutcome>;
  complete(
    command: InitialGenerationCommandIdentity & { meal: Meal },
  ): Promise<MealRerollCommandOutcome>;
  fail(
    command: InitialGenerationCommandIdentity & {
      errorCode: string;
      errorMessage: string;
      retryable: boolean;
      evidence: Record<string, unknown>;
    },
  ): Promise<MealRerollCommandOutcome>;
}

export type InitialGenerationCheckpoint =
  | {
    kind: "success";
    document: unknown;
    usageRecord: ProviderUsageRecord;
  }
  | {
    kind: "failure" | "unknown";
    usageRecord: ProviderUsageRecord;
    error: WeeklyPlanCommandError;
    evidence: Record<string, unknown>;
  };

interface InitialGenerationCommandIdentity {
  commandId: string;
  userId: string;
  inputFingerprint: string;
}

export interface InitialGenerationCommandStore {
  begin(identity: InitialGenerationCommandIdentity): Promise<InitialGenerationCommandOutcome>;
  checkpoint(
    command: InitialGenerationCommandIdentity & {
      checkpoint: InitialGenerationCheckpoint;
    },
  ): Promise<InitialGenerationCommandOutcome>;
  complete(
    identity: InitialGenerationCommandIdentity & { document: unknown },
  ): Promise<InitialGenerationCommandOutcome>;
  fail(
    identity: InitialGenerationCommandIdentity & {
      errorCode: string;
      errorMessage: string;
      retryable: boolean;
      evidence: Record<string, unknown>;
    },
  ): Promise<InitialGenerationCommandOutcome>;
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
    readonly outcomeUnknown = false,
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
const commandIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normalizeForFingerprint = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeForFingerprint);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeForFingerprint(item)]),
    );
  }
  return value;
};

async function fingerprintInitialGeneration(request: GenerationRequest): Promise<string> {
  const normalized = JSON.stringify(normalizeForFingerprint({
    operation: "generate_initial",
    profile: request.profile,
  }));
  return sha256Hex(normalized);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function fingerprintMealReroll(request: GenerationRequest): Promise<string> {
  const normalized = JSON.stringify(normalizeForFingerprint({
    operation: "reroll_meal",
    profile: request.profile,
    displayedPlanId: request.displayedPlanId,
    displayedRevision: request.displayedRevision,
    day: request.day,
    mealType: request.mealType,
  }));
  return sha256Hex(normalized);
}

async function fingerprintNextGeneration(request: GenerationRequest): Promise<string> {
  const normalized = JSON.stringify(normalizeForFingerprint({
    operation: "generate_next",
    profile: request.profile,
    feedback: request.feedback,
    reviewType: request.reviewType,
    displayedPlanId: request.displayedPlanId,
    displayedRevision: request.displayedRevision,
  }));
  return sha256Hex(normalized);
}

const commandResponse = (
  outcome: InitialGenerationCommandOutcome & {
    target?: MealRerollTarget | null;
    source?: NextWeeklyPlanSource | null;
  },
) => {
  const {
    shouldGenerate: _shouldGenerate,
    checkpoint: _checkpoint,
    target: _target,
    source: _source,
    ...response
  } = outcome;
  return response;
};

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
  const isDurableMealReroll =
    body.action === "meal" &&
    typeof body.commandId === "string" &&
    typeof body.displayedPlanId === "string" &&
    typeof body.displayedRevision === "number" &&
    Number.isInteger(body.displayedRevision) &&
    body.displayedRevision >= 0 &&
    typeof body.day === "string" &&
    body.day.length > 0;
  if (body.action === "meal" && !isDurableMealReroll && !validMeal(body.currentMeal)) {
    throw new HttpError("The current meal is required.", 400, "missing_current_meal");
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
      return true;
    } catch {
      console.error("Failed to persist AI Usage Record after retries", {
        userId: user.id,
        action: request.action,
        callId: usageRecord.callId,
        attempt: usageRecord.attempt,
        providerRequestId: usageRecord.providerRequestId,
        providerResponseId: usageRecord.providerResponseId,
      });
      return false;
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

      const isInitialGeneration =
        generationRequest.action === "plan" &&
        generationRequest.reviewType === undefined &&
        generationRequest.currentPlan === undefined;
      if (isInitialGeneration && dependencies.initialGeneration) {
        if (
          typeof generationRequest.commandId !== "string" ||
          !commandIdPattern.test(generationRequest.commandId)
        ) {
          throw new HttpError(
            "A valid command ID is required.",
            400,
            "invalid_command_id",
          );
        }

        const identity = {
          commandId: generationRequest.commandId,
          userId: user.id,
          inputFingerprint: await fingerprintInitialGeneration(generationRequest),
        };
        const finalizeCheckpoint = async (
          outcome: InitialGenerationCommandOutcome,
        ): Promise<Response> => {
          const checkpoint = outcome.checkpoint;
          if (!checkpoint) return json(commandResponse(outcome));

          const usagePersisted = await persistAndReport(
            user!,
            generationRequest!,
            checkpoint.usageRecord,
          );
          if (!usagePersisted) {
            throw new HttpError(
              "The provider attempt is awaiting durable reconciliation.",
              503,
              "usage_persistence_failed",
            );
          }
          if (checkpoint.kind === "unknown") {
            throw new HttpError(
              "The provider outcome is unknown and requires reconciliation.",
              503,
              "generation_outcome_unknown",
            );
          }
          if (checkpoint.kind === "failure") {
            const failed = await dependencies.initialGeneration!.fail({
              ...identity,
              errorCode: checkpoint.error.code,
              errorMessage: checkpoint.error.message,
              retryable: checkpoint.error.retryable,
              evidence: checkpoint.evidence,
            });
            return json(commandResponse(failed));
          }

          const completed = await dependencies.initialGeneration!.complete({
            ...identity,
            document: checkpoint.document,
          });
          return json(commandResponse(completed));
        };

        const started = await dependencies.initialGeneration.begin(identity);
        if (!started.shouldGenerate) {
          return await finalizeCheckpoint(started);
        }

        let result: GenerationResult;
        try {
          result = await dependencies.generate({
            ...generationRequest,
            attempt: 1,
          });
        } catch (error) {
          if (error instanceof ProviderGenerationError) {
            const evidence = {
              stage: "provider",
              reason: error.code,
              callId: error.usageRecord.callId,
              attempt: error.usageRecord.attempt,
              providerRequestId: error.usageRecord.providerRequestId,
              providerResponseId: error.usageRecord.providerResponseId,
            };
            const checkpointed = await dependencies.initialGeneration.checkpoint({
              ...identity,
              checkpoint: {
                kind: error.outcomeUnknown ? "unknown" : "failure",
                usageRecord: error.usageRecord,
                error: {
                  code: error.outcomeUnknown
                    ? "generation_outcome_unknown"
                    : "generation_failed",
                  message: error.outcomeUnknown
                    ? "The provider outcome is unknown and requires reconciliation."
                    : "A valid Current Weekly Plan was not created.",
                  retryable: false,
                },
                evidence,
              },
            });
            return await finalizeCheckpoint(checkpointed);
          }

          const failed = await dependencies.initialGeneration.fail({
            ...identity,
            errorCode: "generation_failed",
            errorMessage: "A valid Current Weekly Plan was not created.",
            retryable: false,
            evidence: {
              stage: "generation",
              reason: error instanceof HttpError ? error.code : "unexpected_error",
            },
          });
          return json(commandResponse(failed));
        }

        const checkpointed = await dependencies.initialGeneration.checkpoint({
          ...identity,
          checkpoint: {
            kind: "success",
            document: result.data,
            usageRecord: result.usageRecord,
          },
        });
        return await finalizeCheckpoint(checkpointed);
      }

      const isDurableNextGeneration =
        generationRequest.action === "plan" &&
        (generationRequest.reviewType === "empty" ||
          generationRequest.reviewType === "partial") &&
        dependencies.nextGeneration;
      if (isDurableNextGeneration) {
        if (
          typeof generationRequest.commandId !== "string" ||
          !commandIdPattern.test(generationRequest.commandId) ||
          typeof generationRequest.displayedPlanId !== "string" ||
          !commandIdPattern.test(generationRequest.displayedPlanId) ||
          typeof generationRequest.displayedRevision !== "number" ||
          !Number.isInteger(generationRequest.displayedRevision) ||
          generationRequest.displayedRevision < 0
        ) {
          throw new HttpError(
            "A valid Next Weekly Plan command is required.",
            400,
            "invalid_command",
          );
        }

        const identity = {
          commandId: generationRequest.commandId,
          userId: user.id,
          inputFingerprint: await fingerprintNextGeneration(generationRequest),
        };
        const finalizeCheckpoint = async (
          outcome: NextWeeklyPlanCommandOutcome,
        ): Promise<Response> => {
          const checkpoint = outcome.checkpoint;
          if (!checkpoint) return json(commandResponse(outcome));

          const usagePersisted = await persistAndReport(
            user!,
            generationRequest!,
            checkpoint.usageRecord,
          );
          if (!usagePersisted) {
            throw new HttpError(
              "The provider attempt is awaiting durable reconciliation.",
              503,
              "usage_persistence_failed",
            );
          }
          if (checkpoint.kind === "unknown") {
            throw new HttpError(
              "The provider outcome is unknown and requires reconciliation.",
              503,
              "generation_outcome_unknown",
            );
          }
          if (checkpoint.kind === "failure") {
            const failed = await dependencies.nextGeneration!.fail({
              ...identity,
              errorCode: checkpoint.error.code,
              errorMessage: checkpoint.error.message,
              retryable: checkpoint.error.retryable,
              evidence: checkpoint.evidence,
            });
            return json(commandResponse(failed));
          }

          const completed = await dependencies.nextGeneration!.complete({
            ...identity,
            document: checkpoint.document,
          });
          return json(commandResponse(completed));
        };

        const started = await dependencies.nextGeneration.begin({
          ...identity,
          sourcePlanId: generationRequest.displayedPlanId,
          sourceRevision: generationRequest.displayedRevision,
        });
        if (!started.shouldGenerate) {
          return await finalizeCheckpoint(started);
        }
        if (!started.source) {
          const failed = await dependencies.nextGeneration.fail({
            ...identity,
            errorCode: "generation_lock_lost",
            errorMessage: "The locked Current Weekly Plan is unavailable.",
            retryable: true,
            evidence: { stage: "start", reason: "source_missing" },
          });
          return json(commandResponse(failed));
        }

        let validationDetails: string[] | undefined;
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          let result: GenerationResult;
          try {
            result = await dependencies.generate({
              ...generationRequest,
              currentPlan: started.source.document,
              attempt,
              validationDetails,
            });
          } catch (error) {
            if (error instanceof ProviderGenerationError) {
              const checkpointed = await dependencies.nextGeneration.checkpoint({
                ...identity,
                checkpoint: {
                  kind: error.outcomeUnknown ? "unknown" : "failure",
                  usageRecord: error.usageRecord,
                  error: {
                    code: error.outcomeUnknown
                      ? "generation_outcome_unknown"
                      : "generation_failed",
                    message: error.outcomeUnknown
                      ? "The provider outcome is unknown and requires reconciliation."
                      : "A valid Next Weekly Plan was not created.",
                    retryable: !error.outcomeUnknown,
                  },
                  evidence: {
                    stage: "provider",
                    reason: error.code,
                    callId: error.usageRecord.callId,
                    attempt: error.usageRecord.attempt,
                    providerRequestId: error.usageRecord.providerRequestId,
                    providerResponseId: error.usageRecord.providerResponseId,
                  },
                },
              });
              return await finalizeCheckpoint(checkpointed);
            }

            const failed = await dependencies.nextGeneration.fail({
              ...identity,
              errorCode: "generation_failed",
              errorMessage: "A valid Next Weekly Plan was not created.",
              retryable: true,
              evidence: {
                stage: "generation",
                reason: error instanceof HttpError ? error.code : "unexpected_error",
              },
            });
            return json(commandResponse(failed));
          }

          try {
            const assembledPlan = validateNextWeeklyPlan(
              started.source.document,
              result.data,
              generationRequest.feedback,
              generationRequest.reviewType,
            );
            const checkpointed = await dependencies.nextGeneration.checkpoint({
              ...identity,
              checkpoint: {
                kind: "success",
                document: assembledPlan,
                usageRecord: result.usageRecord,
              },
            });
            return await finalizeCheckpoint(checkpointed);
          } catch (error) {
            if (!(error instanceof NextWeeklyPlanValidationError)) throw error;
            validationDetails = error.codes;
            const failedUsage = {
              ...result.usageRecord,
              outcome: "failure" as const,
              validationCodes: error.codes,
              errorCode: "invalid_next_weekly_plan",
            };
            if (attempt < 2) {
              await persistAndReport(user, generationRequest, failedUsage);
              continue;
            }

            const checkpointed = await dependencies.nextGeneration.checkpoint({
              ...identity,
              checkpoint: {
                kind: "failure",
                usageRecord: failedUsage,
                error: {
                  code: "invalid_next_weekly_plan",
                  message: "A valid Next Weekly Plan was not created.",
                  retryable: true,
                },
                evidence: {
                  stage: "validation",
                  reason: "invalid_next_weekly_plan",
                  callId: failedUsage.callId,
                  attempt: failedUsage.attempt,
                  providerRequestId: failedUsage.providerRequestId,
                  providerResponseId: failedUsage.providerResponseId,
                },
              },
            });
            return await finalizeCheckpoint(checkpointed);
          }
        }
      }

      const isDurableMealReroll =
        generationRequest.action === "meal" &&
        dependencies.mealReroll;
      if (isDurableMealReroll) {
        if (
          generationRequest.currentMeal !== undefined ||
          generationRequest.currentPlan !== undefined ||
          typeof generationRequest.commandId !== "string" ||
          !commandIdPattern.test(generationRequest.commandId) ||
          typeof generationRequest.displayedPlanId !== "string" ||
          !commandIdPattern.test(generationRequest.displayedPlanId) ||
          typeof generationRequest.displayedRevision !== "number" ||
          !Number.isInteger(generationRequest.displayedRevision) ||
          generationRequest.displayedRevision < 0 ||
          typeof generationRequest.day !== "string" ||
          !generationRequest.day ||
          typeof generationRequest.mealType !== "string"
        ) {
          throw new HttpError(
            "A valid Meal Reroll command is required.",
            400,
            "invalid_command",
          );
        }

        const identity = {
          commandId: generationRequest.commandId,
          userId: user.id,
          inputFingerprint: await fingerprintMealReroll(generationRequest),
        };
        const finalizeCheckpoint = async (
          outcome: MealRerollCommandOutcome,
        ): Promise<Response> => {
          const checkpoint = outcome.checkpoint;
          if (!checkpoint) return json(commandResponse(outcome));

          const usagePersisted = await persistAndReport(
            user!,
            generationRequest!,
            checkpoint.usageRecord,
          );
          if (!usagePersisted) {
            throw new HttpError(
              "The provider attempt is awaiting durable reconciliation.",
              503,
              "usage_persistence_failed",
            );
          }
          if (checkpoint.kind === "unknown") {
            throw new HttpError(
              "The provider outcome is unknown and requires reconciliation.",
              503,
              "generation_outcome_unknown",
            );
          }
          if (checkpoint.kind === "failure") {
            const failed = await dependencies.mealReroll!.fail({
              ...identity,
              errorCode: checkpoint.error.code,
              errorMessage: checkpoint.error.message,
              retryable: checkpoint.error.retryable,
              evidence: checkpoint.evidence,
            });
            return json(commandResponse(failed));
          }

          const generated = checkpoint.document as Meal & { mealType?: string };
          const { mealType: _mealType, ...meal } = generated;
          const completed = await dependencies.mealReroll!.complete({
            ...identity,
            meal,
          });
          return json(commandResponse(completed));
        };

        const started = await dependencies.mealReroll.begin({
          ...identity,
          displayedPlanId: generationRequest.displayedPlanId,
          displayedRevision: generationRequest.displayedRevision,
          day: generationRequest.day,
          mealType: generationRequest.mealType,
        });
        if (!started.shouldGenerate) {
          return await finalizeCheckpoint(started);
        }
        if (
          !started.target ||
          !validMeal(started.target.meal) ||
          started.target.day !== generationRequest.day ||
          started.target.mealType !== generationRequest.mealType
        ) {
          const failed = await dependencies.mealReroll.fail({
            ...identity,
            errorCode: "meal_slot_not_found",
            errorMessage: "The authoritative Meal Slot could not be reserved.",
            retryable: false,
            evidence: { stage: "start", reason: "invalid_reserved_target" },
          });
          return json(commandResponse(failed));
        }

        let validationDetails: string[] | undefined;
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          let result: GenerationResult;
          try {
            result = await dependencies.generate({
              ...generationRequest,
              currentMeal: started.target.meal,
              attempt,
              validationDetails,
            });
          } catch (error) {
            if (error instanceof ProviderGenerationError) {
              const checkpointed = await dependencies.mealReroll.checkpoint({
                ...identity,
                checkpoint: {
                  kind: error.outcomeUnknown ? "unknown" : "failure",
                  usageRecord: error.usageRecord,
                  error: {
                    code: error.outcomeUnknown
                      ? "generation_outcome_unknown"
                      : "generation_failed",
                    message: error.outcomeUnknown
                      ? "The provider outcome is unknown and requires reconciliation."
                      : "A usable replacement meal was not created.",
                    retryable: false,
                  },
                  evidence: { stage: "provider", reason: error.code },
                },
              });
              return await finalizeCheckpoint(checkpointed);
            }
            throw error;
          }

          const returnedMealType = result.data && typeof result.data === "object"
            ? (result.data as Record<string, unknown>).mealType
            : undefined;
          const validationCode = !validMeal(result.data)
            ? "invalid_meal"
            : returnedMealType !== generationRequest.mealType
            ? "wrong_meal_type"
            : isSameMeal(started.target.meal, result.data)
            ? "same_meal"
            : undefined;
          if (!validationCode) {
            const checkpointed = await dependencies.mealReroll.checkpoint({
              ...identity,
              checkpoint: {
                kind: "success",
                document: result.data,
                usageRecord: result.usageRecord,
              },
            });
            return await finalizeCheckpoint(checkpointed);
          }

          validationDetails = [validationCode];
          const failedUsage = {
            ...result.usageRecord,
            outcome: "failure" as const,
            validationCodes: validationDetails,
            errorCode: "invalid_meal_reroll",
          };
          const usagePersisted = await persistAndReport(
            user,
            generationRequest,
            failedUsage,
          );
          if (!usagePersisted) {
            const checkpointed = await dependencies.mealReroll.checkpoint({
              ...identity,
              checkpoint: {
                kind: "failure",
                usageRecord: failedUsage,
                error: {
                  code: "generation_failed",
                  message: "A usable replacement meal was not created.",
                  retryable: false,
                },
                evidence: {
                  stage: "usage_persistence",
                  reason: "usage_persistence_failed",
                  validationCodes: validationDetails,
                },
              },
            });
            return await finalizeCheckpoint(checkpointed);
          }
        }

        const failed = await dependencies.mealReroll.fail({
          ...identity,
          errorCode: "generation_failed",
          errorMessage: "A different usable meal was not created.",
          retryable: false,
          evidence: {
            stage: "validation",
            reason: "invalid_meal_reroll",
            validationCodes: validationDetails ?? [],
          },
        });
        return json(commandResponse(failed));
      }

      const isNextWeeklyPlanReview =
        generationRequest.action === "plan" &&
        (generationRequest.reviewType === "empty" || generationRequest.reviewType === "partial") &&
        generationRequest.currentPlan;
      const isMealReroll =
        generationRequest.action === "meal" &&
        generationRequest.currentMeal;
      let validationDetails: string[] | undefined;

      for (let attempt = 1; attempt <= (isNextWeeklyPlanReview || isMealReroll ? 2 : 1); attempt += 1) {
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
        } else if (isMealReroll) {
          const returnedMealType = result.data && typeof result.data === "object"
            ? (result.data as Record<string, unknown>).mealType
            : undefined;
          const validationCode = !validMeal(result.data)
            ? "invalid_meal"
            : returnedMealType !== generationRequest.mealType
            ? "wrong_meal_type"
            : isSameMeal(generationRequest.currentMeal!, result.data)
            ? "same_meal"
            : undefined;
          if (validationCode) {
            validationDetails = [validationCode];
            await persistAndReport(user, generationRequest, {
              ...result.usageRecord,
              outcome: "failure",
              validationCodes: validationDetails,
              errorCode: "invalid_meal_reroll",
            });
            console.error("Meal Reroll validation failed", {
              userId: user.id,
              attempt,
              failedRules: validationDetails,
              mealType: generationRequest.mealType,
              timestamp: new Date().toISOString(),
              providerRequestId: result.usageRecord.providerRequestId,
              providerResponseId: result.usageRecord.providerResponseId,
            });
          } else {
            const persisted = await persistAndReport(user, generationRequest, result.usageRecord);
            if (!persisted) {
              throw new HttpError(
                "Meal generation could not be recorded. Your original meal is unchanged.",
                503,
              "usage_persistence_failed",
            );
          }
            const { mealType: _mealType, ...meal } = result.data as Meal & { mealType: string };
            return json({ data: meal });
          }
        } else {
          await persistAndReport(user, generationRequest, result.usageRecord);
          return json({ data: result.data });
        }
      }

      if (isMealReroll) {
        throw new HttpError(
          "A different meal was not created. Your original meal is unchanged.",
          422,
          "invalid_meal_reroll",
        );
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
