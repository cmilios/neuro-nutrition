// Fallback ingest for client incident telemetry that could not reach the
// database.
//
// This exists for one failure mode: `record_weekly_plan_client_incident`
// rejecting every insert — a drifted context contract, a revoked grant, a
// changed constraint. That class of failure is uncorrelated with Supabase being
// reachable, so a receiver inside the same project still catches it. It
// deliberately does *not* write to `weekly_plan_client_incidents`: the whole
// point is to work when that path does not. The alert goes to the function log,
// which shares no schema, constraint or grant with the primary channel.
//
// The endpoint is unauthenticated because `navigator.sendBeacon` cannot attach
// an Authorization header, so anyone can post to it. Everything that reaches
// the log is therefore either generated here or first validated against a
// closed shape, and no part of the request body is ever echoed back. An
// anonymous caller cannot use this to write free text — or anyone's personal
// data — into the operator's logs.

const ALERT_EVENT_TYPE = "telemetry_delivery_failure";

// `failedEvent` is a `ClientIncidentType` from the client. Rather than copying
// that union here — a second list that could drift from the one the database
// and client already share — it is constrained by shape. Any real event type
// satisfies this, and nothing that satisfies it can carry a token, an email
// address or a provider message.
const FAILED_EVENT_PATTERN = /^[a-z][a-z_]{0,63}$/;

const MAX_BODY_BYTES = 1024;

export type ClientIncidentAlert = {
  failedEvent: string;
  occurredAt: string;
  receivedAt: string;
};

const baseHeaders = {
  "content-type": "application/json",
  "cache-control": "no-store",
};

function corsHeaders(
  request: Request,
  allowedOrigins: readonly string[],
): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" &&
    value.length <= 32 &&
    !Number.isNaN(Date.parse(value));
}

export function createClientIncidentAlertHandler(options: {
  allowedOrigins: readonly string[];
  recordAlert: (alert: ClientIncidentAlert) => void;
  maxPerMinute?: number;
  now?: () => number;
}) {
  const maxPerMinute = options.maxPerMinute ?? 60;
  const now = options.now ?? Date.now;

  // Per-isolate fixed window. Approximate, because Supabase may run several
  // isolates, but it bounds how much log volume one anonymous caller can
  // generate — which is all this needs to do.
  let windowStartedAt = now();
  let windowCount = 0;

  const withinRateLimit = (): boolean => {
    const currentTime = now();
    if (currentTime - windowStartedAt >= 60_000) {
      windowStartedAt = currentTime;
      windowCount = 0;
    }
    windowCount += 1;
    return windowCount <= maxPerMinute;
  };

  return async (request: Request): Promise<Response> => {
    const cors = corsHeaders(request, options.allowedOrigins);

    // The `fetch` fallback sends `content-type: application/json`, which
    // preflights. The `sendBeacon` path sends `text/plain` and does not.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== "POST") {
      return Response.json(
        { error: "method_not_allowed" },
        { status: 405, headers: { ...baseHeaders, ...cors } },
      );
    }

    if (!withinRateLimit()) {
      return Response.json(
        { error: "rate_limited" },
        { status: 429, headers: { ...baseHeaders, ...cors } },
      );
    }

    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) {
      return Response.json(
        { error: "payload_too_large" },
        { status: 413, headers: { ...baseHeaders, ...cors } },
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return Response.json(
        { error: "malformed_payload" },
        { status: 400, headers: { ...baseHeaders, ...cors } },
      );
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return Response.json(
        { error: "malformed_payload" },
        { status: 400, headers: { ...baseHeaders, ...cors } },
      );
    }

    const { eventType, failedEvent, occurredAt } = parsed as
      Record<string, unknown>;

    if (
      eventType !== ALERT_EVENT_TYPE ||
      typeof failedEvent !== "string" ||
      !FAILED_EVENT_PATTERN.test(failedEvent) ||
      !isIsoTimestamp(occurredAt)
    ) {
      return Response.json(
        { error: "malformed_payload" },
        { status: 400, headers: { ...baseHeaders, ...cors } },
      );
    }

    // Only the three validated fields survive; any other key the caller sent is
    // dropped rather than logged.
    options.recordAlert({
      failedEvent,
      occurredAt: new Date(occurredAt).toISOString(),
      receivedAt: new Date(now()).toISOString(),
    });

    return new Response(null, { status: 204, headers: cors });
  };
}
