import React, { useState, useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';
import Layout from './components/Layout';
import ProfileForm from './components/ProfileForm';
import PlanDashboard from './components/PlanDashboard';
import PerformanceDashboard from './components/PerformanceDashboard';
import LoadingView from './components/LoadingView';
import AuthScreen from './components/AuthScreen';
import WeeklyReviewModal from './components/WeeklyReviewModal';
import UserProfileModal from './components/UserProfileModal';
import { UserProfile, MealPlan, User, DayPlan, Meal, MealFeedback, Milestone } from './types';
import { generateMealPlan, regenerateSingleMeal } from './services/aiService';
import { authService } from './services/authService';
import { storageService } from './services/storageService';
import { supabase } from './services/supabaseClient';

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [mealPlan, setMealPlan] = useState<MealPlan | null>(null);
  const [milestones, setMilestones] = useState<Milestone[]>([]);

  // Track the currently loaded user ID to avoid stale closures in effects
  const loadedUserIdRef = React.useRef<string | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [isDataLoading, setIsDataLoading] = useState(false);
  const [rerollingState, setRerollingState] = useState<{ dayIndex: number, mealType: string } | null>(null);
  const [nextWeekRetry, setNextWeekRetry] = useState<{
    feedback: MealFeedback[];
    currentPlan: MealPlan;
    reviewType: 'empty' | 'partial';
  } | null>(null);

  // Navigation State
  const [currentView, setCurrentView] = useState<'plan' | 'performance'>('plan');

  // Modals
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  const userFromSession = (session: Session | null): User | null => {
    if (!session?.user) return null;

    return {
      id: session.user.id,
      email: session.user.email || '',
      name: session.user.user_metadata?.name || '',
    };
  };

  const errorMessage = (err: unknown, fallback: string) =>
    err instanceof Error && err.message ? err.message : fallback;

  // Keep auth callbacks synchronous. Calling another Supabase API from an async
  // onAuthStateChange callback can deadlock supabase-js.
  useEffect(() => {
    let mounted = true;

    const applySession = (session: Session | null) => {
      if (!mounted) return;
      const nextUser = userFromSession(session);
      setUser(nextUser);

      if (!nextUser) {
        loadedUserIdRef.current = null;
        setProfile(null);
        setMealPlan(null);
        setMilestones([]);
        setNextWeekRetry(null);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      applySession(session);
      setIsAuthChecking(false);
    });

    supabase.auth.getSession()
      .then(({ data, error: sessionError }) => {
        if (sessionError) throw sessionError;
        applySession(data.session);
      })
      .catch((sessionError) => {
        console.error('Failed to restore session:', sessionError);
        if (mounted) setError('Could not restore your session. Please log in again.');
      })
      .finally(() => {
        if (mounted) setIsAuthChecking(false);
      });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Data loading is deliberately separate from the auth callback to avoid the
  // supabase-js auth callback deadlock and stale data leaking between users.
  useEffect(() => {
    if (!user || loadedUserIdRef.current === user.id) return;

    let cancelled = false;
    loadedUserIdRef.current = user.id;
    setIsDataLoading(true);
    setProfile(null);
    setMealPlan(null);
    setMilestones([]);

    storageService.getUserData(user.id)
      .then((data) => {
        if (cancelled || loadedUserIdRef.current !== user.id) return;
        setProfile(data?.profile ?? null);
        setMealPlan(data?.mealPlan ?? null);
        setMilestones(data?.milestones ?? []);
      })
      .catch((loadError) => {
        console.error('Failed to load user data:', loadError);
        if (!cancelled) {
          loadedUserIdRef.current = null;
          setError('Failed to load your data. Please refresh.');
        }
      })
      .finally(() => {
        if (!cancelled) setIsDataLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const handleAuthSuccess = (authenticatedUser: User) => {
    setUser(authenticatedUser);
  };

  const handleLogout = async () => {
    try {
      await authService.logout();
      loadedUserIdRef.current = null;
      setUser(null);
      setProfile(null);
      setMealPlan(null);
      setMilestones([]);
      setNextWeekRetry(null);
    } catch (logoutError) {
      console.error('Failed to log out:', logoutError);
      setError('Could not log out. Please try again.');
    }
  };

  const handleProfileSubmit = async (data: UserProfile) => {
    if (!user) return;

    // Keep the submitted values as a draft so a failed generation can be
    // retried without forcing the user to re-enter the entire profile.
    setProfile(data);
    setIsLoading(true);
    setError(null);

    try {
      const generatedPlan = await generateMealPlan(data);
      setMealPlan(generatedPlan);
      try {
        await storageService.saveUserData(user.id, data, generatedPlan, milestones);
      } catch (saveError) {
        console.error('Plan generated but failed to save:', saveError);
        setError('Your plan was generated, but it could not be synced. Please try again before leaving this page.');
      }
    } catch (err) {
      console.error('Failed to generate meal plan:', err);
      setError(errorMessage(err, 'We encountered an issue generating your plan. Please try again.'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateProfile = async (updatedProfile: UserProfile) => {
    if (!user || !mealPlan) return;
    try {
      await storageService.saveUserData(user.id, updatedProfile, mealPlan, milestones);
      setProfile(updatedProfile);
    } catch (saveError) {
      console.error('Failed to update profile:', saveError);
      setError('Could not save your profile changes. Please try again.');
    }
  };

  const handleAddMilestone = async (weight: number, note: string, bodyFat?: number) => {
    if (!user || !profile || !mealPlan) return;

    const newMilestone: Milestone = {
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      weight,
      note,
      bodyFatPercentage: bodyFat
    };

    const updatedMilestones = [...milestones, newMilestone];
    const updatedProfile = { ...profile, weightKg: weight };
    try {
      await storageService.saveUserData(user.id, updatedProfile, mealPlan, updatedMilestones);
      setMilestones(updatedMilestones);
      setProfile(updatedProfile);
    } catch (saveError) {
      console.error('Failed to add milestone:', saveError);
      setError('Could not save that milestone. Please try again.');
    }
  };

  const handleDeleteMilestone = async (id: string) => {
    if (!user || !profile || !mealPlan) return;
    const updatedMilestones = milestones.filter(m => m.id !== id);
    try {
      await storageService.saveUserData(user.id, profile, mealPlan, updatedMilestones);
      setMilestones(updatedMilestones);
    } catch (saveError) {
      console.error('Failed to delete milestone:', saveError);
      setError('Could not delete that milestone. Please try again.');
    }
  }

  const handleRerollMeal = async (dayIndex: number, mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack') => {
    if (!user || !profile || !mealPlan) return;

    setRerollingState({ dayIndex, mealType });

    try {
      const newMeal = await regenerateSingleMeal(profile, mealType);

      const updatedDays = [...mealPlan.days];
      const targetDay = { ...updatedDays[dayIndex] };

      // Update specific meal
      targetDay[mealType] = newMeal;

      // Recalculate daily summary
      const meals = [targetDay.breakfast, targetDay.lunch, targetDay.dinner, targetDay.snack];

      targetDay.dailySummary = meals.reduce((acc, meal) => ({
        calories: acc.calories + meal.macros.calories,
        protein: acc.protein + meal.macros.protein,
        carbs: acc.carbs + meal.macros.carbs,
        fats: acc.fats + meal.macros.fats
      }), { calories: 0, protein: 0, carbs: 0, fats: 0 });

      updatedDays[dayIndex] = targetDay;
      const updatedPlan = { ...mealPlan, days: updatedDays };

      setMealPlan(updatedPlan);
      await storageService.saveUserData(user.id, profile, updatedPlan, milestones);

    } catch (err) {
      console.error(err);
      setError(errorMessage(err, 'Failed to regenerate the meal. Please try again.'));
    } finally {
      setRerollingState(null);
    }
  };

  const handleToggleIngredient = async (dayIndex: number, mealType: string, ingredient: string) => {
    if (!user || !profile || !mealPlan) return;

    const updatedDays = [...mealPlan.days];
    const targetDay = { ...updatedDays[dayIndex] };

    const meal = targetDay[mealType as keyof DayPlan] as Meal;

    if (meal && typeof meal === 'object') {
      const currentChecked = meal.checkedIngredients || [];
      const checkedIngredients = currentChecked.includes(ingredient)
        ? currentChecked.filter(i => i !== ingredient)
        : [...currentChecked, ingredient];

      // Clone the meal instead of mutating the existing React state object.
      targetDay[mealType as 'breakfast' | 'lunch' | 'dinner' | 'snack'] = {
        ...meal,
        checkedIngredients,
      };
    }

    updatedDays[dayIndex] = targetDay;

    const updatedPlan = { ...mealPlan, days: updatedDays };
    setMealPlan(updatedPlan);
    try {
      await storageService.saveUserData(user.id, profile, updatedPlan, milestones);
    } catch (saveError) {
      console.error('Failed to save ingredient state:', saveError);
      setMealPlan(mealPlan);
      setError('Could not save that ingredient change. Please try again.');
    }
  };

  const handleReset = async () => {
    if (!user) return;
    try {
      await storageService.clearUserData(user.id);
      setProfile(null);
      setMealPlan(null);
      setMilestones([]);
      setError(null);
      setNextWeekRetry(null);
    } catch (clearError) {
      console.error('Failed to reset user data:', clearError);
      setError('Could not reset your data. Please try again.');
    }
  };

  // Triggered by the "Next Week" button in Layout
  const runNextWeekGeneration = async (request: {
    feedback: MealFeedback[];
    currentPlan: MealPlan;
    reviewType: 'empty' | 'partial';
  }) => {
    if (!user || !profile) return;

    setIsReviewModalOpen(false);
    setIsLoading(true);
    setError(null);

    try {
      const generatedPlan = await generateMealPlan(
        profile,
        request.feedback,
        request.currentPlan,
        request.reviewType,
      );
      await storageService.saveUserData(user.id, profile, generatedPlan, milestones);
      setMealPlan(generatedPlan);
      setNextWeekRetry(null);
    } catch (err) {
      console.error('Failed to generate optimized plan:', err);
      setNextWeekRetry(request);
      setError(errorMessage(
        err,
        'A valid Next Weekly Plan was not created. Your current plan is unchanged.',
      ));
    } finally {
      setIsLoading(false);
    }
  };

  const handleNextWeekRequest = () => {
    if (nextWeekRetry) {
      void runNextWeekGeneration(nextWeekRetry);
      return;
    }
    if (mealPlan) {
      setIsReviewModalOpen(true);
    } else {
      handleReset();
    }
  };

  // Called when the Review Modal is submitted
  const handleReviewSubmit = (feedback: MealFeedback[]) => {
    if (!mealPlan) return;
    void runNextWeekGeneration({
      feedback,
      currentPlan: mealPlan,
      reviewType: feedback.length === 0 ? 'empty' : 'partial',
    });
  };

  if (isAuthChecking || isDataLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-400">Loading...</div>;
  }

  if (!user) {
    return <AuthScreen onSuccess={handleAuthSuccess} />;
  }

  return (
    <Layout
      user={user}
      userProfile={profile}
      onOpenProfile={() => setIsProfileModalOpen(true)}
      onNextWeek={handleNextWeekRequest}
      onLogout={handleLogout}
      hasProfile={!!mealPlan}
      canRetryNextWeek={!!nextWeekRetry}
      currentView={currentView}
      onViewChange={setCurrentView}
    >
      <div className="animate-fade-in">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-slate-800">Welcome back, {user.name}</h2>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-sm font-bold underline">Dismiss</button>
          </div>
        )}

        {!mealPlan && !isLoading && (
          <ProfileForm initialData={profile} onSubmit={handleProfileSubmit} isLoading={isLoading} />
        )}

        {isLoading && (
          <LoadingView />
        )}

        {!isLoading && profile && (
          <>
            {currentView === 'plan' && mealPlan ? (
              <PlanDashboard
                plan={mealPlan}
                onReroll={handleRerollMeal}
                rerollingState={rerollingState}
                onToggleIngredient={handleToggleIngredient}
              />
            ) : currentView === 'performance' ? (
              <PerformanceDashboard
                milestones={milestones}
                userProfile={profile}
              />
            ) : null}
          </>
        )}

        {mealPlan && (
          <WeeklyReviewModal
            currentPlan={mealPlan}
            isOpen={isReviewModalOpen}
            onClose={() => setIsReviewModalOpen(false)}
            onSubmit={handleReviewSubmit}
          />
        )}

        {profile && mealPlan && (
          <UserProfileModal
            isOpen={isProfileModalOpen}
            onClose={() => setIsProfileModalOpen(false)}
            profile={profile}
            milestones={milestones}
            onUpdateProfile={handleUpdateProfile}
            onAddMilestone={handleAddMilestone}
            onDeleteMilestone={handleDeleteMilestone}
          />
        )}
      </div>
    </Layout>
  );
};

export default App;
