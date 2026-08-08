import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClientIncidentAlertHandler } from "./handler.ts";

const handler = createClientIncidentAlertHandler({
  allowedOrigins: [
    "https://cmilios.github.io",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ],
  recordAlert: (alert) => {
    // Structured so the operator can filter the function logs on
    // `client_incident_delivery_failure`. Reaching this line means the primary
    // telemetry channel is refusing writes and needs investigation.
    console.warn(JSON.stringify({
      event: "client_incident_delivery_failure",
      ...alert,
    }));
  },
});

Deno.serve(handler);
