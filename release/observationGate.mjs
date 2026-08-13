const CHECK_DEFINITIONS = {
  "release-identity": {
    field: "releaseIdentity",
    passes: (value) => value?.matches === true,
  },
  "plan-invariants": {
    field: "planInvariants",
    passes: (value, snapshot) =>
      value?.violations === 0 && snapshot?.rolloutState === "authoritative",
  },
  "command-ages-and-statuses": {
    field: "commands",
    passes: (value) => value?.stale === 0 && value?.invalidStatus === 0,
  },
  locks: { field: "locks", passes: (value) => value?.stale === 0 },
  reservations: {
    field: "reservations",
    passes: (value) => value?.stale === 0,
  },
  "ai-usage-linkage": {
    field: "aiUsageLinkage",
    passes: (value) => value?.unlinked === 0,
  },
  "migration-evidence": {
    field: "migrationEvidence",
    passes: (value) => value?.valid === true,
  },
  "function-failures": {
    field: "functionFailures",
    passes: (value) => value?.critical === 0,
  },
  "client-incidents": {
    field: "clientIncidents",
    passes: (value) => value?.critical === 0,
  },
};

export const REQUIRED_OBSERVATION_CHECKS =
  Object.freeze(Object.keys(CHECK_DEFINITIONS));

export function evaluateObservationSnapshot(snapshot) {
  const checks = {};
  const criticalFindings = [];
  for (const check of REQUIRED_OBSERVATION_CHECKS) {
    const definition = CHECK_DEFINITIONS[check];
    const value = snapshot?.[definition.field];
    const unavailable = !value || typeof value !== "object" || "error" in value;
    const passed = !unavailable && definition.passes(value, snapshot);
    checks[check] = { status: passed ? "passed" : "failed" };
    if (!passed) {
      criticalFindings.push({
        check,
        code: unavailable ? "monitoring_unavailable" : "critical_finding",
      });
    }
  }
  return {
    checkedAt: snapshot?.checkedAt ?? null,
    status: criticalFindings.length === 0 ? "passed" : "failed",
    checks,
    criticalFindings,
  };
}

const validLink = (value) =>
  typeof value === "string" && /^https?:\/\/\S+$/.test(value);

/**
 * The observation workflow asks GitHub for a run every fifteen minutes, but
 * GitHub treats scheduled workflows as best-effort and throttles them: observed
 * gaps run 45-90 minutes, and past 2h20m overnight. A fifteen-minute ceiling
 * therefore blocked every window on the timestamps alone, so `blocked` could
 * not distinguish an unhealthy system from a late scheduler. Three hours clears
 * the worst gap seen while still catching a monitor that genuinely stopped.
 */
export const MAXIMUM_OBSERVATION_GAP_MINUTES = 180;

const hasBoundedGapCoverage = (evaluations, start, end) => {
  const times = evaluations
    .map((evaluation) => Date.parse(evaluation.checkedAt))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (times.length < 2 || times[0] > start || times.at(-1) < end) return false;
  const maximumGap = MAXIMUM_OBSERVATION_GAP_MINUTES * 60 * 1000;
  return times.slice(1)
    .every((time, index) => time - times[index] <= maximumGap);
};

export function createDeliveryGateReport(input) {
  const start = Date.parse(input.observationStartedAt);
  const end = Date.parse(input.observationEndedAt);
  const retainedUntil = Date.parse(input.recoveryPointRetainedUntil);
  const evaluations = (input.snapshots ?? []).map(evaluateObservationSnapshot);
  const evidenceKeys = [
    "immutableRelease",
    "migrationAssertions",
    "signedInSuite",
    "activeSoak",
    "monitoringResults",
    "recoveryPoint",
  ];
  const findings = input.findings ?? [];
  const gates = [
    {
      gate: "observation-window",
      status: Number.isFinite(start) && Number.isFinite(end)
        && end - start >= 24 * 60 * 60 * 1000 ? "passed" : "failed",
    },
    {
      gate: "monitoring",
      status: validLink(input.monitoringCoverage?.evidence)
        && hasBoundedGapCoverage(evaluations, start, end)
        && evaluations.length > 0
        && evaluations.every((result) => result.status === "passed")
        ? "passed" : "failed",
    },
    {
      gate: "operator-alerting",
      status: input.operatorAlerting?.configured === true
        && input.operatorAlerting?.reachable === true
        && validLink(input.operatorAlerting?.evidence)
        ? "passed" : "failed",
    },
    {
      gate: "recovery-retention",
      status: typeof input.recoveryPoint?.id === "string"
        && input.recoveryPoint.id.length > 0
        && input.recoveryPoint?.verified === true
        && validLink(input.recoveryPoint?.evidence)
        && Number.isFinite(retainedUntil)
        && retainedUntil >= end + 7 * 24 * 60 * 60 * 1000
        ? "passed" : "failed",
    },
    {
      gate: "evidence",
      status: evidenceKeys.every((key) => validLink(input.evidence?.[key]))
        ? "passed" : "failed",
    },
    {
      gate: "finding-disposition",
      status: findings.every((finding) =>
        finding.status === "resolved"
        && typeof finding.disposition === "string"
        && finding.disposition.length > 0
        && validLink(finding.evidence)
      ) ? "passed" : "failed",
    },
  ];
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    observation: {
      startedAt: input.observationStartedAt,
      endedAt: input.observationEndedAt,
      coverage: input.monitoringCoverage,
    },
    recoveryPoint: input.recoveryPoint,
    operatorAlerting: input.operatorAlerting,
    gates,
    evaluations,
    evidence: input.evidence,
    findings,
    decision: gates.every((gate) => gate.status === "passed")
      ? "delivered" : "blocked",
  };
}
