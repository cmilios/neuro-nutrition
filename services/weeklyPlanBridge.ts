import type {
  AuthoritativeWeeklyPlanRow,
  MealPlan,
  Milestone,
  UserProfile,
} from "../types";

export type WeeklyPlanRolloutState = "legacy" | "maintenance" | "authoritative";

export const createWeeklyPlanRolloutStateReader = (
  client: {
    rpc(name: string): PromiseLike<{ data: unknown; error: unknown }>;
  },
) => async (): Promise<WeeklyPlanRolloutState> => {
  const { data, error } = await client.rpc("get_weekly_plan_rollout_state");
  if (error) throw error;
  if (data !== "legacy" && data !== "maintenance" && data !== "authoritative") {
    throw new Error("Weekly Plan rollout state is invalid.");
  }
  return data;
};

export interface BridgeGateway {
  getCurrent(userId: string): Promise<unknown>;
  createCurrent(command: unknown): Promise<unknown>;
  saveCurrent(command: unknown): Promise<unknown>;
}

interface LegacyPlanRow {
  meal_plan: MealPlan | null;
  updated_at: string | null;
}

interface LegacyPlanClient {
  from(table: "user_data"): {
    select(columns: string): {
      eq(column: "user_id", userId: string): {
        maybeSingle(): Promise<{ data: LegacyPlanRow | null; error: unknown }>;
      };
    };
    upsert(
      value: Record<string, unknown>,
      options: { onConflict: "user_id" },
    ): Promise<{ error: unknown }>;
  };
}

interface LegacyCreateCommand {
  commandId: string;
  userId: string;
  document: MealPlan;
  profile: UserProfile;
  milestones: Milestone[];
}

interface LegacySaveCommand {
  commandId: string;
  userId: string;
  document: MealPlan;
}

const legacyRow = (
  userId: string,
  document: MealPlan,
  updatedAt: string | null,
): AuthoritativeWeeklyPlanRow => ({
  planId: `legacy:${userId}`,
  userId,
  document,
  schemaVersion: 1,
  revision: 0,
  isActive: true,
  createdAt: null,
  updatedAt,
  deactivatedAt: null,
  predecessorPlanId: null,
  generationId: null,
});

export const createLegacyWeeklyPlanRoute = (
  client: LegacyPlanClient,
): BridgeGateway => ({
  async getCurrent(userId) {
    const { data, error } = await client
      .from("user_data")
      .select("meal_plan, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data?.meal_plan
      ? legacyRow(userId, data.meal_plan, data.updated_at)
      : null;
  },
  async createCurrent(value) {
    const command = value as LegacyCreateCommand;
    const updatedAt = new Date().toISOString();
    const { error } = await client.from("user_data").upsert({
      user_id: command.userId,
      profile: command.profile,
      meal_plan: command.document,
      milestones: command.milestones,
      updated_at: updatedAt,
    }, { onConflict: "user_id" });
    if (error) throw error;
    return legacyRow(command.userId, command.document, updatedAt);
  },
  async saveCurrent(value) {
    const command = value as LegacySaveCommand;
    const updatedAt = new Date().toISOString();
    const { error } = await client.from("user_data").upsert({
      user_id: command.userId,
      meal_plan: command.document,
      updated_at: updatedAt,
    }, { onConflict: "user_id" });
    if (error) throw error;
    return legacyRow(command.userId, command.document, updatedAt);
  },
});

export class WeeklyPlanRolloutError extends Error {
  constructor(
    public readonly code:
      | "weekly_plan_maintenance"
      | "weekly_plan_reload_required",
    message: string,
  ) {
    super(message);
    this.name = "WeeklyPlanRolloutError";
  }
}

export const createWeeklyPlanBridge = (
  getRolloutState: () => Promise<WeeklyPlanRolloutState>,
  legacy: BridgeGateway,
) => {
  const route = async (mutation: boolean) => {
    const state = await getRolloutState();
    if (state === "authoritative") {
      throw new WeeklyPlanRolloutError(
        "weekly_plan_reload_required",
        "Weekly Plan storage was upgraded. Reload to use the authoritative store.",
      );
    }
    if (state === "maintenance" && mutation) {
      throw new WeeklyPlanRolloutError(
        "weekly_plan_maintenance",
        "Weekly Plan changes are temporarily disabled during maintenance.",
      );
    }
    return legacy;
  };

  return {
    async getCurrent(userId: string) {
      return (await route(false)).getCurrent(userId);
    },
    async createCurrent(command: unknown) {
      return (await route(true)).createCurrent(command);
    },
    async saveCurrent(command: unknown) {
      return (await route(true)).saveCurrent(command);
    },
  };
};
