import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const portable = (value) => value.split(path.sep).join("/");

export const PRODUCTION_PROJECT_REF = "cmayisxvronrwvzhyuer";

export const REQUIRED_REHEARSAL_CHECKS = Object.freeze([
  "manifest-integrity",
  "sanitized-legacy-fixtures",
  "invalid-document-abort",
  "source-destination-count-abort",
  "ownership-mismatch-abort",
  "canonical-content-mismatch-abort",
  "missing-secrets",
  "wrong-function-release",
  "missing-realtime-publication",
  "cross-account-access",
  "direct-authenticated-mutation",
  "response-loss-idempotency",
  "frontend-publication-failure",
  "telemetry-failure-isolation",
  "emergency-maintenance",
  "recovery-point-created",
  "recovery-point-restored",
  "signed-in-two-session-suite",
]);

async function filesUnder(root, relativeDirectory, include = () => true) {
  const absoluteDirectory = path.join(root, relativeDirectory);
  const entries = await readdir(absoluteDirectory, {
    recursive: true,
    withFileTypes: true,
  });

  return entries
    .filter((entry) => entry.isFile() && include(entry.name))
    .map((entry) =>
      portable(
        path.relative(
          root,
          path.join(entry.parentPath ?? entry.path, entry.name),
        ),
      ),
    )
    .sort();
}

async function pinFiles(root, relativeDirectory, include) {
  const files = await filesUnder(root, relativeDirectory, include);
  return Promise.all(
    files.map(async (file) => ({
      path: file,
      sha256: sha256(await readFile(path.join(root, file))),
    })),
  );
}

async function functionNames(root) {
  const entries = await readdir(path.join(root, "supabase/functions"), {
    withFileTypes: true,
  });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name)
    .sort();
}

function candidateIdentity(manifestWithoutIdentity) {
  return sha256(`${JSON.stringify(manifestWithoutIdentity)}\n`);
}

export async function createReleaseManifest({
  root,
  commit,
  targetProjectRef,
  targetRegion,
  functionVersions,
  createdAt = new Date().toISOString(),
}) {
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error("Release candidate commit must be a full 40-character SHA.");
  }
  if (!targetProjectRef || !targetRegion) {
    throw new Error("An isolated target project ref and region are required.");
  }
  if (targetProjectRef === PRODUCTION_PROJECT_REF) {
    throw new Error("Release candidates must target an isolated project.");
  }

  const migrations = await pinFiles(
    root,
    "supabase/migrations",
    (name) => name.endsWith(".sql"),
  );
  const frontendFiles = await pinFiles(root, "dist");
  const edgeFunctions = [];
  const discoveredFunctions = await functionNames(root);
  const suppliedFunctions = Object.keys(functionVersions).sort();
  const missingFunctions = discoveredFunctions.filter(
    (name) => !suppliedFunctions.includes(name),
  );
  const unknownFunctions = suppliedFunctions.filter(
    (name) => !discoveredFunctions.includes(name),
  );
  if (missingFunctions.length || unknownFunctions.length) {
    throw new Error(
      `Edge Function versions must exactly match the source tree. Missing: ${
        missingFunctions.join(", ") || "none"
      }; unknown: ${unknownFunctions.join(", ") || "none"}.`,
    );
  }

  for (const [name, version] of Object.entries(functionVersions).sort()) {
    if (!/^[1-9]\d*$/.test(version)) {
      throw new Error(
        `Edge Function ${name} requires a positive deployment version.`,
      );
    }
    const files = await pinFiles(root, `supabase/functions/${name}`);
    edgeFunctions.push({
      name,
      version,
      sourceSha256: sha256(`${JSON.stringify(files)}\n`),
      files,
    });
  }

  const manifestWithoutIdentity = {
    schemaVersion: 1,
    createdAt,
    source: { commit },
    target: {
      purpose: "isolated-production-like-rehearsal",
      projectRef: targetProjectRef,
      region: targetRegion,
    },
    supabaseConfig: {
      path: "supabase/config.toml",
      sha256: sha256(await readFile(path.join(root, "supabase/config.toml"))),
    },
    migrations,
    edgeFunctions,
    frontend: {
      artifactSha256: sha256(`${JSON.stringify(frontendFiles)}\n`),
      files: frontendFiles,
    },
  };

  return {
    ...manifestWithoutIdentity,
    candidateId: candidateIdentity(manifestWithoutIdentity),
  };
}

export async function verifyReleaseManifest(root, manifest, { actualCommit } = {}) {
  const mismatches = [];
  if (actualCommit && actualCommit !== manifest.source.commit) {
    mismatches.push("source.commit");
  }
  const pinnedFiles = [
    manifest.supabaseConfig,
    ...manifest.migrations,
    ...manifest.edgeFunctions.flatMap((entry) => entry.files),
    ...manifest.frontend.files,
  ];

  for (const pinned of pinnedFiles) {
    try {
      const actual = sha256(await readFile(path.join(root, pinned.path)));
      if (actual !== pinned.sha256) mismatches.push(pinned.path);
    } catch {
      mismatches.push(pinned.path);
    }
  }
  for (const edgeFunction of manifest.edgeFunctions) {
    if (
      sha256(`${JSON.stringify(edgeFunction.files)}\n`) !==
      edgeFunction.sourceSha256
    ) {
      mismatches.push(`supabase/functions/${edgeFunction.name}:sourceSha256`);
    }
  }
  if (
    sha256(`${JSON.stringify(manifest.frontend.files)}\n`) !==
    manifest.frontend.artifactSha256
  ) {
    mismatches.push("frontend.artifactSha256");
  }

  const actualDeployablePaths = [
    ...(await filesUnder(
      root,
      "supabase/migrations",
      (name) => name.endsWith(".sql"),
    )),
    ...(
      await Promise.all(
        manifest.edgeFunctions.map((entry) =>
          filesUnder(root, `supabase/functions/${entry.name}`),
        ),
      )
    ).flat(),
    ...(await filesUnder(root, "dist")),
  ];
  const actualFunctionNames = await functionNames(root);
  const pinnedFunctionNames = manifest.edgeFunctions
    .map((entry) => entry.name)
    .sort();
  for (const name of actualFunctionNames) {
    if (!pinnedFunctionNames.includes(name)) {
      mismatches.push(`supabase/functions/${name}`);
    }
  }
  for (const name of pinnedFunctionNames) {
    if (!actualFunctionNames.includes(name)) {
      mismatches.push(`supabase/functions/${name}`);
    }
  }
  const pinnedPaths = new Set(pinnedFiles.map((entry) => entry.path));
  for (const actualPath of actualDeployablePaths) {
    if (!pinnedPaths.has(actualPath)) mismatches.push(actualPath);
  }

  const { candidateId, ...manifestWithoutIdentity } = manifest;
  if (candidateIdentity(manifestWithoutIdentity) !== candidateId) {
    mismatches.push("candidateId");
  }

  const uniqueMismatches = [...new Set(mismatches)].sort();
  return {
    valid: uniqueMismatches.length === 0,
    mismatches: uniqueMismatches,
  };
}

export async function createRehearsalReport({
  root,
  candidateId,
  targetProjectRef,
  manifestValid,
  results,
  completedAt = new Date().toISOString(),
}) {
  if (targetProjectRef === PRODUCTION_PROJECT_REF) {
    throw new Error(
      "Release rehearsal requires an isolated project, never production.",
    );
  }
  if (!/^[0-9a-f]{64}$/.test(candidateId)) {
    throw new Error("Candidate ID must be a SHA-256 digest.");
  }

  const evidenceRoot = path.resolve(root, "release", "evidence", candidateId);
  const pinnedResults = await Promise.all(
    results.map(async (result) => {
      const evidence = [];
      const evidenceErrors = [];
      for (const relativeEvidencePath of result.evidence ?? []) {
        const absoluteEvidencePath = path.resolve(
          evidenceRoot,
          relativeEvidencePath,
        );
        if (
          absoluteEvidencePath !== evidenceRoot &&
          !absoluteEvidencePath.startsWith(`${evidenceRoot}${path.sep}`)
        ) {
          evidenceErrors.push(`${relativeEvidencePath}: outside candidate`);
          continue;
        }
        try {
          const evidenceContents = await readFile(absoluteEvidencePath);
          const evidenceDocument = JSON.parse(evidenceContents.toString("utf8"));
          const startedAt = Date.parse(evidenceDocument.startedAt);
          const completedAt = Date.parse(evidenceDocument.completedAt);
          const assertionsAreReviewable =
            Array.isArray(evidenceDocument.assertions) &&
            evidenceDocument.assertions.length > 0 &&
            evidenceDocument.assertions.every(
              (assertion) =>
                typeof assertion.name === "string" &&
                assertion.name.trim() &&
                assertion.status === "passed",
            );
          const sessionsAreIndependent =
            result.check !== "signed-in-two-session-suite" ||
            (Array.isArray(evidenceDocument.sessions) &&
              evidenceDocument.sessions.length >= 2 &&
              new Set(evidenceDocument.sessions).size >= 2);
          if (
            evidenceDocument.schemaVersion !== 1 ||
            evidenceDocument.candidateId !== candidateId ||
            evidenceDocument.check !== result.check ||
            evidenceDocument.targetProjectRef !== targetProjectRef ||
            typeof evidenceDocument.command !== "string" ||
            !evidenceDocument.command.trim() ||
            evidenceDocument.exitCode !== 0 ||
            !Number.isFinite(startedAt) ||
            !Number.isFinite(completedAt) ||
            completedAt < startedAt ||
            !assertionsAreReviewable ||
            !sessionsAreIndependent
          ) {
            evidenceErrors.push(
              `${relativeEvidencePath}: invalid execution evidence`,
            );
            continue;
          }
          evidence.push({
            path: portable(path.relative(root, absoluteEvidencePath)),
            sha256: sha256(evidenceContents),
          });
        } catch {
          evidenceErrors.push(`${relativeEvidencePath}: unreadable`);
        }
      }
      return { ...result, evidence, evidenceErrors };
    }),
  );
  const resultsByCheck = new Map(
    pinnedResults.map((result) => [result.check, result]),
  );
  const missingOrFailedChecks = REQUIRED_REHEARSAL_CHECKS.filter((check) => {
    const result = resultsByCheck.get(check);
    return (
      !result ||
      result.status !== "passed" ||
      !Array.isArray(result.evidence) ||
      result.evidence.length === 0 ||
      result.evidenceErrors.length > 0
    );
  });
  if (!manifestValid) missingOrFailedChecks.unshift("manifest-integrity");

  const uniqueFailures = [...new Set(missingOrFailedChecks)];
  return {
    schemaVersion: 1,
    candidateId,
    completedAt,
    targetProjectRef,
    productionProjectRef: PRODUCTION_PROJECT_REF,
    productionAuthorityChanged: false,
    decision: uniqueFailures.length === 0 ? "go" : "no-go",
    missingOrFailedChecks: uniqueFailures,
    results: pinnedResults,
  };
}
