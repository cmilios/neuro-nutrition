import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { weeklyPlanFixture } from "./test/weeklyPlanFixture";
import type { AuthoritativeWeeklyPlanRow } from "./types";

const { getProfileData, getCurrent } = vi.hoisted(() => ({
  getProfileData: vi.fn(),
  getCurrent: vi.fn(),
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
  weeklyPlanGateway: {
    getCurrent,
    createCurrent: vi.fn(),
    saveCurrent: vi.fn(),
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
});
