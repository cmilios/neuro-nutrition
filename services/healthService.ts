import { UserProfile, Gender, ActivityLevel } from '../types';

export const healthService = {
  syncAppleHealth: async (): Promise<Partial<UserProfile>> => {
    // Simulate native bridge/API latency
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // In a real implementation, this would call a native bridge or API
    // returning the user's health data. Here we mock it for the demo.
    return {
      age: 27,
      heightCm: 178,
      weightKg: 74.5,
      gender: Gender.Male,
      activityLevel: ActivityLevel.VeryActive
    };
  }
};