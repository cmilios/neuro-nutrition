import { describe, expect, it, vi } from "vitest";
import { weeklyPlanFixture } from "../test/weeklyPlanFixture";
import { ActivityLevel, DietType, Gender, Goal } from "../types";
import {
  createAuthoritativeWeeklyPlanReader,
  createIngredientProgressGateway,
  createWeeklyPlanInvalidationSubscription,
  createWeeklyPlanGateway,
} from "./weeklyPlanGateway";

describe("Weekly Plan gateway", () => {
  it("loads and maps the authenticated user's active authoritative row", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        plan_id: "00000000-0000-4000-8000-000000000010",
        user_id: "user-1",
        document: weeklyPlanFixture,
        schema_version: 1,
        revision: 4,
        is_active: true,
        created_at: "2026-07-27T10:00:00.000Z",
        updated_at: "2026-07-27T11:00:00.000Z",
        deactivated_at: null,
        predecessor_plan_id: null,
        generation_id: null,
      },
      error: null,
    });
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle,
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const client = { from: vi.fn().mockReturnValue(query) };
    const reader = createAuthoritativeWeeklyPlanReader(client as never);

    await expect(reader.getCurrent("user-1")).resolves.toEqual({
      planId: "00000000-0000-4000-8000-000000000010",
      userId: "user-1",
      document: weeklyPlanFixture,
      schemaVersion: 1,
      revision: 4,
      isActive: true,
      createdAt: "2026-07-27T10:00:00.000Z",
      updatedAt: "2026-07-27T11:00:00.000Z",
      deactivatedAt: null,
      predecessorPlanId: null,
      generationId: null,
    });
    expect(client.from).toHaveBeenCalledWith("weekly_plans");
    expect(query.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(query.eq).toHaveBeenCalledWith("is_active", true);
  });

  it("rejects a malformed authoritative row at the read boundary", async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          plan_id: "00000000-0000-4000-8000-000000000010",
          user_id: "user-1",
          document: { weeklySummary: "Incomplete", days: [] },
          schema_version: 1,
          revision: 0,
          is_active: true,
          created_at: "2026-07-27T10:00:00.000Z",
          updated_at: "2026-07-27T10:00:00.000Z",
          deactivated_at: null,
          predecessor_plan_id: null,
          generation_id: null,
        },
        error: null,
      }),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const reader = createAuthoritativeWeeklyPlanReader({
      from: vi.fn().mockReturnValue(query),
    } as never);

    await expect(reader.getCurrent("user-1"))
      .rejects.toThrow("invalid Weekly Plan");
  });

  it("rejects an authoritative document without stable ingredient occurrence identities", async () => {
    const unidentified = structuredClone(weeklyPlanFixture) as unknown as {
      days: Array<{ breakfast: Record<string, unknown> }>;
    };
    delete unidentified.days[0].breakfast.ingredientIds;
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          plan_id: "00000000-0000-4000-8000-000000000010",
          user_id: "user-1",
          document: unidentified,
          schema_version: 1,
          revision: 0,
          is_active: true,
          created_at: "2026-07-27T10:00:00.000Z",
          updated_at: "2026-07-27T10:00:00.000Z",
          deactivated_at: null,
          predecessor_plan_id: null,
          generation_id: null,
        },
        error: null,
      }),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const reader = createAuthoritativeWeeklyPlanReader({
      from: vi.fn().mockReturnValue(query),
    } as never);

    await expect(reader.getCurrent("user-1"))
      .rejects.toThrow("invalid Weekly Plan");
  });

  it("presents a legacy persisted plan through the authoritative row contract", async () => {
    const storage = {
      getWeeklyPlan: vi.fn().mockResolvedValue({
        plan: weeklyPlanFixture,
        updatedAt: "2026-07-27T10:00:00.000Z",
      }),
      createWeeklyPlan: vi.fn(),
      saveWeeklyPlan: vi.fn(),
      clearUserData: vi.fn(),
    };
    const gateway = createWeeklyPlanGateway(storage);

    await expect(gateway.getCurrent("user-1")).resolves.toEqual({
      planId: "legacy:user-1",
      userId: "user-1",
      document: weeklyPlanFixture,
      schemaVersion: 1,
      revision: 0,
      isActive: true,
      createdAt: null,
      updatedAt: "2026-07-27T10:00:00.000Z",
      deactivatedAt: null,
      predecessorPlanId: null,
      generationId: null,
    });
  });

  it("returns the common command outcome after saving a plan", async () => {
    const storage = {
      getWeeklyPlan: vi.fn(),
      createWeeklyPlan: vi.fn(),
      saveWeeklyPlan: vi.fn().mockResolvedValue({
        updatedAt: "2026-07-27T11:00:00.000Z",
      }),
      clearUserData: vi.fn(),
    };
    const gateway = createWeeklyPlanGateway(storage);

    await expect(gateway.saveCurrent({
      commandId: "command-1",
      userId: "user-1",
      document: weeklyPlanFixture,
    })).resolves.toEqual({
      commandId: "command-1",
      status: "succeeded",
      result: expect.objectContaining({
        planId: "legacy:user-1",
        userId: "user-1",
        document: weeklyPlanFixture,
        revision: 0,
      }),
      error: null,
    });
    expect(storage.saveWeeklyPlan).toHaveBeenCalledWith("user-1", weeklyPlanFixture);
  });

  it("creates the initial profile and Weekly Plan atomically behind the gateway", async () => {
    const profile = {
      age: 30,
      gender: Gender.Male,
      heightCm: 175,
      weightKg: 75,
      activityLevel: ActivityLevel.ModeratelyActive,
      goal: Goal.LoseWeight,
      dietType: DietType.Mediterranean,
    };
    const storage = {
      getWeeklyPlan: vi.fn(),
      createWeeklyPlan: vi.fn().mockResolvedValue({
        updatedAt: "2026-07-27T11:00:00.000Z",
      }),
      saveWeeklyPlan: vi.fn(),
      clearUserData: vi.fn(),
    };
    const gateway = createWeeklyPlanGateway(storage);

    await expect(gateway.createCurrent({
      commandId: "command-create",
      userId: "user-1",
      document: weeklyPlanFixture,
      profile,
      milestones: [],
    })).resolves.toEqual(expect.objectContaining({
      commandId: "command-create",
      status: "succeeded",
      result: expect.objectContaining({ document: weeklyPlanFixture }),
    }));
    expect(storage.createWeeklyPlan).toHaveBeenCalledWith(
      "user-1",
      profile,
      weeklyPlanFixture,
      [],
    );
  });

  it("returns a structured failed outcome when legacy persistence fails", async () => {
    const storage = {
      getWeeklyPlan: vi.fn(),
      createWeeklyPlan: vi.fn(),
      saveWeeklyPlan: vi.fn().mockRejectedValue(new Error("storage unavailable")),
      clearUserData: vi.fn(),
    };
    const gateway = createWeeklyPlanGateway(storage);

    await expect(gateway.saveCurrent({
      commandId: "command-2",
      userId: "user-1",
      document: weeklyPlanFixture,
    })).resolves.toEqual({
      commandId: "command-2",
      status: "failed",
      result: null,
      error: {
        code: "weekly_plan_persistence_failed",
        message: "storage unavailable",
        retryable: true,
      },
    });
  });

  it("routes Start Over through the gateway and preserves its command envelope", async () => {
    const storage = {
      getWeeklyPlan: vi.fn(),
      createWeeklyPlan: vi.fn(),
      saveWeeklyPlan: vi.fn(),
      clearUserData: vi.fn().mockResolvedValue(undefined),
    };
    const gateway = createWeeklyPlanGateway(storage);

    await expect(gateway.startOver({
      commandId: "command-3",
      userId: "user-1",
    })).resolves.toEqual({
      commandId: "command-3",
      status: "succeeded",
      result: null,
      error: null,
    });
    expect(storage.clearUserData).toHaveBeenCalledWith("user-1");
  });

  it("sets ingredient progress through the narrow authenticated command", async () => {
    const result = {
      commandId: "10000000-0000-4000-8000-000000000001",
      status: "succeeded",
      result: {
        planId: "00000000-0000-4000-8000-000000000010",
        userId: "user-1",
        document: weeklyPlanFixture,
        schemaVersion: 1,
        revision: 5,
        isActive: true,
        createdAt: "2026-07-27T10:00:00.000Z",
        updatedAt: "2026-07-27T11:00:00.000Z",
        deactivatedAt: null,
        predecessorPlanId: null,
        generationId: null,
      },
      error: null,
    };
    const rpc = vi.fn().mockResolvedValue({ data: result, error: null });
    const gateway = createIngredientProgressGateway({ rpc } as never);

    await expect(gateway.setIngredientChecked({
      commandId: "10000000-0000-4000-8000-000000000001",
      userId: "user-1",
      planId: "00000000-0000-4000-8000-000000000010",
      displayedRevision: 4,
      day: "Monday",
      mealType: "breakfast",
      ingredientId: weeklyPlanFixture.days[0].breakfast.ingredientIds[0],
      checked: true,
    })).resolves.toEqual(result);
    expect(rpc).toHaveBeenCalledWith("set_ingredient_checked", {
      p_plan_id: "00000000-0000-4000-8000-000000000010",
      p_displayed_revision: 4,
      p_day: "Monday",
      p_meal_type: "breakfast",
      p_ingredient_id: weeklyPlanFixture.days[0].breakfast.ingredientIds[0],
      p_checked: true,
      p_command_id: "10000000-0000-4000-8000-000000000001",
    });
  });

  it("treats Realtime rows only as invalidations and reports connection freshness", () => {
    let invalidate: (() => void) | undefined;
    let reportStatus: ((status: string) => void) | undefined;
    const channel = {
      on: vi.fn((_event, _filter, handler) => {
        invalidate = handler;
        return channel;
      }),
      subscribe: vi.fn((handler) => {
        reportStatus = handler;
        return channel;
      }),
    };
    const removeChannel = vi.fn();
    const client = {
      channel: vi.fn().mockReturnValue(channel),
      removeChannel,
    };
    const onInvalidated = vi.fn();
    const onStatusChanged = vi.fn();

    const subscription = createWeeklyPlanInvalidationSubscription(
      client as never,
      "user-1",
      onInvalidated,
      onStatusChanged,
    );
    invalidate?.();
    reportStatus?.("SUBSCRIBED");
    reportStatus?.("CHANNEL_ERROR");

    expect(client.channel).toHaveBeenCalledWith("current-weekly-plan:user-1");
    expect(channel.on).toHaveBeenCalledWith(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "weekly_plans",
        filter: "user_id=eq.user-1",
      },
      expect.any(Function),
    );
    expect(onInvalidated).toHaveBeenCalledTimes(1);
    expect(onStatusChanged).toHaveBeenNthCalledWith(1, "connected");
    expect(onStatusChanged).toHaveBeenNthCalledWith(2, "disconnected");

    subscription.unsubscribe();
    expect(removeChannel).toHaveBeenCalledWith(channel);
  });
});
