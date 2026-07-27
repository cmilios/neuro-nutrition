// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { weeklyPlanFixture } from "../../../test/weeklyPlanFixture";
import {
  createGenerateMealPlanHandler,
  type MealRerollCommandStore,
} from "./handler";
import { createOpenAIUsageRecord } from "./usage";

const commandId = "10000000-0000-4000-8000-000000000001";
const displayedPlanId = "20000000-0000-4000-8000-000000000001";
const currentPlanId = "20000000-0000-4000-8000-000000000002";
const profile = {
  age: 30,
  gender: "Male",
  heightCm: 175,
  weightKg: 75,
  activityLevel: "Moderately Active",
  goal: "Lose Weight",
  dietType: "Mediterranean",
};
const authoritativeMeal = {
  ...weeklyPlanFixture.days[0].breakfast,
  name: "Authoritative breakfast",
};
const replacement = {
  ...weeklyPlanFixture.days[0].breakfast,
  name: "Replacement breakfast",
  ingredients: ["different ingredient"],
  instructions: ["Cook the different ingredient"],
  mealType: "breakfast",
};
const authoritativeRow = {
  planId: currentPlanId,
  userId: "user-1",
  document: weeklyPlanFixture,
  schemaVersion: 1,
  revision: 8,
  isActive: true,
  createdAt: "2026-07-27T12:00:00.000Z",
  updatedAt: "2026-07-27T12:01:00.000Z",
  deactivatedAt: null,
  predecessorPlanId: displayedPlanId,
  generationId: null,
};
const usageRecord = createOpenAIUsageRecord({
  callId: "00000000-0000-4000-8000-000000000101",
  attempt: 1,
  configuredModel: "gpt-5.6-sol",
  outcome: "success",
});

const request = () => new Request("http://localhost/generate", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    action: "meal",
    commandId,
    profile,
    displayedPlanId,
    displayedRevision: 3,
    day: "Monday",
    mealType: "breakfast",
  }),
});

const store = (): MealRerollCommandStore => ({
  begin: vi.fn().mockResolvedValue({
    commandId,
    status: "in_progress",
    result: null,
    error: null,
    shouldGenerate: true,
    target: {
      planId: currentPlanId,
      day: "Monday",
      mealType: "breakfast",
      meal: authoritativeMeal,
    },
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

describe("durable authoritative Meal Reroll HTTP command", () => {
  it("rejects a browser-supplied meal instead of treating stale content as authority", async () => {
    const mealReroll = store();
    const generate = vi.fn();
    const handler = createGenerateMealPlanHandler({
      authenticate: vi.fn().mockResolvedValue({ id: "user-1" }),
      generate,
      persist: vi.fn(),
      mealReroll,
    });
    const suppliedMealRequest = new Request("http://localhost/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "meal",
        commandId,
        profile,
        displayedPlanId,
        displayedRevision: 3,
        day: "Monday",
        mealType: "breakfast",
        currentMeal: weeklyPlanFixture.days[0].breakfast,
      }),
    });

    expect(await (await handler(suppliedMealRequest)).json()).toEqual({
      error: {
        code: "invalid_command",
        message: "A valid Meal Reroll command is required.",
      },
    });
    expect(mealReroll.begin).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("rejects browser-supplied plan JSON instead of accepting replacement authority", async () => {
    const mealReroll = store();
    const generate = vi.fn();
    const handler = createGenerateMealPlanHandler({
      authenticate: vi.fn().mockResolvedValue({ id: "user-1" }),
      generate,
      persist: vi.fn(),
      mealReroll,
    });
    const suppliedPlanRequest = new Request("http://localhost/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "meal",
        commandId,
        profile,
        displayedPlanId,
        displayedRevision: 3,
        day: "Monday",
        mealType: "breakfast",
        currentPlan: weeklyPlanFixture,
      }),
    });

    expect(await (await handler(suppliedPlanRequest)).json()).toEqual({
      error: {
        code: "invalid_command",
        message: "A valid Meal Reroll command is required.",
      },
    });
    expect(mealReroll.begin).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("uses the reserved authoritative meal and returns the complete committed row", async () => {
    const mealReroll = store();
    const generate = vi.fn().mockResolvedValue({ data: replacement, usageRecord });
    const handler = createGenerateMealPlanHandler({
      authenticate: vi.fn().mockResolvedValue({ id: "user-1" }),
      generate,
      persist: vi.fn().mockResolvedValue(undefined),
      mealReroll,
    });

    const response = await handler(request());

    expect(await response.json()).toEqual({
      commandId,
      status: "succeeded",
      result: authoritativeRow,
      error: null,
    });
    expect(mealReroll.begin).toHaveBeenCalledBefore(generate);
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      action: "meal",
      currentMeal: authoritativeMeal,
      mealType: "breakfast",
    }));
    expect(mealReroll.complete).toHaveBeenCalledWith(expect.objectContaining({
      commandId,
      meal: expect.not.objectContaining({ mealType: expect.anything() }),
    }));
  });

  it("replays the recorded outcome without another provider call", async () => {
    const mealReroll = store();
    vi.mocked(mealReroll.begin).mockResolvedValue({
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
      mealReroll,
    });

    expect(await (await handler(request())).json()).toEqual({
      commandId,
      status: "succeeded",
      result: authoritativeRow,
      error: null,
    });
    expect(generate).not.toHaveBeenCalled();
    expect(mealReroll.checkpoint).not.toHaveBeenCalled();
    expect(mealReroll.complete).not.toHaveBeenCalled();
  });

  it("checkpoints an invalid billable attempt when usage attribution is unavailable", async () => {
    const mealReroll = store();
    const invalidResult = {
      data: {
        ...authoritativeMeal,
        mealType: "breakfast",
      },
      usageRecord,
    };
    const generate = vi.fn().mockResolvedValue(invalidResult);
    const handler = createGenerateMealPlanHandler({
      authenticate: vi.fn().mockResolvedValue({ id: "user-1" }),
      generate,
      persist: vi.fn().mockRejectedValue(new Error("ledger unavailable")),
      mealReroll,
    });

    const response = await handler(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "usage_persistence_failed",
        message: "The provider attempt is awaiting durable reconciliation.",
      },
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(mealReroll.checkpoint).toHaveBeenCalledWith(expect.objectContaining({
      checkpoint: expect.objectContaining({
        kind: "failure",
        usageRecord: expect.objectContaining({
          errorCode: "invalid_meal_reroll",
        }),
      }),
    }));
    expect(mealReroll.fail).not.toHaveBeenCalled();
  });
});
