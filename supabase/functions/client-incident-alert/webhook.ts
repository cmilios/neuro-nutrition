// Forwards a delivery-failure alert to a real notification channel.
//
// The point of this module is where the webhook URL lives. The browser only
// ever knows the public function URL; the actual channel secret is a Supabase
// function secret read here, server-side, and never reaches the client bundle.
// A `VITE_`-prefixed webhook would be inlined into the bundle at build time and
// readable — and abusable — by anyone.
//
// Forwarding is best-effort by construction. A channel outage must not turn
// into a failed response, because the caller is already in a degraded state:
// it only reached this function because its primary telemetry path was broken.

import type { ClientIncidentAlert } from "./handler.ts";

// Failures are reported as a closed set of codes. Raw fetch errors are never
// surfaced, because a Deno network error can embed the request URL — which is
// the secret. The same reasoning that keeps provider messages out of incident
// rows keeps them out of here.
export type ForwardFailure =
  | { reason: "insecure_url" }
  | { reason: "network_error" }
  | { reason: "rejected"; status: number };

const DEFAULT_TIMEOUT_MS = 5_000;

export function createAlertForwarder(options: {
  webhookUrl: string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  onFailure?: (failure: ForwardFailure) => void;
}): (alert: ClientIncidentAlert) => Promise<void> {
  const { webhookUrl } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const onFailure = options.onFailure ?? (() => {});

  // Unset is a valid configuration: the log line remains the record.
  if (!webhookUrl) return async () => {};

  if (!webhookUrl.startsWith("https://")) {
    return async () => onFailure({ reason: "insecure_url" });
  }

  return async (alert: ClientIncidentAlert): Promise<void> => {
    const summary =
      `NeuroNutrition: client incident telemetry could not be delivered ` +
      `(${alert.failedEvent}). The primary channel is refusing writes.`;

    // `text` is what Slack reads and `content` is what Discord reads, so one
    // body works for either without the operator having to tell us which they
    // chose. Anything else gets the structured fields.
    const body = JSON.stringify({
      text: summary,
      content: summary,
      event: "client_incident_delivery_failure",
      failedEvent: alert.failedEvent,
      occurredAt: alert.occurredAt,
      receivedAt: alert.receivedAt,
    });

    let response: Response;
    try {
      response = await fetchImpl(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      onFailure({ reason: "network_error" });
      return;
    }

    if (!response.ok) {
      onFailure({ reason: "rejected", status: response.status });
    }
  };
}
