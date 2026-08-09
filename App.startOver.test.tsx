import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { weeklyPlanFixture } from "./test/weeklyPlanFixture";
import type { AuthoritativeWeeklyPlanRow } from "./types";

const {
  getProfileData,
  getCurrent,
  getPendingMealRerolls,
  startOver,
} = vi.hoisted(() => ({
  getProfileData: vi.fn(),
  getCurrent: vi.fn(),
  getPendingMealRerolls: vi.fn(),
  startOver: vi.fn(),
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
  },
}));

vi.mock("./services/storageService", () => ({
  storageService: {
    getProfileData,
    saveProfileData: vi.fn(),
  },
}));

vi.mock("./services/weeklyPlanGateway", () => ({
  createWeeklyPlanInvalidationSubscription: vi.fn(() => ({
    unsubscribe: vi.fn(),
  })),
  weeklyPlanGateway: {
    getCurrent,
    getPendingInitialGeneration: vi.fn().mockResolvedValue(null),
    getPendingMealRerolls,
    createCurrent: vi.fn(),
    saveCurrent: vi.fn(),
    setIngredientChecked: vi.fn(),
    startOver,
  },
}));

vi.mock("./services/authService", () => ({
  authService: { logout: vi.fn() },
}));

vi.mock("./components/Layout", () => ({
  default: ({ children, onOpenProfile, userProfile }) => (
    <div>
      <div>{userProfile ? `profile-${userProfile.age}` : "profile-empty"}</div>
      <button onClick={onOpenProfile}>Open Account</button>
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

vi.mock("./components/ProfileForm", () => ({
  default: () => <div>Profile form</div>,
}));

import App from "./App";

const authoritativeRow: AuthoritativeWeeklyPlanRow = {
  planId: "20000000-0000-4000-8000-000000000001",
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
};

describe("application Start Over flow", () => {
  beforeEach(() => {
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
      milestones: [{ id: "milestone-1", date: "2026-07-27", weight: 75 }],
    });
    getCurrent.mockReset().mockResolvedValue(authoritativeRow);
    startOver.mockReset();
  });

  it("keeps the displayed plan read-only until Start Over confirms empty", async () => {
    let confirmStartOver:
      ((outcome: Record<string, unknown>) => void) | undefined;
    startOver.mockImplementation(({ commandId }) => new Promise((resolve) => {
      confirmStartOver = (outcome) => resolve({ commandId, ...outcome });
    }));
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText(weeklyPlanFixture.weeklySummary)).toBeInTheDocument();
    expect(screen.getByText("plan-editable")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open Account" }));
    await user.click(screen.getByRole("tab", { name: "Start Over" }));
    await user.click(screen.getByRole("button", { name: "Start Over" }));
    await user.click(screen.getAllByRole("button", { name: "Start Over" }).at(-1)!);

    expect(await screen.findByText("plan-read-only")).toBeInTheDocument();
    expect(screen.getByText(weeklyPlanFixture.weeklySummary)).toBeInTheDocument();
    expect(screen.queryByText("Profile form")).not.toBeInTheDocument();
    expect(startOver).toHaveBeenCalledWith({
      commandId: expect.any(String),
      userId: "user-1",
      displayedPlanId: authoritativeRow.planId,
      displayedRevision: authoritativeRow.revision,
    });

    confirmStartOver?.({
      status: "succeeded",
      result: null,
      error: null,
    });

    expect(await screen.findByText("Profile form")).toBeInTheDocument();
    expect(screen.queryByText(weeklyPlanFixture.weeklySummary)).not.toBeInTheDocument();
  });

  it("retains loaded client state after a failed Start Over command", async () => {
    startOver.mockImplementation(async ({ commandId }) => ({
      commandId,
      status: "failed",
      result: null,
      error: {
        code: "weekly_plan_persistence_failed",
        message: "storage unavailable",
        retryable: true,
      },
    }));
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText(weeklyPlanFixture.weeklySummary)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open Account" }));
    await user.click(screen.getByRole("tab", { name: "Start Over" }));
    await user.click(screen.getByRole("button", { name: "Start Over" }));
    await user.click(screen.getAllByRole("button", { name: "Start Over" }).at(-1)!);

    expect((await screen.findAllByText("Could not start over. Please try again.")).length)
      .toBeGreaterThan(0);
    expect(screen.getByText(weeklyPlanFixture.weeklySummary)).toBeInTheDocument();
    expect(screen.getByText("plan-editable")).toBeInTheDocument();
  });
});
