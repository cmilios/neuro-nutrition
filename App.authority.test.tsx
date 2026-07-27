import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { weeklyPlanFixture } from "./test/weeklyPlanFixture";
import type { AuthoritativeWeeklyPlanRow } from "./types";

const {
  getProfileData,
  getCurrent,
  getPendingMealRerolls,
  setIngredientChecked,
  subscribeToInvalidations,
  realtimeCallbacks,
} = vi.hoisted(() => ({
  getProfileData: vi.fn(),
  getCurrent: vi.fn(),
  getPendingMealRerolls: vi.fn(),
  setIngredientChecked: vi.fn(),
  subscribeToInvalidations: vi.fn(),
  realtimeCallbacks: [] as Array<{
    invalidate: () => void;
    status: (status: "connected" | "disconnected") => void;
  }>,
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
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  },
}));

vi.mock("./services/storageService", () => ({
  storageService: {
    getProfileData,
    saveProfileData: vi.fn(),
  },
}));

vi.mock("./services/weeklyPlanGateway", () => ({
  createWeeklyPlanInvalidationSubscription: subscribeToInvalidations,
  weeklyPlanGateway: {
    getCurrent,
    getPendingMealRerolls,
    createCurrent: vi.fn(),
    saveCurrent: vi.fn(),
    setIngredientChecked,
    startOver: vi.fn(),
  },
}));

vi.mock("./services/authService", () => ({
  authService: { logout: vi.fn() },
}));

import App from "./App";

const authoritativeRow = (
  overrides: Partial<AuthoritativeWeeklyPlanRow> = {},
): AuthoritativeWeeklyPlanRow => ({
  planId: "00000000-0000-4000-8000-000000000010",
  userId: "user-1",
  document: weeklyPlanFixture,
  schemaVersion: 1,
  revision: 3,
  isActive: true,
  createdAt: "2026-07-27T10:00:00.000Z",
  updatedAt: "2026-07-27T11:00:00.000Z",
  deactivatedAt: null,
  predecessorPlanId: null,
  generationId: null,
  ...overrides,
});

describe("authority-first Current Weekly Plan loading", () => {
  beforeEach(() => {
    sessionStorage.clear();
    getPendingMealRerolls.mockReset().mockResolvedValue([]);
    getProfileData.mockReset().mockResolvedValue({
      profile: {
        age: 30,
        gender: "Male",
        heightCm: 175,
        weightKg: 75,
        activityLevel: "Moderately Active",
        goal: "Lose Weight",
        dietType: "Mediterranean",
      },
      milestones: [],
    });
    getCurrent.mockReset();
    setIngredientChecked.mockReset();
    realtimeCallbacks.length = 0;
    subscribeToInvalidations.mockReset().mockImplementation(
      (_client, _userId, invalidate, status) => {
        realtimeCallbacks.push({ invalidate, status });
        return { unsubscribe: vi.fn() };
      },
    );
  });

  it("blocks initial generation while authority is checking", async () => {
    getCurrent.mockReturnValue(new Promise(() => undefined));

    render(<App />);

    expect(await screen.findByText("Checking your Current Weekly Plan…"))
      .toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Let's build your plan." }))
      .not.toBeInTheDocument();
  });

  it("shows initial generation only after the authoritative query confirms emptiness", async () => {
    getCurrent.mockResolvedValue(null);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Let's build your plan." }))
      .toBeInTheDocument();
  });

  it("shows unavailable recovery and never generation when the load fails", async () => {
    getCurrent.mockRejectedValue(new Error("network unavailable"));

    render(<App />);

    expect(await screen.findByText("Your Current Weekly Plan is unavailable."))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Let's build your plan." }))
      .not.toBeInTheDocument();
  });

  it("rejects an incomplete loaded document before treating it as authoritative", async () => {
    getCurrent.mockResolvedValue(authoritativeRow({
      document: { weeklySummary: "Incomplete", days: [] },
    }));

    render(<App />);

    expect(await screen.findByText("Your Current Weekly Plan is unavailable."))
      .toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Let's build your plan." }))
      .not.toBeInTheDocument();
  });

  it("keeps a validated cached snapshot visible but read-only after a failed load", async () => {
    sessionStorage.setItem(
      "neuronutrition_current_weekly_plan_user-1",
      JSON.stringify(authoritativeRow()),
    );
    getCurrent.mockRejectedValue(new Error("network unavailable"));

    render(<App />);

    expect(await screen.findByText("Test Berry Breakfast")).toBeInTheDocument();
    expect(screen.getByText("This plan may be out of date.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByTitle("Reroll this meal")[0]).toBeDisabled();
      expect(screen.getByRole("button", { name: "Next Week" })).toBeDisabled();
    });
  });

  it("keeps a cached snapshot visibly read-only while authority is checking", async () => {
    sessionStorage.setItem(
      "neuronutrition_current_weekly_plan_user-1",
      JSON.stringify(authoritativeRow()),
    );
    getCurrent.mockReturnValue(new Promise(() => undefined));

    render(<App />);

    expect(await screen.findByText("Test Berry Breakfast")).toBeInTheDocument();
    expect(screen.getByText("Checking for Current Weekly Plan updates…"))
      .toBeInTheDocument();
    expect(screen.getAllByTitle("Reroll this meal")[0]).toBeDisabled();
  });

  it("marks a validated authoritative result as synchronized", async () => {
    getCurrent.mockResolvedValue(authoritativeRow());

    render(<App />);

    expect(await screen.findByText("Test Berry Breakfast")).toBeInTheDocument();
    expect(screen.getByText("Current Weekly Plan synchronized")).toBeInTheDocument();
  });

  it("keeps confirmed ingredient state visible, marks only its control pending, and applies the returned row", async () => {
    const displayed = structuredClone(weeklyPlanFixture);
    displayed.days[0].breakfast.ingredients = ["salt", "salt"];
    displayed.days[0].breakfast.ingredientIds = [
      "20000000-0000-4000-8000-000000000001",
      "20000000-0000-4000-8000-000000000002",
    ];
    displayed.days[0].breakfast.checkedIngredientIds = [];
    getCurrent.mockResolvedValue(authoritativeRow({ document: displayed }));
    let resolveCommand!: (value: unknown) => void;
    setIngredientChecked.mockReturnValue(new Promise((resolve) => {
      resolveCommand = resolve;
    }));
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByText("Test Berry Breakfast"));
    const saltControls = screen.getAllByRole("checkbox", { name: "salt" });
    await user.click(saltControls[1]);

    expect(saltControls[0]).not.toBeDisabled();
    expect(saltControls[1]).toBeDisabled();
    expect(saltControls[1]).toHaveAttribute("aria-busy", "true");
    expect(saltControls[1]).toHaveAttribute("aria-checked", "false");
    expect(setIngredientChecked).toHaveBeenCalledWith({
      commandId: expect.any(String),
      userId: "user-1",
      planId: "00000000-0000-4000-8000-000000000010",
      displayedRevision: 3,
      day: "Monday",
      mealType: "breakfast",
      ingredientId: "20000000-0000-4000-8000-000000000002",
      checked: true,
    });

    const confirmed = structuredClone(displayed);
    confirmed.days[0].breakfast.checkedIngredientIds = [
      "20000000-0000-4000-8000-000000000002",
    ];
    await act(async () => {
      resolveCommand({
        commandId: "10000000-0000-4000-8000-000000000001",
        status: "succeeded",
        result: authoritativeRow({
          document: confirmed,
          revision: 4,
          updatedAt: "2026-07-27T11:01:00.000Z",
        }),
        error: null,
      });
    });

    await waitFor(() => {
      const updatedControls = screen.getAllByRole("checkbox", { name: "salt" });
      expect(updatedControls[0]).toHaveAttribute("aria-checked", "false");
      expect(updatedControls[1]).toHaveAttribute("aria-checked", "true");
      expect(updatedControls[1]).not.toBeDisabled();
    });
  });

  it("coalesces Realtime invalidations into an authoritative refetch", async () => {
    const updated = structuredClone(weeklyPlanFixture);
    updated.days[0].breakfast.name = "Converged Breakfast";
    getCurrent
      .mockResolvedValueOnce(authoritativeRow())
      .mockResolvedValueOnce(authoritativeRow({
        document: updated,
        revision: 4,
      }));

    render(<App />);
    expect(await screen.findByText("Test Berry Breakfast")).toBeInTheDocument();
    expect(realtimeCallbacks).toHaveLength(1);

    act(() => {
      realtimeCallbacks[0].invalidate();
      realtimeCallbacks[0].invalidate();
    });

    expect(await screen.findByText("Converged Breakfast")).toBeInTheDocument();
    expect(getCurrent).toHaveBeenCalledTimes(2);
  });

  it("converges a connected session on confirmed-empty after remote Start Over", async () => {
    getCurrent
      .mockResolvedValueOnce(authoritativeRow())
      .mockResolvedValueOnce(null);

    render(<App />);
    expect(await screen.findByText("Test Berry Breakfast")).toBeInTheDocument();

    act(() => realtimeCallbacks[0].invalidate());

    expect(await screen.findByRole("heading", { name: "Let's build your plan." }))
      .toBeInTheDocument();
    expect(screen.queryByText("Test Berry Breakfast")).not.toBeInTheDocument();
    expect(getCurrent).toHaveBeenCalledTimes(2);
  });

  it("makes a disconnected snapshot stale and read-only until reconnect refetch succeeds", async () => {
    getCurrent.mockResolvedValue(authoritativeRow());

    render(<App />);
    expect(await screen.findByText("Test Berry Breakfast")).toBeInTheDocument();

    act(() => realtimeCallbacks[0].status("disconnected"));
    expect(await screen.findByText("This plan may be out of date.")).toBeInTheDocument();
    expect(screen.getAllByTitle("Reroll this meal")[0]).toBeDisabled();

    act(() => realtimeCallbacks[0].status("connected"));
    await waitFor(() => {
      expect(getCurrent).toHaveBeenCalledTimes(2);
      expect(screen.getByText("Current Weekly Plan synchronized")).toBeInTheDocument();
    });
  });

  it("converges two independent application sessions on the same plan and revision", async () => {
    const initial = authoritativeRow();
    const convergedDocument = structuredClone(weeklyPlanFixture);
    const ingredientId =
      convergedDocument.days[0].breakfast.ingredientIds[0];
    convergedDocument.days[0].breakfast.checkedIngredientIds = [ingredientId];
    const converged = authoritativeRow({
      document: convergedDocument,
      revision: 4,
      updatedAt: "2026-07-27T11:01:00.000Z",
    });
    getCurrent.mockResolvedValue(initial);
    setIngredientChecked.mockResolvedValue({
      commandId: "10000000-0000-4000-8000-000000000001",
      status: "succeeded",
      result: converged,
      error: null,
    });
    const firstSession = render(<App />);
    const secondSession = render(<App />);
    const first = within(firstSession.container);
    const second = within(secondSession.container);
    const user = userEvent.setup();

    await first.findByText("Test Berry Breakfast");
    await second.findByText("Test Berry Breakfast");
    expect(realtimeCallbacks).toHaveLength(2);

    await user.click(first.getByText("Test Berry Breakfast"));
    await user.click(first.getByRole("checkbox", { name: "ingredient" }));
    await waitFor(() => {
      expect(first.getByRole("checkbox", { name: "ingredient" }))
        .toHaveAttribute("aria-checked", "true");
    });

    getCurrent.mockResolvedValue(converged);
    act(() => {
      realtimeCallbacks[0].invalidate();
      realtimeCallbacks[1].invalidate();
    });
    await waitFor(() => expect(getCurrent).toHaveBeenCalledTimes(4));

    await user.click(second.getByText("Test Berry Breakfast"));
    expect(second.getByRole("checkbox", { name: "ingredient" }))
      .toHaveAttribute("aria-checked", "true");

    setIngredientChecked.mockClear();
    await user.click(second.getByRole("checkbox", { name: "ingredient" }));
    expect(setIngredientChecked).toHaveBeenCalledWith(expect.objectContaining({
      planId: converged.planId,
      displayedRevision: 4,
      ingredientId,
      checked: false,
    }));
  });
});
