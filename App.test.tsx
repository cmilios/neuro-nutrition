import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { weeklyPlanFixture } from "./test/weeklyPlanFixture";

const { edgeFunctionInvoke, getUserData, saveUserData } = vi.hoisted(() => ({
  edgeFunctionInvoke: vi.fn(),
  getUserData: vi.fn(),
  saveUserData: vi.fn(),
}));

vi.mock("./services/supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: {
          session: {
            user: { id: "user-1", email: "alex@example.com", user_metadata: { name: "Alex" } },
          },
        },
        error: null,
      }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
    functions: { invoke: edgeFunctionInvoke },
  },
}));

vi.mock("./services/storageService", () => ({
  storageService: {
    getUserData,
    saveUserData,
    clearUserData: vi.fn(),
  },
}));

vi.mock("./services/authService", () => ({
  authService: { logout: vi.fn() },
}));

import App from "./App";

describe("application generation flow", () => {
  beforeEach(() => {
    edgeFunctionInvoke.mockReset();
    getUserData.mockReset().mockResolvedValue(null);
    saveUserData.mockReset().mockResolvedValue(undefined);
  });

  it("generates and renders the returned Weekly Plan", async () => {
    edgeFunctionInvoke.mockResolvedValue({ data: { data: weeklyPlanFixture }, error: null });
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "Let's build your plan." });
    await user.click(screen.getByRole("button", { name: "Generate Meal Plan" }));

    expect(await screen.findByText("Test Berry Breakfast")).toBeInTheDocument();
    expect(edgeFunctionInvoke).toHaveBeenCalledWith("generate-meal-plan", expect.objectContaining({
      body: expect.objectContaining({ action: "plan" }),
    }));
    expect(saveUserData).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ age: 30 }),
      weeklyPlanFixture,
      [],
    );
  });

  it("rerolls a meal through the same Edge Function boundary", async () => {
    const profile = {
      age: 30,
      gender: "Male",
      heightCm: 175,
      weightKg: 75,
      activityLevel: "Moderately Active",
      goal: "Lose Weight",
      dietType: "Mediterranean",
    };
    getUserData.mockResolvedValue({ profile, mealPlan: weeklyPlanFixture, milestones: [] });
    const rerolledMeal = {
      ...weeklyPlanFixture.days[0].breakfast,
      name: "Rerolled Breakfast",
      macros: { calories: 450, protein: 35, carbs: 42, fats: 14 },
    };
    edgeFunctionInvoke.mockResolvedValue({ data: { data: rerolledMeal }, error: null });
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("Test Berry Breakfast");
    await user.click(screen.getAllByTitle("Reroll this meal")[0]);

    expect(await screen.findByText("Rerolled Breakfast")).toBeInTheDocument();
    expect(edgeFunctionInvoke).toHaveBeenCalledWith("generate-meal-plan", {
      body: expect.objectContaining({
        action: "meal",
        mealType: "breakfast",
        currentMeal: weeklyPlanFixture.days[0].breakfast,
      }),
    });
    expect(saveUserData).toHaveBeenCalledWith(
      "user-1",
      profile,
      expect.objectContaining({
        days: expect.arrayContaining([
          expect.objectContaining({
            breakfast: rerolledMeal,
            lunch: weeklyPlanFixture.days[0].lunch,
            dailySummary: {
              calories: 1650,
              protein: 125,
              carbs: 162,
              fats: 50,
            },
          }),
        ]),
      }),
      [],
    );
  });

  it("preserves the original meal and reuses the in-memory Meal Reroll request through Try Again", async () => {
    const profile = {
      age: 30,
      gender: "Male",
      heightCm: 175,
      weightKg: 75,
      activityLevel: "Moderately Active",
      goal: "Lose Weight",
      dietType: "Mediterranean",
    };
    const replacement = {
      ...weeklyPlanFixture.days[0].breakfast,
      name: "Successful Retry Breakfast",
      ingredients: ["replacement ingredient"],
    };
    getUserData.mockResolvedValue({ profile, mealPlan: weeklyPlanFixture, milestones: [] });
    edgeFunctionInvoke
      .mockResolvedValueOnce({
        data: null,
        error: { message: "A different meal was not created. Your original meal is unchanged." },
      })
      .mockResolvedValueOnce({ data: { data: replacement }, error: null });
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("Test Berry Breakfast");
    await user.click(screen.getAllByTitle("Reroll this meal")[0]);

    expect(await screen.findByText("A different meal was not created. Your original meal is unchanged."))
      .toBeInTheDocument();
    expect(screen.getByText("Test Berry Breakfast")).toBeInTheDocument();
    expect(saveUserData).not.toHaveBeenCalled();
    const firstRequest = edgeFunctionInvoke.mock.calls[0][1];
    const tryAgain = screen.getByRole("button", { name: "Try Again" });

    await user.click(tryAgain);

    expect(await screen.findByText("Successful Retry Breakfast")).toBeInTheDocument();
    expect(edgeFunctionInvoke.mock.calls[1][1]).toEqual(firstRequest);
    expect(screen.queryByRole("button", { name: "Try Again" })).not.toBeInTheDocument();
    expect(screen.getAllByTitle("Reroll this meal")).toHaveLength(4);
  });

  it("clears Meal Reroll retry state when the application session is refreshed", async () => {
    const profile = {
      age: 30,
      gender: "Male",
      heightCm: 175,
      weightKg: 75,
      activityLevel: "Moderately Active",
      goal: "Lose Weight",
      dietType: "Mediterranean",
    };
    getUserData.mockResolvedValue({ profile, mealPlan: weeklyPlanFixture, milestones: [] });
    edgeFunctionInvoke.mockResolvedValue({
      data: null,
      error: { message: "A different meal was not created. Your original meal is unchanged." },
    });
    const user = userEvent.setup();
    const firstSession = render(<App />);

    await screen.findByText("Test Berry Breakfast");
    await user.click(screen.getAllByTitle("Reroll this meal")[0]);
    expect(await screen.findByRole("button", { name: "Try Again" })).toBeInTheDocument();

    firstSession.unmount();
    render(<App />);

    expect(await screen.findByText("Test Berry Breakfast")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try Again" })).not.toBeInTheDocument();
  });

  it("labels Empty and Partial Meal Review actions explicitly", async () => {
    getUserData.mockResolvedValue({
      profile: {
        age: 30,
        gender: "Male",
        heightCm: 175,
        weightKg: 75,
        activityLevel: "Moderately Active",
        goal: "Lose Weight",
        dietType: "Mediterranean",
      },
      mealPlan: weeklyPlanFixture,
      milestones: [],
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Next Week" }));

    expect(screen.getByRole("button", { name: "Continue Without Review" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate Next Plan" })).toBeInTheDocument();
    expect(screen.getByText(/untouched meals.*uncooked meals.*replaced/i)).toBeInTheDocument();
  });

  it("keeps an untouched Generate Next Plan submission as an Empty Meal Review", async () => {
    getUserData.mockResolvedValue({
      profile: {
        age: 30,
        gender: "Male",
        heightCm: 175,
        weightKg: 75,
        activityLevel: "Moderately Active",
        goal: "Lose Weight",
        dietType: "Mediterranean",
      },
      mealPlan: weeklyPlanFixture,
      milestones: [],
    });
    edgeFunctionInvoke.mockResolvedValue({ data: { data: weeklyPlanFixture }, error: null });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Next Week" }));
    await user.click(screen.getByRole("button", { name: "Generate Next Plan" }));

    expect(edgeFunctionInvoke.mock.calls[0][1].body).toEqual(expect.objectContaining({
      feedback: [],
      reviewType: "empty",
    }));
  });

  it("normalizes untouched Meal Slots when submitting a Partial Meal Review", async () => {
    getUserData.mockResolvedValue({
      profile: {
        age: 30,
        gender: "Male",
        heightCm: 175,
        weightKg: 75,
        activityLevel: "Moderately Active",
        goal: "Lose Weight",
        dietType: "Mediterranean",
      },
      mealPlan: weeklyPlanFixture,
      milestones: [],
    });
    const convergedPlan = structuredClone(weeklyPlanFixture);
    convergedPlan.days[0].breakfast.name = "Converged Partial Breakfast";
    edgeFunctionInvoke.mockResolvedValue({ data: { data: convergedPlan }, error: null });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Next Week" }));
    await user.click(screen.getAllByRole("button", { name: "Cooked" })[0]);
    await user.click(screen.getByRole("button", { name: "Generate Next Plan" }));

    expect(await screen.findByText("Converged Partial Breakfast")).toBeInTheDocument();
    const request = edgeFunctionInvoke.mock.calls[0][1].body;
    expect(request.reviewType).toBe("partial");
    expect(request.feedback).toHaveLength(28);
    expect(request.feedback[0]).toEqual(expect.objectContaining({
      cooked: true,
      liked: false,
    }));
    expect(request.feedback.slice(1)).toEqual(expect.arrayContaining([
      expect.objectContaining({ cooked: false, liked: false }),
    ]));
    expect(saveUserData).toHaveBeenCalledWith(
      "user-1",
      expect.any(Object),
      convergedPlan,
      [],
    );
  });

  it("preserves the current plan and reuses the Empty Meal Review request through Try Again", async () => {
    const profile = {
      age: 30,
      gender: "Male",
      heightCm: 175,
      weightKg: 75,
      activityLevel: "Moderately Active",
      goal: "Lose Weight",
      dietType: "Mediterranean",
    };
    const nextPlan = structuredClone(weeklyPlanFixture);
    nextPlan.days[0].breakfast.name = "Next Week Breakfast";
    getUserData.mockResolvedValue({ profile, mealPlan: weeklyPlanFixture, milestones: [] });
    edgeFunctionInvoke
      .mockResolvedValueOnce({
        data: null,
        error: { message: "A valid Next Weekly Plan was not created. Your current plan is unchanged." },
      })
      .mockResolvedValueOnce({ data: { data: nextPlan }, error: null });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Next Week" }));
    await user.click(screen.getByRole("button", { name: "Continue Without Review" }));

    expect(await screen.findByText("Test Berry Breakfast")).toBeInTheDocument();
    const tryAgain = screen.getByRole("button", { name: "Try Again" });
    const firstRequest = edgeFunctionInvoke.mock.calls[0][1];
    expect(firstRequest.body).toEqual(expect.objectContaining({
      action: "plan",
      feedback: [],
      reviewType: "empty",
      currentPlan: weeklyPlanFixture,
    }));
    expect(saveUserData).not.toHaveBeenCalled();

    await user.click(tryAgain);

    expect(await screen.findByText("Next Week Breakfast")).toBeInTheDocument();
    expect(edgeFunctionInvoke.mock.calls[1][1]).toEqual(firstRequest);
    expect(screen.getByRole("button", { name: "Next Week" })).toBeInTheDocument();
    expect(saveUserData).toHaveBeenCalledWith("user-1", profile, nextPlan, []);
  });

  it("clears terminal retry state when the application session is refreshed", async () => {
    const profile = {
      age: 30,
      gender: "Male",
      heightCm: 175,
      weightKg: 75,
      activityLevel: "Moderately Active",
      goal: "Lose Weight",
      dietType: "Mediterranean",
    };
    getUserData.mockResolvedValue({ profile, mealPlan: weeklyPlanFixture, milestones: [] });
    edgeFunctionInvoke.mockResolvedValue({
      data: null,
      error: { message: "A valid Next Weekly Plan was not created. Your current plan is unchanged." },
    });
    const user = userEvent.setup();
    const firstSession = render(<App />);

    await user.click(await screen.findByRole("button", { name: "Next Week" }));
    await user.click(screen.getByRole("button", { name: "Continue Without Review" }));
    expect(await screen.findByRole("button", { name: "Try Again" })).toBeInTheDocument();

    firstSession.unmount();
    render(<App />);

    expect(await screen.findByRole("button", { name: "Next Week" })).toBeInTheDocument();
    expect(screen.getByText("Test Berry Breakfast")).toBeInTheDocument();
  });
});
