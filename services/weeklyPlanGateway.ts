import type {
  AuthoritativeWeeklyPlanRow,
  IngredientProgressCommand,
  MealPlan,
  Milestone,
  UserProfile,
  WeeklyPlanCommandOutcome,
} from "../types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { legacyWeeklyPlanStorage } from "./storageService";
import { supabase } from "./supabaseClient";
import { requireAuthoritativeWeeklyPlanRow } from "./weeklyPlanValidation";

interface LegacyWeeklyPlanSnapshot {
  plan: MealPlan;
  updatedAt: string | null;
}

interface LegacyWeeklyPlanStorage {
  getWeeklyPlan(userId: string): Promise<LegacyWeeklyPlanSnapshot | null>;
  createWeeklyPlan(
    userId: string,
    profile: UserProfile,
    plan: MealPlan,
    milestones: Milestone[],
  ): Promise<{ updatedAt: string }>;
  saveWeeklyPlan(userId: string, plan: MealPlan): Promise<{ updatedAt: string }>;
  clearUserData(userId: string): Promise<void>;
}

interface CreateCurrentWeeklyPlanCommand extends SaveCurrentWeeklyPlanCommand {
  profile: UserProfile;
  milestones: Milestone[];
}

interface SaveCurrentWeeklyPlanCommand {
  commandId: string;
  userId: string;
  document: MealPlan;
}

interface StartOverCommand {
  commandId: string;
  userId: string;
}

export interface WeeklyPlanGateway {
  getCurrent(userId: string): Promise<AuthoritativeWeeklyPlanRow | null>;
  createCurrent(command: CreateCurrentWeeklyPlanCommand): Promise<WeeklyPlanCommandOutcome>;
  saveCurrent(command: SaveCurrentWeeklyPlanCommand): Promise<WeeklyPlanCommandOutcome>;
  setIngredientChecked(command: IngredientProgressCommand): Promise<WeeklyPlanCommandOutcome>;
  startOver(command: StartOverCommand): Promise<WeeklyPlanCommandOutcome>;
}

interface WeeklyPlanDatabaseRow {
  plan_id: string;
  user_id: string;
  document: unknown;
  schema_version: number;
  revision: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deactivated_at: string | null;
  predecessor_plan_id: string | null;
  generation_id: string | null;
}

const authoritativeRow = (row: WeeklyPlanDatabaseRow): AuthoritativeWeeklyPlanRow => ({
  planId: row.plan_id,
  userId: row.user_id,
  document: row.document as MealPlan,
  schemaVersion: row.schema_version,
  revision: row.revision,
  isActive: row.is_active,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  deactivatedAt: row.deactivated_at,
  predecessorPlanId: row.predecessor_plan_id,
  generationId: row.generation_id,
});

export const createAuthoritativeWeeklyPlanReader = (
  client: Pick<SupabaseClient, "from">,
) => ({
  async getCurrent(userId: string): Promise<AuthoritativeWeeklyPlanRow | null> {
    const { data, error } = await client
      .from("weekly_plans")
      .select(`
        plan_id, user_id, document, schema_version, revision, is_active,
        created_at, updated_at, deactivated_at, predecessor_plan_id, generation_id
      `)
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return requireAuthoritativeWeeklyPlanRow(
      authoritativeRow(data as WeeklyPlanDatabaseRow),
      userId,
    );
  },
});

export const createIngredientProgressGateway = (
  client: Pick<SupabaseClient, "rpc">,
) => ({
  async setIngredientChecked(
    command: IngredientProgressCommand,
  ): Promise<WeeklyPlanCommandOutcome> {
    const { data, error } = await client.rpc("set_ingredient_checked", {
      p_plan_id: command.planId,
      p_displayed_revision: command.displayedRevision,
      p_day: command.day,
      p_meal_type: command.mealType,
      p_ingredient_id: command.ingredientId,
      p_checked: command.checked,
      p_command_id: command.commandId,
    });
    if (error) throw error;

    const outcome = data as unknown as WeeklyPlanCommandOutcome;
    if (outcome.status === "succeeded" && outcome.result) {
      outcome.result = requireAuthoritativeWeeklyPlanRow(
        outcome.result,
        command.userId,
      );
    }
    return outcome;
  },
});

export type WeeklyPlanRealtimeStatus = "connected" | "disconnected";

export const createWeeklyPlanInvalidationSubscription = (
  client: Pick<SupabaseClient, "channel" | "removeChannel">,
  userId: string,
  onInvalidated: () => void,
  onStatusChanged: (status: WeeklyPlanRealtimeStatus) => void,
) => {
  const channel = client
    .channel(`current-weekly-plan:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "weekly_plans",
        filter: `user_id=eq.${userId}`,
      },
      onInvalidated,
    )
    .subscribe((status) => {
      onStatusChanged(status === "SUBSCRIBED" ? "connected" : "disconnected");
    });

  return {
    unsubscribe() {
      void client.removeChannel(channel);
    },
  };
};

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

const failedOutcome = (
  commandId: string,
  error: unknown,
): WeeklyPlanCommandOutcome => ({
  commandId,
  status: "failed",
  result: null,
  error: {
    code: "weekly_plan_persistence_failed",
    message: error instanceof Error ? error.message : "Weekly Plan persistence failed.",
    retryable: true,
  },
});

export const createWeeklyPlanGateway = (
  storage: LegacyWeeklyPlanStorage,
): WeeklyPlanGateway => ({
  async getCurrent(userId) {
    const snapshot = await storage.getWeeklyPlan(userId);
    return snapshot ? legacyRow(userId, snapshot.plan, snapshot.updatedAt) : null;
  },

  async createCurrent(command) {
    try {
      const saved = await storage.createWeeklyPlan(
        command.userId,
        command.profile,
        command.document,
        command.milestones,
      );
      return {
        commandId: command.commandId,
        status: "succeeded",
        result: legacyRow(command.userId, command.document, saved.updatedAt),
        error: null,
      };
    } catch (error) {
      return failedOutcome(command.commandId, error);
    }
  },

  async saveCurrent(command) {
    try {
      const saved = await storage.saveWeeklyPlan(command.userId, command.document);
      return {
        commandId: command.commandId,
        status: "succeeded",
        result: legacyRow(command.userId, command.document, saved.updatedAt),
        error: null,
      };
    } catch (error) {
      return failedOutcome(command.commandId, error);
    }
  },

  async setIngredientChecked(command) {
    return failedOutcome(
      command.commandId,
      new Error("Ingredient progress requires the authoritative store."),
    );
  },

  async startOver(command) {
    try {
      await storage.clearUserData(command.userId);
      return {
        commandId: command.commandId,
        status: "succeeded",
        result: null,
        error: null,
      };
    } catch (error) {
      return failedOutcome(command.commandId, error);
    }
  },
});

const legacyWeeklyPlanGateway = createWeeklyPlanGateway(legacyWeeklyPlanStorage);
const authoritativeWeeklyPlanReader = createAuthoritativeWeeklyPlanReader(supabase);
const ingredientProgressGateway = createIngredientProgressGateway(supabase);

export const weeklyPlanGateway: WeeklyPlanGateway = {
  ...legacyWeeklyPlanGateway,
  getCurrent: authoritativeWeeklyPlanReader.getCurrent,
  setIngredientChecked: ingredientProgressGateway.setIngredientChecked,
};
