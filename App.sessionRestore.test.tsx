import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authStateChangeCallbacks,
  completePasswordRecovery,
  createInvalidationSubscription,
  getCurrent,
  getPendingMealRerolls,
  getProfileData,
  getSession,
  logout,
  reportClientIncident,
  signInWithOAuth,
  updateDisplayName,
} = vi.hoisted(() => ({
  authStateChangeCallbacks: [] as Array<(event: string, session: unknown) => void>,
  completePasswordRecovery: vi.fn(),
  createInvalidationSubscription: vi.fn(() => ({ unsubscribe: vi.fn() })),
  getCurrent: vi.fn(),
  getPendingMealRerolls: vi.fn(),
  getProfileData: vi.fn(),
  getSession: vi.fn(),
  logout: vi.fn(),
  reportClientIncident: vi.fn(),
  signInWithOAuth: vi.fn(),
  updateDisplayName: vi.fn(),
}));

vi.mock("./services/supabaseClient", () => ({
  supabase: {
    auth: {
      getSession,
      onAuthStateChange: vi.fn((callback) => {
        authStateChangeCallbacks.push(callback);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
    },
  },
}));

vi.mock("./services/authService", () => ({
  authService: {
    completePasswordRecovery,
    login: vi.fn(),
    logout,
    register: vi.fn(),
    sendPasswordRecovery: vi.fn(),
    signInWithOAuth,
    updateDisplayName,
  },
}));

vi.mock("./services/oauthProviderFlagsService", () => ({
  getProviderMode: vi.fn(() => "on"),
}));

vi.mock("./services/storageService", () => ({
  storageService: {
    getProfileData,
    saveProfileData: vi.fn(),
  },
}));

vi.mock("./services/weeklyPlanGateway", () => ({
  createWeeklyPlanInvalidationSubscription: createInvalidationSubscription,
  weeklyPlanGateway: {
    getPendingInitialGeneration: vi.fn().mockResolvedValue(null),
    getCurrent,
    getPendingMealRerolls,
  },
}));

vi.mock("./services/clientIncidentTelemetry", () => ({
  reportClientIncident,
}));

import App from "./App";

const oauthSession = (
  name?: string,
  verifiedEmail = true,
  provider: "google" | "apple" = "google",
) => ({
  user: {
    id: "oauth-user-1",
    email: "alex@example.com",
    email_confirmed_at: verifiedEmail ? "2026-08-05T08:00:00.000Z" : null,
    app_metadata: { provider },
    user_metadata: name === undefined ? {} : { name },
  },
});

describe("post-redirect session restore", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/neuro-nutrition/");
    authStateChangeCallbacks.length = 0;
    getSession.mockReset().mockResolvedValue({
      data: { session: oauthSession("Alex") },
      error: null,
    });
    getProfileData.mockReset().mockResolvedValue(null);
    getCurrent.mockReset().mockResolvedValue(null);
    getPendingMealRerolls.mockReset().mockResolvedValue([]);
    logout.mockReset().mockResolvedValue(undefined);
    updateDisplayName.mockReset().mockResolvedValue(undefined);
    reportClientIncident.mockReset().mockResolvedValue(undefined);
    signInWithOAuth.mockReset().mockResolvedValue(undefined);
    completePasswordRecovery.mockReset().mockResolvedValue(undefined);
    createInvalidationSubscription.mockClear();
    sessionStorage.clear();
  });

  it.each(["google", "apple"] as const)(
    "loads the authenticated app when the %s session has a canonical Display Name",
    async (provider) => {
    getSession.mockResolvedValue({
      data: { session: oauthSession("Alex", true, provider) },
      error: null,
    });
    render(<App />);

    expect(await screen.findByText("Welcome back, Alex")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Choose your Display Name" }))
      .not.toBeInTheDocument();
    await waitFor(() => {
      expect(getProfileData).toHaveBeenCalledWith("oauth-user-1");
      expect(getCurrent).toHaveBeenCalledWith("oauth-user-1");
    });
  });

  it.each(["google", "apple"] as const)(
    "gates a nameless %s session before any Health Profile or Weekly Plan data loads",
    async (provider) => {
    getSession.mockResolvedValue({
      data: { session: oauthSession("   ", true, provider) },
      error: null,
    });

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Choose your Display Name" }))
      .toBeInTheDocument();
    expect(getProfileData).not.toHaveBeenCalled();
    expect(getCurrent).not.toHaveBeenCalled();
    expect(getPendingMealRerolls).not.toHaveBeenCalled();
    expect(createInvalidationSubscription).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /dismiss|close|skip/i }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it.each(["google", "apple"] as const)(
    "saves a trimmed Display Name for %s and only then loads authenticated data",
    async (provider) => {
    getSession.mockResolvedValue({
      data: { session: oauthSession(undefined, true, provider) },
      error: null,
    });
    const user = userEvent.setup();

    render(<App />);

    const nameInput = await screen.findByLabelText("Display Name");
    await user.type(nameInput, "  Alex Rivera  ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(updateDisplayName).toHaveBeenCalledWith("Alex Rivera");
    expect(await screen.findByText("Welcome back, Alex Rivera"))
      .toBeInTheDocument();
    await waitFor(() => {
      expect(getProfileData).toHaveBeenCalledWith("oauth-user-1");
      expect(getCurrent).toHaveBeenCalledWith("oauth-user-1");
    });
  });

  it.each(["google", "apple"] as const)(
    "retains the entered name and offers retry when %s metadata saving fails",
    async (provider) => {
    getSession.mockResolvedValue({
      data: { session: oauthSession(undefined, true, provider) },
      error: null,
    });
    updateDisplayName.mockRejectedValue(new Error("metadata unavailable"));
    const user = userEvent.setup();

    render(<App />);

    const nameInput = await screen.findByLabelText("Display Name");
    await user.type(nameInput, "Alex Rivera");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/try again/i);
    expect(nameInput).toHaveValue("Alex Rivera");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(getProfileData).not.toHaveBeenCalled();
    expect(getCurrent).not.toHaveBeenCalled();
  });

  it.each(["google", "apple"] as const)(
    "allows logout as the only non-save exit from the %s gate",
    async (provider) => {
    getSession.mockResolvedValue({
      data: { session: oauthSession(undefined, true, provider) },
      error: null,
    });
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Log Out" }));

    expect(logout).toHaveBeenCalledOnce();
    expect(await screen.findByRole("button", { name: /^sign in$/i }))
      .toBeInTheDocument();
    expect(getProfileData).not.toHaveBeenCalled();
  });

  it.each(["google", "apple"] as const)(
    "admits the first valid %s SIGNED_IN session and authenticates it again later",
    async (provider) => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    render(<App />);

    expect(await screen.findByRole("button", { name: /^sign in$/i }))
      .toBeInTheDocument();
    await act(async () => {
      authStateChangeCallbacks[0](
        "SIGNED_IN",
        oauthSession("Stored Name", true, provider),
      );
    });

    expect(await screen.findByText("Welcome back, Stored Name"))
      .toBeInTheDocument();
    expect(getProfileData).toHaveBeenCalledOnce();

    await act(async () => {
      authStateChangeCallbacks[0]("SIGNED_OUT", null);
    });
    expect(await screen.findByRole("button", { name: /^sign in$/i }))
      .toBeInTheDocument();
    await act(async () => {
      authStateChangeCallbacks[0](
        "SIGNED_IN",
        oauthSession("Stored Name", true, provider),
      );
    });
    expect(await screen.findByText("Welcome back, Stored Name"))
      .toBeInTheDocument();
    expect(getProfileData).toHaveBeenCalledTimes(2);
  });

  it("retries once when discarding an invalid OAuth session fails transiently", async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    logout
      .mockRejectedValueOnce(new Error("temporary transport failure"))
      .mockResolvedValueOnce(undefined);

    render(<App />);
    expect(await screen.findByRole("button", { name: /^sign in$/i }))
      .toBeInTheDocument();
    await act(async () => {
      authStateChangeCallbacks[0]("SIGNED_IN", oauthSession("Alex", false));
    });

    await waitFor(() => expect(logout).toHaveBeenCalledTimes(2));
    expect(reportClientIncident).toHaveBeenCalledWith("oauth_auth_failure", expect.objectContaining({
      provider: "google",
      lifecycleStage: "session_restore",
      errorCode: "unverified_email",
      releaseIdentifier: "development",
    }));
    expect(reportClientIncident).not.toHaveBeenCalledWith(
      "oauth_auth_failure",
      expect.objectContaining({ errorCode: "session_discard_failed" }),
    );
    expect(getProfileData).not.toHaveBeenCalled();
  });

  it.each(["google", "apple"] as const)(
    "fails closed and discards a %s session without a verified email",
    async (provider) => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    render(<App />);

    expect(await screen.findByRole("button", { name: /^sign in$/i }))
      .toBeInTheDocument();
    sessionStorage.setItem("neuronutrition.oauth-initiating-provider", provider);
    await act(async () => {
      authStateChangeCallbacks[0](
        "SIGNED_IN",
        oauthSession("Alex", false, provider),
      );
    });

    expect(await screen.findByRole("status")).toHaveTextContent(
      new RegExp(`couldn't complete ${provider} sign-in`, "i"),
    );
    expect(screen.getByRole("button", { name: new RegExp(`continue with ${provider}`, "i") }))
      .toBeInTheDocument();
    await waitFor(() => expect(logout).toHaveBeenCalledOnce());
    expect(reportClientIncident).toHaveBeenCalledWith("oauth_auth_failure", expect.objectContaining({
      provider,
      lifecycleStage: "session_restore",
      errorCode: "unverified_email",
      releaseIdentifier: "development",
    }));
    expect(getProfileData).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("neuronutrition.oauth-initiating-provider"))
      .toBeNull();
  });

  it("returns to Log In with a retryable message when session restoration fails", async () => {
    sessionStorage.setItem("neuronutrition.oauth-initiating-provider", "google");
    getSession.mockRejectedValue(new Error("provider details must stay private"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(<App />);

    expect(await screen.findByRole("status")).toHaveTextContent(
      /couldn't complete google sign-in/i,
    );
    expect(screen.getByRole("button", { name: /continue with google/i }))
      .toBeInTheDocument();
    expect(screen.getByPlaceholderText(/you@example.com/i)).toBeInTheDocument();
    expect(reportClientIncident).toHaveBeenCalledWith("oauth_auth_failure", {
      provider: "google",
      lifecycleStage: "session_restore",
      errorCode: "session_restore_failed",
      releaseIdentifier: "development",
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(JSON.stringify(reportClientIncident.mock.calls)).not.toContain(
      "provider details must stay private",
    );
    // M11 / finding 5: the browser console must carry the stable error code,
    // never the raw provider/Supabase error object or its message.
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to restore session:",
      "session_restore_failed",
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      "provider details must stay private",
    );
  });

  it.each(["google", "apple"] as const)(
    "treats returning from %s without a session as cancellation without telemetry",
    async (provider) => {
      sessionStorage.setItem("neuronutrition.oauth-initiating-provider", provider);
      sessionStorage.setItem("neuronutrition.oauth-initiating-view", "register");
      getSession.mockResolvedValue({ data: { session: null }, error: null });

      render(<App />);

      expect(await screen.findByRole("status")).toHaveTextContent(
        new RegExp(`${provider} sign-in was canceled`, "i"),
      );
      expect(screen.getByPlaceholderText(/john doe/i)).toBeInTheDocument();
      expect(screen.getByRole("button", {
        name: new RegExp(`continue with ${provider}`, "i"),
      })).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/you@example.com/i)).toBeInTheDocument();
      expect(reportClientIncident).not.toHaveBeenCalled();
    },
  );

  it.each(["google", "apple"] as const)(
    "treats denied %s consent as cancellation without telemetry",
    async (provider) => {
      sessionStorage.setItem("neuronutrition.oauth-initiating-provider", provider);
      sessionStorage.setItem("neuronutrition.oauth-initiating-view", "login");
      window.history.replaceState(
        {},
        "",
        "/neuro-nutrition/?error=access_denied&error_description=user%20denied",
      );
      getSession.mockResolvedValue({ data: { session: null }, error: null });

      render(<App />);

      expect(await screen.findByRole("status")).toHaveTextContent(
        new RegExp(`${provider} sign-in was canceled`, "i"),
      );
      expect(reportClientIncident).not.toHaveBeenCalled();
      expect(window.location.search).toBe("");
    },
  );

  it.each(["google", "apple"] as const)(
    "reports a sanitized %s callback failure and returns to the initiating view",
    async (provider) => {
      sessionStorage.setItem("neuronutrition.oauth-initiating-provider", provider);
      sessionStorage.setItem("neuronutrition.oauth-initiating-view", "login");
      window.history.replaceState(
        {},
        "",
        `/neuro-nutrition/?error=server_error&error_description=secret-token-alex%40example.com`,
      );
      getSession.mockResolvedValue({ data: { session: null }, error: null });

      render(<App />);

      expect(await screen.findByRole("status")).toHaveTextContent(
        new RegExp(`couldn't complete ${provider} sign-in`, "i"),
      );
      expect(screen.getByPlaceholderText(/you@example.com/i)).toBeInTheDocument();
      expect(reportClientIncident).toHaveBeenCalledWith("oauth_auth_failure", {
        provider,
        lifecycleStage: "callback",
        errorCode: "oauth_callback_failed",
        releaseIdentifier: "development",
        timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });
      const payload = JSON.stringify(reportClientIncident.mock.calls);
      expect(payload).not.toContain("secret-token");
      expect(payload).not.toContain("alex@example.com");
      expect(payload).not.toContain("error_description");
    },
  );

  it("returns to the initiating Create Account view with a Back to Log In action", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    getSession.mockResolvedValue({ data: { session: null }, error: null });

    const firstPage = render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /create account/i }));
    await userEvent.click(screen.getByRole("button", { name: /continue with google/i }));
    expect(signInWithOAuth).toHaveBeenCalledWith("google");
    expect(sessionStorage.getItem("neuronutrition.oauth-initiating-view"))
      .toBe("register");
    firstPage.unmount();

    getSession.mockRejectedValue(new Error("provider details must stay private"));

    render(<App />);

    expect(await screen.findByPlaceholderText(/john doe/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue with google/i }))
      .toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /back to log in/i }));
    expect(screen.queryByPlaceholderText(/john doe/i)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText(/you@example.com/i)).toBeInTheDocument();
  });

  it("keeps the password recovery route unchanged", async () => {
    window.history.replaceState({}, "", "/neuro-nutrition/recover-password");
    getSession.mockResolvedValue({ data: { session: null }, error: null });

    render(<App />);
    await act(async () => {
      authStateChangeCallbacks[0]("PASSWORD_RECOVERY", oauthSession("Alex"));
    });

    expect(await screen.findByRole("heading", { name: "Recover password" }))
      .toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Choose your Display Name" }))
      .not.toBeInTheDocument();
  });
});
