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
