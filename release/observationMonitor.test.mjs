import { afterEach, describe, expect, it, vi } from "vitest";
import { runObservationMonitor } from "./observationMonitor.mjs";

const databaseSnapshot = {
  rolloutState: "authoritative",
  planInvariants: { violations: 0 },
  commands: { stale: 0, invalidStatus: 0 },
  locks: { stale: 0 },
  reservations: { stale: 0 },
  aiUsageLinkage: { unlinked: 0 },
  migrationEvidence: { valid: true },
  clientIncidents: { critical: 0 },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("observation monitor", () => {
  it("uses GET-only probes and passes a clean aggregate snapshot", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(databaseSnapshot)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ matches: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ critical: 0 })));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runObservationMonitor({
      databaseUrl: "https://example.test/database",
      databaseToken: "database-token",
      releaseIdentityUrl: "https://example.test/release",
      releaseIdentityToken: "release-token",
      functionFailuresUrl: "https://example.test/functions",
      functionFailuresToken: "function-token",
    });

    expect(result.evaluation.status).toBe("passed");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [, options] of fetchMock.mock.calls) {
      expect(options.method).toBe("GET");
      expect(options.headers).not.toHaveProperty("apikey");
    }
    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      Authorization: "Bearer database-token",
    });
  });

  it("alerts without a plan mutation when monitoring is unavailable", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const fetchMock = vi.fn((url) => {
      if (url.endsWith("/database")) return Promise.reject(new Error("offline"));
      if (url.endsWith("/release")) {
        return Promise.resolve(new Response(JSON.stringify({ matches: true })));
      }
      if (url.endsWith("/functions")) {
        return Promise.resolve(new Response(JSON.stringify({ critical: 0 })));
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runObservationMonitor({
      databaseUrl: "https://example.test/database",
      releaseIdentityUrl: "https://example.test/release",
      functionFailuresUrl: "https://example.test/functions",
      alertUrl: "https://example.test/alert",
      retryDelayMs: 0,
    });

    expect(result.evaluation.status).toBe("failed");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://example.test/alert",
      expect.objectContaining({ method: "POST" }),
    );
    expect(
      fetchMock.mock.calls
        .filter(([url]) => !url.endsWith("/alert"))
        .every(([, options]) => options.method === "GET"),
    ).toBe(true);
  });

  it("retries a transient probe failure and passes once it recovers", async () => {
    let databaseAttempts = 0;
    const fetchMock = vi.fn((url) => {
      if (url.endsWith("/database")) {
        databaseAttempts += 1;
        if (databaseAttempts < 3) {
          return Promise.resolve(new Response(null, { status: 502 }));
        }
        return Promise.resolve(new Response(JSON.stringify(databaseSnapshot)));
      }
      if (url.endsWith("/release")) {
        return Promise.resolve(new Response(JSON.stringify({ matches: true })));
      }
      return Promise.resolve(new Response(JSON.stringify({ critical: 0 })));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runObservationMonitor({
      databaseUrl: "https://example.test/database",
      releaseIdentityUrl: "https://example.test/release",
      functionFailuresUrl: "https://example.test/functions",
      retryDelayMs: 0,
    });

    expect(result.evaluation.status).toBe("passed");
    expect(databaseAttempts).toBe(3);
  });

  it("stops retrying a probe that is rejecting our credentials", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    let databaseAttempts = 0;
    const fetchMock = vi.fn((url) => {
      if (url.endsWith("/database")) {
        databaseAttempts += 1;
        return Promise.resolve(new Response(null, { status: 401 }));
      }
      if (url.endsWith("/release")) {
        return Promise.resolve(new Response(JSON.stringify({ matches: true })));
      }
      return Promise.resolve(new Response(JSON.stringify({ critical: 0 })));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runObservationMonitor({
      databaseUrl: "https://example.test/database",
      releaseIdentityUrl: "https://example.test/release",
      functionFailuresUrl: "https://example.test/functions",
      retryDelayMs: 0,
    });

    expect(result.evaluation.status).toBe("failed");
    expect(result.snapshot.error).toBe("http_401");
    expect(databaseAttempts).toBe(1);
  });

  // Observed in production: the Data API refuses the observation function's key
  // on one call and accepts it on the next. Failing the window on the first
  // refusal reports a self-healing blip as a monitoring outage.
  it("retries an upstream credential refusal that clears", async () => {
    let databaseAttempts = 0;
    const fetchMock = vi.fn((url) => {
      if (url.endsWith("/database")) {
        databaseAttempts += 1;
        if (databaseAttempts < 2) {
          return Promise.resolve(new Response(null, { status: 424 }));
        }
        return Promise.resolve(new Response(JSON.stringify(databaseSnapshot)));
      }
      if (url.endsWith("/release")) {
        return Promise.resolve(new Response(JSON.stringify({ matches: true })));
      }
      return Promise.resolve(new Response(JSON.stringify({ critical: 0 })));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runObservationMonitor({
      databaseUrl: "https://example.test/database",
      releaseIdentityUrl: "https://example.test/release",
      functionFailuresUrl: "https://example.test/functions",
      retryDelayMs: 0,
    });

    expect(result.evaluation.status).toBe("passed");
    expect(databaseAttempts).toBe(2);
  });

  it("still reports a refusal that survives every attempt distinctly", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    let databaseAttempts = 0;
    const fetchMock = vi.fn((url) => {
      if (url.endsWith("/database")) {
        databaseAttempts += 1;
        return Promise.resolve(new Response(null, { status: 424 }));
      }
      if (url.endsWith("/release")) {
        return Promise.resolve(new Response(JSON.stringify({ matches: true })));
      }
      return Promise.resolve(new Response(JSON.stringify({ critical: 0 })));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runObservationMonitor({
      databaseUrl: "https://example.test/database",
      releaseIdentityUrl: "https://example.test/release",
      functionFailuresUrl: "https://example.test/functions",
      attempts: 3,
      retryDelayMs: 0,
    });

    expect(result.evaluation.status).toBe("failed");
    expect(result.snapshot.error).toBe("http_424");
    expect(databaseAttempts).toBe(3);
  });
});
