import { supabase } from "./supabaseClient";
import {
  createLegacyWeeklyPlanRoute,
  createWeeklyPlanBridge,
  createWeeklyPlanRolloutStateReader,
} from "./weeklyPlanBridge";

// Transitional deployment entrypoint. The authority-first application does not
// import this module, so its bundle cannot retain a competing legacy authority.
export const weeklyPlanBridgeClient = createWeeklyPlanBridge(
  createWeeklyPlanRolloutStateReader(supabase),
  createLegacyWeeklyPlanRoute(supabase as never),
);
