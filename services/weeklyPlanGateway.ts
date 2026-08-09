import type {
  AuthoritativeWeeklyPlanRow,
  IngredientProgressCommand,
  MealPlan,
  MealRerollReservation,
  WeeklyPlanCommandOutcome,
} from "../types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import { requireAuthoritativeWeeklyPlanRow } from "./weeklyPlanValidation";

interface StartOverCommand {
  commandId: string;
  userId: string;
  displayedPlanId: string;
  displayedRevision: number;
}

export interface WeeklyPlanGateway {
  getCurrent(userId: string): Promise<AuthoritativeWeeklyPlanRow | null>;
  setIngredientChecked(command: IngredientProgressCommand): Promise<WeeklyPlanCommandOutcome>;
  startOver(command: StartOverCommand): Promise<WeeklyPlanCommandOutcome>;
  getPendingMealRerolls(userId: string): Promise<MealRerollReservation[]>;
  getPendingInitialGeneration(): Promise<string | null>;
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
  next_generation_id: string | null;
  next_generation_locked_at: string | null;
  health_profile_replacement_id: string | null;
  health_profile_replacement_locked_at: string | null;
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
  nextGenerationId: row.next_generation_id,
  nextGenerationLockedAt: row.next_generation_locked_at,
  healthProfileReplacementId: row.health_profile_replacement_id,
  healthProfileReplacementLockedAt: row.health_profile_replacement_locked_at,
});

export const createAuthoritativeWeeklyPlanReader = (
  client: Pick<SupabaseClient, "from">,
) => ({
  async getCurrent(userId: string): Promise<AuthoritativeWeeklyPlanRow | null> {
    const { data, error } = await client
      .from("weekly_plans")
      .select(`
        plan_id, user_id, document, schema_version, revision, is_active,
        created_at, updated_at, deactivated_at, predecessor_plan_id, generation_id,
        next_generation_id, next_generation_locked_at,
        health_profile_replacement_id, health_profile_replacement_locked_at
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

export const createMealRerollReservationReader = (
  client: Pick<SupabaseClient, "from">,
) => ({
  async getPendingMealRerolls(userId: string): Promise<MealRerollReservation[]> {
    const { data, error } = await client
      .from("weekly_plan_meal_reroll_reservations")
      .select("command_id, plan_id, day, meal_type, reserved_at")
      .eq("user_id", userId);
    if (error) throw error;
    return (data ?? []).map((row) => ({
      commandId: row.command_id,
      planId: row.plan_id,
      day: row.day,
      mealType: row.meal_type,
      reservedAt: row.reserved_at,
    })) as MealRerollReservation[];
  },
});

export const createPendingInitialGenerationReader = (
  client: Pick<SupabaseClient, "rpc">,
) => ({
  async getPendingInitialGeneration(): Promise<string | null> {
    const { data, error } = await client.rpc(
      "get_pending_initial_weekly_plan_generation",
    );
    if (error) throw error;
    if (data === null) return null;
    const commandId = (data as { commandId?: unknown }).commandId;
    if (
      typeof commandId !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(commandId)
    ) {
      throw new Error("Pending initial generation returned an invalid command ID");
    }
    return commandId;
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
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "weekly_plan_meal_reroll_reservations",
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

export const createStartOverGateway = (
  client: Pick<SupabaseClient, "rpc">,
) => ({
  async startOver(command: StartOverCommand): Promise<WeeklyPlanCommandOutcome> {
    const { data, error } = await client.rpc("start_over_weekly_plan", {
      p_displayed_plan_id: command.displayedPlanId,
      p_displayed_revision: command.displayedRevision,
      p_command_id: command.commandId,
    });
    if (error) throw error;
    return data as unknown as WeeklyPlanCommandOutcome;
  },
});

const authoritativeWeeklyPlanReader = createAuthoritativeWeeklyPlanReader(supabase);
const ingredientProgressGateway = createIngredientProgressGateway(supabase);
const mealRerollReservationReader = createMealRerollReservationReader(supabase);
const pendingInitialGenerationReader = createPendingInitialGenerationReader(supabase);
const startOverGateway = createStartOverGateway(supabase);

export const weeklyPlanGateway: WeeklyPlanGateway = {
  getCurrent: authoritativeWeeklyPlanReader.getCurrent,
  setIngredientChecked: ingredientProgressGateway.setIngredientChecked,
  startOver: startOverGateway.startOver,
  getPendingMealRerolls: mealRerollReservationReader.getPendingMealRerolls,
  getPendingInitialGeneration:
    pendingInitialGenerationReader.getPendingInitialGeneration,
};
