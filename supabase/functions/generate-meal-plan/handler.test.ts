// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createGenerateMealPlanHandler, HttpError } from "./handler";

const profile = {
  age: 30,
  gender: "Male",
  heightCm: 175,
  weightKg: 75,
  activityLevel: "Moderately Active",
  goal: "Lose Weight",
  dietType: "Mediterranean",
};

describe("generate-meal-plan HTTP contract", () => {
  it("returns a generated Weekly Plan through controlled boundaries", async () => {
    const weeklyPlan = { weeklySummary: "Balanced week", days: [] };
    const authenticate = vi.fn().mockResolvedValue({ id: "user-1" });
    const generate = vi.fn().mockResolvedValue(weeklyPlan);
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
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", action: "plan", outcome: "success" }));
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
    const generate = vi.fn().mockResolvedValue(meal);
    const handler = createGenerateMealPlanHandler({
      authenticate: vi.fn().mockResolvedValue({ id: "user-1" }),
      generate,
      persist: vi.fn().mockResolvedValue(undefined),
    });

    const response = await handler(new Request("http://localhost/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "meal", mealType: "breakfast", profile }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: meal });
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ action: "meal", mealType: "breakfast" }));
  });

  it("preserves a structured provider failure response", async () => {
    const handler = createGenerateMealPlanHandler({
      authenticate: vi.fn().mockResolvedValue({ id: "user-1" }),
      generate: vi.fn().mockRejectedValue(
        new HttpError("The AI provider is rate-limiting requests.", 429, "ai_rate_limited"),
      ),
      persist: vi.fn().mockResolvedValue(undefined),
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
  });
});
