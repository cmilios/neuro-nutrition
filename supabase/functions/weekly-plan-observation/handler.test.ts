// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  createObservationProbeHandler,
  createPostgrestRpc,
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
  it("sends an opaque Supabase secret key only as the PostgREST API key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ critical: 0, total: 0 }),
    );
    const rpc = createPostgrestRpc({
      supabaseUrl: "https://example.supabase.co",
      credential: { apiKey: "sb_secret_monitoring" },
      fetch: fetchMock,
    });

    await expect(rpc("get_weekly_plan_function_failures")).resolves.toEqual({
      critical: 0,
      total: 0,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.supabase.co/rest/v1/rpc/get_weekly_plan_function_failures",
      expect.objectContaining({
        headers: {
          "content-type": "application/json",
          apikey: "sb_secret_monitoring",
        },
      }),
    );
  });

  it("retains bearer authorization for a legacy service-role JWT", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ critical: 0 }));
    const rpc = createPostgrestRpc({
      supabaseUrl: "https://example.supabase.co",
      credential: {
        apiKey: "legacy-service-role-jwt",
        authorization: "Bearer legacy-service-role-jwt",
      },
      fetch: fetchMock,
    });

    await rpc("get_weekly_plan_function_failures");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          apikey: "legacy-service-role-jwt",
          authorization: "Bearer legacy-service-role-jwt",
        }),
      }),
    );
  });

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
