// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { weeklyPlanFixture } from "../../../test/weeklyPlanFixture";
import {
  createGenerateMealPlanHandler,
  ProviderGenerationError,
  type InitialGenerationCheckpoint,
  type NextWeeklyPlanCommandOutcome,
  type NextWeeklyPlanCommandStore,
} from "./handler";
import { createOpenAIUsageRecord } from "./usage";

const profile = {
  age: 30,
  gender: "Male",
  heightCm: 175,
  weightKg: 75,
  activityLevel: "Moderately Active",
  goal: "Lose Weight",
  dietType: "Mediterranean",
};
const commandId = "10000000-0000-4000-8000-000000000001";
const planId = "20000000-0000-4000-8000-000000000001";

const successor = () => {
  const result = structuredClone(weeklyPlanFixture);
  result.weeklySummary = "Successor";
  result.days.forEach((day, dayIndex) => {
    for (const type of ["breakfast", "lunch", "dinner", "snack"] as const) {
      day[type] = {
        ...day[type],
        name: `New ${dayIndex} ${type}`,
        ingredients: [`new ingredient ${dayIndex} ${type}`],
        instructions: [`new instruction ${dayIndex} ${type}`],
      };
    }
  });
  return result;
};

const request = (overrides: Record<string, unknown> = {}) => new Request("http://localhost/generate", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    action: "plan",
    commandId,
    profile,
    feedback: [],
    reviewType: "empty",
    currentPlan: weeklyPlanFixture,
    displayedPlanId: planId,
    displayedRevision: 0,
    ...overrides,
  }),
});

const pending = (
  overrides: Partial<NextWeeklyPlanCommandOutcome> = {},
): NextWeeklyPlanCommandOutcome => ({
  commandId,
  status: "in_progress",
  result: null,
  error: null,
  shouldGenerate: true,
  checkpoint: null,
  source: {
    planId,
    revision: 0,
    document: weeklyPlanFixture,
  },
  ...overrides,
});

const store = (
  beginOutcome = pending(),
): NextWeeklyPlanCommandStore => ({
  begin: vi.fn().mockResolvedValue(beginOutcome),
  checkpoint: vi.fn().mockImplementation(async ({ checkpoint }) =>
    pending({ shouldGenerate: false, checkpoint })
  ),
  complete: vi.fn().mockResolvedValue(pending({
    status: "succeeded",
    shouldGenerate: false,
    result: {
      planId: "20000000-0000-4000-8000-000000000002",
      revision: 0,
    },
  })),
  fail: vi.fn().mockResolvedValue(pending({
    status: "failed",
    shouldGenerate: false,
    error: {
      code: "generation_failed",
      message: "No usable result was produced.",
      retryable: true,
    },
  })),
});

describe("durable Next Weekly Plan generation handler", () => {
  it("generates from the authoritative locked source and commits the validated result", async () => {
    const commandStore = store();
    const generated = successor();
    const generate = vi.fn().mockResolvedValue({
      data: generated,
      usageRecord: createOpenAIUsageRecord({
        callId: "30000000-0000-4000-8000-000000000001",
        attempt: 1,
        configuredModel: "gpt-5.6-sol",
        outcome: "success",
      }),
    });
    const handler = createGenerateMealPlanHandler({
      authenticate: vi.fn().mockResolvedValue({ id: "user-1" }),
      generate,
      persist: vi.fn().mockResolvedValue(undefined),
      nextGeneration: commandStore,
    });

    const response = await handler(request());

    expect(response.status).toBe(200);
    expect(commandStore.begin).toHaveBeenCalledWith(expect.objectContaining({
      commandId,
      userId: "user-1",
      sourcePlanId: planId,
      sourceRevision: 0,
    }));
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      currentPlan: weeklyPlanFixture,
      attempt: 1,
    }));
    expect(commandStore.checkpoint).toHaveBeenCalledWith(expect.objectContaining({
      checkpoint: expect.objectContaining({
        kind: "success",
        document: generated,
      }),
    }));
    expect(commandStore.complete).toHaveBeenCalledWith(expect.objectContaining({
      document: generated,
    }));
    expect(await response.json()).toMatchObject({ status: "succeeded" });
  });

  it("returns an in-progress replay without making another provider call", async () => {
    const commandStore = store(pending({
      shouldGenerate: false,
      source: null,
    }));
    const generate = vi.fn();
    const handler = createGenerateMealPlanHandler({
      authenticate: vi.fn().mockResolvedValue({ id: "user-1" }),
      generate,
      persist: vi.fn(),
      nextGeneration: commandStore,
    });

    const response = await handler(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      commandId,
      status: "in_progress",
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("retains an unknown provider checkpoint and command identity for reconciliation", async () => {
    const usageRecord = createOpenAIUsageRecord({
      callId: "30000000-0000-4000-8000-000000000002",
      attempt: 1,
      configuredModel: "gpt-5.6-sol",
      outcome: "failure",
      errorCode: "provider_transport_error",
    });
    const commandStore = store();
    const generate = vi.fn().mockRejectedValue(new ProviderGenerationError(
      "Connection lost.",
      503,
      "provider_transport_error",
      usageRecord,
      true,
    ));
    const handler = createGenerateMealPlanHandler({
      authenticate: vi.fn().mockResolvedValue({ id: "user-1" }),
      generate,
      persist: vi.fn().mockResolvedValue(undefined),
      nextGeneration: commandStore,
    });

    const response = await handler(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "generation_outcome_unknown",
        message: "The provider outcome is unknown and requires reconciliation.",
      },
    });
    expect(commandStore.checkpoint).toHaveBeenCalledWith(expect.objectContaining({
      checkpoint: expect.objectContaining({ kind: "unknown" }),
    }));
    expect(commandStore.fail).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("finishes a replayed success checkpoint without another provider call", async () => {
    const document = successor();
    const checkpoint: InitialGenerationCheckpoint = {
      kind: "success",
      document,
      usageRecord: createOpenAIUsageRecord({
        callId: "30000000-0000-4000-8000-000000000003",
        attempt: 1,
        configuredModel: "gpt-5.6-sol",
        outcome: "success",
      }),
    };
    const commandStore = store(pending({
      shouldGenerate: false,
      checkpoint,
      source: null,
    }));
    const generate = vi.fn();
    const handler = createGenerateMealPlanHandler({
      authenticate: vi.fn().mockResolvedValue({ id: "user-1" }),
      generate,
      persist: vi.fn().mockResolvedValue(undefined),
      nextGeneration: commandStore,
    });

    const response = await handler(request());

    expect(response.status).toBe(200);
    expect(commandStore.complete).toHaveBeenCalledWith(expect.objectContaining({
      commandId,
      document,
    }));
    expect(generate).not.toHaveBeenCalled();
  });

  it("recovers a persisted Next Weekly Plan identity without another provider call", async () => {
    const commandStore = {
      ...store(),
      recover: vi.fn().mockResolvedValue(pending({
        status: "failed",
        shouldGenerate: false,
        source: null,
        error: {
          code: "provider_outcome_unrecoverable",
          message: "No Next Weekly Plan was committed.",
          retryable: false,
        },
        inputFingerprint: "a".repeat(64),
      })),
    };
    const generate = vi.fn();
    const handler = createGenerateMealPlanHandler({
      authenticate: vi.fn().mockResolvedValue({ id: "user-1" }),
      generate,
      persist: vi.fn(),
      nextGeneration: commandStore,
    });

    const response = await handler(request({
      profile: {},
      feedback: [],
      resumeExisting: true,
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      commandId,
      status: "failed",
      error: { code: "provider_outcome_unrecoverable", retryable: false },
    });
    expect(commandStore.recover).toHaveBeenCalledWith({
      commandId,
      userId: "user-1",
    });
    expect(commandStore.begin).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });
});
