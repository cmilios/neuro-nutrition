import { User } from '../types';
import { supabase } from './supabaseClient';

export const authService = {
  login: async (email: string, password: string): Promise<User> => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      throw error;
    }

    if (!data.user) {
      throw new Error("No user returned from login");
    }

    return {
      id: data.user.id,
      email: data.user.email || '',
      name: data.user.user_metadata.name || '',
    };
  },

  register: async (email: string, password: string, name: string): Promise<User> => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name,
        },
      },
    });

    if (error) {
      throw error;
    }

    if (!data.user) {
      throw new Error("Registration succeeded but no user returned");
    }

    // Note: If email confirmation is enabled, the user might not be able to login immediately
    // or the session might be null.
    // For this implementation, we assume auto-confirmation or we return the user regardless.
    return {
      id: data.user.id,
      email: data.user.email || '',
      name: name,
    };
  },

  logout: async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  // This is kept for compatibility but synchronous checks are less reliable with async auth.
  // We will primarily use the onAuthStateChange listener in App.tsx.
  getCurrentUser: (): User | null => {
    // Cannot sync get current user reliably with standard supabase client in one go without async
    // We will return null here and rely on App.tsx to fetch session on load.
    return null;
  },

  // Helper to get session async
  getSessionUser: async (): Promise<User | null> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      return {
        id: session.user.id,
        email: session.user.email || '',
        name: session.user.user_metadata.name || '',
      };
    }
    return null;
  }
};
