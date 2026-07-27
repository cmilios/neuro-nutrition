import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const portable = (value) => value.split(path.sep).join("/");

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

  const migrations = await pinFiles(
    root,
    "supabase/migrations",
    (name) => name.endsWith(".sql"),
  );
  const frontendFiles = await pinFiles(root, "dist");
  const edgeFunctions = [];

  for (const [name, version] of Object.entries(functionVersions).sort()) {
    if (!version) {
      throw new Error(`Edge Function ${name} is missing an immutable version.`);
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

export function createRehearsalReport({
  candidateId,
  targetProjectRef,
  productionProjectRef,
  manifestValid,
  results,
  completedAt = new Date().toISOString(),
}) {
  if (targetProjectRef === productionProjectRef) {
    throw new Error(
      "Release rehearsal requires an isolated project, never production.",
    );
  }

  const resultsByCheck = new Map(
    results.map((result) => [result.check, result]),
  );
  const missingOrFailedChecks = REQUIRED_REHEARSAL_CHECKS.filter((check) => {
    const result = resultsByCheck.get(check);
    return (
      !result ||
      result.status !== "passed" ||
      !Array.isArray(result.evidence) ||
      result.evidence.length === 0
    );
  });
  if (!manifestValid) missingOrFailedChecks.unshift("manifest-integrity");

  const uniqueFailures = [...new Set(missingOrFailedChecks)];
  return {
    schemaVersion: 1,
    candidateId,
    completedAt,
    targetProjectRef,
    productionProjectRef,
    productionAuthorityChanged: false,
    decision: uniqueFailures.length === 0 ? "go" : "no-go",
    missingOrFailedChecks: uniqueFailures,
    results,
  };
}
