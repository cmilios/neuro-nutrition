import { writeFile } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { evaluateObservationSnapshot } from "./observationGate.mjs";
import { computeSourceDigest, readFunctionSource } from "./sourceDigest.mjs";

// 424 is the observation function reporting that an upstream refused the
// credential it presented. Gateway logs show those refusals are transient — a
// PGRST303 on one call, a 200 on the next, same key — so they are retried like
// any other blip. If one survives every attempt it is still reported as
// http_424, which stays distinguishable from an unreachable upstream. A 401,
// by contrast, means our own monitoring token was rejected: that is a real
// misconfiguration and must not be retried.
const RETRYABLE_STATUSES = new Set([408, 424, 429, 500, 502, 503, 504]);
const PROBE_TIMEOUT_MS = 10_000;
// The observation probes 502 often enough that a single retry still leaves the
// scheduled run red most days; four attempts on a second-scale backoff also
// gives a cold edge instance time to boot. Worst case adds ~6s to a ~20s run.
const DEFAULT_ATTEMPTS = 4;
const DEFAULT_RETRY_DELAY_MS = 1000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readProbe(url, token, retry = {}) {
  if (!url) return { error: "probe_not_configured" };
  const attempts = retry.attempts ?? DEFAULT_ATTEMPTS;
  const retryDelayMs = retry.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  let failure = { error: "probe_unavailable", attempts: 0 };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (response.ok) return await response.json();
      failure = { error: `http_${response.status}`, attempts: attempt };
      // A 4xx other than 408/429 means misconfiguration, not a blip; stop early.
      if (!RETRYABLE_STATUSES.has(response.status)) return failure;
    } catch {
      failure = { error: "probe_unavailable", attempts: attempt };
    }
    if (attempt < attempts) await wait(retryDelayMs * attempt);
  }
  return failure;
}

/**
 * Compares the digest the deployment reports against the reviewed source.
 *
 * `sourceMatches` is deliberately three-valued. `null` means the question could
 * not be asked — a deployment predating the digest, a runtime that cannot read
 * its own source, or no reviewed source to compare against — and must not be
 * read as agreement. Only `false` is drift.
 */
async function withSourceDrift(releaseIdentity, sourceDirectory) {
  if (!releaseIdentity || typeof releaseIdentity !== "object") {
    return releaseIdentity;
  }
  if ("error" in releaseIdentity) return releaseIdentity;
  const reported = releaseIdentity.sourceDigest;
  if (typeof reported !== "string" || !sourceDirectory) {
    return { ...releaseIdentity, sourceMatches: null };
  }
  try {
    const expected = await computeSourceDigest(
      await readFunctionSource(sourceDirectory),
    );
    return {
      ...releaseIdentity,
      expectedSourceDigest: expected,
      sourceMatches: expected === reported,
    };
  } catch {
    return { ...releaseIdentity, sourceMatches: null };
  }
}

export async function runObservationMonitor(options = {}) {
  const retry = {
    attempts: options.attempts,
    retryDelayMs: options.retryDelayMs,
  };
  const [database, releaseIdentity, functionFailures] = await Promise.all([
    readProbe(options.databaseUrl, options.databaseToken, retry),
    readProbe(options.releaseIdentityUrl, options.releaseIdentityToken, retry),
    readProbe(options.functionFailuresUrl, options.functionFailuresToken, retry),
  ]);
  const snapshot = {
    ...(database && typeof database === "object" ? database : {}),
    checkedAt: new Date().toISOString(),
    releaseIdentity: await withSourceDrift(
      releaseIdentity,
      options.releaseIdentitySourceDirectory,
    ),
    functionFailures,
  };
  const evaluation = evaluateObservationSnapshot(snapshot);
  const result = { schemaVersion: 1, snapshot, evaluation };
  if (options.output) {
    await writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`);
  }
  if (evaluation.status === "failed") {
    const message = `Weekly Plan observation failed: ${
      evaluation.criticalFindings.map((finding) =>
        `${finding.check}:${finding.code}`
      ).join(", ")
    }`;
    process.stderr.write(`::error title=Weekly Plan observation::${message}\n`);
    if (options.alertUrl) {
      try {
        await fetch(options.alertUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message, checkedAt: snapshot.checkedAt }),
        });
      } catch {
        process.stderr.write("Operator alert delivery failed.\n");
      }
    }
  }
  return result;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  const result = await runObservationMonitor({
    databaseUrl: process.env.OBSERVATION_DATABASE_URL,
    databaseToken: process.env.OBSERVATION_DATABASE_TOKEN,
    releaseIdentityUrl: process.env.OBSERVATION_RELEASE_IDENTITY_URL,
    releaseIdentityToken: process.env.OBSERVATION_RELEASE_IDENTITY_TOKEN,
    functionFailuresUrl: process.env.OBSERVATION_FUNCTION_FAILURES_URL,
    functionFailuresToken: process.env.OBSERVATION_FUNCTION_FAILURES_TOKEN,
    releaseIdentitySourceDirectory: new URL(
      "../supabase/functions/generate-meal-plan",
      import.meta.url,
    ),
    alertUrl: process.env.OBSERVATION_ALERT_URL,
    output: process.env.OBSERVATION_OUTPUT ?? "observation-result.json",
  });
  if (result.evaluation.status !== "passed") process.exitCode = 1;
}
