import { describe, expect, it, vi } from "vitest";
import { createClientIncidentReporter } from "./clientIncidentTelemetry";

describe("client incident telemetry", () => {
  it("sends only allow-listed privacy-limited context", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const report = createClientIncidentReporter({ rpc } as never);

    await report("authoritative_load_failure", {
      provider: "google",
      phase: "initial_load",
      operation: "load",
      authorityStatus: "checking",
      plan: { private: "must not leave the client" },
      rawError: "secret",
    } as never);

    expect(rpc).toHaveBeenCalledWith("record_weekly_plan_client_incident", {
      p_event_type: "authoritative_load_failure",
      p_context: {
        provider: "google",
        phase: "initial_load",
        operation: "load",
        authorityStatus: "checking",
      },
    });
  });

  it("sends only the sanitized OAuth incident contract", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const report = createClientIncidentReporter({ rpc } as never);

    await report("oauth_auth_failure", {
      provider: "apple",
      lifecycleStage: "callback",
      errorCode: "oauth_callback_failed",
      releaseIdentifier: "release-63",
      timestamp: "2026-08-05T18:00:00.000Z",
      token: "secret-token",
      authorizationCode: "secret-code",
      email: "alex@example.com",
      rawError: "provider-specific text",
    } as never);

    expect(rpc).toHaveBeenCalledWith("record_weekly_plan_client_incident", {
      p_event_type: "oauth_auth_failure",
      p_context: {
        provider: "apple",
        lifecycleStage: "callback",
        errorCode: "oauth_callback_failed",
        releaseIdentifier: "release-63",
        timestamp: "2026-08-05T18:00:00.000Z",
      },
    });
  });

  it("never rejects when telemetry storage fails", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: new Error("telemetry unavailable"),
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const alertOperator = vi.fn();
    const report = createClientIncidentReporter(
      { rpc } as never,
      alertOperator,
    );

    await expect(report("forced_reload_failure", {
      phase: "reload",
    })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    expect(alertOperator).toHaveBeenCalledWith("forced_reload_failure");
  });
});
