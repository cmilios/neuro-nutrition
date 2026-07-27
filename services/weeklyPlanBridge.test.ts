import { describe, expect, it, vi } from "vitest";
import {
  createLegacyWeeklyPlanRoute,
  createWeeklyPlanBridge,
  createWeeklyPlanRolloutStateReader,
} from "./weeklyPlanBridge";

const gateway = () => ({
  getCurrent: vi.fn().mockResolvedValue(null),
  createCurrent: vi.fn().mockResolvedValue({ status: "succeeded" }),
  saveCurrent: vi.fn().mockResolvedValue({ status: "succeeded" }),
});

describe("Weekly Plan rollout bridge", () => {
  it("provides a concrete legacy-only persistence route for bridge deployments", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { meal_plan: null, updated_at: null },
      error: null,
    });
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle,
      upsert: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const client = { from: vi.fn().mockReturnValue(query) };
    const route = createLegacyWeeklyPlanRoute(client as never);

    await route.getCurrent("user-1");

    expect(client.from).toHaveBeenCalledWith("user_data");
    expect(query.select).toHaveBeenCalledWith("meal_plan, updated_at");
    expect(query.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("reads the server-enforced rollout state", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: "maintenance",
      error: null,
    });

    await expect(createWeeklyPlanRolloutStateReader({ rpc })())
      .resolves.toBe("maintenance");
    expect(rpc).toHaveBeenCalledWith("get_weekly_plan_rollout_state");
  });

  it("uses only the legacy route in legacy", async () => {
    const legacy = gateway();
    const authoritative = gateway();
    const bridge = createWeeklyPlanBridge(
      vi.fn().mockResolvedValue("legacy"),
      legacy,
    );

    await bridge.getCurrent("user-1");
    await bridge.saveCurrent({ commandId: "command-1" } as never);

    expect(legacy.getCurrent).toHaveBeenCalledWith("user-1");
    expect(legacy.saveCurrent).toHaveBeenCalled();
    expect(authoritative.getCurrent).not.toHaveBeenCalled();
    expect(authoritative.saveCurrent).not.toHaveBeenCalled();
  });

  it("allows legacy reads but disables plan mutations in maintenance", async () => {
    const legacy = gateway();
    const bridge = createWeeklyPlanBridge(
      vi.fn().mockResolvedValue("maintenance"),
      legacy,
    );

    await bridge.getCurrent("user-1");
    await expect(bridge.saveCurrent({ commandId: "command-1" } as never))
      .rejects.toMatchObject({ code: "weekly_plan_maintenance" });
    expect(legacy.getCurrent).toHaveBeenCalledWith("user-1");
    expect(legacy.saveCurrent).not.toHaveBeenCalled();
  });

  it("requires a reload instead of mixing authorities after cutover", async () => {
    const legacy = gateway();
    const authoritative = gateway();
    const bridge = createWeeklyPlanBridge(
      vi.fn().mockResolvedValue("authoritative"),
      legacy,
    );

    await expect(bridge.getCurrent("user-1"))
      .rejects.toMatchObject({ code: "weekly_plan_reload_required" });
    expect(legacy.getCurrent).not.toHaveBeenCalled();
    expect(authoritative.getCurrent).not.toHaveBeenCalled();
  });
});
