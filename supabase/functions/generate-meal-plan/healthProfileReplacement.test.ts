// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { weeklyPlanFixture } from "../../../test/weeklyPlanFixture";
import {
  createGenerateMealPlanHandler,
  type NextWeeklyPlanCommandStore,
} from "./handler";
import { createOpenAIUsageRecord } from "./usage";

const commandId = "10000000-0000-4000-8000-000000000001";
const sourcePlanId = "20000000-0000-4000-8000-000000000001";
const profile = {
  age: 31,
  gender: "Male",
  heightCm: 175,
  weightKg: 74,
  activityLevel: "Moderately Active",
  goal: "Lose Weight",
  dietType: "Mediterranean",
};
const savedProfile = { ...profile, weightKg: 72 };
const usageRecord = createOpenAIUsageRecord({
  callId: "00000000-0000-4000-8000-000000000101",
  attempt: 1,
  configuredModel: "gpt-5.6-luna",
  outcome: "success",
});
const resultRow = {
  planId: "20000000-0000-4000-8000-000000000002",
  userId: "user-1",
  document: weeklyPlanFixture,
  schemaVersion: 1,
  revision: 0,
  isActive: true,
  predecessorPlanId: sourcePlanId,
  generationId: commandId,
};

const request = () => new Request("http://localhost/generate", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    action: "plan",
    operation: "health_profile_plan_replacement",
    commandId,
    displayedPlanId: sourcePlanId,
    displayedRevision: 3,
    profile,
  }),
});

const store = (): NextWeeklyPlanCommandStore => ({
  begin: vi.fn().mockResolvedValue({
    commandId,
    status: "in_progress",
    result: null,
    error: null,
    shouldGenerate: true,
    source: { planId: sourcePlanId, revision: 3, document: weeklyPlanFixture },
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
    result: resultRow,
    error: null,
    shouldGenerate: false,
  }),
  fail: vi.fn(),
  recover: vi.fn(),
});

describe("Health Profile Plan Replacement Edge Function command", () => {
  it("uses normal profile-tailored generation and completes after usage persistence", async () => {
    const commandStore = store();
    const generate = vi.fn().mockResolvedValue({ data: weeklyPlanFixture, usageRecord });
    const persist = vi.fn().mockResolvedValue(undefined);
    const handler = createGenerateMealPlanHandler({
      authenticate: vi.fn().mockResolvedValue({ id: "user-1" }),
      generate,
      persist,
      loadHealthProfile: vi.fn().mockResolvedValue(savedProfile),
      profileReplacement: commandStore,
    });

    const response = await handler(request());

    expect(await response.json()).toEqual({
      commandId,
      status: "succeeded",
      result: resultRow,
      error: null,
    });
    expect(commandStore.begin).toHaveBeenCalledWith(expect.objectContaining({
      sourcePlanId,
      sourceRevision: 3,
      inputFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      profile: savedProfile,
      reviewType: undefined,
      currentPlan: undefined,
      feedback: undefined,
    }));
    expect(commandStore.checkpoint).toHaveBeenCalledBefore(persist);
    expect(commandStore.complete).toHaveBeenCalledAfter(persist);
  });

  it("replays a completed command without a second provider call", async () => {
    const commandStore = store();
    vi.mocked(commandStore.begin).mockResolvedValue({
      commandId,
      status: "succeeded",
      result: resultRow,
      error: null,
      shouldGenerate: false,
    });
    const generate = vi.fn();
    const handler = createGenerateMealPlanHandler({
      authenticate: vi.fn().mockResolvedValue({ id: "user-1" }),
      generate,
      persist: vi.fn(),
      loadHealthProfile: vi.fn().mockResolvedValue(savedProfile),
      profileReplacement: commandStore,
    });

    expect(await (await handler(request())).json()).toMatchObject({
      commandId,
      status: "succeeded",
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("rejects missing source authority before starting the command", async () => {
    const commandStore = store();
    const handler = createGenerateMealPlanHandler({
      authenticate: vi.fn().mockResolvedValue({ id: "user-1" }),
      generate: vi.fn(),
      persist: vi.fn(),
      loadHealthProfile: vi.fn().mockResolvedValue(savedProfile),
      profileReplacement: commandStore,
    });
    const invalid = new Request("http://localhost/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "plan",
        operation: "health_profile_plan_replacement",
        commandId,
        profile,
      }),
    });

    expect((await handler(invalid)).status).toBe(400);
    expect(commandStore.begin).not.toHaveBeenCalled();
  });

  it("invokes stale recovery when replay finds an in-progress command", async () => {
    const commandStore = store();
    vi.mocked(commandStore.begin).mockResolvedValue({
      commandId,
      status: "in_progress",
      result: null,
      error: null,
      shouldGenerate: false,
    });
    vi.mocked(commandStore.recover!).mockResolvedValue({
      commandId,
      status: "failed",
      result: null,
      error: {
        code: "stale_generation_recovered",
        message: "Retry.",
        retryable: true,
      },
      shouldGenerate: false,
    });
    const handler = createGenerateMealPlanHandler({
      authenticate: vi.fn().mockResolvedValue({ id: "user-1" }),
      generate: vi.fn(),
      persist: vi.fn(),
      loadHealthProfile: vi.fn().mockResolvedValue(savedProfile),
      profileReplacement: commandStore,
    });

    expect(await (await handler(request())).json()).toMatchObject({
      status: "failed",
      error: { code: "stale_generation_recovered" },
    });
    expect(commandStore.recover).toHaveBeenCalledWith({
      commandId,
      userId: "user-1",
    });
  });

  it("recovers a persisted command identity without re-fingerprinting a changed profile", async () => {
    const commandStore = store();
    const originalFingerprint = "a".repeat(64);
    vi.mocked(commandStore.recover!).mockResolvedValue({
      commandId,
      status: "failed",
      result: null,
      error: {
        code: "stale_generation_recovered",
        message: "Retry.",
        retryable: true,
      },
      shouldGenerate: false,
      inputFingerprint: originalFingerprint,
    });
    const loadHealthProfile = vi.fn().mockResolvedValue({
      ...savedProfile,
      dietType: "Vegan",
    });
    const handler = createGenerateMealPlanHandler({
      authenticate: vi.fn().mockResolvedValue({ id: "user-1" }),
      generate: vi.fn(),
      persist: vi.fn(),
      loadHealthProfile,
      profileReplacement: commandStore,
    });
    const resumeRequest = new Request("http://localhost/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "plan",
        operation: "health_profile_plan_replacement",
        resumeExisting: true,
        commandId,
        displayedPlanId: sourcePlanId,
        displayedRevision: 3,
        profile: { ...profile, dietType: "Vegan" },
      }),
    });

    expect(await (await handler(resumeRequest)).json()).toEqual({
      commandId,
      status: "failed",
      result: null,
      error: {
        code: "stale_generation_recovered",
        message: "Retry.",
        retryable: true,
      },
    });
    expect(commandStore.recover).toHaveBeenCalledWith({
      commandId,
      userId: "user-1",
    });
    expect(commandStore.begin).not.toHaveBeenCalled();
    expect(loadHealthProfile).not.toHaveBeenCalled();
  });
});
