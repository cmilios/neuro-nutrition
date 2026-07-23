// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  createGenerateMealPlanHandler,
  ProviderGenerationError,
} from "./handler";
import { createOpenAIUsageRecord } from "./usage";
import { weeklyPlanFixture } from "../../../test/weeklyPlanFixture";

const profile = {
  age: 30,
  gender: "Male",
  heightCm: 175,
  weightKg: 75,
  activityLevel: "Moderately Active",
  goal: "Lose Weight",
  dietType: "Mediterranean",
};

const mealTypes = ["breakfast", "lunch", "dinner", "snack"] as const;

const partialFeedback = (likedSlots: number[]) =>
  weeklyPlanFixture.days.flatMap((day, dayIndex) =>
    mealTypes.map((type, typeIndex) => ({
      day: day.day,
      type,
      name: day[type].name,
      cooked: likedSlots.includes(dayIndex * mealTypes.length + typeIndex),
      liked: likedSlots.includes(dayIndex * mealTypes.length + typeIndex),
    }))
  );

const partialSuccessor = (likedSlots: number[]) => {
  const candidate = structuredClone(weeklyPlanFixture);
  candidate.days.forEach((day, dayIndex) => {
    for (const type of mealTypes) {
      day[type] = {
        ...day[type],
        name: `Replacement ${dayIndex} ${type}`,
        ingredients: [`replacement ingredient ${dayIndex} ${type}`],
        instructions: [`replacement preparation ${dayIndex} ${type}`],
      };
    }
  });
  for (const slot of likedSlots) {
    const type = mealTypes[slot % mealTypes.length];
    const oldDay = Math.floor(slot / mealTypes.length);
    candidate.days[(oldDay + 1) % 7][type] =
      structuredClone(weeklyPlanFixture.days[oldDay][type]);
  }
  return candidate;
};

describe("generate-meal-plan HTTP contract", () => {
  it("returns a generated Weekly Plan through controlled boundaries", async () => {
    const weeklyPlan = { weeklySummary: "Balanced week", days: [] };
    const authenticate = vi.fn().mockResolvedValue({ id: "user-1" });
    const generate = vi.fn().mockResolvedValue({
      data: weeklyPlan,
      usageRecord: createOpenAIUsageRecord({
        callId: "00000000-0000-4000-8000-000000000101",
        attempt: 1,
        configuredModel: "gpt-5.6-sol",
        providerRequestId: "req_123",
        response: {
          id: "resp_123",
          model: "gpt-5.6-sol",
          usage: {
          input_tokens: 1_000,
          input_tokens_details: { cached_tokens: 200, cache_write_tokens: 100 },
          output_tokens: 500,
          output_tokens_details: { reasoning_tokens: 120 },
          total_tokens: 1_500,
          },
        },
        outcome: "success",
      }),
    });
    const persist = vi.fn().mockResolvedValue(undefined);
    const handler = createGenerateMealPlanHandler({ authenticate, generate, persist });

    const response = await handler(new Request("http://localhost/generate", {
      method: "POST",
      headers: { Authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify({ action: "plan", profile }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: weeklyPlan });
    expect(authenticate).toHaveBeenCalledWith(expect.any(Request));
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ action: "plan", profile }));
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith({
      callId: "00000000-0000-4000-8000-000000000101",
      userId: "user-1",
      action: "plan",
      attempt: 1,
      model: "gpt-5.6-sol",
      provider: "openai",
      providerResponseId: "resp_123",
      providerRequestId: "req_123",
      inputTokens: 1_000,
      cachedInputTokens: 200,
      cacheWriteInputTokens: 100,
      outputTokens: 500,
      reasoningOutputTokens: 120,
      totalTokens: 1_500,
      rawUsage: {
        input_tokens: 1_000,
        input_tokens_details: { cached_tokens: 200, cache_write_tokens: 100 },
        output_tokens: 500,
        output_tokens_details: { reasoning_tokens: 120 },
        total_tokens: 1_500,
      },
      outcome: "success",
      estimatedCostUsd: 0.019225,
      pricingVersion: "openai-standard-2026-07-22",
      pricingSnapshot: {
        currency: "USD",
        unitTokens: 1_000_000,
        inputPerMillionUsd: 5,
        cachedInputPerMillionUsd: 0.5,
        cacheWriteInputPerMillionUsd: 6.25,
        outputPerMillionUsd: 30,
        longContextThresholdTokens: 272_000,
        longContextInputMultiplier: 2,
        longContextOutputMultiplier: 1.5,
      },
    });
  });

  it("returns a structured response when authentication fails", async () => {
    const handler = createGenerateMealPlanHandler({
      authenticate: vi.fn().mockRejectedValue(new Error("invalid token")),
      generate: vi.fn(),
      persist: vi.fn(),
    });

    const response = await handler(new Request("http://localhost/generate", {
      method: "POST",
      body: JSON.stringify({ action: "plan", profile }),
    }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "unauthorized", message: "Your session is invalid or expired. Please log in again." },
    });
  });

  it("returns a rerolled meal through the existing HTTP contract", async () => {
    const meal = { name: "Rerolled Breakfast" };
    const generate = vi.fn().mockResolvedValue({
      data: meal,
      usageRecord: {
        callId: "00000000-0000-4000-8000-000000000102",
        attempt: 1,
        model: "gpt-5.6-sol",
        provider: "openai",
        outcome: "success",
      },
    });
    const persist = vi.fn().mockResolvedValue(undefined);
    const handler = createGenerateMealPlanHandler({
      authenticate: vi.fn().mockResolvedValue({ id: "user-1" }),
      generate,
      persist,
    });

    const response = await handler(new Request("http://localhost/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "meal", mealType: "breakfast", profile }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: meal });
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ action: "meal", mealType: "breakfast" }));
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      action: "meal",
      attempt: 1,
      outcome: "success",
    }));
  });

  it("preserves raw usage without estimating cost for an unknown model", async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const handler = createGenerateMealPlanHandler({
      authenticate: vi.fn().mockResolvedValue({ id: "user-2" }),
      generate: vi.fn().mockResolvedValue({
        data: { weeklySummary: "Future model", days: [] },
        usageRecord: createOpenAIUsageRecord({
          callId: "00000000-0000-4000-8000-000000000103",
          attempt: 1,
          configuredModel: "future-model",
          response: {
            id: "resp_future",
            model: "future-model-2026-08-01",
            usage: { input_tokens: 40, output_tokens: 10, total_tokens: 50 },
          },
          outcome: "success",
        }),
      }),
      persist,
    });

    const response = await handler(new Request("http://localhost/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "plan", profile }),
    }));

    expect(response.status).toBe(200);
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({
      model: "future-model-2026-08-01",
      rawUsage: { input_tokens: 40, output_tokens: 10, total_tokens: 50 },
      estimatedCostUsd: undefined,
      pricingVersion: undefined,
      pricingSnapshot: undefined,
    }));
  });

  it("preserves a structured provider failure response", async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const handler = createGenerateMealPlanHandler({
      authenticate: vi.fn().mockResolvedValue({ id: "user-1" }),
      generate: vi.fn().mockRejectedValue(
        new ProviderGenerationError(
          "The AI provider is rate-limiting requests.",
          429,
          "ai_rate_limited",
          createOpenAIUsageRecord({
            callId: "00000000-0000-4000-8000-000000000104",
            attempt: 1,
            configuredModel: "gpt-5.6-sol",
            providerRequestId: "req_failed",
            response: {
              model: "gpt-5.6-sol",
              usage: { input_tokens: 300, output_tokens: 20, total_tokens: 320 },
            },
            outcome: "failure",
            errorCode: "ai_rate_limited",
          }),
        ),
      ),
      persist,
    });

    const response = await handler(new Request("http://localhost/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "plan", profile }),
    }));

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: { code: "ai_rate_limited", message: "The AI provider is rate-limiting requests." },
    });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      action: "plan",
      providerRequestId: "req_failed",
      inputTokens: 300,
      outputTokens: 20,
      totalTokens: 320,
      outcome: "failure",
      errorCode: "ai_rate_limited",
    }));
  });

  it("records a provider failure without inventing unavailable usage or cost", async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const handler = createGenerateMealPlanHandler({
      authenticate: vi.fn().mockResolvedValue({ id: "user-3" }),
      generate: vi.fn().mockRejectedValue(
        new ProviderGenerationError(
          "The AI provider rejected the generation request.",
          502,
          "ai_provider_error",
          createOpenAIUsageRecord({
            callId: "00000000-0000-4000-8000-000000000105",
            attempt: 1,
            configuredModel: "gpt-5.6-sol",
            providerRequestId: "req_no_usage",
            outcome: "failure",
            errorCode: "ai_provider_error",
          }),
        ),
      ),
      persist,
    });

    const response = await handler(new Request("http://localhost/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "plan", profile }),
    }));

    expect(response.status).toBe(502);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-3",
      providerRequestId: "req_no_usage",
      inputTokens: undefined,
      outputTokens: undefined,
      totalTokens: undefined,
      estimatedCostUsd: undefined,
      outcome: "failure",
    }));
  });

  it("returns generated data when usage persistence is temporarily unavailable", async () => {
    const weeklyPlan = { weeklySummary: "Still delivered", days: [] };
    const persist = vi.fn().mockRejectedValue(new Error("ledger unavailable"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = createGenerateMealPlanHandler({
      authenticate: vi.fn().mockResolvedValue({ id: "user-4" }),
      generate: vi.fn().mockResolvedValue({
        data: weeklyPlan,
        usageRecord: createOpenAIUsageRecord({
          callId: "00000000-0000-4000-8000-000000000106",
          attempt: 1,
          configuredModel: "gpt-5.6-sol",
          response: {
            id: "resp_ledger_failure",
            usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
          },
          outcome: "success",
        }),
      }),
      persist,
    });

    const response = await handler(new Request("http://localhost/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "plan", profile }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: weeklyPlan });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to persist AI Usage Record after retries",
      expect.objectContaining({
        callId: "00000000-0000-4000-8000-000000000106",
        userId: "user-4",
        action: "plan",
      }),
    );
    errorSpy.mockRestore();
  });

  it("repairs one invalid Empty Meal Review result and records both attempts", async () => {
    const invalidPlan = structuredClone(weeklyPlanFixture);
    const repairedPlan = structuredClone(weeklyPlanFixture);
    repairedPlan.days.forEach((day, dayIndex) => {
      for (const type of ["breakfast", "lunch", "dinner", "snack"] as const) {
        day[type] = {
          ...day[type],
          name: `New ${day[type].name}`,
          ingredients: [`new ingredient ${dayIndex} ${type}`],
          instructions: [`new preparation ${dayIndex} ${type}`],
        };
      }
    });
    const generate = vi.fn()
      .mockResolvedValueOnce({
        data: invalidPlan,
        usageRecord: createOpenAIUsageRecord({
          callId: "00000000-0000-4000-8000-000000000201",
          attempt: 1,
          configuredModel: "gpt-5.6-sol",
          outcome: "success",
        }),
      })
      .mockResolvedValueOnce({
        data: repairedPlan,
        usageRecord: createOpenAIUsageRecord({
          callId: "00000000-0000-4000-8000-000000000202",
          attempt: 2,
          configuredModel: "gpt-5.6-sol",
          outcome: "success",
        }),
      });
    const persist = vi.fn().mockResolvedValue(undefined);
    const handler = createGenerateMealPlanHandler({
      authenticate: vi.fn().mockResolvedValue({ id: "user-5" }),
      generate,
      persist,
    });

    const response = await handler(new Request("http://localhost/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "plan",
        profile,
        feedback: [],
        reviewType: "empty",
        currentPlan: weeklyPlanFixture,
      }),
    }));

    expect(response.status).toBe(200);
    expect((await response.json()).data.days).toHaveLength(7);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate).toHaveBeenNthCalledWith(2, expect.objectContaining({
      attempt: 2,
      validationDetails: expect.arrayContaining(["too_many_same_meals"]),
    }));
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenNthCalledWith(1, expect.objectContaining({
      attempt: 1,
      outcome: "failure",
      validationCodes: expect.arrayContaining(["too_many_same_meals"]),
    }));
    expect(persist).toHaveBeenNthCalledWith(2, expect.objectContaining({
      attempt: 2,
      outcome: "success",
    }));
  });

  it("returns a terminal validation error after exactly two invalid attempts", async () => {
    const generate = vi.fn()
      .mockImplementation(({ attempt }) => Promise.resolve({
        data: weeklyPlanFixture,
        usageRecord: createOpenAIUsageRecord({
          callId: `00000000-0000-4000-8000-00000000020${attempt}`,
          attempt,
          configuredModel: "gpt-5.6-sol",
          outcome: "success",
        }),
      }));
    const persist = vi.fn().mockResolvedValue(undefined);
    const handler = createGenerateMealPlanHandler({
      authenticate: vi.fn().mockResolvedValue({ id: "user-6" }),
      generate,
      persist,
    });

    const response = await handler(new Request("http://localhost/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "plan",
        profile,
        feedback: [],
        reviewType: "empty",
        currentPlan: weeklyPlanFixture,
      }),
    }));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: {
        code: "invalid_next_weekly_plan",
        message: "A valid Next Weekly Plan was not created. Your current plan is unchanged.",
      },
    });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("does not suppress the validation retry when usage persistence is unavailable", async () => {
    const repairedPlan = structuredClone(weeklyPlanFixture);
    repairedPlan.days.forEach((day, dayIndex) => {
      for (const type of ["breakfast", "lunch", "dinner", "snack"] as const) {
        day[type] = {
          ...day[type],
          ingredients: [`replacement ${dayIndex} ${type}`],
          instructions: [`prepare replacement ${dayIndex} ${type}`],
        };
      }
    });
    const generate = vi.fn()
      .mockResolvedValueOnce({
        data: weeklyPlanFixture,
        usageRecord: createOpenAIUsageRecord({
          callId: "00000000-0000-4000-8000-000000000211",
          attempt: 1,
          configuredModel: "gpt-5.6-sol",
          outcome: "success",
        }),
      })
      .mockResolvedValueOnce({
        data: repairedPlan,
        usageRecord: createOpenAIUsageRecord({
          callId: "00000000-0000-4000-8000-000000000212",
          attempt: 2,
          configuredModel: "gpt-5.6-sol",
          outcome: "success",
        }),
      });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = createGenerateMealPlanHandler({
      authenticate: vi.fn().mockResolvedValue({ id: "user-7" }),
      generate,
      persist: vi.fn().mockRejectedValue(new Error("ledger unavailable")),
    });

    const response = await handler(new Request("http://localhost/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "plan",
        profile,
        feedback: [],
        reviewType: "empty",
        currentPlan: weeklyPlanFixture,
      }),
    }));

    expect(response.status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });

  it("repairs mixed Partial Meal Review results and preserves exact Liked Meals", async () => {
    const likedSlots = [0, 5, 10, 15];
    const repairedPlan = partialSuccessor(likedSlots);
    const generate = vi.fn()
      .mockResolvedValueOnce({
        data: weeklyPlanFixture,
        usageRecord: createOpenAIUsageRecord({
          callId: "00000000-0000-4000-8000-000000000301",
          attempt: 1,
          configuredModel: "gpt-5.6-sol",
          outcome: "success",
        }),
      })
      .mockResolvedValueOnce({
        data: repairedPlan,
        usageRecord: createOpenAIUsageRecord({
          callId: "00000000-0000-4000-8000-000000000302",
          attempt: 2,
          configuredModel: "gpt-5.6-sol",
          outcome: "success",
        }),
      });
    const persist = vi.fn().mockResolvedValue(undefined);
    const handler = createGenerateMealPlanHandler({
      authenticate: vi.fn().mockResolvedValue({ id: "user-8" }),
      generate,
      persist,
    });

    const response = await handler(new Request("http://localhost/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "plan",
        profile,
        feedback: partialFeedback(likedSlots),
        reviewType: "partial",
        currentPlan: weeklyPlanFixture,
      }),
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    for (const slot of likedSlots) {
      const type = mealTypes[slot % mealTypes.length];
      const oldDay = Math.floor(slot / mealTypes.length);
      expect(body.data.days[(oldDay + 1) % 7][type])
        .toEqual(weeklyPlanFixture.days[oldDay][type]);
    }
    expect(body.data.days[0].lunch.ingredients[0]).toMatch(/^replacement ingredient/);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate).toHaveBeenNthCalledWith(2, expect.objectContaining({
      validationDetails: expect.arrayContaining(["reviewed_meal_not_replaced"]),
    }));
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it("accepts a Proven Weekly Plan successor with all twenty-eight exact meals rotated", async () => {
    const likedSlots = Array.from({ length: 28 }, (_, index) => index);
    const provenSuccessor = partialSuccessor(likedSlots);
    const generate = vi.fn().mockResolvedValue({
      data: provenSuccessor,
      usageRecord: createOpenAIUsageRecord({
        callId: "00000000-0000-4000-8000-000000000303",
        attempt: 1,
        configuredModel: "gpt-5.6-sol",
        outcome: "success",
      }),
    });
    const handler = createGenerateMealPlanHandler({
      authenticate: vi.fn().mockResolvedValue({ id: "user-9" }),
      generate,
      persist: vi.fn().mockResolvedValue(undefined),
    });

    const response = await handler(new Request("http://localhost/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "plan",
        profile,
        feedback: partialFeedback(likedSlots),
        reviewType: "partial",
        currentPlan: weeklyPlanFixture,
      }),
    }));

    expect(response.status).toBe(200);
    expect((await response.json()).data.days).toHaveLength(7);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("rejects non-canonical or incomplete Partial Meal Review slots before generation", async () => {
    const generate = vi.fn();
    const handler = createGenerateMealPlanHandler({
      authenticate: vi.fn().mockResolvedValue({ id: "user-10" }),
      generate,
      persist: vi.fn(),
    });
    const feedback = partialFeedback([0]);
    feedback[1] = { ...feedback[0] };

    const response = await handler(new Request("http://localhost/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "plan",
        profile,
        feedback,
        reviewType: "partial",
        currentPlan: weeklyPlanFixture,
      }),
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "invalid_feedback", message: "Invalid Partial Meal Review." },
    });
    expect(generate).not.toHaveBeenCalled();
  });
});
