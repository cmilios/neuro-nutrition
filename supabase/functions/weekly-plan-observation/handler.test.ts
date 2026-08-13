// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  createObservationProbeHandler,
  ProbeUpstreamError,
} from "./handler";

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function handler() {
  return createObservationProbeHandler({
    expectedTokenHash: await hash("monitor-token"),
    loadDatabaseSnapshot: vi.fn().mockResolvedValue({
      rolloutState: "authoritative",
    }),
    loadFunctionFailures: vi.fn().mockResolvedValue({ critical: 0, total: 0 }),
    loadReleaseIdentity: vi.fn().mockResolvedValue({ matches: true }),
  });
}

describe("Weekly Plan observation probes", () => {
  it.each([
    ["database", { rolloutState: "authoritative" }],
    ["function-failures", { critical: 0, total: 0 }],
    ["release-identity", { matches: true }],
  ])("serves the authenticated %s probe", async (probe, expected) => {
    const response = await (await handler())(
      new Request(`https://example.test/observe?probe=${probe}`, {
        headers: { authorization: "Bearer monitor-token" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expected);
  });

  it("rejects requests without the dedicated bearer credential", async () => {
    const response = await (await handler())(
      new Request("https://example.test/observe?probe=database"),
    );

    expect(response.status).toBe(401);
  });

  it("fails closed when an upstream probe is unavailable", async () => {
    const probeHandler = createObservationProbeHandler({
      expectedTokenHash: await hash("monitor-token"),
      loadDatabaseSnapshot: vi.fn().mockRejectedValue(new Error("offline")),
      loadFunctionFailures: vi.fn(),
      loadReleaseIdentity: vi.fn(),
    });

    const response = await probeHandler(
      new Request("https://example.test/observe?probe=database", {
        headers: { authorization: "Bearer monitor-token" },
      }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "probe_unavailable",
    });
  });

  it.each([401, 403])(
    "reports an upstream %i as a refused credential, not unreachability",
    async (upstreamStatus) => {
      const probeHandler = createObservationProbeHandler({
        expectedTokenHash: await hash("monitor-token"),
        loadDatabaseSnapshot: vi.fn().mockRejectedValue(
          new ProbeUpstreamError("RPC snapshot failed", upstreamStatus),
        ),
        loadFunctionFailures: vi.fn(),
        loadReleaseIdentity: vi.fn(),
      });

      const response = await probeHandler(
        new Request("https://example.test/observe?probe=database", {
          headers: { authorization: "Bearer monitor-token" },
        }),
      );

      expect(response.status).toBe(424);
      await expect(response.json()).resolves.toEqual({
        error: "probe_credential_rejected",
      });
    },
  );

  it("keeps an upstream server error unreachable rather than refused", async () => {
    const probeHandler = createObservationProbeHandler({
      expectedTokenHash: await hash("monitor-token"),
      loadDatabaseSnapshot: vi.fn().mockRejectedValue(
        new ProbeUpstreamError("RPC snapshot failed", 503),
      ),
      loadFunctionFailures: vi.fn(),
      loadReleaseIdentity: vi.fn(),
    });

    const response = await probeHandler(
      new Request("https://example.test/observe?probe=database", {
        headers: { authorization: "Bearer monitor-token" },
      }),
    );

    expect(response.status).toBe(502);
  });

  it("keeps the upstream message out of the refused-credential body", async () => {
    const probeHandler = createObservationProbeHandler({
      expectedTokenHash: await hash("monitor-token"),
      loadDatabaseSnapshot: vi.fn(),
      loadFunctionFailures: vi.fn().mockRejectedValue(
        new ProbeUpstreamError("PGRST303 JWT expired for sb_secret_t_HfM", 401),
      ),
      loadReleaseIdentity: vi.fn(),
    });

    const response = await probeHandler(
      new Request("https://example.test/observe?probe=function-failures", {
        headers: { authorization: "Bearer monitor-token" },
      }),
    );

    expect(JSON.stringify(await response.json())).not.toContain("PGRST303");
  });
});
