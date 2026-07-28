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
import {
  AuthoritativeWeeklyPlanRow,
  UserProfile,
  MealPlan,
  User,
  MealRerollReservation,
  MealFeedback,
  Milestone,
  MealType,
  NextWeeklyPlanCommand,
  Gender,
  ActivityLevel,
  Goal,
  DietType,
} from './types';
import {
  generateInitialWeeklyPlan,
  generateNextWeeklyPlan,
  rerollMeal,
} from './services/aiService';
import { authService } from './services/authService';
import { storageService } from './services/storageService';
import {
  createWeeklyPlanInvalidationSubscription,
  weeklyPlanGateway,
} from './services/weeklyPlanGateway';
import { weeklyPlanCache } from './services/weeklyPlanCache';
import { requireAuthoritativeWeeklyPlanRow } from './services/weeklyPlanValidation';
import { supabase } from './services/supabaseClient';

type PlanAuthorityStatus =
  | 'checking'
  | 'synchronized'
  | 'confirmed-empty'
  | 'stale'
  | 'unavailable';

const prototypeProfile: UserProfile = {
  age: 34,
  gender: Gender.Female,
  heightCm: 168,
  weightKg: 67,
  targetWeightKg: 64,
  activityLevel: ActivityLevel.ModeratelyActive,
  goal: Goal.MaintainWeight,
  dietType: DietType.Mediterranean,
  allergies: 'None',
};

const AccountPrototypePreview: React.FC = () => {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <Layout
      user={{ id: 'prototype-user', name: 'Alex Morgan', email: 'alex@example.com' }}
      userProfile={prototypeProfile}
      onOpenProfile={() => setIsOpen(true)}
      onNextWeek={() => undefined}
      onStartOver={() => undefined}
      onLogout={() => undefined}
      hasProfile
      currentView="plan"
      onViewChange={() => undefined}
    >
      <div className="animate-fade-in">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-emerald-700">Current Weekly Plan</p>
            <h2 className="mt-1 text-2xl font-bold text-slate-900">Welcome back, Alex</h2>
          </div>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800">
            Synchronized
          </span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-hidden="true">
          {['Monday', 'Tuesday', 'Wednesday', 'Thursday'].map((day, index) => (
            <div key={day} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <span className="font-bold text-slate-800">{day}</span>
                <span className="text-xs text-slate-400">Day {index + 1}</span>
              </div>
              <div className="space-y-3">
                {[88, 72, 94].map((width, mealIndex) => (
                  <div key={mealIndex} className="rounded-xl bg-slate-50 p-3">
                    <div className="h-2 rounded-full bg-slate-200" style={{ width: `${width}%` }} />
                    <div className="mt-2 h-2 w-1/2 rounded-full bg-emerald-100" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <UserProfileModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        profile={prototypeProfile}
        email="alex@example.com"
      />
    </Layout>
  );
};

const App: React.FC = () => {
  if (
    import.meta.env.DEV
    && new URLSearchParams(window.location.search).get('accountPrototype') === '1'
  ) {
    return <AccountPrototypePreview />;
  }

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [mealPlan, setMealPlan] = useState<MealPlan | null>(null);
  const [authoritativePlan, setAuthoritativePlan] =
    useState<AuthoritativeWeeklyPlanRow | null>(null);
  const [milestones, setMilestones] = useState<Milestone[]>([]);

  // Track the currently loaded user ID to avoid stale closures in effects
  const loadedUserIdRef = React.useRef<string | null>(null);
  const initialGenerationCommandRef = React.useRef<{
    commandId: string;
    normalizedProfile: string;
  } | null>(null);
  const authoritativePlanRef = React.useRef<AuthoritativeWeeklyPlanRow | null>(null);
  const requestPlanRefetchRef = React.useRef<(() => void) | null>(null);
  const reconcilingNextGenerationIdRef = React.useRef<string | null>(null);

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
    commandId: string | null;
  } | null>(null);
  const [pendingMealRerolls, setPendingMealRerolls] =
    useState<MealRerollReservation[]>([]);
  const [nextWeekRetry, setNextWeekRetry] = useState<
    Omit<NextWeeklyPlanCommand, 'commandId'> & {
    commandId: string | null;
  } | null>(null);
  const [pendingNextGenerationId, setPendingNextGenerationId] =
    useState<string | null>(null);
  const [pendingIngredientIds, setPendingIngredientIds] = useState<string[]>([]);

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

  const applyAuthoritativePlan = (
    row: AuthoritativeWeeklyPlanRow,
    userId: string,
  ) => {
    const validated = requireAuthoritativeWeeklyPlanRow(row, userId);
    const previouslyAuthoritative = authoritativePlanRef.current;
    authoritativePlanRef.current = validated;
    setAuthoritativePlan(validated);
    weeklyPlanCache.set(userId, validated);
    setMealPlan(validated.document);
    setPlanAuthorityStatus('synchronized');
    setPendingNextGenerationId((pendingCommandId) => {
      if (!pendingCommandId) {
        return null;
      }
      if (validated.generationId === pendingCommandId) {
        reconcilingNextGenerationIdRef.current = null;
        setNextWeekRetry(null);
        return null;
      }
      if (
        validated.nextGenerationId === pendingCommandId
        || (
          reconcilingNextGenerationIdRef.current !== pendingCommandId
          || previouslyAuthoritative?.nextGenerationId !== pendingCommandId
        )
      ) {
        return pendingCommandId;
      }

      reconcilingNextGenerationIdRef.current = null;
      setNextWeekRetry((retry) =>
        retry ? { ...retry, commandId: null } : retry
      );
      return null;
    });
    return validated;
  };

  const clearAuthoritativePlan = (userId: string) => {
    authoritativePlanRef.current = null;
    setAuthoritativePlan(null);
    weeklyPlanCache.clear(userId);
    setMealPlan(null);
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
        authoritativePlanRef.current = null;
        setAuthoritativePlan(null);
        setProfile(null);
        setMealPlan(null);
        setMilestones([]);
        setNextWeekRetry(null);
        setPendingNextGenerationId(null);
        setRerollRetry(null);
        setPendingMealRerolls([]);
        setPendingIngredientIds([]);
        initialGenerationCommandRef.current = null;
        reconcilingNextGenerationIdRef.current = null;
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
    authoritativePlanRef.current = cachedPlan;
    setAuthoritativePlan(cachedPlan);
    setMealPlan(cachedPlan?.document ?? null);
    setMilestones([]);

    const useCachedPlanFallback = (loadError: unknown) => {
      console.error('Failed to load Current Weekly Plan:', loadError);
      if (cancelled) return;
      setPlanAuthorityStatus(cachedPlan ? 'stale' : 'unavailable');
      authoritativePlanRef.current = cachedPlan;
      setAuthoritativePlan(cachedPlan);
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

    Promise.all([
      weeklyPlanGateway.getCurrent(user.id),
      weeklyPlanGateway.getPendingMealRerolls(user.id),
    ])
      .then(([currentPlan, reservations]) => {
        if (cancelled || loadedUserIdRef.current !== user.id) return;
        try {
          setPendingMealRerolls(reservations);
          if (!currentPlan) {
            clearAuthoritativePlan(user.id);
            setPlanAuthorityStatus('confirmed-empty');
            return;
          }

          applyAuthoritativePlan(currentPlan, user.id);
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

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    let refetchTimer: ReturnType<typeof setTimeout> | null = null;
    let refetchInFlight = false;
    let refetchQueued = false;

    const refetchCurrentPlan = async () => {
      if (refetchInFlight) {
        refetchQueued = true;
        return;
      }

      refetchInFlight = true;
      try {
        const [currentPlan, reservations] = await Promise.all([
          weeklyPlanGateway.getCurrent(user.id),
          weeklyPlanGateway.getPendingMealRerolls(user.id),
        ]);
        if (cancelled) return;
        setPendingMealRerolls(reservations);
        setRerollRetry((current) =>
          current?.commandId
          && !reservations.some((reservation) =>
            reservation.commandId === current.commandId
          )
            ? null
            : current
        );
        if (!currentPlan) {
          clearAuthoritativePlan(user.id);
          setPlanAuthorityStatus('confirmed-empty');
          return;
        }
        applyAuthoritativePlan(currentPlan, user.id);
      } catch (refetchError) {
        console.error('Failed to refetch Current Weekly Plan:', refetchError);
        if (!cancelled) {
          setPlanAuthorityStatus(
            authoritativePlanRef.current ? 'stale' : 'unavailable',
          );
        }
      } finally {
        refetchInFlight = false;
        if (!cancelled && refetchQueued) {
          refetchQueued = false;
          void refetchCurrentPlan();
        }
      }
    };

    const scheduleRefetch = () => {
      if (cancelled) return;
      setPlanAuthorityStatus(
        authoritativePlanRef.current ? 'stale' : 'checking',
      );
      if (refetchTimer || refetchInFlight) {
        refetchQueued = refetchInFlight;
        return;
      }
      refetchTimer = setTimeout(() => {
        refetchTimer = null;
        void refetchCurrentPlan();
      }, 20);
    };

    requestPlanRefetchRef.current = scheduleRefetch;
    const subscription = createWeeklyPlanInvalidationSubscription(
      supabase,
      user.id,
      scheduleRefetch,
      (status) => {
        if (status === 'connected') {
          scheduleRefetch();
          return;
        }
        setPlanAuthorityStatus(
          authoritativePlanRef.current ? 'stale' : 'unavailable',
        );
      },
    );

    return () => {
      cancelled = true;
      requestPlanRefetchRef.current = null;
      if (refetchTimer) clearTimeout(refetchTimer);
      subscription.unsubscribe();
    };
  }, [user?.id]);

  const handleAuthSuccess = (authenticatedUser: User) => {
    setUser(authenticatedUser);
  };

  const handleLogout = async () => {
    try {
      await authService.logout();
      loadedUserIdRef.current = null;
      authoritativePlanRef.current = null;
      setAuthoritativePlan(null);
      setUser(null);
      setProfile(null);
      setMealPlan(null);
      setMilestones([]);
      setNextWeekRetry(null);
      setPendingNextGenerationId(null);
      setRerollRetry(null);
      setPendingMealRerolls([]);
      setPendingIngredientIds([]);
      initialGenerationCommandRef.current = null;
      reconcilingNextGenerationIdRef.current = null;
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

      initialGenerationCommandRef.current = null;
      applyAuthoritativePlan(outcome.result, user.id);
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
    if (!user || !profile || !mealPlan || !authoritativePlan || planAuthorityStatus !== 'synchronized') return;

    const retryRequest = rerollRetry?.dayIndex === dayIndex && rerollRetry.mealType === mealType
      ? rerollRetry
      : null;
    const day = mealPlan.days[dayIndex];
    if (!day) return;
    const commandId = retryRequest?.commandId ?? crypto.randomUUID();
    const command = {
      commandId,
      displayedPlanId: authoritativePlan.planId,
      displayedRevision: authoritativePlan.revision,
      day: day.day,
      mealType,
    };
    let commandOutcomeReceived = false;
    setRerollingState({ dayIndex, mealType });
    setError(null);

    try {
      const outcome = await rerollMeal(profile, command);
      commandOutcomeReceived = true;
      if (outcome.status === 'in_progress') {
        setRerollRetry({ dayIndex, mealType, commandId });
        requestPlanRefetchRef.current?.();
        return;
      }
      if (outcome.status !== 'succeeded' || !outcome.result) {
        setRerollRetry({ dayIndex, mealType, commandId: null });
        throw new Error(outcome.error?.message || 'The Meal Reroll did not succeed.');
      }
      applyAuthoritativePlan(outcome.result, user.id);
      setRerollRetry(null);
    } catch (err) {
      console.error(err);
      if (!commandOutcomeReceived) {
        setPendingMealRerolls((current) => current.some((reservation) =>
          reservation.commandId === commandId
        ) ? current : [...current, {
          commandId,
          planId: authoritativePlan.planId,
          day: day.day,
          mealType,
          reservedAt: new Date().toISOString(),
        }]);
        void rerollMeal(profile, command)
          .then((outcome) => {
            if (outcome.status === 'succeeded' && outcome.result) {
              applyAuthoritativePlan(outcome.result, user.id);
              setPendingMealRerolls((current) =>
                current.filter((reservation) => reservation.commandId !== commandId)
              );
              setRerollRetry(null);
              setError(null);
              return;
            }
            if (outcome.status === 'failed') {
              setPendingMealRerolls((current) =>
                current.filter((reservation) => reservation.commandId !== commandId)
              );
              setRerollRetry({ dayIndex, mealType, commandId: null });
              setError(outcome.error?.message || 'Meal Reroll failed.');
              return;
            }
            requestPlanRefetchRef.current?.();
          })
          .catch(() => {
            requestPlanRefetchRef.current?.();
          });
      }
      setRerollRetry((current) =>
        current?.dayIndex === dayIndex && current.mealType === mealType
          ? current
          : { dayIndex, mealType, commandId }
      );
      setError(errorMessage(err, 'Meal Reroll failed. Please try again.'));
    } finally {
      setRerollingState(null);
    }
  };

  const handleToggleIngredient = async (
    dayIndex: number,
    mealType: MealType,
    ingredientId: string,
    checked: boolean,
  ) => {
    if (!user
      || !profile
      || !mealPlan
      || !authoritativePlan
      || planAuthorityStatus !== 'synchronized'
      || pendingIngredientIds.includes(ingredientId)
    ) {
      return;
    }

    const day = mealPlan.days[dayIndex];
    if (!day || !day[mealType].ingredientIds.includes(ingredientId)) return;

    setPendingIngredientIds((current) => [...current, ingredientId]);
    setError(null);
    try {
      const outcome = await weeklyPlanGateway.setIngredientChecked({
        commandId: crypto.randomUUID(),
        userId: user.id,
        planId: authoritativePlan.planId,
        displayedRevision: authoritativePlan.revision,
        day: day.day,
        mealType,
        ingredientId,
        checked,
      });
      if (outcome.status !== 'succeeded' || !outcome.result) {
        if (['stale_plan', 'no_current_plan', 'ingredient_not_found']
          .includes(outcome.error?.code ?? '')) {
          setPlanAuthorityStatus('stale');
          requestPlanRefetchRef.current?.();
        }
        throw new Error(
          outcome.error?.message || 'The ingredient progress command did not succeed.',
        );
      }

      const latestConfirmed = authoritativePlanRef.current;
      if (latestConfirmed
        && (
          outcome.result.planId !== latestConfirmed.planId
          || outcome.result.revision < latestConfirmed.revision
        )
      ) {
        requestPlanRefetchRef.current?.();
      } else {
        applyAuthoritativePlan(outcome.result, user.id);
      }
    } catch (saveError) {
      console.error('Failed to save ingredient state:', saveError);
      setError('Could not save that ingredient change. Please try again.');
    } finally {
      setPendingIngredientIds((current) =>
        current.filter((identity) => identity !== ingredientId)
      );
    }
  };

  const handleStartOver = async () => {
    if (!user || !authoritativePlan || planAuthorityStatus !== 'synchronized') return;
    const displayedPlan = authoritativePlan;
    setPlanAuthorityStatus('stale');
    try {
      const outcome = await weeklyPlanGateway.startOver({
        commandId: crypto.randomUUID(),
        userId: user.id,
        displayedPlanId: displayedPlan.planId,
        displayedRevision: displayedPlan.revision,
      });
      if (outcome.status !== 'succeeded') {
        throw new Error(outcome.error?.message || 'Start Over did not succeed.');
      }
      setError(null);
      setNextWeekRetry(null);
      setRerollRetry(null);
      setPendingMealRerolls([]);
      clearAuthoritativePlan(user.id);
      setPlanAuthorityStatus('confirmed-empty');
      setIsProfileModalOpen(false);
    } catch (clearError) {
      console.error('Failed to Start Over:', clearError);
      setError('Could not start over. Please try again.');
    }
  };

  // Triggered by the "Next Week" button in Layout
  const runNextWeekGeneration = async (
    request: Omit<NextWeeklyPlanCommand, 'commandId'> & {
    commandId: string | null;
  }) => {
    if (!user || !profile) return;

    setIsReviewModalOpen(false);
    setError(null);
    const commandId = request.commandId ?? crypto.randomUUID();
    let commandOutcomeReceived = false;
    setPendingNextGenerationId(commandId);

    try {
      const outcome = await generateNextWeeklyPlan(profile, {
        ...request,
        commandId,
      });
      commandOutcomeReceived = true;
      if (outcome.status === 'in_progress') {
        reconcilingNextGenerationIdRef.current = commandId;
        setNextWeekRetry({ ...request, commandId });
        requestPlanRefetchRef.current?.();
        return;
      }
      if (outcome.status !== 'succeeded' || !outcome.result) {
        setPendingNextGenerationId(null);
        setNextWeekRetry({ ...request, commandId: null });
        throw new Error(
          outcome.error?.message ||
          'A valid Next Weekly Plan was not created. Your current plan is unchanged.',
        );
      }
      applyAuthoritativePlan(outcome.result, user.id);
      reconcilingNextGenerationIdRef.current = null;
      setPendingNextGenerationId(null);
      setNextWeekRetry(null);
    } catch (err) {
      console.error('Failed to generate optimized plan:', err);
      reconcilingNextGenerationIdRef.current =
        commandOutcomeReceived ? null : commandId;
      setNextWeekRetry((current) =>
        current?.commandId === null
          ? current
          : { ...request, commandId }
      );
      requestPlanRefetchRef.current?.();
      setError(errorMessage(
        err,
        'A valid Next Weekly Plan was not created. Your current plan is unchanged.',
      ));
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
    }
  };

  // Called when the Review Modal is submitted
  const handleReviewSubmit = (feedback: MealFeedback[]) => {
    if (!mealPlan || !authoritativePlan) return;
    void runNextWeekGeneration({
      feedback,
      currentPlan: mealPlan,
      reviewType: feedback.length === 0 ? 'empty' : 'partial',
      displayedPlanId: authoritativePlan.planId,
      displayedRevision: authoritativePlan.revision,
      commandId: null,
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

  const nextGenerationLocked =
    !!pendingNextGenerationId || !!authoritativePlan?.nextGenerationId;
  const planIsReadOnly =
    planAuthorityStatus !== 'synchronized' || nextGenerationLocked;
  const planLifecycleBlocked =
    planIsReadOnly || !!rerollingState || pendingMealRerolls.length > 0;

  return (
    <Layout
      user={user}
      userProfile={profile}
      onOpenProfile={() => setIsProfileModalOpen(true)}
      onNextWeek={handleNextWeekRequest}
      onStartOver={() => void handleStartOver()}
      onLogout={handleLogout}
      hasProfile={!!mealPlan}
      canRetryNextWeek={!!nextWeekRetry}
      planMutationsDisabled={planLifecycleBlocked && !nextWeekRetry}
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

        {nextGenerationLocked && mealPlan && (
          <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-900">
            <p className="font-bold">Your Next Weekly Plan is being generated.</p>
            <p className="text-sm">
              Your Current Weekly Plan remains available but read-only until generation finishes.
            </p>
          </div>
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
                pendingMealRerolls={pendingMealRerolls}
                onToggleIngredient={handleToggleIngredient}
                pendingIngredientIds={pendingIngredientIds}
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
            email={user.email}
          />
        )}
      </div>
    </Layout>
  );
};

export default App;
