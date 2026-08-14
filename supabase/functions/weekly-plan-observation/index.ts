import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createObservationProbeHandler,
  createPostgrestRpc,
  ProbeUpstreamError,
  type PostgrestCredential,
} from "./handler.ts";

const EXPECTED_MONITOR_TOKEN_HASH =
  "9211a1250a23b36181c4bc82cbe7f2acd76dc779c3606c34776185e6dd6dfb30";

function postgrestAdminCredential(): PostgrestCredential {
  const modernKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (modernKeys) {
    const parsed = JSON.parse(modernKeys) as Record<string, string>;
    if (parsed.default) return { apiKey: parsed.default };
  }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) {
    return { apiKey: legacy, authorization: `Bearer ${legacy}` };
  }
  throw new Error("Supabase service credential is unavailable");
}

const supabaseUrl = Deno.env.get("SUPABASE_URL");
if (!supabaseUrl) throw new Error("Supabase URL is unavailable");
const rpc = createPostgrestRpc({
  supabaseUrl,
  credential: postgrestAdminCredential(),
  fetch,
});

const handler = createObservationProbeHandler({
  expectedTokenHash: EXPECTED_MONITOR_TOKEN_HASH,
  loadDatabaseSnapshot: () => rpc("get_weekly_plan_observation_snapshot"),
  loadFunctionFailures: () => rpc("get_weekly_plan_function_failures"),
  loadReleaseIdentity: async (authorization) => {
    const response = await fetch(
      `${supabaseUrl}/functions/v1/generate-meal-plan/release-identity`,
      { headers: { authorization } },
    );
    if (!response.ok) {
      throw new ProbeUpstreamError(
        "Release identity probe failed",
        response.status,
      );
    }
    return await response.json() as Record<string, unknown>;
  },
});

Deno.serve(handler);
