import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";

const validatorPath = path.resolve("docs/check.mjs");

test("the project landing page must link to developer and contribution guidance", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "neuro-onboarding-check-"));
  try {
    await Promise.all([
      writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: {} })),
      writeFile(path.join(root, ".env.example"), ""),
      writeFile(path.join(root, "README.md"), "# Project\n"),
      mkdir(path.join(root, "docs"), { recursive: true }).then(() =>
        writeFile(path.join(root, "docs", "development.md"), "# Developer guide\n"),
      ),
      writeFile(path.join(root, "CONTRIBUTING.md"), "# Contributing\n"),
    ]);

    const result = spawnSync(process.execPath, [validatorPath], {
      cwd: root,
      encoding: "utf8",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/README\.md:1 \[required-navigation\]/);
    expect(result.stderr).toMatch(/docs\/development\.md/);
    expect(result.stderr).toMatch(/CONTRIBUTING\.md/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
