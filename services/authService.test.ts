import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, updateUser, resetPasswordForEmail, signInWithOAuth, signOut, unlinkIdentity } = vi.hoisted(() => ({
  getUser: vi.fn(),
  updateUser: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  signInWithOAuth: vi.fn(),
  signOut: vi.fn(),
  unlinkIdentity: vi.fn(),
}));

vi.mock("./supabaseClient", () => ({
  supabase: {
    auth: {
      getUser,
      updateUser,
      resetPasswordForEmail,
      signInWithOAuth,
      signOut,
      unlinkIdentity,
    },
  },
}));

import { authService } from "./authService";
import { OAUTH_REDIRECT_URL } from "./applicationRoutes";

describe("authenticated security operations", () => {
  beforeEach(() => {
    getUser.mockReset();
    updateUser.mockReset();
    resetPasswordForEmail.mockReset();
    signInWithOAuth.mockReset();
    signOut.mockReset();
    unlinkIdentity.mockReset();
  });

  it("lists connected sign-in methods from the authenticated user's identities", async () => {
    getUser.mockResolvedValue({
      data: {
        user: {
          identities: [
            { id: "legacy-google", identity_id: "google-1", provider: "google" },
            { id: "legacy-email", identity_id: "email-1", provider: "email" },
          ],
        },
      },
      error: null,
    });

    await expect(authService.getConnectedSignInMethods()).resolves.toEqual([
      { identityId: "google-1", provider: "google" },
      { identityId: "email-1", provider: "email" },
    ]);
    expect(getUser).toHaveBeenCalledOnce();
  });

  it("sends the current and new password through the authenticated update contract", async () => {
    updateUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });

    await authService.changePassword("old-secret1", "new-secret2");

    expect(updateUser).toHaveBeenCalledWith({
      password: "new-secret2",
      current_password: "old-secret1",
    });
  });

  it("sets a first password without requiring the current password or ending the session", async () => {
    updateUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          identities: [
            { id: "legacy-google", identity_id: "google-1", provider: "google" },
            { id: "legacy-email", identity_id: "email-1", provider: "email" },
          ],
        },
      },
      error: null,
    });

    await expect(authService.setPassword("new-secret2")).resolves.toEqual([
      { identityId: "google-1", provider: "google" },
      { identityId: "email-1", provider: "email" },
    ]);

    expect(updateUser).toHaveBeenCalledWith({ password: "new-secret2" });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("disconnects the selected identity returned by the authenticated user lookup", async () => {
    const googleIdentity = {
      id: "legacy-google",
      identity_id: "google-1",
      provider: "google",
    };
    getUser.mockResolvedValue({
      data: {
        user: {
          identities: [
            googleIdentity,
            { id: "legacy-email", identity_id: "email-1", provider: "email" },
          ],
        },
      },
      error: null,
    });
    unlinkIdentity.mockResolvedValue({ data: {}, error: null });

    await authService.disconnectSignInMethod("google-1");

    expect(unlinkIdentity).toHaveBeenCalledWith(googleIdentity);
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

  it("persists a trimmed canonical Display Name", async () => {
    updateUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });

    await authService.updateDisplayName("  Alex Rivera  ");

    expect(updateUser).toHaveBeenCalledWith({
      data: { name: "Alex Rivera" },
    });
  });

  it("preserves Display Name update errors for retry handling", async () => {
    const authError = new Error("metadata unavailable");
    updateUser.mockResolvedValue({ data: { user: null }, error: authError });

    await expect(authService.updateDisplayName("Alex Rivera"))
      .rejects.toBe(authError);
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
