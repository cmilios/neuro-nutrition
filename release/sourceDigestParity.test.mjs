// @vitest-environment node
import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  computeSourceDigest as runnerDigest,
  readFunctionSource,
} from "./sourceDigest.mjs";
import { computeSourceDigest as deployedDigest } from "../supabase/functions/generate-meal-plan/releaseIdentity.ts";

const fixture = [
  { name: "index.ts", content: "export const a = 1;\n" },
  { name: "handler.ts", content: "export const b = 2;\n" },
];

describe("source digest parity", () => {
  // The runner's copy and the deployed function's copy must agree, or the
  // drift check reports drift on every healthy deployment. They are separate
  // implementations on purpose; this is what stops them diverging.
  it("agrees with the deployed implementation", async () => {
    await expect(runnerDigest(fixture)).resolves.toBe(
      await deployedDigest(fixture),
    );
  });

  it("ignores line endings and trailing whitespace", async () => {
    const crlf = [
      { name: "index.ts", content: "export const a = 1;\r\n\r\n" },
      { name: "handler.ts", content: "export const b = 2;" },
    ];

    await expect(runnerDigest(crlf)).resolves.toBe(
      await runnerDigest(fixture),
    );
  });

  it("does not depend on the order files are read in", async () => {
    await expect(runnerDigest([...fixture].reverse())).resolves.toBe(
      await runnerDigest(fixture),
    );
  });

  it.each([
    ["content changes", [
      { name: "index.ts", content: "export const a = 2;\n" },
      { name: "handler.ts", content: "export const b = 2;\n" },
    ]],
    ["a file is added", [...fixture, {
      name: "extra.ts",
      content: "export const c = 3;\n",
    }]],
    ["a file is removed", [fixture[0]]],
    ["a file is renamed", [
      { name: "index.ts", content: "export const a = 1;\n" },
      { name: "renamed.ts", content: "export const b = 2;\n" },
    ]],
  ])("changes when %s", async (_case, changed) => {
    await expect(runnerDigest(changed)).resolves.not.toBe(
      await runnerDigest(fixture),
    );
  });

  it("reads the reviewed function source without its tests", async () => {
    const directory = path.resolve(
      import.meta.dirname,
      "../supabase/functions/generate-meal-plan",
    );

    const files = await readFunctionSource(directory);
    const names = files.map((file) => file.name).sort();

    expect(names).toEqual([
      "handler.ts",
      "index.ts",
      "nextWeeklyPlan.ts",
      "persistence.ts",
      "releaseIdentity.ts",
      "usage.ts",
    ]);
  });
});
