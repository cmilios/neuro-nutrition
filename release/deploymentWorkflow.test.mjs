// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("GitHub Pages deployment workflow", () => {
  it("does not block the application build on observation-only alert configuration", async () => {
    const workflow = await readFile(
      new URL("../.github/workflows/deploy.yml", import.meta.url),
      "utf8",
    );

    expect(workflow).not.toContain("Verify independent telemetry alerting");
    expect(workflow).not.toContain("CLIENT_INCIDENT_ALERT_HEALTH_URL");
    expect(workflow).toContain("VITE_CLIENT_INCIDENT_ALERT_URL");
  });
});

describe("scheduled Weekly Plan observation workflow", () => {
  it("runs only after observation infrastructure is explicitly enabled", async () => {
    const workflow = (
      await readFile(
        new URL("../.github/workflows/observe-weekly-plan.yml", import.meta.url),
        "utf8",
      )
    ).replaceAll("\r\n", "\n");

    expect(workflow).toContain(
      "vars.WEEKLY_PLAN_OBSERVATION_ENABLED == 'true' ||\n"
      + "      (github.event_name == 'workflow_dispatch' &&\n"
      + "      vars.WEEKLY_PLAN_OBSERVATION_ENABLED == 'manual')",
    );
  });
});
