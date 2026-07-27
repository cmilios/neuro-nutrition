// @vitest-environment node

import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  REQUIRED_REHEARSAL_CHECKS,
  createRehearsalReport,
  createReleaseManifest,
  verifyReleaseManifest,
} from "./releaseCandidate.mjs";

describe("immutable release candidate manifest", () => {
  it("pins every deployable input and rejects a changed migration", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "release-candidate-"));
    await mkdir(path.join(root, "supabase", "migrations"), { recursive: true });
    await mkdir(path.join(root, "supabase", "functions", "generate-meal-plan"), {
      recursive: true,
    });
    await mkdir(path.join(root, "dist", "assets"), { recursive: true });
    await writeFile(
      path.join(root, "supabase", "migrations", "001.sql"),
      "select 1;\n",
    );
    await writeFile(
      path.join(root, "supabase", "config.toml"),
      'project_id = "isolated-project"\n',
    );
    await writeFile(
      path.join(root, "supabase", "functions", "generate-meal-plan", "index.ts"),
      "export {};\n",
    );
    await writeFile(path.join(root, "dist", "assets", "app.js"), "app\n");

    const manifest = await createReleaseManifest({
      root,
      commit: "0123456789abcdef0123456789abcdef01234567",
      targetProjectRef: "isolated-project",
      targetRegion: "eu-west-1",
      functionVersions: { "generate-meal-plan": "candidate-7" },
      createdAt: "2026-07-27T12:00:00.000Z",
    });

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      source: { commit: "0123456789abcdef0123456789abcdef01234567" },
      target: {
        purpose: "isolated-production-like-rehearsal",
        projectRef: "isolated-project",
        region: "eu-west-1",
      },
      edgeFunctions: [
        {
          name: "generate-meal-plan",
          version: "candidate-7",
        },
      ],
    });
    expect(manifest.migrations).toHaveLength(1);
    expect(manifest.frontend.files).toHaveLength(1);
    await expect(verifyReleaseManifest(root, manifest)).resolves.toEqual({
      valid: true,
      mismatches: [],
    });
    await expect(
      verifyReleaseManifest(root, manifest, {
        actualCommit: "ffffffffffffffffffffffffffffffffffffffff",
      }),
    ).resolves.toMatchObject({
      valid: false,
      mismatches: ["source.commit"],
    });

    await writeFile(
      path.join(root, "supabase", "migrations", "001.sql"),
      "select 2;\n",
    );

    await expect(verifyReleaseManifest(root, manifest)).resolves.toMatchObject({
      valid: false,
      mismatches: ["supabase/migrations/001.sql"],
    });
  });
});

describe("release rehearsal decision", () => {
  it("fails closed until every required scenario has reviewable passing evidence", () => {
    const passingResults = REQUIRED_REHEARSAL_CHECKS.map((check) => ({
      check,
      status: "passed",
      evidence: [`evidence/${check}.json`],
    }));

    expect(
      createRehearsalReport({
        candidateId: "candidate-id",
        targetProjectRef: "isolated-project",
        productionProjectRef: "production-project",
        manifestValid: true,
        results: passingResults,
        completedAt: "2026-07-27T13:00:00.000Z",
      }),
    ).toMatchObject({
      decision: "go",
      productionAuthorityChanged: false,
      missingOrFailedChecks: [],
    });

    expect(
      createRehearsalReport({
        candidateId: "candidate-id",
        targetProjectRef: "isolated-project",
        productionProjectRef: "production-project",
        manifestValid: true,
        results: passingResults.filter(
          ({ check }) => check !== "recovery-point-restored",
        ),
        completedAt: "2026-07-27T13:00:00.000Z",
      }),
    ).toMatchObject({
      decision: "no-go",
      missingOrFailedChecks: ["recovery-point-restored"],
      productionAuthorityChanged: false,
    });
  });

  it("refuses to rehearse against the production project", () => {
    expect(() =>
      createRehearsalReport({
        candidateId: "candidate-id",
        targetProjectRef: "production-project",
        productionProjectRef: "production-project",
        manifestValid: true,
        results: [],
      }),
    ).toThrow("isolated");
  });
});
