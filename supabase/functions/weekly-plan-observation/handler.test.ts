// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createObservationProbeHandler } from "./handler";

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
  });
});
