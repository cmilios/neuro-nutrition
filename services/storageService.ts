import type { Milestone, UserProfile } from '../types';
import { supabase } from './supabaseClient';

const loadProfileData = async (userId: string) => {
  const { data, error } = await supabase
    .from('user_data')
    .select('profile, milestones')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('Error fetching user data:', error);
    throw error;
  }

  if (data) {
    return {
      profile: data.profile,
      milestones: data.milestones || [],
    };
  }
  return null;
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
    const data = await loadProfileData(userId);
    return data
      ? { profile: data.profile, milestones: data.milestones }
      : null;
  },
};
