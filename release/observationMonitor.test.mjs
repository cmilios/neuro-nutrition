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
      releaseIdentityUrl: "https://example.test/release",
      functionFailuresUrl: "https://example.test/functions",
    });

    expect(result.evaluation.status).toBe("passed");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [, options] of fetchMock.mock.calls) {
      expect(options.method).toBe("GET");
    }
  });

  it("alerts without a plan mutation when monitoring is unavailable", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ matches: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ critical: 0 })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runObservationMonitor({
      databaseUrl: "https://example.test/database",
      releaseIdentityUrl: "https://example.test/release",
      functionFailuresUrl: "https://example.test/functions",
      alertUrl: "https://example.test/alert",
    });

    expect(result.evaluation.status).toBe("failed");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://example.test/alert",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock.mock.calls.slice(0, 3).every(([, options]) =>
      options.method === "GET"
    )).toBe(true);
  });
});
