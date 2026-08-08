import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClientIncidentAlertHandler } from "./handler.ts";
import { createAlertForwarder } from "./webhook.ts";

// Server-side only. Set with:
//   supabase secrets set CLIENT_INCIDENT_WEBHOOK_URL=... --project-ref <ref>
// Leaving it unset is a valid configuration; the log line is still written.
const forwardAlert = createAlertForwarder({
  webhookUrl: Deno.env.get("CLIENT_INCIDENT_WEBHOOK_URL"),
  onFailure: (failure) => {
    console.error(JSON.stringify({
      event: "client_incident_alert_forward_failed",
      ...failure,
    }));
  },
});

const handler = createClientIncidentAlertHandler({
  allowedOrigins: [
    "https://cmilios.github.io",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ],
  recordAlert: (alert) => {
    // The log line is the always-on record, written before the forward is
    // attempted so an unreachable channel cannot cost us the evidence.
    // Filter the function's Logs view on `client_incident_delivery_failure`.
    console.warn(JSON.stringify({
      event: "client_incident_delivery_failure",
      ...alert,
    }));

    // Keep the isolate alive until the webhook settles, without making the
    // caller wait on it — the caller is a browser already in a failure path.
    const pending = forwardAlert(alert);
    if (typeof EdgeRuntime !== "undefined") {
      EdgeRuntime.waitUntil(pending);
    }
  },
});

Deno.serve(handler);
