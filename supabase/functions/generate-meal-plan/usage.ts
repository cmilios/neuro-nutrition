import type { ProviderUsageRecord } from "./handler.ts";

interface OpenAIUsageInput {
  callId: string;
  attempt: number;
  configuredModel: string;
  providerRequestId?: string;
  response?: Record<string, unknown>;
  rawUsage?: Record<string, unknown>;
  outcome: ProviderUsageRecord["outcome"];
  errorCode?: string;
  validationCodes?: string[];
}

const GPT_5_6_SOL_PRICING = {
  currency: "USD",
  unitTokens: 1_000_000,
  inputPerMillionUsd: 5,
  cachedInputPerMillionUsd: 0.5,
  cacheWriteInputPerMillionUsd: 6.25,
  outputPerMillionUsd: 30,
  longContextThresholdTokens: 272_000,
  longContextInputMultiplier: 2,
  longContextOutputMultiplier: 1.5,
} as const;

const PRICING_VERSION = "openai-standard-2026-07-22";
const numberOrUndefined = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

function pricingFor(model: string) {
  return model === "gpt-5.6-sol" || model.startsWith("gpt-5.6-sol-") || model === "gpt-5.6"
    ? GPT_5_6_SOL_PRICING
    : undefined;
}

function estimateCost(
  inputTokens: number,
  cachedInputTokens: number,
  cacheWriteInputTokens: number,
  outputTokens: number,
  pricing: typeof GPT_5_6_SOL_PRICING,
): number {
  const uncachedInputTokens = Math.max(
    0,
    inputTokens - cachedInputTokens - cacheWriteInputTokens,
  );
  const longContext = inputTokens > pricing.longContextThresholdTokens;
  const inputMultiplier = longContext ? pricing.longContextInputMultiplier : 1;
  const outputMultiplier = longContext ? pricing.longContextOutputMultiplier : 1;
  const cost = (
    uncachedInputTokens * pricing.inputPerMillionUsd * inputMultiplier +
    cachedInputTokens * pricing.cachedInputPerMillionUsd * inputMultiplier +
    cacheWriteInputTokens * pricing.cacheWriteInputPerMillionUsd * inputMultiplier +
    outputTokens * pricing.outputPerMillionUsd * outputMultiplier
  ) / pricing.unitTokens;
  return Number(cost.toFixed(12));
}

export function createOpenAIUsageRecord(input: OpenAIUsageInput): ProviderUsageRecord {
  const response = input.response;
  const usage = input.rawUsage ?? (
    response?.usage && typeof response.usage === "object"
      ? response.usage as Record<string, unknown>
      : undefined
  );
  const inputDetails = usage?.input_tokens_details && typeof usage.input_tokens_details === "object"
    ? usage.input_tokens_details as Record<string, unknown>
    : undefined;
  const outputDetails = usage?.output_tokens_details && typeof usage.output_tokens_details === "object"
    ? usage.output_tokens_details as Record<string, unknown>
    : undefined;
  const model = typeof response?.model === "string" ? response.model : input.configuredModel;
  const inputTokens = numberOrUndefined(usage?.input_tokens);
  const cachedInputTokens = numberOrUndefined(inputDetails?.cached_tokens);
  const cacheWriteInputTokens = numberOrUndefined(inputDetails?.cache_write_tokens);
  const outputTokens = numberOrUndefined(usage?.output_tokens);
  const reasoningOutputTokens = numberOrUndefined(outputDetails?.reasoning_tokens);
  const totalTokens = numberOrUndefined(usage?.total_tokens);
  const pricing = pricingFor(model);
  const canEstimate = pricing && inputTokens !== undefined && outputTokens !== undefined;

  return {
    callId: input.callId,
    attempt: input.attempt,
    model,
    provider: "openai",
    providerResponseId: typeof response?.id === "string" ? response.id : undefined,
    providerRequestId: input.providerRequestId,
    inputTokens,
    cachedInputTokens,
    cacheWriteInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
    rawUsage: usage,
    outcome: input.outcome,
    validationCodes: input.validationCodes,
    errorCode: input.errorCode,
    estimatedCostUsd: canEstimate
      ? estimateCost(
          inputTokens,
          cachedInputTokens ?? 0,
          cacheWriteInputTokens ?? 0,
          outputTokens,
          pricing,
        )
      : undefined,
    pricingVersion: pricing ? PRICING_VERSION : undefined,
    pricingSnapshot: pricing ? { ...pricing } : undefined,
  };
}
