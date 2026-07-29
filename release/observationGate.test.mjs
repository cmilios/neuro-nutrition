import { describe, expect, it } from "vitest";
import {
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

describe("observation gate", () => {
  it("evaluates every required read-only observation check", () => {
    const result = evaluateObservationSnapshot(cleanSnapshot);

    expect(Object.keys(result.checks).sort())
      .toEqual([...REQUIRED_OBSERVATION_CHECKS].sort());
    expect(result.criticalFindings).toEqual([]);
    expect(result.status).toBe("passed");
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
    const snapshots = [];
    for (
      let time = Date.parse("2026-07-28T08:27:00.000Z");
      time <= Date.parse("2026-07-29T08:27:00.000Z");
      time += 15 * 60 * 1000
    ) {
      snapshots.push({
        ...structuredClone(cleanSnapshot),
        checkedAt: new Date(time).toISOString(),
      });
    }
    const report = createDeliveryGateReport({
      observationStartedAt: "2026-07-28T08:27:00.000Z",
      observationEndedAt: "2026-07-29T08:27:00.000Z",
      recoveryPointRetainedUntil: "2026-08-05T08:27:00.000Z",
      monitoringCoverage: {
        startedAt: "2026-07-28T08:27:00.000Z",
        endedAt: "2026-07-29T08:27:00.000Z",
        cadenceMinutes: 15,
        maximumGapMinutes: 15,
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
    });

    expect(report.decision).toBe("delivered");
    expect(report.gates.every((gate) => gate.status === "passed")).toBe(true);
  });

  it("does not accept a clean final snapshot without timestamped fifteen-minute coverage", () => {
    const report = createDeliveryGateReport({
      observationStartedAt: "2026-07-28T08:27:00.000Z",
      observationEndedAt: "2026-07-29T08:27:00.000Z",
      recoveryPointRetainedUntil: "2026-08-05T08:27:00.000Z",
      snapshots: [cleanSnapshot],
      evidence: {},
      findings: [],
    });

    expect(report.gates.find((gate) => gate.gate === "monitoring")?.status)
      .toBe("failed");
    expect(report.decision).toBe("blocked");
  });
});
