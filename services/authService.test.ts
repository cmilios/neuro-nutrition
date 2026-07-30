import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateUser, resetPasswordForEmail } = vi.hoisted(() => ({
  updateUser: vi.fn(),
  resetPasswordForEmail: vi.fn(),
}));

vi.mock("./supabaseClient", () => ({
  supabase: {
    auth: {
      updateUser,
      resetPasswordForEmail,
    },
  },
}));

import { authService } from "./authService";

describe("authenticated security operations", () => {
  beforeEach(() => {
    updateUser.mockReset();
    resetPasswordForEmail.mockReset();
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
});
