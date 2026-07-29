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

  register: async (
    email: string,
    password: string,
    name: string,
  ): Promise<{ user: User; needsEmailConfirmation: boolean }> => {
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

    // When email confirmation is enabled in Supabase, signUp returns a user but
    // NO session. In that case the user cannot use the app until they confirm,
    // so the UI must show a "check your email" state rather than logging them in.
    return {
      user: {
        id: data.user.id,
        email: data.user.email || '',
        name: name,
      },
      needsEmailConfirmation: !data.session,
    };
  },

  logout: async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  changePassword: async (currentPassword: string, newPassword: string) => {
    const { data, error } = await supabase.auth.updateUser({
      password: newPassword,
      current_password: currentPassword,
    });
    if (error) throw error;
    return data.user;
  },

  sendPasswordRecovery: async (email: string, redirectTo: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    if (error) throw error;
  },

  completePasswordRecovery: async (newPassword: string) => {
    const { data, error } = await supabase.auth.updateUser({
      password: newPassword,
    });
    if (error) throw error;
    return data.user;
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
