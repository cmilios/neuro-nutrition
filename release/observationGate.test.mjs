import { describe, expect, it } from "vitest";
import {
  MAXIMUM_OBSERVATION_GAP_MINUTES,
  REQUIRED_OBSERVATION_CHECKS,
  createDeliveryGateReport,
  evaluateObservationSnapshot,
} from "./observationGate.mjs";

const cleanSnapshot = {
  checkedAt: "2026-07-29T08:27:00.000Z",
  rolloutState: "authoritative",
  releaseIdentity: { matches: true },
  planInvariants: { violations: 0 },
  commands: { stale: 0, invalidStatus: 0 },
  locks: { stale: 0 },
  reservations: { stale: 0 },
  aiUsageLinkage: { unlinked: 0 },
  migrationEvidence: { valid: true },
  functionFailures: { critical: 0 },
  clientIncidents: { critical: 0 },
};

const WINDOW_STARTED_AT = "2026-07-28T08:27:00.000Z";

// Builds a run of clean observations separated by the given gaps, in minutes,
// so a test can state the cadence it is about rather than a wall of timestamps.
const snapshotsSeparatedBy = (gapMinutes) => {
  let time = Date.parse(WINDOW_STARTED_AT);
  const snapshots = [
    { ...structuredClone(cleanSnapshot), checkedAt: WINDOW_STARTED_AT },
  ];
  for (const gap of gapMinutes) {
    time += gap * 60 * 1000;
    snapshots.push({
      ...structuredClone(cleanSnapshot),
      checkedAt: new Date(time).toISOString(),
    });
  }
  return snapshots;
};

const deliveryGateInput = (snapshots) => {
  const endedAt = snapshots.at(-1).checkedAt;
  const retainedUntil = new Date(
    Date.parse(endedAt) + 7 * 24 * 60 * 60 * 1000,
  ).toISOString();
  return {
    observationStartedAt: WINDOW_STARTED_AT,
    observationEndedAt: endedAt,
    recoveryPointRetainedUntil: retainedUntil,
    monitoringCoverage: {
      startedAt: WINDOW_STARTED_AT,
      endedAt,
      cadenceMinutes: 15,
      maximumGapMinutes: MAXIMUM_OBSERVATION_GAP_MINUTES,
      evidence: "https://example.test/monitoring",
    },
    recoveryPoint: {
      id: "recovery-point-1",
      verified: true,
      evidence: "https://example.test/recovery",
    },
    operatorAlerting: {
      configured: true,
      reachable: true,
      evidence: "https://example.test/alert-health",
    },
    snapshots,
    evidence: {
      immutableRelease: "https://example.test/release",
      migrationAssertions: "https://example.test/migration",
      signedInSuite: "https://example.test/suite",
      activeSoak: "https://example.test/soak",
      monitoringResults: "https://example.test/monitoring",
      recoveryPoint: "https://example.test/recovery",
    },
    findings: [{
      id: "release-drift-1",
      severity: "critical",
      status: "resolved",
      disposition: "Pinned the accepted function identity and resumed observation.",
      evidence: "https://example.test/finding",
    }],
  };
};

const monitoringGateOf = (report) =>
  report.gates.find((gate) => gate.gate === "monitoring")?.status;

describe("observation gate", () => {
  it("evaluates every required read-only observation check", () => {
    const result = evaluateObservationSnapshot(cleanSnapshot);

    expect(Object.keys(result.checks).sort())
      .toEqual([...REQUIRED_OBSERVATION_CHECKS].sort());
    expect(result.criticalFindings).toEqual([]);
    expect(result.status).toBe("passed");
  });

  it.each([
    ["drift is detected", false, "failed"],
    ["the source matches", true, "passed"],
    ["the deployment cannot report a digest", null, "passed"],
  ])("%s: release identity is %s", (_case, sourceMatches, status) => {
    const snapshot = structuredClone(cleanSnapshot);
    snapshot.releaseIdentity = { matches: true, sourceMatches };

    const result = evaluateObservationSnapshot(snapshot);

    expect(result.checks["release-identity"].status).toBe(status);
  });

  it("fails a matching version whose source has drifted", () => {
    const snapshot = structuredClone(cleanSnapshot);
    snapshot.releaseIdentity = { matches: true, sourceMatches: false };

    const result = evaluateObservationSnapshot(snapshot);

    expect(result.status).toBe("failed");
    expect(result.criticalFindings).toContainEqual({
      check: "release-identity",
      code: "critical_finding",
    });
  });

  it("fails closed when a probe is unavailable", () => {
    const snapshot = structuredClone(cleanSnapshot);
    snapshot.functionFailures = { error: "unavailable" };

    const result = evaluateObservationSnapshot(snapshot);

    expect(result.status).toBe("failed");
    expect(result.criticalFindings).toContainEqual(expect.objectContaining({
      check: "function-failures",
      code: "monitoring_unavailable",
    }));
  });

  it("declares delivery only when the window, retention, evidence, and findings all pass", () => {
    const report = createDeliveryGateReport(
      deliveryGateInput(snapshotsSeparatedBy(Array(96).fill(15))),
    );

    expect(report.decision).toBe("delivered");
    expect(report.gates.every((gate) => gate.status === "passed")).toBe(true);
  });

  it("certifies a window at the cadence GitHub's throttled scheduler produces", () => {
    // GitHub treats `cron` as best-effort: observed gaps run 45-90 minutes,
    // with a 2h20m overnight gap. A healthy window must still certify.
    const report = createDeliveryGateReport(
      deliveryGateInput(snapshotsSeparatedBy([140, ...Array(14).fill(95)])),
    );

    expect(monitoringGateOf(report)).toBe("passed");
    expect(report.decision).toBe("delivered");
  });

  it("blocks when a gap exceeds the tolerated maximum", () => {
    const report = createDeliveryGateReport(
      deliveryGateInput(snapshotsSeparatedBy([
        MAXIMUM_OBSERVATION_GAP_MINUTES + 1,
        ...Array(14).fill(95),
      ])),
    );

    expect(monitoringGateOf(report)).toBe("failed");
    expect(report.decision).toBe("blocked");
  });

  it("does not accept a clean final snapshot without timestamped gap-bounded coverage", () => {
    const report = createDeliveryGateReport({
      observationStartedAt: "2026-07-28T08:27:00.000Z",
      observationEndedAt: "2026-07-29T08:27:00.000Z",
      recoveryPointRetainedUntil: "2026-08-05T08:27:00.000Z",
      snapshots: [cleanSnapshot],
      evidence: {},
      findings: [],
    });

    expect(monitoringGateOf(report)).toBe("failed");
    expect(report.decision).toBe("blocked");
  });
});
