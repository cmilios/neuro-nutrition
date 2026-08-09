import React, { useState, useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';
import Layout from './components/Layout';
import ProfileForm from './components/ProfileForm';
import PlanDashboard from './components/PlanDashboard';
import PerformanceDashboard from './components/PerformanceDashboard';
import LoadingView from './components/LoadingView';
import AuthScreen from './components/AuthScreen';
import type { AuthView } from './components/AuthScreen';
import WeeklyReviewModal from './components/WeeklyReviewModal';
import UserProfileModal from './components/UserProfileModal';
import PasswordRecoveryScreen from './components/PasswordRecoveryScreen';
import DisplayNameGate from './components/DisplayNameGate';
import Toast, { type ToastMessage } from './components/Toast';
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
} from './types';
import {
  generateInitialWeeklyPlan,
  recoverInitialWeeklyPlan,
  generateNextWeeklyPlan,
  replaceWeeklyPlanFromProfile,
  rerollMeal,
} from './services/aiService';
import { authService } from './services/authService';
import type { OAuthProvider } from './services/oauthProviderFlagsService';
import { storageService } from './services/storageService';
import {
  createWeeklyPlanInvalidationSubscription,
  weeklyPlanGateway,
} from './services/weeklyPlanGateway';
import { weeklyPlanCache } from './services/weeklyPlanCache';
import { requireAuthoritativeWeeklyPlanRow } from './services/weeklyPlanValidation';
import { supabase } from './services/supabaseClient';
import { reportClientIncident } from './services/clientIncidentTelemetry';
import {
  APPLICATION_BASE_PATH,
  PASSWORD_RECOVERY_PATH,
  passwordRecoveryUrl,
} from './services/applicationRoutes';

type PlanAuthorityStatus =
  | 'checking'
  | 'synchronized'
  | 'confirmed-empty'
  | 'stale'
  | 'unavailable';

const OAUTH_INITIATING_VIEW_KEY = 'neuronutrition.oauth-initiating-view';
const OAUTH_INITIATING_PROVIDER_KEY = 'neuronutrition.oauth-initiating-provider';

const providerName = (provider: OAuthProvider) =>
  provider === 'google' ? 'Google' : 'Apple';

const oauthCallbackError = (): string | null => {
  const search = new URLSearchParams(window.location.search);
  const hashQuery = window.location.hash.includes('?')
    ? window.location.hash.slice(window.location.hash.indexOf('?') + 1)
    : window.location.hash.replace(/^#/, '');
  const hash = new URLSearchParams(hashQuery);
  return search.get('error_code')
    ?? search.get('error')
    ?? hash.get('error_code')
    ?? hash.get('error');
};

const isOAuthCancellation = (errorCode: string | null) =>
  errorCode === null
  || ['access_denied', 'user_denied', 'oauth_cancelled'].includes(errorCode);

const App: React.FC = () => {
  const isPasswordRecoveryRoute =
    window.location.pathname === PASSWORD_RECOVERY_PATH;
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [mealPlan, setMealPlan] = useState<MealPlan | null>(null);
  const [authoritativePlan, setAuthoritativePlan] =
    useState<AuthoritativeWeeklyPlanRow | null>(null);
  const [milestones, setMilestones] = useState<Milestone[]>([]);

  // Track the currently loaded user ID to avoid stale closures in effects
  const loadedUserIdRef = React.useRef<string | null>(null);
  const authenticatedUserIdRef = React.useRef<string | null>(null);
  const initialGenerationCommandRef = React.useRef<{
    commandId: string;
    normalizedProfile: string;
  } | null>(null);
  const authoritativePlanRef = React.useRef<AuthoritativeWeeklyPlanRow | null>(null);
  const requestPlanRefetchRef = React.useRef<(() => void) | null>(null);
  const reconcilingNextGenerationIdRef = React.useRef<string | null>(null);
  const profileReplacementCommandRef = React.useRef<{
    commandId: string;
    normalizedProfile: string;
  } | null>(null);
  const startOverCommandRef = React.useRef<{
    commandId: string;
    planId: string;
    revision: number;
  } | null>(null);
  const recoveringRealtimeRef = React.useRef(false);
  const realtimeDisconnectedRef = React.useRef(false);
  const recoveryEventReceivedRef = React.useRef(false);
  const rejectedOAuthUserIdRef = React.useRef<string | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [authenticationError, setAuthenticationError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [authView, setAuthView] = useState<AuthView>(() =>
    sessionStorage.getItem(OAUTH_INITIATING_VIEW_KEY) === 'register'
      ? 'register'
      : 'login'
  );
  // True from the moment a provider button is pressed until the browser is
  // redirected away. It gates a neutral "Signing you in…" interstitial that
  // replaces the logged-out Log In screen, so no logged-out flash or other
  // user's cached data can appear while the OAuth redirect is pending.
  const [isOAuthRedirecting, setIsOAuthRedirecting] = useState(false);
  const [recoverySessionStatus, setRecoverySessionStatus] = useState<
    'checking' | 'ready' | 'invalid'
  >(isPasswordRecoveryRoute ? 'checking' : 'invalid');
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
  const [pendingInitialGenerationId, setPendingInitialGenerationId] =
    useState<string | null>(null);
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

    const metadataName = session.user.user_metadata?.name;

    return {
      id: session.user.id,
      email: session.user.email || '',
      name: typeof metadataName === 'string' ? metadataName.trim() : '',
    };
  };

  const oauthProviderFromSession = (session: Session | null): OAuthProvider | null => {
    const provider = session?.user?.app_metadata?.provider;
    return provider === 'google' || provider === 'apple' ? provider : null;
  };

  const errorMessage = (err: unknown, fallback: string) =>
    err instanceof Error && err.message ? err.message : fallback;

  const showOAuthToast = (
    provider: OAuthProvider,
    kind: ToastMessage['kind'],
  ) => {
    setToast({
      id: Date.now(),
      kind,
      message: kind === 'info'
        ? `${providerName(provider)} sign-in was canceled. No changes were made.`
        : `We couldn't complete ${providerName(provider)} sign-in. Please try again.`,
    });
  };

  const clearPendingOAuth = () => {
    sessionStorage.removeItem(OAUTH_INITIATING_VIEW_KEY);
    sessionStorage.removeItem(OAUTH_INITIATING_PROVIDER_KEY);
  };

  const reportOAuthFailure = (
    provider: OAuthProvider,
    lifecycleStage: string,
    errorCode: string,
  ) => {
    void reportClientIncident('oauth_auth_failure', {
      provider,
      lifecycleStage,
      errorCode,
      releaseIdentifier: import.meta.env.VITE_RELEASE_ID?.trim() || 'development',
      timestamp: new Date().toISOString(),
    });
  };

  const oauthFailureMessage = (provider: OAuthProvider) =>
    `We could not complete ${providerName(provider)} sign-in. Please try again or use another sign-in method.`;

  const reportUnknownCommandOutcome = (operation: string) => {
    void reportClientIncident('unknown_command_outcome', {
      phase: 'command_transport',
      operation,
      authorityStatus: planAuthorityStatus,
    });
  };

  const applyAuthoritativePlan = (
    row: AuthoritativeWeeklyPlanRow,
    userId: string,
  ) => {
    const validated = requireAuthoritativeWeeklyPlanRow(row, userId);
    const previouslyAuthoritative = authoritativePlanRef.current;
    if (previouslyAuthoritative && (
      (
        validated.planId === previouslyAuthoritative.planId
        && validated.revision < previouslyAuthoritative.revision
      )
      || (
        validated.planId !== previouslyAuthoritative.planId
        && validated.predecessorPlanId !== previouslyAuthoritative.planId
      )
    )) {
      void reportClientIncident('revision_mismatch', {
        phase: 'apply_authoritative_result',
        operation: 'refetch',
        authorityStatus: planAuthorityStatus,
      });
    }
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

      const oauthProvider = oauthProviderFromSession(session);
      const invalidOAuthEmail = !!oauthProvider
        && (!session?.user.email?.trim() || !session.user.email_confirmed_at);
      if (invalidOAuthEmail) {
        setAuthenticationError(oauthFailureMessage(oauthProvider));
        setIsOAuthRedirecting(false);
        showOAuthToast(oauthProvider, 'error');
        clearPendingOAuth();
        if (rejectedOAuthUserIdRef.current !== session?.user.id) {
          rejectedOAuthUserIdRef.current = session?.user.id ?? null;
          reportOAuthFailure(oauthProvider, 'session_restore', 'unverified_email');
          // Do not call another Supabase API from inside the synchronous auth
          // callback. Deferring sign-out avoids the supabase-js callback deadlock.
          void Promise.resolve().then(async () => {
            for (let attempt = 0; attempt < 2; attempt += 1) {
              try {
                await authService.logout();
                return;
              } catch {
                // A single retry handles a transient sign-out transport failure.
              }
            }

              rejectedOAuthUserIdRef.current = null;
              reportOAuthFailure(
                oauthProvider,
                'session_cleanup',
                'session_discard_failed',
              );
          });
        }
      }

      const nextUser = invalidOAuthEmail ? null : userFromSession(session);
      if (nextUser) {
        authenticatedUserIdRef.current = nextUser.id;
        rejectedOAuthUserIdRef.current = null;
        clearPendingOAuth();
        setAuthenticationError(null);
      }

      if (!nextUser) {
        if (authenticatedUserIdRef.current) {
          weeklyPlanCache.clear(authenticatedUserIdRef.current);
        }
        authenticatedUserIdRef.current = null;
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
        setPendingInitialGenerationId(null);
        setPendingIngredientIds([]);
        initialGenerationCommandRef.current = null;
        profileReplacementCommandRef.current = null;
        startOverCommandRef.current = null;
        reconcilingNextGenerationIdRef.current = null;
        setPlanAuthorityStatus('checking');
      }
      setUser(nextUser);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (isPasswordRecoveryRoute && event === 'PASSWORD_RECOVERY') {
        recoveryEventReceivedRef.current = true;
        setRecoverySessionStatus(session ? 'ready' : 'invalid');
      }
      applySession(session);
      setIsAuthChecking(false);
    });

    const pendingProvider = sessionStorage.getItem(OAUTH_INITIATING_PROVIDER_KEY);
    const oauthProvider = pendingProvider === 'google' || pendingProvider === 'apple'
      ? pendingProvider
      : null;

    supabase.auth.getSession()
      .then(({ data, error: sessionError }) => {
        if (sessionError) throw sessionError;
        applySession(data.session);
        if (!data.session && oauthProvider) {
          const callbackError = oauthCallbackError();
          setIsOAuthRedirecting(false);
          setAuthenticationError(null);
          showOAuthToast(
            oauthProvider,
            isOAuthCancellation(callbackError) ? 'info' : 'error',
          );
          if (!isOAuthCancellation(callbackError)) {
            reportOAuthFailure(
              oauthProvider,
              'callback',
              'oauth_callback_failed',
            );
          }
          clearPendingOAuth();
          window.history.replaceState({}, '', window.location.pathname);
        }
      })
      .catch(() => {
        // Log the stable error code, not the raw provider/Supabase error
        // object: this path runs on OAuth callbacks too, and M11 forbids raw
        // provider text reaching the browser console.
        const errorCode = 'session_restore_failed';
        console.error('Failed to restore session:', errorCode);
        if (mounted) {
          if (oauthProvider) {
            setAuthenticationError(oauthFailureMessage(oauthProvider));
            setIsOAuthRedirecting(false);
            showOAuthToast(oauthProvider, 'error');
            reportOAuthFailure(
              oauthProvider,
              'session_restore',
              errorCode,
            );
            clearPendingOAuth();
          } else {
            setAuthenticationError(
              'Could not restore your session. Please try again or use another sign-in method.',
            );
          }
        }
      })
      .finally(() => {
        if (mounted) {
          setIsAuthChecking(false);
          if (
            isPasswordRecoveryRoute
            && !recoveryEventReceivedRef.current
          ) {
            setRecoverySessionStatus('invalid');
          }
        }
      });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      const storedProvider = sessionStorage.getItem(OAUTH_INITIATING_PROVIDER_KEY);
      if (storedProvider !== 'google' && storedProvider !== 'apple') return;
      setAuthView(
        sessionStorage.getItem(OAUTH_INITIATING_VIEW_KEY) === 'register'
          ? 'register'
          : 'login',
      );
      setIsOAuthRedirecting(false);
      setAuthenticationError(null);
      showOAuthToast(storedProvider, 'info');
      clearPendingOAuth();
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, []);

  // Data loading is deliberately separate from the auth callback to avoid the
  // supabase-js auth callback deadlock and stale data leaking between users.
  useEffect(() => {
    if (!user || !user.name || loadedUserIdRef.current === user.id) return;

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
      void reportClientIncident('authoritative_load_failure', {
        phase: 'initial_load',
        operation: 'load',
        authorityStatus: cachedPlan ? 'stale' : 'unavailable',
      });
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
      weeklyPlanGateway.getPendingInitialGeneration(),
    ])
      .then(([currentPlan, reservations, pendingInitialCommandId]) => {
        if (cancelled || loadedUserIdRef.current !== user.id) return;
        try {
          setPendingMealRerolls(reservations);
          setPendingInitialGenerationId(pendingInitialCommandId);
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
  }, [user?.id, user?.name]);

  useEffect(() => {
    if (!user?.name) return;

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
        const [currentPlan, reservations, pendingInitialCommandId] = await Promise.all([
          weeklyPlanGateway.getCurrent(user.id),
          weeklyPlanGateway.getPendingMealRerolls(user.id),
          weeklyPlanGateway.getPendingInitialGeneration(),
        ]);
        if (cancelled) return;
        setPendingMealRerolls(reservations);
        setPendingInitialGenerationId(pendingInitialCommandId);
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
          if (recoveringRealtimeRef.current) {
            void reportClientIncident('realtime_recovery_succeeded', {
              phase: 'reconnect_refetch',
              operation: 'refetch',
              authorityStatus: 'confirmed-empty',
            });
            recoveringRealtimeRef.current = false;
          }
          return;
        }
        applyAuthoritativePlan(currentPlan, user.id);
        if (recoveringRealtimeRef.current) {
          void reportClientIncident('realtime_recovery_succeeded', {
            phase: 'reconnect_refetch',
            operation: 'refetch',
            authorityStatus: 'synchronized',
          });
        }
        recoveringRealtimeRef.current = false;
      } catch (refetchError) {
        console.error('Failed to refetch Current Weekly Plan:', refetchError);
        void reportClientIncident('authoritative_refetch_failure', {
          phase: 'realtime_refetch',
          operation: 'refetch',
          authorityStatus: authoritativePlanRef.current ? 'stale' : 'unavailable',
        });
        if (recoveringRealtimeRef.current) {
          void reportClientIncident('realtime_recovery_failure', {
            phase: 'reconnect_refetch',
            operation: 'refetch',
            authorityStatus: authoritativePlanRef.current ? 'stale' : 'unavailable',
          });
        }
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
          recoveringRealtimeRef.current = realtimeDisconnectedRef.current;
          realtimeDisconnectedRef.current = false;
          scheduleRefetch();
          return;
        }
        realtimeDisconnectedRef.current = true;
        recoveringRealtimeRef.current = false;
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

  const forceReload = () => {
    const reportFailure = () => {
      void reportClientIncident('forced_reload_failure', {
        phase: 'reload',
        operation: 'reload',
        authorityStatus: planAuthorityStatus,
      });
      setError('Reload could not start. Please use your browser reload control.');
    };
    const failureTimer = window.setTimeout(reportFailure, 5_000);
    window.addEventListener(
      'beforeunload',
      () => window.clearTimeout(failureTimer),
      { once: true },
    );
    try {
      window.location.reload();
    } catch {
      window.clearTimeout(failureTimer);
      reportFailure();
    }
  };

  const handleAuthSuccess = (authenticatedUser: User) => {
    setAuthenticationError(null);
    setUser(authenticatedUser);
  };

  const handleDisplayNameSave = async (name: string) => {
    await authService.updateDisplayName(name);
    setUser((currentUser) => currentUser
      ? { ...currentUser, name: name.trim() }
      : currentUser
    );
  };

  const handleProviderSignIn = async (
    provider: OAuthProvider,
    initiatingView: AuthView,
  ) => {
    // Show the interstitial before initiating so the logged-out screen never
    // flashes back while the redirect is being set up.
    setAuthView(initiatingView);
    sessionStorage.setItem(OAUTH_INITIATING_VIEW_KEY, initiatingView);
    sessionStorage.setItem(OAUTH_INITIATING_PROVIDER_KEY, provider);
    setIsOAuthRedirecting(true);
    try {
      await authService.signInWithOAuth(provider);
      // On success the browser navigates to the provider and control does not
      // return; nothing else to do here.
    } catch {
      // The redirect could not be started. Return to the Log In screen so the
      // user can retry or use email/password instead of being stranded on the
      // interstitial. Log the stable error code, not the raw provider error
      // object, per M11.
      const errorCode = 'redirect_start_failed';
      console.error('Could not start OAuth sign-in:', errorCode);
      setIsOAuthRedirecting(false);
      setAuthenticationError(oauthFailureMessage(provider));
      showOAuthToast(provider, 'error');
      reportOAuthFailure(provider, 'redirect_start', errorCode);
      clearPendingOAuth();
    }
  };

  const handleLogout = async () => {
    const loggingOutUserId = user?.id ?? null;
    try {
      await authService.logout();
      if (loggingOutUserId) weeklyPlanCache.clear(loggingOutUserId);
      clearPendingOAuth();
      authenticatedUserIdRef.current = null;
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
      setPendingInitialGenerationId(null);
      setPendingIngredientIds([]);
      initialGenerationCommandRef.current = null;
      profileReplacementCommandRef.current = null;
      startOverCommandRef.current = null;
      reconcilingNextGenerationIdRef.current = null;
      setPlanAuthorityStatus('checking');
      setUser(null);
    } catch (logoutError) {
      console.error('Failed to log out:', logoutError);
      throw new Error('Could not log out. Please try again.');
    }
  };

  const handleProfileSubmit = async (data: UserProfile) => {
    if (!user || planAuthorityStatus !== 'confirmed-empty') return;

    // Keep the submitted values as a draft so a failed generation can be
    // retried without forcing the user to re-enter the entire profile.
    setProfile(data);
    setIsLoading(true);
    setError(null);
    let commandOutcomeReceived = false;

    try {
      const normalizedProfile = JSON.stringify(data);
      const pendingCommand = initialGenerationCommandRef.current;
      const commandId = pendingCommand?.normalizedProfile === normalizedProfile
        ? pendingCommand.commandId
        : crypto.randomUUID();
      initialGenerationCommandRef.current = { commandId, normalizedProfile };

      const outcome = await generateInitialWeeklyPlan(data, commandId);
      commandOutcomeReceived = true;
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
      if (!commandOutcomeReceived) {
        reportUnknownCommandOutcome('generate_initial');
      }
      setError(errorMessage(err, 'We encountered an issue generating your plan. Please try again.'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateProfile = async (
    updatedProfile: UserProfile,
    replacePlan: boolean,
  ) => {
    if (!user) throw new Error('Your session is no longer available.');
    await storageService.saveProfileData(user.id, updatedProfile, milestones);
    setProfile(updatedProfile);
    if (!replacePlan) return;

    const sourcePlan = authoritativePlanRef.current;
    if (!sourcePlan || planAuthorityStatus !== 'synchronized') {
      throw new Error('Your Health Profile was saved, but the Current Weekly Plan is not ready to be replaced.');
    }

    const normalizedProfile = JSON.stringify(updatedProfile);
    const pending = profileReplacementCommandRef.current;
    const commandId = pending?.normalizedProfile === normalizedProfile
      ? pending.commandId
      : crypto.randomUUID();
    profileReplacementCommandRef.current = { commandId, normalizedProfile };
    let commandOutcomeReceived = false;
    setPlanAuthorityStatus('stale');
    try {
      const outcome = await replaceWeeklyPlanFromProfile(updatedProfile, {
        commandId,
        displayedPlanId: sourcePlan.planId,
        displayedRevision: sourcePlan.revision,
      });
      commandOutcomeReceived = true;
      if (outcome.status === 'in_progress') {
        throw new Error('Weekly Plan replacement is still in progress.');
      }
      if (outcome.status === 'failed') {
        profileReplacementCommandRef.current = null;
        throw Object.assign(
          new Error(
            outcome.error?.message
              || 'Weekly Plan replacement failed. Your previous plan is unchanged.',
          ),
          { retryable: outcome.error?.retryable ?? false },
        );
      }
      if (!outcome.result) {
        throw new Error('Weekly Plan replacement returned no authoritative plan.');
      }
      profileReplacementCommandRef.current = null;
      applyAuthoritativePlan(outcome.result, user.id);
      setIsProfileModalOpen(false);
    } catch (replacementError) {
      if (!commandOutcomeReceived) {
        reportUnknownCommandOutcome('health_profile_plan_replacement');
      } else {
        setPlanAuthorityStatus('synchronized');
      }
      throw replacementError;
    }
  };

  useEffect(() => {
    const lockedCommandId = authoritativePlan?.healthProfileReplacementId;
    if (!user || !profile || !authoritativePlan || !lockedCommandId) return;

    let cancelled = false;
    let replayTimer: ReturnType<typeof setTimeout> | null = null;
    const sourcePlan = authoritativePlan;

    const replay = async (commandId: string, mayRetryRecoveredStale = true) => {
      try {
        const outcome = await replaceWeeklyPlanFromProfile(profile, {
          commandId,
          displayedPlanId: sourcePlan.planId,
          displayedRevision: sourcePlan.revision,
          resumeExisting: commandId === lockedCommandId,
        });
        if (cancelled) return;
        if (outcome.status === 'succeeded' && outcome.result) {
          profileReplacementCommandRef.current = null;
          applyAuthoritativePlan(outcome.result, user.id);
          return;
        }
        if (outcome.status === 'in_progress') {
          replayTimer = setTimeout(() => void replay(commandId), 60_000);
          return;
        }
        if (
          outcome.status === 'failed'
          && outcome.error?.code === 'stale_generation_recovered'
          && mayRetryRecoveredStale
        ) {
          const retryCommandId = crypto.randomUUID();
          profileReplacementCommandRef.current = {
            commandId: retryCommandId,
            normalizedProfile: JSON.stringify(profile),
          };
          await replay(retryCommandId, false);
          return;
        }

        profileReplacementCommandRef.current = null;
        requestPlanRefetchRef.current?.();
        setError(
          outcome.error?.message
            ?? 'Weekly Plan replacement failed. Your previous plan is unchanged.',
        );
      } catch (replayError) {
        if (cancelled) return;
        reportUnknownCommandOutcome('health_profile_plan_replacement');
        replayTimer = setTimeout(() => void replay(commandId), 60_000);
      }
    };

    void replay(lockedCommandId);
    return () => {
      cancelled = true;
      if (replayTimer) clearTimeout(replayTimer);
    };
  }, [
    authoritativePlan?.healthProfileReplacementId,
    authoritativePlan?.planId,
    authoritativePlan?.revision,
    profile,
    user?.id,
  ]);

  useEffect(() => {
    if (
      !user
      || planAuthorityStatus !== 'confirmed-empty'
      || !pendingInitialGenerationId
    ) {
      return;
    }

    let cancelled = false;
    let replayTimer: ReturnType<typeof setTimeout> | null = null;

    const replay = async () => {
      try {
        const outcome = await recoverInitialWeeklyPlan(
          pendingInitialGenerationId,
        );
        if (cancelled) return;
        if (outcome.status === 'succeeded' && outcome.result) {
          initialGenerationCommandRef.current = null;
          setPendingInitialGenerationId(null);
          setIsLoading(false);
          applyAuthoritativePlan(outcome.result, user.id);
          return;
        }
        if (outcome.status === 'in_progress') {
          replayTimer = setTimeout(() => void replay(), 60_000);
          return;
        }

        initialGenerationCommandRef.current = null;
        setPendingInitialGenerationId(null);
        setIsLoading(false);
        setError(
          outcome.error?.message
            ?? 'Initial Weekly Plan recovery did not produce a committed plan.',
        );
        requestPlanRefetchRef.current?.();
      } catch {
        if (cancelled) return;
        reportUnknownCommandOutcome('generate_initial');
        replayTimer = setTimeout(() => void replay(), 60_000);
      }
    };

    setIsLoading(true);
    void replay();
    return () => {
      cancelled = true;
      if (replayTimer) clearTimeout(replayTimer);
    };
  }, [
    pendingInitialGenerationId,
    planAuthorityStatus,
    user?.id,
  ]);

  useEffect(() => {
    const commandId = authoritativePlan?.nextGenerationId;
    if (!user || !profile || !authoritativePlan || !commandId) return;

    let cancelled = false;
    let replayTimer: ReturnType<typeof setTimeout> | null = null;
    const sourcePlan = authoritativePlan;

    const replay = async () => {
      try {
        const outcome = await generateNextWeeklyPlan(profile, {
          commandId,
          displayedPlanId: sourcePlan.planId,
          displayedRevision: sourcePlan.revision,
          feedback: [],
          currentPlan: sourcePlan.document,
          reviewType: 'empty',
          resumeExisting: true,
        });
        if (cancelled) return;
        if (outcome.status === 'succeeded' && outcome.result) {
          reconcilingNextGenerationIdRef.current = null;
          setPendingNextGenerationId(null);
          setNextWeekRetry(null);
          applyAuthoritativePlan(outcome.result, user.id);
          return;
        }
        if (outcome.status === 'in_progress') {
          replayTimer = setTimeout(() => void replay(), 60_000);
          return;
        }

        reconcilingNextGenerationIdRef.current = null;
        setPendingNextGenerationId(null);
        setNextWeekRetry(null);
        setError(
          outcome.error?.message
            ?? 'Next Weekly Plan recovery did not produce a committed plan.',
        );
        requestPlanRefetchRef.current?.();
      } catch {
        if (cancelled) return;
        reportUnknownCommandOutcome('generate_next');
        replayTimer = setTimeout(() => void replay(), 60_000);
      }
    };

    reconcilingNextGenerationIdRef.current = commandId;
    setPendingNextGenerationId(commandId);
    void replay();
    return () => {
      cancelled = true;
      if (replayTimer) clearTimeout(replayTimer);
    };
  }, [
    authoritativePlan?.nextGenerationId,
    authoritativePlan?.planId,
    authoritativePlan?.revision,
    profile,
    user?.id,
  ]);

  useEffect(() => {
    if (!user || !profile || !authoritativePlan || pendingMealRerolls.length === 0) {
      return;
    }

    let cancelled = false;
    const replayTimers = new Map<string, ReturnType<typeof setTimeout>>();

    const replay = async (reservation: MealRerollReservation) => {
      try {
        const outcome = await rerollMeal(profile, {
          commandId: reservation.commandId,
          displayedPlanId: reservation.planId,
          displayedRevision: authoritativePlan.revision,
          day: reservation.day,
          mealType: reservation.mealType,
          resumeExisting: true,
        });
        if (cancelled) return;
        if (outcome.status === 'succeeded' && outcome.result) {
          applyAuthoritativePlan(outcome.result, user.id);
          setPendingMealRerolls((current) => current.filter(
            (pending) => pending.commandId !== reservation.commandId,
          ));
          setRerollRetry(null);
          return;
        }
        if (outcome.status === 'in_progress') {
          replayTimers.set(
            reservation.commandId,
            setTimeout(() => void replay(reservation), 60_000),
          );
          return;
        }

        setPendingMealRerolls((current) => current.filter(
          (pending) => pending.commandId !== reservation.commandId,
        ));
        setRerollRetry(null);
        setError(
          outcome.error?.message
            ?? 'Meal Reroll recovery did not change the Meal Slot.',
        );
        requestPlanRefetchRef.current?.();
      } catch {
        if (cancelled) return;
        reportUnknownCommandOutcome('reroll_meal');
        replayTimers.set(
          reservation.commandId,
          setTimeout(() => void replay(reservation), 60_000),
        );
      }
    };

    for (const reservation of pendingMealRerolls) {
      void replay(reservation);
    }
    return () => {
      cancelled = true;
      for (const timer of replayTimers.values()) clearTimeout(timer);
    };
  }, [
    authoritativePlan?.planId,
    authoritativePlan?.revision,
    pendingMealRerolls,
    profile,
    user?.id,
  ]);

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
        reportUnknownCommandOutcome('reroll_meal');
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
    let commandOutcomeReceived = false;
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
      commandOutcomeReceived = true;
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
      if (!commandOutcomeReceived) {
        reportUnknownCommandOutcome('set_ingredient_checked');
      }
      setError('Could not save that ingredient change. Please try again.');
    } finally {
      setPendingIngredientIds((current) =>
        current.filter((identity) => identity !== ingredientId)
      );
    }
  };

  const handleStartOver = async () => {
    if (!user || !authoritativePlan || planAuthorityStatus !== 'synchronized') {
      throw new Error('Start Over is unavailable until the Current Weekly Plan is synchronized.');
    }
    const displayedPlan = authoritativePlan;
    let commandOutcomeReceived = false;
    const pendingCommand = startOverCommandRef.current;
    const commandId = pendingCommand?.planId === displayedPlan.planId
      && pendingCommand.revision === displayedPlan.revision
      ? pendingCommand.commandId
      : crypto.randomUUID();
    startOverCommandRef.current = {
      commandId,
      planId: displayedPlan.planId,
      revision: displayedPlan.revision,
    };
    setPlanAuthorityStatus('stale');
    try {
      const outcome = await weeklyPlanGateway.startOver({
        commandId,
        userId: user.id,
        displayedPlanId: displayedPlan.planId,
        displayedRevision: displayedPlan.revision,
      });
      commandOutcomeReceived = true;
      if (outcome.status !== 'succeeded') {
        if (outcome.status === 'failed') {
          startOverCommandRef.current = null;
        }
        throw new Error(outcome.error?.message || 'Start Over did not succeed.');
      }
      startOverCommandRef.current = null;
      setError(null);
      setNextWeekRetry(null);
      setRerollRetry(null);
      setPendingMealRerolls([]);
      clearAuthoritativePlan(user.id);
      setPlanAuthorityStatus('confirmed-empty');
      setIsProfileModalOpen(false);
    } catch (clearError) {
      console.error('Failed to Start Over:', clearError);
      if (!commandOutcomeReceived) {
        reportUnknownCommandOutcome('start_over');
        requestPlanRefetchRef.current?.();
      } else {
        setPlanAuthorityStatus('synchronized');
      }
      setError('Could not start over. Please try again.');
      throw new Error('Could not start over. Please try again.');
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
      if (!commandOutcomeReceived) {
        reportUnknownCommandOutcome('generate_next');
      }
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

  const renderWithToast = (content: React.ReactNode) => (
    <>
      {content}
      {toast && <Toast toast={toast} onDismiss={() => setToast(null)} />}
    </>
  );

  if (
    isAuthChecking
    || (isPasswordRecoveryRoute && recoverySessionStatus === 'checking')
  ) {
    return renderWithToast(<div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-400">Loading...</div>);
  }

  if (isPasswordRecoveryRoute) {
    if (recoverySessionStatus !== 'ready') {
      return renderWithToast(
        <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-red-100 bg-white p-8 shadow-xl">
            <h1 className="text-2xl font-black text-slate-950">Recover password</h1>
            <p role="alert" className="mt-4 text-sm text-red-700">
              This password recovery link is invalid or has expired. Request a new
              recovery email from Account Security.
            </p>
            <a
              href={APPLICATION_BASE_PATH}
              className="mt-4 inline-block text-sm font-bold text-emerald-700 underline"
            >
              Return to NeuroNutrition
            </a>
          </div>
        </main>
      );
    }
    return renderWithToast(
      <PasswordRecoveryScreen
        onComplete={authService.completePasswordRecovery}
      />
    );
  }

  if (!user) {
    if (isOAuthRedirecting) {
      return renderWithToast(
        <div
          role="status"
          className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500"
        >
          Signing you in…
        </div>
      );
    }
    return renderWithToast(
      <AuthScreen
        initialError={authenticationError ?? undefined}
        initialView={authView}
        onSuccess={handleAuthSuccess}
        onProviderSignIn={handleProviderSignIn}
      />
    );
  }

  if (!user.name) {
    return renderWithToast(
      <DisplayNameGate
        onLogout={handleLogout}
        onSave={handleDisplayNameSave}
      />
    );
  }

  if (isDataLoading && planAuthorityStatus === 'checking' && !mealPlan) {
    return renderWithToast(
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500">
        Checking your Current Weekly Plan…
      </div>
    );
  }

  const nextGenerationLocked =
    !!pendingNextGenerationId || !!authoritativePlan?.nextGenerationId;
  const profileReplacementLocked =
    !!authoritativePlan?.healthProfileReplacementId;
  const planIsReadOnly =
    planAuthorityStatus !== 'synchronized'
    || nextGenerationLocked
    || profileReplacementLocked;
  const planLifecycleBlocked =
    planIsReadOnly || !!rerollingState || pendingMealRerolls.length > 0;

  return renderWithToast(
    <Layout
      user={user}
      userProfile={profile}
      onOpenProfile={() => setIsProfileModalOpen(true)}
      onNextWeek={handleNextWeekRequest}
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
            <button onClick={forceReload} className="mt-2 text-sm font-bold underline">
              Reload
            </button>
          </div>
        )}

        {planAuthorityStatus === 'unavailable' && (
          <div className="mx-auto max-w-xl rounded-2xl border border-red-200 bg-red-50 p-8 text-center text-red-900">
            <h1 className="text-2xl font-bold">Your Current Weekly Plan is unavailable.</h1>
            <p className="mt-2 text-sm">We could not confirm the authoritative plan, so generation remains disabled.</p>
            <button
              onClick={forceReload}
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

        {!mealPlan && !isLoading && !pendingInitialGenerationId
          && planAuthorityStatus === 'confirmed-empty' && (
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

        {isProfileModalOpen && (
          <UserProfileModal
            isOpen={isProfileModalOpen}
            onClose={() => setIsProfileModalOpen(false)}
            profile={profile}
            milestones={milestones}
            email={user.email}
            name={user.name}
            hasCurrentPlan={!!authoritativePlan}
            planMutationsDisabled={planLifecycleBlocked}
            onUpdateProfile={handleUpdateProfile}
            onAddMilestone={handleAddMilestone}
            onDeleteMilestone={handleDeleteMilestone}
            onChangePassword={authService.changePassword}
            onSetPassword={authService.setPassword}
            onGetConnectedSignInMethods={authService.getConnectedSignInMethods}
            onDisconnectSignInMethod={authService.disconnectSignInMethod}
            onSendRecovery={() => authService.sendPasswordRecovery(
              user.email,
              passwordRecoveryUrl(window.location.origin),
            )}
            onStartOver={handleStartOver}
            onLogout={handleLogout}
          />
        )}

        {profileReplacementLocked && mealPlan && (
          <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-900">
            <p className="font-bold">Your Weekly Plan is being tailored to your updated Health Profile.</p>
            <p className="text-sm">Your Current Weekly Plan remains available until its replacement succeeds.</p>
          </div>
        )}
      </div>
    </Layout>
  );
};

export default App;
