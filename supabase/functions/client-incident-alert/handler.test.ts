// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  type ClientIncidentAlert,
  createClientIncidentAlertHandler,
} from "./handler";

const ORIGIN = "https://cmilios.github.io";

function handler(overrides: {
  recordAlert?: (alert: ClientIncidentAlert) => void;
  maxPerMinute?: number;
  now?: () => number;
} = {}) {
  const recordAlert = overrides.recordAlert ?? vi.fn();
  return {
    recordAlert,
    respond: createClientIncidentAlertHandler({
      allowedOrigins: [ORIGIN],
      recordAlert,
      maxPerMinute: overrides.maxPerMinute,
      now: overrides.now,
    }),
  };
}

function alertRequest(body: unknown, origin = ORIGIN) {
  return new Request("https://example.test/client-incident-alert", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const validPayload = {
  eventType: "telemetry_delivery_failure",
  failedEvent: "oauth_auth_failure",
  occurredAt: "2026-08-08T12:00:00.000Z",
};

describe("client incident alert fallback", () => {
  it("records a well-formed delivery failure", async () => {
    const recordAlert = vi.fn();
    const { respond } = handler({ recordAlert });

    const response = await respond(alertRequest(validPayload));

    expect(response.status).toBe(204);
    expect(recordAlert).toHaveBeenCalledWith({
      failedEvent: "oauth_auth_failure",
      occurredAt: "2026-08-08T12:00:00.000Z",
      receivedAt: expect.any(String),
    });
  });

  it("answers the preflight the fetch fallback sends", async () => {
    const { respond } = handler();

    const response = await respond(
      new Request("https://example.test/client-incident-alert", {
        method: "OPTIONS",
        headers: {
          origin: ORIGIN,
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type",
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(response.headers.get("access-control-allow-headers"))
      .toContain("content-type");
  });

  it("does not grant CORS to an unknown origin", async () => {
    const { respond } = handler();

    const response = await respond(
      alertRequest(validPayload, "https://attacker.test"),
    );

    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("keeps anonymous callers from writing free text into the logs", async () => {
    const recordAlert = vi.fn();
    const { respond } = handler({ recordAlert });

    const rejected = [
      "not json at all",
      JSON.stringify([validPayload]),
      JSON.stringify({ ...validPayload, eventType: "something_else" }),
      // A provider message, an email address and a token all fail the shape.
      JSON.stringify({
        ...validPayload,
        failedEvent: "invalid_grant: user@example.com",
      }),
      JSON.stringify({ ...validPayload, failedEvent: "ya29.A0ARrdaM-TOKEN" }),
      JSON.stringify({ ...validPayload, occurredAt: "whenever" }),
      JSON.stringify({ eventType: "telemetry_delivery_failure" }),
    ];

    for (const body of rejected) {
      const response = await respond(alertRequest(body));
      expect(response.status).toBe(400);
    }
    expect(recordAlert).not.toHaveBeenCalled();
  });

  it("drops keys it was not asked to carry", async () => {
    const recordAlert = vi.fn();
    const { respond } = handler({ recordAlert });

    await respond(alertRequest({
      ...validPayload,
      accessToken: "ya29.A0ARrdaM-TOKEN",
      email: "someone@example.com",
    }));

    expect(recordAlert).toHaveBeenCalledWith({
      failedEvent: "oauth_auth_failure",
      occurredAt: "2026-08-08T12:00:00.000Z",
      receivedAt: expect.any(String),
    });
  });

  it("refuses an oversized body", async () => {
    const { respond, recordAlert } = handler();

    const response = await respond(alertRequest(
      JSON.stringify({ ...validPayload, padding: "x".repeat(2048) }),
    ));

    expect(response.status).toBe(413);
    expect(recordAlert).not.toHaveBeenCalled();
  });

  it("bounds how much log volume one caller can generate", async () => {
    const recordAlert = vi.fn();
    let clock = 1_000_000;
    const { respond } = handler({
      recordAlert,
      maxPerMinute: 3,
      now: () => clock,
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await respond(alertRequest(validPayload));
    }
    expect(recordAlert).toHaveBeenCalledTimes(3);

    // The window reopens rather than latching shut.
    clock += 60_000;
    await respond(alertRequest(validPayload));
    expect(recordAlert).toHaveBeenCalledTimes(4);
  });

  it("rejects methods other than POST", async () => {
    const { respond } = handler();

    const response = await respond(
      new Request("https://example.test/client-incident-alert", {
        method: "GET",
        headers: { origin: ORIGIN },
      }),
    );

    expect(response.status).toBe(405);
  });
});
