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
import {
  generateInitialWeeklyPlan,
  generateMealPlan,
  regenerateSingleMeal,
} from './services/aiService';
import { authService } from './services/authService';
import { storageService } from './services/storageService';
import { weeklyPlanGateway } from './services/weeklyPlanGateway';
import { weeklyPlanCache } from './services/weeklyPlanCache';
import { requireAuthoritativeWeeklyPlanRow } from './services/weeklyPlanValidation';
import { supabase } from './services/supabaseClient';

type PlanAuthorityStatus =
  | 'checking'
  | 'synchronized'
  | 'confirmed-empty'
  | 'stale'
  | 'unavailable';

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [mealPlan, setMealPlan] = useState<MealPlan | null>(null);
  const [milestones, setMilestones] = useState<Milestone[]>([]);

  // Track the currently loaded user ID to avoid stale closures in effects
  const loadedUserIdRef = React.useRef<string | null>(null);
  const initialGenerationCommandRef = React.useRef<{
    commandId: string;
    normalizedProfile: string;
  } | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [isDataLoading, setIsDataLoading] = useState(false);
  const [planAuthorityStatus, setPlanAuthorityStatus] =
    useState<PlanAuthorityStatus>('checking');
  const [rerollingState, setRerollingState] = useState<{ dayIndex: number, mealType: string } | null>(null);
  const [rerollRetry, setRerollRetry] = useState<{
    dayIndex: number;
    mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
    currentMeal: Meal;
  } | null>(null);
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

  const saveCurrentWeeklyPlan = async (userId: string, document: MealPlan) => {
    const outcome = await weeklyPlanGateway.saveCurrent({
      commandId: crypto.randomUUID(),
      userId,
      document,
    });

    if (outcome.status !== 'succeeded') {
      throw new Error(outcome.error?.message || 'The Weekly Plan command did not succeed.');
    }
    setPlanAuthorityStatus('stale');
  };

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
        setRerollRetry(null);
        initialGenerationCommandRef.current = null;
        setPlanAuthorityStatus('checking');
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
    const cachedPlan = weeklyPlanCache.get(user.id);
    loadedUserIdRef.current = user.id;
    setIsDataLoading(true);
    setPlanAuthorityStatus('checking');
    setProfile(null);
    setMealPlan(cachedPlan?.document ?? null);
    setMilestones([]);

    const useCachedPlanFallback = (loadError: unknown) => {
      console.error('Failed to load Current Weekly Plan:', loadError);
      if (cancelled) return;
      setPlanAuthorityStatus(cachedPlan ? 'stale' : 'unavailable');
      setMealPlan(cachedPlan?.document ?? null);
    };

    storageService.getProfileData(user.id)
      .then((data) => {
        if (cancelled || loadedUserIdRef.current !== user.id) return;
        setProfile(data?.profile ?? null);
        setMilestones(data?.milestones ?? []);
      })
      .catch((profileError) => {
        console.error('Failed to load profile data:', profileError);
        if (!cancelled) setError('Failed to load your data. Please refresh.');
      });

    weeklyPlanGateway.getCurrent(user.id)
      .then((currentPlan) => {
        if (cancelled || loadedUserIdRef.current !== user.id) return;
        try {
          if (!currentPlan) {
            weeklyPlanCache.clear(user.id);
            setMealPlan(null);
            setPlanAuthorityStatus('confirmed-empty');
            return;
          }

          const validated = requireAuthoritativeWeeklyPlanRow(currentPlan, user.id);
          weeklyPlanCache.set(user.id, validated);
          setMealPlan(validated.document);
          setPlanAuthorityStatus('synchronized');
        } catch (loadError) {
          useCachedPlanFallback(loadError);
        }
      })
      .catch(useCachedPlanFallback)
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
      setRerollRetry(null);
      initialGenerationCommandRef.current = null;
      setPlanAuthorityStatus('checking');
    } catch (logoutError) {
      console.error('Failed to log out:', logoutError);
      setError('Could not log out. Please try again.');
    }
  };

  const handleProfileSubmit = async (data: UserProfile) => {
    if (!user || planAuthorityStatus !== 'confirmed-empty') return;

    // Keep the submitted values as a draft so a failed generation can be
    // retried without forcing the user to re-enter the entire profile.
    setProfile(data);
    setIsLoading(true);
    setError(null);

    try {
      const normalizedProfile = JSON.stringify(data);
      const pendingCommand = initialGenerationCommandRef.current;
      const commandId = pendingCommand?.normalizedProfile === normalizedProfile
        ? pendingCommand.commandId
        : crypto.randomUUID();
      initialGenerationCommandRef.current = { commandId, normalizedProfile };

      const outcome = await generateInitialWeeklyPlan(data, commandId);
      if (outcome.status === 'in_progress') {
        throw new Error('Your Current Weekly Plan is still being generated. Please try again shortly.');
      }
      if (outcome.status === 'failed') {
        initialGenerationCommandRef.current = null;
        throw new Error(outcome.error?.message || 'A valid Current Weekly Plan was not created.');
      }
      if (!outcome.result) {
        throw new Error('The generation command did not return a Current Weekly Plan.');
      }

      const authoritative = requireAuthoritativeWeeklyPlanRow(outcome.result, user.id);
      initialGenerationCommandRef.current = null;
      weeklyPlanCache.set(user.id, authoritative);
      setMealPlan(authoritative.document);
      setPlanAuthorityStatus('synchronized');
      try {
        await storageService.saveProfileData(user.id, data, milestones);
      } catch (profileSaveError) {
        console.error('Current Weekly Plan generated but profile save failed:', profileSaveError);
        setError('Your Current Weekly Plan is ready, but your profile changes could not be saved.');
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
      await storageService.saveProfileData(user.id, updatedProfile, milestones);
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
      await storageService.saveProfileData(user.id, updatedProfile, updatedMilestones);
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
      await storageService.saveProfileData(user.id, profile, updatedMilestones);
      setMilestones(updatedMilestones);
    } catch (saveError) {
      console.error('Failed to delete milestone:', saveError);
      setError('Could not delete that milestone. Please try again.');
    }
  }

  const handleRerollMeal = async (dayIndex: number, mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack') => {
    if (!user || !profile || !mealPlan || planAuthorityStatus !== 'synchronized') return;

    const retryRequest = rerollRetry?.dayIndex === dayIndex && rerollRetry.mealType === mealType
      ? rerollRetry
      : null;
    const currentMeal = retryRequest?.currentMeal ?? mealPlan.days[dayIndex][mealType];
    setRerollingState({ dayIndex, mealType });
    setError(null);

    try {
      const newMeal = await regenerateSingleMeal(profile, mealType, currentMeal);

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

      await saveCurrentWeeklyPlan(user.id, updatedPlan);
      setMealPlan(updatedPlan);
      setRerollRetry(null);

    } catch (err) {
      console.error(err);
      setRerollRetry({ dayIndex, mealType, currentMeal });
      setError(errorMessage(err, 'Failed to regenerate the meal. Please try again.'));
    } finally {
      setRerollingState(null);
    }
  };

  const handleToggleIngredient = async (dayIndex: number, mealType: string, ingredient: string) => {
    if (!user || !profile || !mealPlan || planAuthorityStatus !== 'synchronized') return;

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
      await saveCurrentWeeklyPlan(user.id, updatedPlan);
    } catch (saveError) {
      console.error('Failed to save ingredient state:', saveError);
      setMealPlan(mealPlan);
      setError('Could not save that ingredient change. Please try again.');
    }
  };

  const handleReset = async () => {
    if (!user) return;
    try {
      const outcome = await weeklyPlanGateway.startOver({
        commandId: crypto.randomUUID(),
        userId: user.id,
      });
      if (outcome.status !== 'succeeded') {
        throw new Error(outcome.error?.message || 'Start Over did not succeed.');
      }
      setError(null);
      setNextWeekRetry(null);
      setRerollRetry(null);
      setPlanAuthorityStatus('stale');
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
      await saveCurrentWeeklyPlan(user.id, generatedPlan);
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
      if (planAuthorityStatus !== 'synchronized') return;
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

  if (isAuthChecking) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-400">Loading...</div>;
  }

  if (!user) {
    return <AuthScreen onSuccess={handleAuthSuccess} />;
  }

  if (isDataLoading && planAuthorityStatus === 'checking' && !mealPlan) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500">
        Checking your Current Weekly Plan…
      </div>
    );
  }

  const planIsReadOnly = planAuthorityStatus !== 'synchronized';

  return (
    <Layout
      user={user}
      userProfile={profile}
      onOpenProfile={() => setIsProfileModalOpen(true)}
      onNextWeek={handleNextWeekRequest}
      onLogout={handleLogout}
      hasProfile={!!mealPlan}
      canRetryNextWeek={!!nextWeekRetry}
      planMutationsDisabled={planIsReadOnly}
      currentView={currentView}
      onViewChange={setCurrentView}
    >
      <div className="animate-fade-in">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-slate-800">Welcome back, {user.name}</h2>
        </div>

        {planAuthorityStatus === 'synchronized' && (
          <span className="sr-only">Current Weekly Plan synchronized</span>
        )}

        {planAuthorityStatus === 'checking' && mealPlan && (
          <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-900">
            <p className="font-bold">Checking for Current Weekly Plan updates…</p>
            <p className="text-sm">The cached plan is read-only until the check succeeds.</p>
          </div>
        )}

        {planAuthorityStatus === 'stale' && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
            <p className="font-bold">This plan may be out of date.</p>
            <p className="text-sm">It is read-only until authority can be checked again.</p>
            <button onClick={() => window.location.reload()} className="mt-2 text-sm font-bold underline">
              Reload
            </button>
          </div>
        )}

        {planAuthorityStatus === 'unavailable' && (
          <div className="mx-auto max-w-xl rounded-2xl border border-red-200 bg-red-50 p-8 text-center text-red-900">
            <h1 className="text-2xl font-bold">Your Current Weekly Plan is unavailable.</h1>
            <p className="mt-2 text-sm">We could not confirm the authoritative plan, so generation remains disabled.</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-5 rounded-lg bg-red-700 px-4 py-2 font-bold text-white"
            >
              Reload
            </button>
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-sm font-bold underline">Dismiss</button>
          </div>
        )}

        {!mealPlan && !isLoading && planAuthorityStatus === 'confirmed-empty' && (
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
                rerollRetry={rerollRetry}
                onToggleIngredient={handleToggleIngredient}
                isReadOnly={planIsReadOnly}
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
