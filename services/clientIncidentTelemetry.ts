import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";

export type ClientIncidentType =
  | "authoritative_load_failure"
  | "authoritative_refetch_failure"
  | "realtime_recovery_succeeded"
  | "realtime_recovery_failure"
  | "unknown_command_outcome"
  | "revision_mismatch"
  | "forced_reload_failure"
  | "oauth_auth_failure";

export interface ClientIncidentContext {
  provider?: string;
  phase?: string;
  lifecycleStage?: string;
  operation?: string;
  authorityStatus?: string;
  errorCode?: string;
  releaseIdentifier?: string;
  timestamp?: string;
}

const CONTEXT_KEYS = [
  "provider",
  "phase",
  "lifecycleStage",
  "operation",
  "authorityStatus",
  "errorCode",
  "releaseIdentifier",
  "timestamp",
] as const;

const privacyLimitedContext = (
  context: ClientIncidentContext,
): ClientIncidentContext => Object.fromEntries(
  CONTEXT_KEYS.flatMap((key) => {
    const value = context[key];
    return typeof value === "string" && value.length > 0
      ? [[key, value.slice(0, 80)]]
      : [];
  }),
);

export const createClientIncidentReporter = (
  client: Pick<SupabaseClient, "rpc">,
  alertOperator: (failedEvent: ClientIncidentType) => void | Promise<void> =
    async (failedEvent) => {
      const url = import.meta.env.VITE_CLIENT_INCIDENT_ALERT_URL;
      if (!url) return;
      const body = JSON.stringify({
        eventType: "telemetry_delivery_failure",
        failedEvent,
        occurredAt: new Date().toISOString(),
      });
      if (typeof navigator !== "undefined" && navigator.sendBeacon?.(url, body)) {
        return;
      }
      await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
      });
    },
) => async (
  eventType: ClientIncidentType,
  context: ClientIncidentContext = {},
): Promise<void> => {
  try {
    const { error } = await client.rpc("record_weekly_plan_client_incident", {
      p_event_type: eventType,
      p_context: privacyLimitedContext(context),
    });
    if (error) throw error;
  } catch (error) {
    // Telemetry is deliberately best-effort and must never change application
    // authority or interrupt a user recovery path.
    console.warn("Weekly Plan client incident telemetry failed.", error);
    try {
      await alertOperator(eventType);
    } catch (alertError) {
      console.error("Weekly Plan telemetry operator alert failed.", alertError);
    }
  }
};

export const reportClientIncident = createClientIncidentReporter(supabase);
