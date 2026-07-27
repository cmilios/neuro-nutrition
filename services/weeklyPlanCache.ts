import type { AuthoritativeWeeklyPlanRow } from "../types";
import { isAuthoritativeWeeklyPlanRow } from "./weeklyPlanValidation";

const keyFor = (userId: string) =>
  `neuronutrition_current_weekly_plan_${userId}`;

export const weeklyPlanCache = {
  get(userId: string): AuthoritativeWeeklyPlanRow | null {
    const key = keyFor(userId);
    try {
      const serialized = sessionStorage.getItem(key);
      if (!serialized) return null;
      const row: unknown = JSON.parse(serialized);
      if (isAuthoritativeWeeklyPlanRow(row, userId)) return row;
      sessionStorage.removeItem(key);
    } catch {
      // The authoritative request still works when browser storage is unavailable.
    }

    return null;
  },

  set(userId: string, row: AuthoritativeWeeklyPlanRow) {
    if (!isAuthoritativeWeeklyPlanRow(row, userId)) return;
    try {
      sessionStorage.setItem(keyFor(userId), JSON.stringify(row));
    } catch {
      // A cache is optional and never becomes authority.
    }
  },

  clear(userId: string) {
    try {
      sessionStorage.removeItem(keyFor(userId));
    } catch {
      // A cache is optional and never becomes authority.
    }
  },
};
