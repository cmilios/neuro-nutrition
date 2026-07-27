import { weeklyPlanBridgeClient } from "./services/weeklyPlanBridgeClient";

// The transitional HTML entry exposes the bridge for the legacy application
// shell without importing it into the authority-first application bundle.
(globalThis as typeof globalThis & {
  weeklyPlanBridgeClient: typeof weeklyPlanBridgeClient;
}).weeklyPlanBridgeClient = weeklyPlanBridgeClient;
