import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { weeklyPlanFixture } from "./test/weeklyPlanFixture";
import type { AuthoritativeWeeklyPlanRow } from "./types";

const {
  getCurrent,
  getPendingMealRerolls,
  getProfileData,
  generateNextWeeklyPlan,
  realtimeInvalidations,
} = vi.hoisted(() => ({
  getCurrent: vi.fn(),
  getPendingMealRerolls: vi.fn(),
  getProfileData: vi.fn(),
  generateNextWeeklyPlan: vi.fn(),
  realtimeInvalidations: [] as Array<() => void>,
}));

vi.mock("./services/supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: {
          session: {
            user: {
              id: "user-1",
              email: "alex@example.com",
              user_metadata: { name: "Alex" },
            },
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
  createWeeklyPlanInvalidationSubscription: vi.fn(
    (_client, _userId, invalidate) => {
      realtimeInvalidations.push(invalidate);
      return { unsubscribe: vi.fn() };
    },
  ),
  weeklyPlanGateway: {
    getCurrent,
    getPendingMealRerolls,
    createCurrent: vi.fn(),
    saveCurrent: vi.fn(),
    setIngredientChecked: vi.fn(),
    startOver: vi.fn(),
  },
}));

vi.mock("./services/aiService", () => ({
  generateInitialWeeklyPlan: vi.fn(),
  generateNextWeeklyPlan,
  rerollMeal: vi.fn(),
}));

vi.mock("./services/authService", () => ({
  authService: { logout: vi.fn() },
}));

vi.mock("./components/Layout", () => ({
  default: ({
    children,
    onNextWeek,
    planMutationsDisabled,
    canRetryNextWeek,
  }) => (
    <div>
      <button onClick={onNextWeek} disabled={planMutationsDisabled}>
        {canRetryNextWeek ? "Try Again" : "Next Week"}
      </button>
      {children}
    </div>
  ),
}));

vi.mock("./components/PlanDashboard", () => ({
  default: ({ plan, isReadOnly }) => (
    <div>
      <span>{plan.weeklySummary}</span>
      <span>{isReadOnly ? "plan-read-only" : "plan-editable"}</span>
    </div>
  ),
}));

vi.mock("./components/WeeklyReviewModal", () => ({
  default: ({ isOpen, onSubmit }) =>
    isOpen ? <button onClick={() => onSubmit([])}>Submit Meal Review</button> : null,
}));

import App from "./App";

const row = (
  overrides: Partial<AuthoritativeWeeklyPlanRow> = {},
): AuthoritativeWeeklyPlanRow => ({
  planId: "20000000-0000-4000-8000-000000000001",
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
  ...overrides,
});

describe("Next Weekly Plan client lifecycle", () => {
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
    generateNextWeeklyPlan.mockReset();
    realtimeInvalidations.length = 0;
  });

  it("keeps a remotely locked source visible and read-only", async () => {
    getCurrent.mockResolvedValue(row({
      nextGenerationId: "10000000-0000-4000-8000-000000000001",
      nextGenerationLockedAt: "2026-07-27T10:01:00.000Z",
    }));

    render(<App />);

    expect(await screen.findByText(weeklyPlanFixture.weeklySummary))
      .toBeInTheDocument();
    expect(screen.getByText("Your Next Weekly Plan is being generated."))
      .toBeInTheDocument();
    expect(screen.getByText("plan-read-only")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next Week" })).toBeDisabled();
  });

  it("keeps the source visible and read-only during local generation, then applies the successor", async () => {
    getCurrent.mockResolvedValue(row());
    let resolveGeneration!: (value: unknown) => void;
    generateNextWeeklyPlan.mockReturnValue(new Promise((resolve) => {
      resolveGeneration = resolve;
    }));
    const nextDocument = {
      ...weeklyPlanFixture,
      weeklySummary: "Authoritative successor",
    };
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText(weeklyPlanFixture.weeklySummary);
    await user.click(screen.getByRole("button", { name: "Next Week" }));
    await user.click(screen.getByRole("button", { name: "Submit Meal Review" }));

    expect(screen.getByText(weeklyPlanFixture.weeklySummary)).toBeInTheDocument();
    expect(screen.getByText("Your Next Weekly Plan is being generated."))
      .toBeInTheDocument();
    expect(screen.getByText("plan-read-only")).toBeInTheDocument();
    expect(generateNextWeeklyPlan).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        commandId: expect.any(String),
        displayedPlanId: "20000000-0000-4000-8000-000000000001",
        displayedRevision: 0,
        reviewType: "empty",
      }),
    );

    await act(async () => {
      resolveGeneration({
        commandId: "10000000-0000-4000-8000-000000000001",
        status: "succeeded",
        result: row({
          planId: "20000000-0000-4000-8000-000000000002",
          document: nextDocument,
          predecessorPlanId: "20000000-0000-4000-8000-000000000001",
          generationId: "10000000-0000-4000-8000-000000000001",
        }),
        error: null,
      });
    });

    await waitFor(() => {
      expect(screen.getByText("Authoritative successor")).toBeInTheDocument();
      expect(screen.getByText("plan-editable")).toBeInTheDocument();
    });
  });

  it("releases the local lock with a fresh Try Again identity after remote no-result recovery", async () => {
    let sentCommandId: string | null = null;
    let recovered = false;
    let currentPlanReadCount = 0;
    const lockedDocument = {
      ...weeklyPlanFixture,
      weeklySummary: "Locked source observed",
    };
    getCurrent.mockImplementation(async () => {
      currentPlanReadCount += 1;
      if (currentPlanReadCount === 1) return row();
      return recovered ? row() : row({
        document: lockedDocument,
        nextGenerationId: sentCommandId,
        nextGenerationLockedAt: "2026-07-27T10:01:00.000Z",
      });
    });
    generateNextWeeklyPlan.mockImplementation(async (_profile, command) => {
      sentCommandId = command.commandId;
      throw new Error("Response lost.");
    });
    const user = userEvent.setup();

    render(<App />);
    await screen.findByText(weeklyPlanFixture.weeklySummary);
    await user.click(screen.getByRole("button", { name: "Next Week" }));
    await user.click(screen.getByRole("button", { name: "Submit Meal Review" }));

    expect(await screen.findByText("Response lost.")).toBeInTheDocument();
    expect(await screen.findByText("Locked source observed")).toBeInTheDocument();
    expect(screen.getByText("plan-read-only")).toBeInTheDocument();

    recovered = true;
    act(() => realtimeInvalidations[0]());

    await waitFor(() => {
      expect(screen.getByText("plan-editable")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Try Again" })).toBeEnabled();
    });
  });
});
