// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("authority-first production source boundary", () => {
  it("contains no legacy Weekly Plan or device-local migration path", async () => {
    const productionBoundarySources = await Promise.all([
      "App.tsx",
      "services/storageService.ts",
      "services/weeklyPlanGateway.ts",
      "services/aiService.ts",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
    const productionBoundary = productionBoundarySources.join("\n");

    expect(productionBoundary).not.toMatch(/\bmeal_plan\b/);
    expect(productionBoundary).not.toMatch(/legacyWeeklyPlan|legacy:user/);
    expect(productionBoundary).not.toMatch(/localStorage/);
  });
});
