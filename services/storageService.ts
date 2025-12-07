import { UserData, UserProfile, MealPlan, Milestone } from '../types';

const DATA_KEY_PREFIX = 'neuronutrition_data_';

export const storageService = {
  saveUserData: (userId: string, profile: UserProfile, mealPlan: MealPlan, milestones: Milestone[] = []) => {
    const data: UserData = { profile, mealPlan, milestones };
    localStorage.setItem(`${DATA_KEY_PREFIX}${userId}`, JSON.stringify(data));
  },

  getUserData: (userId: string): UserData | null => {
    const data = localStorage.getItem(`${DATA_KEY_PREFIX}${userId}`);
    if (!data) return null;
    
    const parsed = JSON.parse(data);
    // Ensure milestones array exists for backward compatibility
    if (!parsed.milestones) {
      parsed.milestones = [];
    }
    return parsed;
  },

  clearUserData: (userId: string) => {
    localStorage.removeItem(`${DATA_KEY_PREFIX}${userId}`);
  }
};