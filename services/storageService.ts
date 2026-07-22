import { UserData, UserProfile, MealPlan, Milestone } from '../types';
import { supabase } from './supabaseClient';

export const storageService = {
  saveUserData: async (userId: string, profile: UserProfile, mealPlan: MealPlan, milestones: Milestone[] = []) => {
    const { error } = await supabase
      .from('user_data')
      .upsert({
        user_id: userId,
        profile,
        meal_plan: mealPlan,
        milestones,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });

    if (error) {
      console.error('Error saving user data:', error);
      throw error;
    }
  },

  getUserData: async (userId: string): Promise<UserData | null> => {
    const { data, error } = await supabase
      .from('user_data')
      .select('profile, meal_plan, milestones')
      .eq('user_id', userId)
      .single();

    if (data) {
      return {
        profile: data.profile,
        mealPlan: data.meal_plan,
        milestones: data.milestones || []
      };
    }

    // Fallback/Migration: Check localStorage
    const DATA_KEY_PREFIX = 'neuronutrition_data_';
    const localData = localStorage.getItem(`${DATA_KEY_PREFIX}${userId}`);
    if (localData) {
      console.log('Found local data. Returning immediately and attempting background migration...');
      try {
        const parsed = JSON.parse(localData);

        // Background migration (fire and forget - but log)
        // We do NOT await this, so the UI unblocks immediately.
        supabase
          .from('user_data')
          .upsert({
            user_id: userId,
            profile: parsed.profile,
            meal_plan: parsed.mealPlan,
            milestones: parsed.milestones || [],
            updated_at: new Date().toISOString()
          }, { onConflict: 'user_id' })
          .then(({ error: migrationError }) => {
            if (!migrationError) {
              console.log('Background migration successful, clearing local storage.');
              localStorage.removeItem(`${DATA_KEY_PREFIX}${userId}`);
            } else {
              console.error('Background migration failed:', migrationError);
            }
          });

        return parsed;
      } catch (e) {
        console.error("Failed to parse local data for migration:", e);
      }
    }

    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching user data:', error);
    }

    return null;
  },

  clearUserData: async (userId: string) => {
    const { error } = await supabase
      .from('user_data')
      .delete()
      .eq('user_id', userId);

    if (error) {
      console.error('Error clearing user data:', error);
    }
  }
};