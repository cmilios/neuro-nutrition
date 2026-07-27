import type { MealPlan, Milestone, UserData, UserProfile } from '../types';
import { supabase } from './supabaseClient';

const DATA_KEY_PREFIX = 'neuronutrition_data_';

const loadLegacyUserData = async (userId: string): Promise<UserData | null> => {
  const { data, error } = await supabase
    .from('user_data')
    .select('profile, meal_plan, milestones')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('Error fetching user data:', error);
    throw error;
  }

  if (data) {
    return {
      profile: data.profile,
      mealPlan: data.meal_plan,
      milestones: data.milestones || [],
    };
  }

  const localData = localStorage.getItem(`${DATA_KEY_PREFIX}${userId}`);
  if (!localData) return null;

  console.log('Found local data. Returning immediately and attempting background migration...');
  try {
    const parsed = JSON.parse(localData) as UserData;

    // Finish migration before returning. A fire-and-forget upsert can race
    // with a subsequent save and overwrite a newly generated plan.
    const { error: migrationError } = await supabase
      .from('user_data')
      .upsert({
        user_id: userId,
        profile: parsed.profile,
        meal_plan: parsed.mealPlan,
        milestones: parsed.milestones || [],
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    if (migrationError) {
      console.error('Local data migration failed:', migrationError);
    } else {
      localStorage.removeItem(`${DATA_KEY_PREFIX}${userId}`);
    }

    return parsed;
  } catch (parseError) {
    console.error('Failed to parse local data for migration:', parseError);
    return null;
  }
};

export const storageService = {
  async saveProfileData(
    userId: string,
    profile: UserProfile,
    milestones: Milestone[] = [],
  ) {
    const { error } = await supabase
      .from('user_data')
      .upsert({
        user_id: userId,
        profile,
        milestones,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    if (error) {
      console.error('Error saving profile data:', error);
      throw error;
    }
  },

  async getProfileData(userId: string) {
    const data = await loadLegacyUserData(userId);
    return data
      ? { profile: data.profile, milestones: data.milestones }
      : null;
  },
};

// The legacy adapter is intentionally kept behind weeklyPlanGateway. It can be
// replaced by the authoritative store without changing App's plan dependency.
export const legacyWeeklyPlanStorage = {
  async getWeeklyPlan(userId: string) {
    const data = await loadLegacyUserData(userId);
    if (!data?.mealPlan) return null;

    return {
      plan: data.mealPlan,
      updatedAt: null,
    };
  },

  async createWeeklyPlan(
    userId: string,
    profile: UserProfile,
    mealPlan: MealPlan,
    milestones: Milestone[],
  ) {
    const updatedAt = new Date().toISOString();
    const { error } = await supabase
      .from('user_data')
      .upsert({
        user_id: userId,
        profile,
        meal_plan: mealPlan,
        milestones,
        updated_at: updatedAt,
      }, { onConflict: 'user_id' });

    if (error) {
      console.error('Error creating Weekly Plan:', error);
      throw error;
    }

    return { updatedAt };
  },

  async saveWeeklyPlan(userId: string, mealPlan: MealPlan) {
    const updatedAt = new Date().toISOString();
    const { error } = await supabase
      .from('user_data')
      .upsert({
        user_id: userId,
        meal_plan: mealPlan,
        updated_at: updatedAt,
      }, { onConflict: 'user_id' });

    if (error) {
      console.error('Error saving Weekly Plan:', error);
      throw error;
    }

    return { updatedAt };
  },

  async clearUserData(userId: string) {
    const { error } = await supabase
      .from('user_data')
      .delete()
      .eq('user_id', userId);

    if (error) {
      console.error('Error clearing user data:', error);
      throw error;
    }
  },
};
