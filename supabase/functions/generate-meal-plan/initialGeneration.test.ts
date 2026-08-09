// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { weeklyPlanFixture } from "../../../test/weeklyPlanFixture";
import {
  createGenerateMealPlanHandler,
  ProviderGenerationError,
  type InitialGenerationCommandStore,
} from "./handler";
import { createOpenAIUsageRecord } from "./usage";

const commandId = "10000000-0000-4000-8000-000000000001";
const profile = {
  age: 30,
  gender: "Male",
  heightCm: 175,
  weightKg: 75,
  activityLevel: "Moderately Active",
  goal: "Lose Weight",
  dietType: "Mediterranean",
};
const authoritativeRow = {
  planId: "20000000-0000-4000-8000-000000000001",
  userId: "user-1",
  document: weeklyPlanFixture,
  schemaVersion: 1,
  revision: 0,
  isActive: true,
  createdAt: "2026-07-27T12:00:00.000Z",
  updatedAt: "2026-07-27T12:00:00.000Z",
  deactivatedAt: null,
  predecessorPlanId: null,
  generationId: commandId,
};

const usageRecord = createOpenAIUsageRecord({
  callId: "00000000-0000-4000-8000-000000000101",
  attempt: 1,
  configuredModel: "gpt-5.6-sol",
  outcome: "success",
});

const request = (body: Record<string, unknown>) => new Request("http://localhost/generate", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const store = (): InitialGenerationCommandStore => ({
  begin: vi.fn().mockResolvedValue({
    commandId,
    status: "in_progress",
    result: null,
    error: null,
    shouldGenerate: true,
  }),
  checkpoint: vi.fn().mockImplementation(async ({ checkpoint }) => ({
    commandId,
    status: "in_progress",
    result: null,
    error: null,
    shouldGenerate: false,
    checkpoint,
  })),
  complete: vi.fn().mockResolvedValue({
    commandId,
    status: "succeeded",
    result: authoritativeRow,
    error: null,
    shouldGenerate: false,
  }),
  fail: vi.fn(),
});

describe("initial Weekly Plan generation command HTTP contract", () => {
  it("returns the complete authoritative row and records before calling the provider", async () => {
    const commandStore = store();
    const generate = vi.fn().mockResolvedValue({ data: weeklyPlanFixture, usageRecord });
    const persist = vi.fn().mockResolvedValue(undefined);
    const handler = createGenerateMealPlanHandler({
      authenticate: vi.fn().mockResolvedValue({ id: "user-1" }),
      generate,
      persist,
      initialGeneration: commandStore,
    });

    const response = await handler(request({ action: "plan", commandId, profile }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      commandId,
      status: "succeeded",
      result: authoritativeRow,
      error: null,
    });
    expect(commandStore.begin).toHaveBeenCalledBefore(generate);
    expect(commandStore.checkpoint).toHaveBeenCalledAfter(generate);
    expect(commandStore.checkpoint).toHaveBeenCalledBefore(persist);
    expect(commandStore.complete).toHaveBeenCalledAfter(persist);
    expect(commandStore.complete).toHaveBeenCalledWith(expect.objectContaining({
      commandId,
      userId: "user-1",
      document: weeklyPlanFixture,
      inputFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
  });

  it("replays a recorded outcome without another provider call", async () => {
    const commandStore = store();
    vi.mocked(commandStore.begin).mockResolvedValue({
      commandId,
      status: "succeeded",
      result: authoritativeRow,
      error: null,
      shouldGenerate: false,
    });
    const generate = vi.fn();
    const handler = createGenerateMealPlanHandler({
      authenticate: vi.fn().mockResolvedValue({ id: "user-1" }),
      generate,
      persist: vi.fn(),
      initialGeneration: commandStore,
    });

    const response = await handler(request({ action: "plan", commandId, profile }));

    expect(await response.json()).toEqual({
      commandId,
      status: "succeeded",
      result: authoritativeRow,
      error: null,
    });
    expect(generate).not.toHaveBeenCalled();
    expect(commandStore.complete).not.toHaveBeenCalled();
    expect(commandStore.checkpoint).not.toHaveBeenCalled();
  });

  it("rejects an invalid command UUID before starting generation", async () => {
    const commandStore = store();
    const generate = vi.fn();
    const handler = createGenerateMealPlanHandler({
      authenticate: vi.fn().mockResolvedValue({ id: "user-1" }),
      generate,
      persist: vi.fn(),
      initialGeneration: commandStore,
    });

    const response = await handler(request({ action: "plan", commandId: "not-a-uuid", profile }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "invalid_command_id",
        message: "A valid command ID is required.",
      },
    });
    expect(commandStore.begin).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("keeps the command pending when a billable provider call cannot be attributed", async () => {
    const commandStore = store();
    const handler = createGenerateMealPlanHandler({
      authenticate: vi.fn().mockResolvedValue({ id: "user-1" }),
      generate: vi.fn().mockResolvedValue({ data: weeklyPlanFixture, usageRecord }),
      persist: vi.fn().mockRejectedValue(new Error("ledger unavailable")),
      initialGeneration: commandStore,
    });

    const response = await handler(request({ action: "plan", commandId, profile }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "usage_persistence_failed",
        message: "The provider attempt is awaiting durable reconciliation.",
      },
    });
    expect(commandStore.complete).not.toHaveBeenCalled();
    expect(commandStore.fail).not.toHaveBeenCalled();
    expect(commandStore.checkpoint).toHaveBeenCalledTimes(1);
  });

  it("resumes a durable provider checkpoint without another provider call", async () => {
    const commandStore = store();
    vi.mocked(commandStore.begin).mockResolvedValue({
      commandId,
      status: "in_progress",
      result: null,
      error: null,
      shouldGenerate: false,
      checkpoint: {
        kind: "success",
        document: weeklyPlanFixture,
        usageRecord,
      },
    });
    const generate = vi.fn();
    const persist = vi.fn().mockResolvedValue(undefined);
    const handler = createGenerateMealPlanHandler({
      authenticate: vi.fn().mockResolvedValue({ id: "user-1" }),
      generate,
      persist,
      initialGeneration: commandStore,
    });

    const response = await handler(request({ action: "plan", commandId, profile }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      commandId,
      status: "succeeded",
      result: authoritativeRow,
      error: null,
    });
    expect(generate).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(commandStore.complete).toHaveBeenCalledWith(expect.objectContaining({
      commandId,
      document: weeklyPlanFixture,
    }));
  });

  it("keeps the command pending when the provider transport outcome is unknown", async () => {
    const commandStore = store();
    const unknownUsage = {
      ...usageRecord,
      outcome: "failure" as const,
      errorCode: "ai_timeout",
    };
    const handler = createGenerateMealPlanHandler({
      authenticate: vi.fn().mockResolvedValue({ id: "user-1" }),
      generate: vi.fn().mockRejectedValue(new ProviderGenerationError(
        "Meal generation timed out.",
        504,
        "ai_timeout",
        unknownUsage,
        true,
      )),
      persist: vi.fn().mockResolvedValue(undefined),
      initialGeneration: commandStore,
    });

    const response = await handler(request({ action: "plan", commandId, profile }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "generation_outcome_unknown",
        message: "The provider outcome is unknown and requires reconciliation.",
      },
    });
    expect(commandStore.complete).not.toHaveBeenCalled();
    expect(commandStore.fail).not.toHaveBeenCalled();
    expect(commandStore.checkpoint).toHaveBeenCalledTimes(1);
  });

  it("recovers a persisted initial command identity without reconstructing input or calling the provider", async () => {
    const commandStore = {
      ...store(),
      recover: vi.fn().mockResolvedValue({
        commandId,
        status: "failed",
        result: null,
        error: {
          code: "provider_outcome_unrecoverable",
          message: "No Current Weekly Plan was committed.",
          retryable: false,
        },
        shouldGenerate: false,
        checkpoint: null,
        inputFingerprint: "a".repeat(64),
      }),
    };
    const generate = vi.fn();
    const handler = createGenerateMealPlanHandler({
      authenticate: vi.fn().mockResolvedValue({ id: "user-1" }),
      generate,
      persist: vi.fn(),
      initialGeneration: commandStore,
    });

    const response = await handler(request({
      action: "plan",
      commandId,
      profile: {},
      resumeExisting: true,
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      commandId,
      status: "failed",
      error: {
        code: "provider_outcome_unrecoverable",
        retryable: false,
      },
    });
    expect(commandStore.recover).toHaveBeenCalledWith({
      commandId,
      userId: "user-1",
    });
    expect(commandStore.begin).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });
});
