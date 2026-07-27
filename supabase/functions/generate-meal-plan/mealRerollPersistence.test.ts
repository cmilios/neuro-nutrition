// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { weeklyPlanFixture } from "../../../test/weeklyPlanFixture";
import { createMealRerollCommandStore } from "./persistence";

describe("Meal Reroll command persistence", () => {
  it("maps the durable phases to service-only RPCs", async () => {
    const fetchImpl = vi.fn()
      .mockImplementation(async () => Response.json({
        commandId: "10000000-0000-4000-8000-000000000001",
        status: "in_progress",
        result: null,
        error: null,
      }));
    const commandStore = createMealRerollCommandStore({
      supabaseUrl: "https://example.supabase.co",
      serviceRoleKey: "service-key",
      fetchImpl,
    });
    const identity = {
      userId: "00000000-0000-4000-8000-000000000001",
      commandId: "10000000-0000-4000-8000-000000000001",
      inputFingerprint: "a".repeat(64),
    };

    await commandStore.begin({
      ...identity,
      displayedPlanId: "20000000-0000-4000-8000-000000000001",
      displayedRevision: 4,
      day: "Monday",
      mealType: "breakfast",
    });
    await commandStore.complete({
      ...identity,
      meal: weeklyPlanFixture.days[0].breakfast,
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://example.supabase.co/rest/v1/rpc/begin_meal_reroll",
      expect.objectContaining({
        body: JSON.stringify({
          p_user_id: identity.userId,
          p_command_id: identity.commandId,
          p_input_fingerprint: identity.inputFingerprint,
          p_displayed_plan_id: "20000000-0000-4000-8000-000000000001",
          p_displayed_revision: 4,
          p_day: "Monday",
          p_meal_type: "breakfast",
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://example.supabase.co/rest/v1/rpc/complete_meal_reroll",
      expect.objectContaining({
        body: JSON.stringify({
          p_user_id: identity.userId,
          p_command_id: identity.commandId,
          p_input_fingerprint: identity.inputFingerprint,
          p_meal: weeklyPlanFixture.days[0].breakfast,
        }),
      }),
    );
  });
});
