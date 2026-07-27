import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getProfileData,
  getCurrent,
  startOver,
} = vi.hoisted(() => ({
  getProfileData: vi.fn(),
  getCurrent: vi.fn(),
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
  default: ({ children, onNextWeek, userProfile }) => (
    <div>
      <div>{userProfile ? `profile-${userProfile.age}` : "profile-empty"}</div>
      <button onClick={onNextWeek}>Exercise Start Over</button>
      {children}
    </div>
  ),
}));

vi.mock("./components/ProfileForm", () => ({
  default: () => <div>Profile form</div>,
}));

import App from "./App";

describe("application Start Over flow", () => {
  beforeEach(() => {
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
    getCurrent.mockReset().mockResolvedValue(null);
    startOver.mockReset();
  });

  it("keeps the loaded plan stale until Start Over is authoritatively confirmed", async () => {
    startOver.mockImplementation(async ({ commandId }) => ({
      commandId,
      status: "succeeded",
      result: null,
      error: null,
    }));
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("profile-30")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Exercise Start Over" }));

    await waitFor(() => {
      expect(screen.getByText("profile-30")).toBeInTheDocument();
      expect(screen.getByText("This plan may be out of date.")).toBeInTheDocument();
      expect(screen.queryByText("Profile form")).not.toBeInTheDocument();
    });
    expect(startOver).toHaveBeenCalledWith({
      commandId: expect.any(String),
      userId: "user-1",
    });
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

    expect(await screen.findByText("profile-30")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Exercise Start Over" }));

    expect(await screen.findByText("Could not reset your data. Please try again."))
      .toBeInTheDocument();
    expect(screen.getByText("profile-30")).toBeInTheDocument();
  });
});
