// The closed set of context keys a client incident may carry.
//
// This list is the contract shared by two enforcement points that must never
// drift apart:
//
//   1. `privacyLimitedContext` in ./clientIncidentTelemetry.ts, which strips
//      anything not named here before the payload leaves the browser.
//   2. `private.is_privacy_limited_client_context` in the database, which backs
//      a CHECK constraint on `public.weekly_plan_client_incidents.context`.
//
// When they disagree the database rejects the insert and the incident is lost
// silently, because telemetry is best-effort and must never interrupt a user
// recovery path. `weekly_plan_observation.test.ts` asserts the database accepts
// every key named here, so a change on one side fails the suite rather than
// disappearing in production.
//
// Keys are deliberately non-identifying: tokens, authorization codes, email
// addresses and raw provider messages have no key to travel under.
export const CLIENT_INCIDENT_CONTEXT_KEYS = [
  "provider",
  "phase",
  "lifecycleStage",
  "operation",
  "authorityStatus",
  "errorCode",
  "releaseIdentifier",
  "timestamp",
] as const;

// The database also caps each value at 80 characters.
export const CLIENT_INCIDENT_VALUE_MAX_LENGTH = 80;

export type ClientIncidentContext = Partial<
  Record<(typeof CLIENT_INCIDENT_CONTEXT_KEYS)[number], string>
>;
