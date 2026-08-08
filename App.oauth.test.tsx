import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { signInWithOAuth, getProviderMode, reportClientIncident } = vi.hoisted(() => ({
  signInWithOAuth: vi.fn(),
  getProviderMode: vi.fn(),
  reportClientIncident: vi.fn(),
}));

vi.mock("./services/supabaseClient", () => ({
  supabase: {
    auth: {
      // No session: the app lands on the logged-out Log In screen, which is the
      // only place the provider rail and the redirect interstitial appear.
      getSession: vi.fn().mockResolvedValue({
        data: { session: null },
        error: null,
      }),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  },
}));

vi.mock("./services/storageService", () => ({
  storageService: { getProfileData: vi.fn(), saveProfileData: vi.fn() },
}));

vi.mock("./services/weeklyPlanGateway", () => ({
  createWeeklyPlanInvalidationSubscription: vi.fn(() => ({
    unsubscribe: vi.fn(),
  })),
  weeklyPlanGateway: {
    getCurrent: vi.fn(),
    getPendingMealRerolls: vi.fn(),
    createCurrent: vi.fn(),
    saveCurrent: vi.fn(),
    setIngredientChecked: vi.fn(),
    startOver: vi.fn(),
  },
}));

vi.mock("./services/authService", () => ({
  authService: {
    signInWithOAuth,
    logout: vi.fn(),
    changePassword: vi.fn(),
    sendPasswordRecovery: vi.fn(),
    completePasswordRecovery: vi.fn(),
  },
}));

vi.mock("./services/oauthProviderFlagsService", () => ({
  getProviderMode,
}));

vi.mock("./services/clientIncidentTelemetry", () => ({
  reportClientIncident,
}));

import App from "./App";

describe("application OAuth redirect interstitial", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/neuro-nutrition/");
    signInWithOAuth.mockReset();
    getProviderMode.mockReset().mockReturnValue("on");
    reportClientIncident.mockReset().mockResolvedValue(undefined);
    sessionStorage.clear();
  });

  // R1 — initiating sign-in shows the neutral interstitial in place of the
  // logged-out screen, and initiates the redirect for the chosen provider.
  it("renders the Signing you in… interstitial and calls signInWithOAuth on provider click", async () => {
    // Never resolves: mirrors the real full-page redirect where control never
    // returns to the app.
    signInWithOAuth.mockReturnValue(new Promise(() => {}));
    render(<App />);

    const googleButton = await screen.findByRole("button", {
      name: /continue with google/i,
    });
    await userEvent.click(googleButton);

    expect(signInWithOAuth).toHaveBeenCalledWith("google");
    expect(sessionStorage.getItem("neuronutrition.oauth-initiating-provider"))
      .toBe("google");
    expect(await screen.findByText(/signing you in/i)).toBeInTheDocument();
    // The logged-out Log In surface is gone: no provider rail, no email field.
    expect(
      screen.queryByRole("button", { name: /continue with google/i }),
    ).toBeNull();
    expect(screen.queryByPlaceholderText(/you@example.com/i)).toBeNull();
  });

  it("passes the apple provider identifier through when Apple is pressed", async () => {
    signInWithOAuth.mockReturnValue(new Promise(() => {}));
    render(<App />);

    const appleButton = await screen.findByRole("button", {
      name: /continue with apple/i,
    });
    await userEvent.click(appleButton);

    expect(signInWithOAuth).toHaveBeenCalledWith("apple");
    expect(await screen.findByText(/signing you in/i)).toBeInTheDocument();
  });

  it.each(["google", "apple"] as const)(
    "restores the initiating view when browser back cancels %s sign-in",
    async (provider) => {
      signInWithOAuth.mockReturnValue(new Promise(() => {}));
      render(<App />);

      await userEvent.click(await screen.findByRole("button", {
        name: new RegExp(`continue with ${provider}`, "i"),
      }));
      const pageShow = new Event("pageshow");
      Object.defineProperty(pageShow, "persisted", { value: true });
      act(() => window.dispatchEvent(pageShow));

      expect(await screen.findByRole("status")).toHaveTextContent(
        new RegExp(`${provider} sign-in was canceled`, "i"),
      );
      expect(screen.getByRole("button", {
        name: new RegExp(`continue with ${provider}`, "i"),
      })).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/you@example.com/i)).toBeInTheDocument();
      expect(reportClientIncident).not.toHaveBeenCalled();
    },
  );

  // If the redirect cannot be started, the user returns to the Log In screen
  // (with email/password) rather than being stranded on the interstitial.
  it.each(["google", "apple"] as const)(
    "returns to Log In with a retryable toast when %s redirect setup fails",
    async (provider) => {
    signInWithOAuth.mockRejectedValue(new Error("provider unreachable"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<App />);

    const providerButton = await screen.findByRole("button", {
      name: new RegExp(`continue with ${provider}`, "i"),
    });
    await userEvent.click(providerButton);

    await waitFor(() =>
      expect(screen.getByPlaceholderText(/you@example.com/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/signing you in/i)).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      new RegExp(`couldn't complete ${provider} sign-in`, "i"),
    );
    expect(screen.getByRole("button", { name: /dismiss notification/i }))
      .toBeInTheDocument();
    expect(reportClientIncident).toHaveBeenCalledWith("oauth_auth_failure", {
      provider,
      lifecycleStage: "redirect_start",
      errorCode: "redirect_start_failed",
      releaseIdentifier: "development",
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(sessionStorage.getItem("neuronutrition.oauth-initiating-provider"))
      .toBeNull();
    // M11 / finding 5: the browser console must carry the stable error code,
    // never the raw provider error object or its message.
    expect(consoleError).toHaveBeenCalledWith(
      "Could not start OAuth sign-in:",
      "redirect_start_failed",
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      "provider unreachable",
    );
  });
});
