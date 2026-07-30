// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createReleaseIdentityHandler } from "./releaseIdentity";

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

describe("generate-meal-plan release identity probe", () => {
  it("authenticates the monitor and compares the immutable deployment version", async () => {
    const handler = createReleaseIdentityHandler({
      expectedTokenHash: await hash("monitor-token"),
      expectedVersion: 17,
      deploymentId: () => "project_function_17",
    });

    const response = await handler(new Request("https://example.test/release", {
      headers: { authorization: "Bearer monitor-token" },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      matches: true,
      expectedVersion: 17,
      actualVersion: 17,
    });
  });

  it("rejects an invalid monitoring credential", async () => {
    const handler = createReleaseIdentityHandler({
      expectedTokenHash: await hash("monitor-token"),
      expectedVersion: 17,
      deploymentId: () => "project_function_17",
    });

    const response = await handler(new Request("https://example.test/release", {
      headers: { authorization: "Bearer wrong-token" },
    }));

    expect(response.status).toBe(401);
  });
});
