import { writeFile } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { evaluateObservationSnapshot } from "./observationGate.mjs";

async function readProbe(url, token) {
  if (!url) return { error: "probe_not_configured" };
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) return { error: `http_${response.status}` };
    return await response.json();
  } catch {
    return { error: "probe_unavailable" };
  }
}

export async function runObservationMonitor(options = {}) {
  const [database, releaseIdentity, functionFailures] = await Promise.all([
    readProbe(options.databaseUrl, options.databaseToken),
    readProbe(options.releaseIdentityUrl, options.releaseIdentityToken),
    readProbe(options.functionFailuresUrl, options.functionFailuresToken),
  ]);
  const snapshot = {
    ...(database && typeof database === "object" ? database : {}),
    checkedAt: new Date().toISOString(),
    releaseIdentity,
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
    alertUrl: process.env.OBSERVATION_ALERT_URL,
    output: process.env.OBSERVATION_OUTPUT ?? "observation-result.json",
  });
  if (result.evaluation.status !== "passed") process.exitCode = 1;
}
