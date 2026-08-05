import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateUser, resetPasswordForEmail, signInWithOAuth } = vi.hoisted(() => ({
  updateUser: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  signInWithOAuth: vi.fn(),
}));

vi.mock("./supabaseClient", () => ({
  supabase: {
    auth: {
      updateUser,
      resetPasswordForEmail,
      signInWithOAuth,
    },
  },
}));

import { authService } from "./authService";
import { OAUTH_REDIRECT_URL } from "./applicationRoutes";

describe("authenticated security operations", () => {
  beforeEach(() => {
    updateUser.mockReset();
    resetPasswordForEmail.mockReset();
    signInWithOAuth.mockReset();
  });

  it("sends the current and new password through the authenticated update contract", async () => {
    updateUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });

    await authService.changePassword("old-secret1", "new-secret2");

    expect(updateUser).toHaveBeenCalledWith({
      password: "new-secret2",
      current_password: "old-secret1",
    });
  });

  it("preserves structured Auth errors for field-specific handling", async () => {
    const authError = Object.assign(new Error("Current password is invalid"), {
      code: "invalid_credentials",
      status: 400,
    });
    updateUser.mockResolvedValue({ data: { user: null }, error: authError });

    await expect(authService.changePassword("wrong-secret1", "new-secret2"))
      .rejects.toBe(authError);
  });

  it("requests recovery for the signed-in email with the dedicated callback", async () => {
    resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });

    await authService.sendPasswordRecovery(
      "alex@example.com",
      "https://app.example.com/recover-password",
    );

    expect(resetPasswordForEmail).toHaveBeenCalledWith("alex@example.com", {
      redirectTo: "https://app.example.com/recover-password",
    });
  });

  it("preserves structured recovery request errors for safe UI handling", async () => {
    const authError = Object.assign(new Error("provider detail"), {
      code: "over_email_send_rate_limit",
      status: 429,
    });
    resetPasswordForEmail.mockResolvedValue({ data: null, error: authError });

    await expect(authService.sendPasswordRecovery(
      "alex@example.com",
      "https://app.example.com/recover-password",
    )).rejects.toBe(authError);
  });

  it("completes recovery without retaining or resending a current password", async () => {
    updateUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });

    await authService.completePasswordRecovery("recovered-secret3");

    expect(updateUser).toHaveBeenCalledWith({ password: "recovered-secret3" });
  });

  it("initiates the hosted OAuth redirect to the canonical return URL for each provider", async () => {
    signInWithOAuth.mockResolvedValue({ data: {}, error: null });

    await authService.signInWithOAuth("google");
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: OAUTH_REDIRECT_URL },
    });

    await authService.signInWithOAuth("apple");
    expect(signInWithOAuth).toHaveBeenLastCalledWith({
      provider: "apple",
      options: { redirectTo: OAUTH_REDIRECT_URL },
    });

    expect(OAUTH_REDIRECT_URL).toBe("https://cmilios.github.io/neuro-nutrition/");
  });

  it("surfaces a failure to start the OAuth redirect so the caller can recover", async () => {
    const authError = Object.assign(new Error("provider unreachable"), {
      code: "oauth_provider_error",
      status: 502,
    });
    signInWithOAuth.mockResolvedValue({ data: null, error: authError });

    await expect(authService.signInWithOAuth("google")).rejects.toBe(authError);
  });
});
