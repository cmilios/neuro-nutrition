import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { weeklyPlanFixture } from "./test/weeklyPlanFixture";

const nextGenerationSuccess = (
  document: typeof weeklyPlanFixture,
  commandId: string,
) => ({
  data: {
    commandId,
    status: "succeeded",
    result: {
      planId: "00000000-0000-4000-8000-000000000030",
      userId: "user-1",
      document,
      schemaVersion: 1,
      revision: 0,
      isActive: true,
      createdAt: "2026-07-27T11:00:00.000Z",
      updatedAt: "2026-07-27T11:00:00.000Z",
      deactivatedAt: null,
      predecessorPlanId: "00000000-0000-4000-8000-000000000010",
      generationId: commandId,
      nextGenerationId: null,
      nextGenerationLockedAt: null,
    },
    error: null,
  },
  error: null,
});

const {
  edgeFunctionInvoke,
  getProfileData,
  saveProfileData,
  getCurrent,
  getPendingMealRerolls,
  createCurrent,
  saveCurrent,
  setIngredientChecked,
  startOver,
  logout,
  changePassword,
  sendPasswordRecovery,
  completePasswordRecovery,
  authStateChangeCallbacks,
} = vi.hoisted(() => ({
  edgeFunctionInvoke: vi.fn(),
  getProfileData: vi.fn(),
  saveProfileData: vi.fn(),
  getCurrent: vi.fn(),
  getPendingMealRerolls: vi.fn(),
  createCurrent: vi.fn(),
  saveCurrent: vi.fn(),
  setIngredientChecked: vi.fn(),
  startOver: vi.fn(),
  logout: vi.fn(),
  changePassword: vi.fn(),
  sendPasswordRecovery: vi.fn(),
  completePasswordRecovery: vi.fn(),
  authStateChangeCallbacks: [] as Array<(event: string, session: unknown) => void>,
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
      onAuthStateChange: vi.fn((callback) => {
        authStateChangeCallbacks.push(callback);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
    },
    functions: { invoke: edgeFunctionInvoke },
  },
}));

vi.mock("./services/storageService", () => ({
  storageService: {
    getProfileData,
    saveProfileData,
  },
}));

vi.mock("./services/weeklyPlanGateway", () => ({
  createWeeklyPlanInvalidationSubscription: vi.fn(() => ({
    unsubscribe: vi.fn(),
  })),
  weeklyPlanGateway: {
    getCurrent,
    getPendingMealRerolls,
    createCurrent,
    saveCurrent,
    setIngredientChecked,
    startOver,
  },
}));

vi.mock("./services/authService", () => ({
  authService: {
    logout,
    changePassword,
    sendPasswordRecovery,
    completePasswordRecovery,
  },
}));

import App from "./App";

describe("application generation flow", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/neuro-nutrition/");
    authStateChangeCallbacks.length = 0;
    edgeFunctionInvoke.mockReset();
    getProfileData.mockReset().mockResolvedValue(null);
    saveProfileData.mockReset().mockResolvedValue(undefined);
    getCurrent.mockReset().mockImplementation(async () => {
      const loadedData = await getProfileData.mock.results.at(-1)?.value;
      return loadedData?.mealPlan ? {
        planId: "00000000-0000-4000-8000-000000000010",
        userId: "user-1",
        document: loadedData.mealPlan,
        schemaVersion: 1,
        revision: 0,
        isActive: true,
        createdAt: "2026-07-27T10:00:00.000Z",
        updatedAt: "2026-07-27T10:00:00.000Z",
        deactivatedAt: null,
        predecessorPlanId: null,
        generationId: null,
      } : null;
    });
    getPendingMealRerolls.mockReset().mockResolvedValue([]);
    createCurrent.mockReset().mockImplementation(async ({ commandId, userId, document }) => ({
      commandId,
      status: "succeeded",
      result: {
        planId: "00000000-0000-4000-8000-000000000020",
        userId,
        document,
        schemaVersion: 1,
        revision: 0,
        isActive: true,
        createdAt: "2026-07-27T10:00:00.000Z",
        updatedAt: "2026-07-27T10:00:00.000Z",
        deactivatedAt: null,
        predecessorPlanId: null,
        generationId: null,
      },
      error: null,
    }));
    saveCurrent.mockReset().mockImplementation(async ({ commandId, userId, document }) => ({
      commandId,
      status: "succeeded",
      result: {
        planId: "00000000-0000-4000-8000-000000000020",
        userId,
        document,
        schemaVersion: 1,
        revision: 0,
        isActive: true,
        createdAt: "2026-07-27T10:00:00.000Z",
        updatedAt: "2026-07-27T10:00:00.000Z",
        deactivatedAt: null,
        predecessorPlanId: null,
        generationId: null,
      },
      error: null,
    }));
    setIngredientChecked.mockReset().mockImplementation(async (command) => {
      const document = structuredClone(weeklyPlanFixture);
      const day = document.days.find((candidate) => candidate.day === command.day);
      const meal = day?.[command.mealType];
      if (meal) {
        meal.checkedIngredientIds = command.checked
          ? [...new Set([...meal.checkedIngredientIds, command.ingredientId])]
          : meal.checkedIngredientIds.filter((identity) => identity !== command.ingredientId);
      }
      return {
        commandId: command.commandId,
        status: "succeeded",
        result: {
          planId: command.planId,
          userId: command.userId,
          document,
          schemaVersion: 1,
          revision: command.displayedRevision + 1,
          isActive: true,
          createdAt: "2026-07-27T10:00:00.000Z",
          updatedAt: "2026-07-27T10:01:00.000Z",
          deactivatedAt: null,
          predecessorPlanId: null,
          generationId: null,
        },
        error: null,
      };
    });
    startOver.mockReset().mockImplementation(async ({ commandId }) => ({
      commandId,
      status: "succeeded",
      result: null,
      error: null,
    }));
    logout.mockReset().mockResolvedValue(undefined);
    changePassword.mockReset().mockResolvedValue(undefined);
    sendPasswordRecovery.mockReset().mockResolvedValue(undefined);
    completePasswordRecovery.mockReset().mockResolvedValue(undefined);
  });

  it("generates and renders the returned Weekly Plan", async () => {
    edgeFunctionInvoke.mockImplementation(async (_name, { body }) => ({
      data: {
        commandId: body.commandId,
        status: "succeeded",
        result: {
          planId: "00000000-0000-4000-8000-000000000020",
          userId: "user-1",
          document: weeklyPlanFixture,
          schemaVersion: 1,
          revision: 0,
          isActive: true,
          createdAt: "2026-07-27T10:00:00.000Z",
          updatedAt: "2026-07-27T10:00:00.000Z",
          deactivatedAt: null,
          predecessorPlanId: null,
          generationId: body.commandId,
        },
        error: null,
      },
      error: null,
    }));
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "Let's build your plan." });
    await waitFor(() => expect(getCurrent).toHaveBeenCalledWith("user-1"));
    await user.click(screen.getByRole("button", { name: "Generate Meal Plan" }));

    expect(await screen.findByText("Test Berry Breakfast")).toBeInTheDocument();
    expect(edgeFunctionInvoke).toHaveBeenCalledWith("generate-meal-plan", expect.objectContaining({
      body: expect.objectContaining({
        action: "plan",
        commandId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      }),
    }));
    expect(createCurrent).not.toHaveBeenCalled();
    expect(saveProfileData).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ age: 30 }),
      [],
    );
    expect(screen.getByText("Current Weekly Plan synchronized")).toBeInTheDocument();
  });

  it("retries an unknown initial-generation outcome with the same command ID", async () => {
    edgeFunctionInvoke
      .mockResolvedValueOnce({
        data: null,
        error: { message: "connection reset" },
      })
      .mockImplementationOnce(async (_name, { body }) => ({
        data: {
          commandId: body.commandId,
          status: "succeeded",
          result: {
            planId: "00000000-0000-4000-8000-000000000020",
            userId: "user-1",
            document: weeklyPlanFixture,
            schemaVersion: 1,
            revision: 0,
            isActive: true,
            createdAt: "2026-07-27T10:00:00.000Z",
            updatedAt: "2026-07-27T10:00:00.000Z",
            deactivatedAt: null,
            predecessorPlanId: null,
            generationId: body.commandId,
          },
          error: null,
        },
        error: null,
      }));
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "Let's build your plan." });
    await user.click(screen.getByRole("button", { name: "Generate Meal Plan" }));
    expect(await screen.findByText("connection reset")).toBeInTheDocument();
    const firstCommandId = edgeFunctionInvoke.mock.calls[0][1].body.commandId;

    await user.click(screen.getByRole("button", { name: "Generate Meal Plan" }));

    expect(await screen.findByText("Test Berry Breakfast")).toBeInTheDocument();
    expect(edgeFunctionInvoke.mock.calls[1][1].body.commandId).toBe(firstCommandId);
  });

  it("uses a new command ID after a confirmed terminal generation failure", async () => {
    edgeFunctionInvoke
      .mockImplementationOnce(async (_name, { body }) => ({
        data: {
          commandId: body.commandId,
          status: "failed",
          result: null,
          error: {
            code: "generation_failed",
            message: "A valid Current Weekly Plan was not created.",
            retryable: false,
          },
        },
        error: null,
      }))
      .mockImplementationOnce(async (_name, { body }) => ({
        data: {
          commandId: body.commandId,
          status: "succeeded",
          result: {
            planId: "00000000-0000-4000-8000-000000000020",
            userId: "user-1",
            document: weeklyPlanFixture,
            schemaVersion: 1,
            revision: 0,
            isActive: true,
            createdAt: "2026-07-27T10:00:00.000Z",
            updatedAt: "2026-07-27T10:00:00.000Z",
            deactivatedAt: null,
            predecessorPlanId: null,
            generationId: body.commandId,
          },
          error: null,
        },
        error: null,
      }));
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "Let's build your plan." });
    await user.click(screen.getByRole("button", { name: "Generate Meal Plan" }));
    expect(await screen.findByText("A valid Current Weekly Plan was not created."))
      .toBeInTheDocument();
    const failedCommandId = edgeFunctionInvoke.mock.calls[0][1].body.commandId;

    await user.click(screen.getByRole("button", { name: "Generate Meal Plan" }));

    expect(await screen.findByText("Test Berry Breakfast")).toBeInTheDocument();
    expect(edgeFunctionInvoke.mock.calls[1][1].body.commandId).not.toBe(failedCommandId);
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
    getProfileData.mockResolvedValue({ profile, mealPlan: weeklyPlanFixture, milestones: [] });
    const rerolledMeal = {
      ...weeklyPlanFixture.days[0].breakfast,
      name: "Rerolled Breakfast",
      macros: { calories: 450, protein: 35, carbs: 42, fats: 14 },
    };
    const rerolledPlan = structuredClone(weeklyPlanFixture);
    rerolledPlan.days[0].breakfast = rerolledMeal;
    edgeFunctionInvoke.mockImplementation(async (_name, options) => ({
      data: {
        commandId: options.body.commandId,
        status: "succeeded",
        result: {
          planId: "00000000-0000-4000-8000-000000000010",
          userId: "user-1",
          document: rerolledPlan,
          schemaVersion: 1,
          revision: 1,
          isActive: true,
          createdAt: "2026-07-27T10:00:00.000Z",
          updatedAt: "2026-07-27T10:01:00.000Z",
          deactivatedAt: null,
          predecessorPlanId: null,
          generationId: null,
        },
        error: null,
      },
      error: null,
    }));
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("Test Berry Breakfast");
    await user.click(screen.getAllByTitle("Reroll this meal")[0]);

    expect(await screen.findByText("Rerolled Breakfast")).toBeInTheDocument();
    expect(edgeFunctionInvoke).toHaveBeenCalledWith("generate-meal-plan", {
      body: expect.objectContaining({
        action: "meal",
        mealType: "breakfast",
        displayedPlanId: "00000000-0000-4000-8000-000000000010",
        displayedRevision: 0,
        day: "Monday",
        commandId: expect.any(String),
      }),
    });
    expect(edgeFunctionInvoke.mock.calls[0][1].body).not.toHaveProperty("currentMeal");
    expect(edgeFunctionInvoke.mock.calls[0][1].body).not.toHaveProperty("currentPlan");
    expect(saveCurrent).not.toHaveBeenCalled();
  });

  it("keeps a response-loss Meal Reroll pending and forces an authoritative refetch", async () => {
    const profile = {
      age: 30,
      gender: "Male",
      heightCm: 175,
      weightKg: 75,
      activityLevel: "Moderately Active",
      goal: "Lose Weight",
      dietType: "Mediterranean",
    };
    getProfileData.mockResolvedValue({ profile, mealPlan: weeklyPlanFixture, milestones: [] });
    getPendingMealRerolls
      .mockResolvedValueOnce([])
      .mockImplementation(async () => [{
        commandId: edgeFunctionInvoke.mock.calls[0][1].body.commandId,
        planId: "00000000-0000-4000-8000-000000000010",
        day: "Monday",
        mealType: "breakfast",
        reservedAt: "2026-07-27T10:00:30.000Z",
      }]);
    edgeFunctionInvoke.mockResolvedValue({
      data: null,
      error: { message: "Connection lost after the command was sent." },
    });
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("Test Berry Breakfast");
    await user.click(screen.getAllByTitle("Reroll this meal")[0]);

    expect(await screen.findByText("Connection lost after the command was sent."))
      .toBeInTheDocument();
    expect(screen.getByText("Test Berry Breakfast")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try Again" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Reroll this meal" })[0])
      .toBeDisabled();
    expect(screen.getByRole("button", { name: "Next Week" })).toBeDisabled();
    await waitFor(() => expect(getCurrent).toHaveBeenCalledTimes(2));
  });

  it("reconciles response loss after commit by replaying the same command identity", async () => {
    const profile = {
      age: 30,
      gender: "Male",
      heightCm: 175,
      weightKg: 75,
      activityLevel: "Moderately Active",
      goal: "Lose Weight",
      dietType: "Mediterranean",
    };
    const completedPlan = structuredClone(weeklyPlanFixture);
    completedPlan.days[0].breakfast.name = "Committed Reroll Breakfast";
    getProfileData.mockResolvedValue({ profile, mealPlan: weeklyPlanFixture, milestones: [] });
    edgeFunctionInvoke
      .mockResolvedValueOnce({
        data: null,
        error: { message: "Response lost after commit." },
      })
      .mockImplementationOnce(async (_name, options) => ({
        data: {
          commandId: options.body.commandId,
          status: "succeeded",
          result: {
            planId: "00000000-0000-4000-8000-000000000010",
            userId: "user-1",
            document: completedPlan,
            schemaVersion: 1,
            revision: 1,
            isActive: true,
            createdAt: "2026-07-27T10:00:00.000Z",
            updatedAt: "2026-07-27T10:01:00.000Z",
            deactivatedAt: null,
            predecessorPlanId: null,
            generationId: null,
          },
          error: null,
        },
        error: null,
      }));
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("Test Berry Breakfast");
    await user.click(screen.getAllByTitle("Reroll this meal")[0]);

    expect(await screen.findByText("Committed Reroll Breakfast")).toBeInTheDocument();
    expect(edgeFunctionInvoke).toHaveBeenCalledTimes(2);
    expect(edgeFunctionInvoke.mock.calls[1][1].body.commandId)
      .toBe(edgeFunctionInvoke.mock.calls[0][1].body.commandId);
    expect(screen.queryByRole("button", { name: "Try Again" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Reroll this meal" })[0])
      .toBeEnabled();
  });

  it("persists ingredient progress through the Weekly Plan gateway", async () => {
    const profile = {
      age: 30,
      gender: "Male",
      heightCm: 175,
      weightKg: 75,
      activityLevel: "Moderately Active",
      goal: "Lose Weight",
      dietType: "Mediterranean",
    };
    getProfileData.mockResolvedValue({ profile, mealPlan: weeklyPlanFixture, milestones: [] });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByText("Test Berry Breakfast"));
    await user.click(screen.getAllByText("ingredient").at(-1)!);

    expect(setIngredientChecked).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      planId: "00000000-0000-4000-8000-000000000010",
      displayedRevision: 0,
      day: "Monday",
      mealType: "breakfast",
      ingredientId: weeklyPlanFixture.days[0].breakfast.ingredientIds[0],
      checked: true,
    }));
    expect(saveProfileData).not.toHaveBeenCalled();
  });

  it("restores confirmed ingredient progress when gateway persistence fails", async () => {
    const profile = {
      age: 30,
      gender: "Male",
      heightCm: 175,
      weightKg: 75,
      activityLevel: "Moderately Active",
      goal: "Lose Weight",
      dietType: "Mediterranean",
    };
    getProfileData.mockResolvedValue({ profile, mealPlan: weeklyPlanFixture, milestones: [] });
    setIngredientChecked.mockResolvedValueOnce({
      commandId: "command-failed",
      status: "failed",
      result: null,
      error: {
        code: "weekly_plan_persistence_failed",
        message: "storage unavailable",
        retryable: true,
      },
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByText("Test Berry Breakfast"));
    await user.click(screen.getAllByText("ingredient").at(-1)!);
    expect(await screen.findByText("Could not save that ingredient change. Please try again."))
      .toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close Details" }));
    await user.click(screen.getByText("Test Berry Breakfast"));
    expect(screen.getAllByText("ingredient").at(-1)?.parentElement)
      .not.toHaveClass("line-through");
  });

  it("persists profile and milestone changes without rewriting the Weekly Plan", async () => {
    const profile = {
      age: 30,
      gender: "Male",
      heightCm: 175,
      weightKg: 75,
      activityLevel: "Moderately Active",
      goal: "Lose Weight",
      dietType: "Mediterranean",
    };
    getProfileData.mockResolvedValue({ profile, mealPlan: weeklyPlanFixture, milestones: [] });
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("Test Berry Breakfast");
    await user.click(screen.getByTitle("Account"));
    const ageInput = screen.getAllByRole("spinbutton")[0];
    await user.clear(ageInput);
    await user.type(ageInput, "31");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(saveProfileData).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ age: 31 }),
      [],
    ));

    await user.click(screen.getByTitle("Account"));
    await user.click(screen.getByRole("button", { name: "Milestones" }));
    const milestoneWeight = screen.getAllByRole("spinbutton")[0];
    await user.clear(milestoneWeight);
    await user.type(milestoneWeight, "74");
    await user.click(screen.getByRole("button", { name: "Log" }));

    await waitFor(() => expect(saveProfileData).toHaveBeenLastCalledWith(
      "user-1",
      expect.objectContaining({ age: 31, weightKg: 74 }),
      [expect.objectContaining({ weight: 74 })],
    ));

    await user.click(screen.getByTitle("Delete Entry"));
    await waitFor(() => expect(saveProfileData).toHaveBeenLastCalledWith(
      "user-1",
      expect.objectContaining({ age: 31, weightKg: 74 }),
      [],
    ));
    expect(saveCurrent).not.toHaveBeenCalled();
  });

  it("opens Account from the identity and protects Health Profile drafts across sections", async () => {
    const profile = {
      age: 30,
      gender: "Male",
      heightCm: 175,
      weightKg: 75,
      activityLevel: "Moderately Active",
      goal: "Lose Weight",
      dietType: "Mediterranean",
    };
    getProfileData.mockResolvedValue({ profile, mealPlan: weeklyPlanFixture, milestones: [] });
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("Test Berry Breakfast");
    const trigger = screen.getByRole("button", { name: "Open Account" });
    await user.click(trigger);

    expect(screen.getByRole("dialog", { name: "Account" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Health Profile" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("button", { name: "Settings" })).not.toBeInTheDocument();

    const ageInput = screen.getAllByRole("spinbutton")[0];
    await user.clear(ageInput);
    await user.type(ageInput, "31");
    const replacement = screen.getByRole("checkbox", {
      name: /Create a new Weekly Plan from these changes/,
    });
    expect(replacement).not.toBeChecked();

    await user.click(screen.getByRole("tab", { name: "Security" }));
    expect(screen.getByRole("alertdialog", {
      name: "Discard unsaved Health Profile changes?",
    })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep Editing" }));
    expect(screen.getAllByRole("spinbutton")[0]).toHaveValue(31);

    await user.click(screen.getByRole("tab", { name: "Security" }));
    await user.click(screen.getByRole("button", { name: "Discard Changes" }));
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Security");

    await user.click(screen.getByRole("button", { name: "Change password" }));
    await waitFor(() => expect(screen.getByLabelText(/^Current password/)).toHaveFocus());
    await user.type(screen.getByLabelText(/^Current password/), "old-secret1");
    await user.type(screen.getByLabelText(/^New password/), "new-secret2");
    await user.type(screen.getByLabelText("Confirm new password"), "new-secret2");
    await user.click(screen.getByRole("button", { name: "Change password" }));
    await waitFor(() => expect(changePassword).toHaveBeenCalledWith(
      "old-secret1",
      "new-secret2",
    ));
    expect(await screen.findByText("Password changed. Other sessions were signed out."))
      .toBeInTheDocument();
    expect(screen.getByLabelText("Current password")).toHaveValue("");

    await user.click(screen.getAllByRole("button", { name: "Close Account" }).at(-1)!);
    expect(screen.queryByRole("dialog", { name: "Account" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("protects Account setup edits before a Health Profile has been completed", async () => {
    getProfileData.mockResolvedValue(null);
    getCurrent.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "Let's build your plan." });
    await user.click(screen.getByRole("button", { name: "Open Account" }));
    const account = screen.getByRole("dialog", { name: "Account" });
    const accountAge = within(account).getAllByRole("spinbutton")[0];
    await user.clear(accountAge);
    await user.type(accountAge, "31");
    await user.click(within(account).getByRole("button", { name: "Close Account" }));

    expect(screen.getByRole("alertdialog", {
      name: "Discard unsaved Health Profile changes?",
    })).toBeInTheDocument();
  });

  it("gives a safe next action when a password change requires stronger authentication", async () => {
    const profile = {
      age: 30,
      gender: "Male",
      heightCm: 175,
      weightKg: 75,
      activityLevel: "Moderately Active",
      goal: "Lose Weight",
      dietType: "Mediterranean",
    };
    getProfileData.mockResolvedValue({ profile, mealPlan: weeklyPlanFixture, milestones: [] });
    changePassword.mockRejectedValue(Object.assign(
      new Error("provider-specific message"),
      { code: "insufficient_aal" },
    ));
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("Test Berry Breakfast");
    await user.click(screen.getByRole("button", { name: "Open Account" }));
    await user.click(screen.getByRole("tab", { name: "Security" }));
    await user.type(screen.getByLabelText(/^Current password/), "old-secret1");
    await user.type(screen.getByLabelText(/^New password/), "new-secret2");
    await user.type(screen.getByLabelText("Confirm new password"), "new-secret2");
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Multi-factor verification is required before you can change your password.",
    );
  });

  it("requests password recovery with the deployed repository-scoped callback", async () => {
    const profile = {
      age: 30,
      gender: "Male",
      heightCm: 175,
      weightKg: 75,
      activityLevel: "Moderately Active",
      goal: "Lose Weight",
      dietType: "Mediterranean",
    };
    getProfileData.mockResolvedValue({ profile, mealPlan: weeklyPlanFixture, milestones: [] });
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("Test Berry Breakfast");
    await user.click(screen.getByRole("button", { name: "Open Account" }));
    await user.click(screen.getByRole("tab", { name: "Security" }));
    await user.click(screen.getByRole("button", { name: "Send recovery email" }));

    await waitFor(() => expect(sendPasswordRecovery).toHaveBeenCalledWith(
      "alex@example.com",
      "http://localhost:3000/neuro-nutrition/recover-password",
    ));
    expect(screen.getByRole("dialog", { name: "Account" })).toBeInTheDocument();
    expect(screen.getByText("Welcome back, Alex")).toBeInTheDocument();
  });

  it("preserves the current session and hides provider details when recovery fails", async () => {
    const profile = {
      age: 30,
      gender: "Male",
      heightCm: 175,
      weightKg: 75,
      activityLevel: "Moderately Active",
      goal: "Lose Weight",
      dietType: "Mediterranean",
    };
    getProfileData.mockResolvedValue({ profile, mealPlan: weeklyPlanFixture, milestones: [] });
    sendPasswordRecovery.mockRejectedValue(Object.assign(
      new Error("alex@example.com is not registered"),
      { code: "user_not_found" },
    ));
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("Test Berry Breakfast");
    await user.click(screen.getByRole("button", { name: "Open Account" }));
    await user.click(screen.getByRole("tab", { name: "Security" }));
    await user.click(screen.getByRole("button", { name: "Send recovery email" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Recovery email could not be sent. Please try again.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("alex@example.com is not registered");
    expect(screen.getByRole("dialog", { name: "Account" })).toBeInTheDocument();
    expect(screen.getByText("Welcome back, Alex")).toBeInTheDocument();
  });

  it("completes password recovery only after the recovery callback is recognized", async () => {
    window.history.replaceState(
      {},
      "",
      "/neuro-nutrition/recover-password#access_token=redacted&type=recovery",
    );
    const user = userEvent.setup();

    render(<App />);
    await act(async () => {
      authStateChangeCallbacks[0]("PASSWORD_RECOVERY", {
        user: { id: "user-1", email: "alex@example.com", user_metadata: { name: "Alex" } },
      });
    });

    expect(await screen.findByRole("heading", { name: "Recover password" }))
      .toBeInTheDocument();
    await user.type(screen.getByLabelText("New password"), "recovered-secret3");
    await user.type(screen.getByLabelText("Confirm new password"), "recovered-secret3");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(completePasswordRecovery).toHaveBeenCalledWith("recovered-secret3");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Your password has been updated.",
    );
  });

  it("rejects a recovery route without a recovery-derived session", async () => {
    window.history.replaceState({}, "", "/neuro-nutrition/recover-password");

    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This password recovery link is invalid or has expired.",
    );
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  });

  it("saves corrected Health Profile data before safely replacing the Current Weekly Plan", async () => {
    const profile = {
      age: 30,
      gender: "Male",
      heightCm: 175,
      weightKg: 75,
      activityLevel: "Moderately Active",
      goal: "Lose Weight",
      dietType: "Mediterranean",
    };
    getProfileData.mockResolvedValue({ profile, mealPlan: weeklyPlanFixture, milestones: [] });
    const replacementPlan = structuredClone(weeklyPlanFixture);
    replacementPlan.weeklySummary = "Tailored replacement";
    edgeFunctionInvoke
      .mockImplementationOnce(async (_name, { body }) => ({
        data: {
          commandId: body.commandId,
          status: "failed",
          result: null,
          error: {
            code: "generation_failed",
            message: "Provider unavailable. Your previous plan is unchanged.",
            retryable: true,
          },
        },
        error: null,
      }))
      .mockImplementationOnce(async (_name, { body }) => ({
        data: {
          commandId: body.commandId,
          status: "succeeded",
          result: {
            planId: "00000000-0000-4000-8000-000000000099",
            userId: "user-1",
            document: replacementPlan,
            schemaVersion: 1,
            revision: 0,
            isActive: true,
            createdAt: "2026-07-29T10:00:00.000Z",
            updatedAt: "2026-07-29T10:00:00.000Z",
            deactivatedAt: null,
            predecessorPlanId: "00000000-0000-4000-8000-000000000010",
            generationId: body.commandId,
          },
          error: null,
        },
        error: null,
      }));
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("Test Berry Breakfast");
    await user.click(screen.getByRole("button", { name: "Open Account" }));
    const ageInput = screen.getAllByRole("spinbutton")[0];
    await user.clear(ageInput);
    await user.type(ageInput, "31");
    await user.click(screen.getByRole("checkbox", {
      name: /Create a new Weekly Plan from these changes/,
    }));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(await screen.findByText("Provider unavailable. Your previous plan is unchanged."))
      .toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Provider unavailable. Your previous plan is unchanged.",
    );
    expect(screen.getByRole("alert")).toHaveClass("text-red-700");
    expect(screen.getByText("Test Berry Breakfast")).toBeInTheDocument();
    expect(saveProfileData).toHaveBeenCalledBefore(edgeFunctionInvoke);
    const firstCommandId = edgeFunctionInvoke.mock.calls[0][1].body.commandId;

    await user.click(screen.getByRole("button", { name: "Retry Weekly Plan replacement" }));

    expect(await screen.findByText("Tailored replacement")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Account" })).not.toBeInTheDocument();
    const secondCommandId = edgeFunctionInvoke.mock.calls[1][1].body.commandId;
    expect(secondCommandId).not.toBe(firstCommandId);
    expect(edgeFunctionInvoke).toHaveBeenLastCalledWith(
      "generate-meal-plan",
      expect.objectContaining({
        body: expect.objectContaining({
          operation: "health_profile_plan_replacement",
          profile: expect.objectContaining({ age: 31 }),
        }),
      }),
    );
  });

  it("recovers and resumes a stale Health Profile replacement after reload", async () => {
    const profile = {
      age: 31,
      gender: "Male",
      heightCm: 175,
      weightKg: 75,
      activityLevel: "Moderately Active",
      goal: "Lose Weight",
      dietType: "Mediterranean",
    };
    const lockedCommandId = "00000000-0000-4000-8000-000000000080";
    const replacementPlan = structuredClone(weeklyPlanFixture);
    replacementPlan.weeklySummary = "Recovered replacement";
    getProfileData.mockResolvedValue({ profile, mealPlan: weeklyPlanFixture, milestones: [] });
    getCurrent.mockResolvedValue({
      planId: "00000000-0000-4000-8000-000000000010",
      userId: "user-1",
      document: weeklyPlanFixture,
      schemaVersion: 1,
      revision: 0,
      isActive: true,
      createdAt: "2026-07-27T10:00:00.000Z",
      updatedAt: "2026-07-27T10:00:00.000Z",
      deactivatedAt: null,
      predecessorPlanId: null,
      generationId: null,
      nextGenerationId: null,
      nextGenerationLockedAt: null,
      healthProfileReplacementId: lockedCommandId,
      healthProfileReplacementLockedAt: "2026-07-29T10:00:00.000Z",
    });
    edgeFunctionInvoke
      .mockImplementationOnce(async (_name, { body }) => ({
        data: {
          commandId: body.commandId,
          status: "failed",
          result: null,
          error: {
            code: "stale_generation_recovered",
            message: "Retry.",
            retryable: true,
          },
        },
        error: null,
      }))
      .mockImplementationOnce(async (_name, { body }) => ({
        data: {
          commandId: body.commandId,
          status: "succeeded",
          result: {
            planId: "00000000-0000-4000-8000-000000000099",
            userId: "user-1",
            document: replacementPlan,
            schemaVersion: 1,
            revision: 0,
            isActive: true,
            createdAt: "2026-07-29T10:20:00.000Z",
            updatedAt: "2026-07-29T10:20:00.000Z",
            deactivatedAt: null,
            predecessorPlanId: "00000000-0000-4000-8000-000000000010",
            generationId: body.commandId,
            nextGenerationId: null,
            nextGenerationLockedAt: null,
            healthProfileReplacementId: null,
            healthProfileReplacementLockedAt: null,
          },
          error: null,
        },
        error: null,
      }));

    render(<App />);

    expect(await screen.findByText("Recovered replacement")).toBeInTheDocument();
    expect(edgeFunctionInvoke).toHaveBeenCalledTimes(2);
    expect(edgeFunctionInvoke.mock.calls[0][1].body.commandId).toBe(lockedCommandId);
    expect(edgeFunctionInvoke.mock.calls[0][1].body.resumeExisting).toBe(true);
    expect(edgeFunctionInvoke.mock.calls[1][1].body.commandId).not.toBe(lockedCommandId);
    expect(edgeFunctionInvoke.mock.calls[1][1].body.resumeExisting).toBe(false);
  });

  it("preserves the original meal and uses a new command after terminal Meal Reroll failure", async () => {
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
    getProfileData.mockResolvedValue({ profile, mealPlan: weeklyPlanFixture, milestones: [] });
    const replacementPlan = structuredClone(weeklyPlanFixture);
    replacementPlan.days[0].breakfast = replacement;
    edgeFunctionInvoke
      .mockImplementationOnce(async (_name, options) => ({
        data: {
          commandId: options.body.commandId,
          status: "failed",
          result: null,
          error: {
            code: "generation_failed",
            message: "A different meal was not created. Your original meal is unchanged.",
            retryable: false,
          },
        },
        error: null,
      }))
      .mockImplementationOnce(async (_name, options) => ({
        data: {
          commandId: options.body.commandId,
          status: "succeeded",
          result: {
            planId: "00000000-0000-4000-8000-000000000010",
            userId: "user-1",
            document: replacementPlan,
            schemaVersion: 1,
            revision: 1,
            isActive: true,
            createdAt: "2026-07-27T10:00:00.000Z",
            updatedAt: "2026-07-27T10:01:00.000Z",
            deactivatedAt: null,
            predecessorPlanId: null,
            generationId: null,
          },
          error: null,
        },
        error: null,
      }))
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("Test Berry Breakfast");
    await user.click(screen.getAllByTitle("Reroll this meal")[0]);

    expect(await screen.findByText("A different meal was not created. Your original meal is unchanged."))
      .toBeInTheDocument();
    expect(screen.getByText("Test Berry Breakfast")).toBeInTheDocument();
    expect(saveCurrent).not.toHaveBeenCalled();
    const firstRequest = edgeFunctionInvoke.mock.calls[0][1];
    const tryAgain = screen.getByRole("button", { name: "Try Again" });

    await user.click(tryAgain);

    expect(await screen.findByText("Successful Retry Breakfast")).toBeInTheDocument();
    expect(edgeFunctionInvoke.mock.calls[1][1].body.commandId)
      .not.toBe(firstRequest.body.commandId);
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
    getProfileData.mockResolvedValue({ profile, mealPlan: weeklyPlanFixture, milestones: [] });
    edgeFunctionInvoke.mockImplementation(async (_name, options) => ({
      data: {
        commandId: options.body.commandId,
        status: "failed",
        result: null,
        error: {
          code: "generation_failed",
          message: "A different meal was not created. Your original meal is unchanged.",
          retryable: false,
        },
      },
      error: null,
    }));
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
    getProfileData.mockResolvedValue({
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
    getProfileData.mockResolvedValue({
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
    edgeFunctionInvoke.mockImplementation(async (_name, { body }) =>
      nextGenerationSuccess(weeklyPlanFixture, body.commandId)
    );
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
    getProfileData.mockResolvedValue({
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
    edgeFunctionInvoke.mockImplementation(async (_name, { body }) =>
      nextGenerationSuccess(convergedPlan, body.commandId)
    );
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
    expect(saveCurrent).not.toHaveBeenCalled();
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
    getProfileData.mockResolvedValue({ profile, mealPlan: weeklyPlanFixture, milestones: [] });
    edgeFunctionInvoke
      .mockResolvedValueOnce({
        data: null,
        error: { message: "A valid Next Weekly Plan was not created. Your current plan is unchanged." },
      })
      .mockImplementationOnce(async (_name, { body }) =>
        nextGenerationSuccess(nextPlan, body.commandId)
      );
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
    expect(saveCurrent).not.toHaveBeenCalled();

    await user.click(tryAgain);

    expect(await screen.findByText("Next Week Breakfast")).toBeInTheDocument();
    expect(edgeFunctionInvoke.mock.calls[1][1]).toEqual(firstRequest);
    expect(screen.getByRole("button", { name: "Next Week" })).toBeInTheDocument();
    expect(saveCurrent).not.toHaveBeenCalled();
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
    getProfileData.mockResolvedValue({ profile, mealPlan: weeklyPlanFixture, milestones: [] });
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
