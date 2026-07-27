// @vitest-environment node

import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  PRODUCTION_PROJECT_REF,
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
    await expect(
      createReleaseManifest({
        root,
        commit: "0123456789abcdef0123456789abcdef01234567",
        targetProjectRef: "isolated-project",
        targetRegion: "eu-west-1",
        functionVersions: {},
      }),
    ).rejects.toThrow("generate-meal-plan");

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
  it("fails closed until every required scenario has candidate-bound evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "release-evidence-"));
    const candidateId = "a".repeat(64);
    const evidenceDirectory = path.join(
      root,
      "release",
      "evidence",
      candidateId,
    );
    await mkdir(evidenceDirectory, { recursive: true });
    const passingResults = REQUIRED_REHEARSAL_CHECKS.map((check) => ({
      check,
      status: "passed",
      evidence: [`${check}.json`],
    }));
    for (const { check } of passingResults) {
      await writeFile(
        path.join(evidenceDirectory, `${check}.json`),
        `${JSON.stringify({ check, passed: true })}\n`,
      );
    }

    await expect(
      createRehearsalReport({
        root,
        candidateId,
        targetProjectRef: "isolated-project",
        manifestValid: true,
        results: passingResults,
        completedAt: "2026-07-27T13:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      decision: "go",
      productionAuthorityChanged: false,
      missingOrFailedChecks: [],
      results: expect.arrayContaining([
        expect.objectContaining({
          check: "manifest-integrity",
          evidence: [
            {
              path: `release/evidence/${candidateId}/manifest-integrity.json`,
              sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
            },
          ],
        }),
      ]),
    });

    await expect(
      createRehearsalReport({
        root,
        candidateId,
        targetProjectRef: "isolated-project",
        manifestValid: true,
        results: passingResults.filter(
          ({ check }) => check !== "recovery-point-restored",
        ),
        completedAt: "2026-07-27T13:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      decision: "no-go",
      missingOrFailedChecks: ["recovery-point-restored"],
      productionAuthorityChanged: false,
    });
  });

  it("refuses to rehearse against the production project", async () => {
    await expect(
      createRehearsalReport({
        root: ".",
        candidateId: "a".repeat(64),
        targetProjectRef: PRODUCTION_PROJECT_REF,
        manifestValid: true,
        results: [],
      }),
    ).rejects.toThrow("isolated");
  });
});
