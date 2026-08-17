// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  computeSourceDigest,
  createReleaseIdentityHandler,
} from "./releaseIdentity";

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
      readSourceFiles: async () => [
        { name: "index.ts", content: "export const a = 1;\n" },
      ],
    });

    const response = await handler(new Request("https://example.test/release", {
      headers: { authorization: "Bearer monitor-token" },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      matches: true,
      expectedVersion: 17,
      actualVersion: 17,
      sourceDigest: await computeSourceDigest([
        { name: "index.ts", content: "export const a = 1;\n" },
      ]),
    });
  });

  it("reports the source it is actually running, not a bundled constant", async () => {
    const digestOf = async (content: string) => {
      const handler = createReleaseIdentityHandler({
        expectedTokenHash: await hash("monitor-token"),
        expectedVersion: 17,
        deploymentId: () => "project_function_17",
        readSourceFiles: async () => [{ name: "index.ts", content }],
      });
      const response = await handler(
        new Request("https://example.test/release", {
          headers: { authorization: "Bearer monitor-token" },
        }),
      );
      return (await response.json()).sourceDigest;
    };

    // Same version, different source: the version check cannot see this, which
    // is the entire reason the digest exists.
    expect(await digestOf("export const a = 1;\n")).not.toBe(
      await digestOf("export const a = 2;\n"),
    );
  });

  it("reports a null digest when it cannot read its own source", async () => {
    const handler = createReleaseIdentityHandler({
      expectedTokenHash: await hash("monitor-token"),
      expectedVersion: 17,
      deploymentId: () => "project_function_17",
      readSourceFiles: () => Promise.reject(new Error("denied")),
    });

    const response = await handler(new Request("https://example.test/release", {
      headers: { authorization: "Bearer monitor-token" },
    }));

    expect(response.status).toBe(200);
    expect((await response.json()).sourceDigest).toBeNull();
  });

  it("rejects an invalid monitoring credential", async () => {
    const handler = createReleaseIdentityHandler({
      expectedTokenHash: await hash("monitor-token"),
      expectedVersion: 17,
      deploymentId: () => "project_function_17",
      readSourceFiles: async () => [
        { name: "index.ts", content: "export const a = 1;\n" },
      ],
    });

    const response = await handler(new Request("https://example.test/release", {
      headers: { authorization: "Bearer wrong-token" },
    }));

    expect(response.status).toBe(401);
  });
});
