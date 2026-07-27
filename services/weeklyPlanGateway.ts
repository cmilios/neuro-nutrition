import type {
  AuthoritativeWeeklyPlanRow,
  MealPlan,
  Milestone,
  UserProfile,
  WeeklyPlanCommandOutcome,
} from "../types";
import { legacyWeeklyPlanStorage } from "./storageService";

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
  startOver(command: StartOverCommand): Promise<WeeklyPlanCommandOutcome>;
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

export const weeklyPlanGateway = createWeeklyPlanGateway(legacyWeeklyPlanStorage);
