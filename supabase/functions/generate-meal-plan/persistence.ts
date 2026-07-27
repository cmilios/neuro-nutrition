import type {
  GenerationRecord,
  InitialGenerationCommandOutcome,
  InitialGenerationCommandStore,
  MealRerollCommandStore,
} from "./handler.ts";

interface PersistenceOptions {
  supabaseUrl: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
  delay?: (milliseconds: number) => Promise<void>;
}

interface CommandPersistenceOptions {
  supabaseUrl: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
}

const defaultDelay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export async function persistUsageRecordToSupabase(
  record: GenerationRecord,
  options: PersistenceOptions,
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const delay = options.delay ?? defaultDelay;
  const body = JSON.stringify({
    call_id: record.callId,
    user_id: record.userId,
    action: record.action,
    attempt: record.attempt,
    provider: record.provider,
    model: record.model,
    provider_response_id: record.providerResponseId,
    provider_request_id: record.providerRequestId,
    input_tokens: record.inputTokens,
    cached_input_tokens: record.cachedInputTokens,
    cache_write_input_tokens: record.cacheWriteInputTokens,
    output_tokens: record.outputTokens,
    reasoning_output_tokens: record.reasoningOutputTokens,
    total_tokens: record.totalTokens,
    raw_usage: record.rawUsage,
    outcome: record.outcome,
    validation_codes: record.validationCodes,
    error_code: record.errorCode,
    estimated_cost_usd: record.estimatedCostUsd,
    pricing_version: record.pricingVersion,
    pricing_snapshot: record.pricingSnapshot,
  });

  let lastStatus: number | undefined;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetchImpl(
        `${options.supabaseUrl}/rest/v1/ai_usage_records?on_conflict=call_id`,
        {
          method: "POST",
          headers: {
            apikey: options.serviceRoleKey,
            Authorization: `Bearer ${options.serviceRoleKey}`,
            "content-type": "application/json",
            Prefer: "resolution=ignore-duplicates,return=minimal",
          },
          body,
        },
      );

      if (response.ok) return;
      lastStatus = response.status;
      if (response.status < 500 || attempt === 3) break;
    } catch (error) {
      lastError = error;
      if (attempt === 3) break;
    }

    await delay(attempt * 50);
  }

  throw new Error("AI Usage Record insert failed", {
    cause: lastError ?? (lastStatus ? new Error(`HTTP ${lastStatus}`) : undefined),
  });
}

export function createInitialGenerationCommandStore(
  options: CommandPersistenceOptions,
): InitialGenerationCommandStore {
  const fetchImpl = options.fetchImpl ?? fetch;
  const rpc = async (
    functionName: string,
    body: Record<string, unknown>,
  ): Promise<InitialGenerationCommandOutcome> => {
    const response = await fetchImpl(
      `${options.supabaseUrl}/rest/v1/rpc/${functionName}`,
      {
        method: "POST",
        headers: {
          apikey: options.serviceRoleKey,
          Authorization: `Bearer ${options.serviceRoleKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      throw new Error(`Weekly Plan command ${functionName} failed with HTTP ${response.status}`);
    }
    return await response.json() as InitialGenerationCommandOutcome;
  };

  return {
    begin(identity) {
      return rpc("begin_initial_weekly_plan_generation", {
        p_user_id: identity.userId,
        p_command_id: identity.commandId,
        p_input_fingerprint: identity.inputFingerprint,
      });
    },
    checkpoint(command) {
      return rpc("checkpoint_initial_weekly_plan_generation", {
        p_user_id: command.userId,
        p_command_id: command.commandId,
        p_input_fingerprint: command.inputFingerprint,
        p_checkpoint: command.checkpoint,
      });
    },
    complete(command) {
      return rpc("complete_initial_weekly_plan_generation", {
        p_user_id: command.userId,
        p_command_id: command.commandId,
        p_input_fingerprint: command.inputFingerprint,
        p_document: command.document,
      });
    },
    fail(command) {
      return rpc("fail_initial_weekly_plan_generation", {
        p_user_id: command.userId,
        p_command_id: command.commandId,
        p_input_fingerprint: command.inputFingerprint,
        p_error_code: command.errorCode,
        p_error_message: command.errorMessage,
        p_retryable: command.retryable,
        p_failure_evidence: command.evidence,
      });
    },
  };
}

export function createMealRerollCommandStore(
  options: CommandPersistenceOptions,
): MealRerollCommandStore {
  const fetchImpl = options.fetchImpl ?? fetch;
  const rpc = async (
    functionName: string,
    body: Record<string, unknown>,
  ): Promise<InitialGenerationCommandOutcome> => {
    const response = await fetchImpl(
      `${options.supabaseUrl}/rest/v1/rpc/${functionName}`,
      {
        method: "POST",
        headers: {
          apikey: options.serviceRoleKey,
          Authorization: `Bearer ${options.serviceRoleKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      throw new Error(`Meal Reroll command ${functionName} failed with HTTP ${response.status}`);
    }
    return await response.json() as InitialGenerationCommandOutcome;
  };

  return {
    begin(identity) {
      return rpc("begin_meal_reroll", {
        p_user_id: identity.userId,
        p_command_id: identity.commandId,
        p_input_fingerprint: identity.inputFingerprint,
        p_displayed_plan_id: identity.displayedPlanId,
        p_displayed_revision: identity.displayedRevision,
        p_day: identity.day,
        p_meal_type: identity.mealType,
      });
    },
    checkpoint(command) {
      return rpc("checkpoint_meal_reroll", {
        p_user_id: command.userId,
        p_command_id: command.commandId,
        p_input_fingerprint: command.inputFingerprint,
        p_checkpoint: command.checkpoint,
      });
    },
    complete(command) {
      return rpc("complete_meal_reroll", {
        p_user_id: command.userId,
        p_command_id: command.commandId,
        p_input_fingerprint: command.inputFingerprint,
        p_meal: command.meal,
      });
    },
    fail(command) {
      return rpc("fail_meal_reroll", {
        p_user_id: command.userId,
        p_command_id: command.commandId,
        p_input_fingerprint: command.inputFingerprint,
        p_code: command.errorCode,
        p_message: command.errorMessage,
        p_retryable: command.retryable,
        p_evidence: command.evidence,
      });
    },
  } as MealRerollCommandStore;
}
