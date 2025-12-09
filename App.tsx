import React, { useState, useEffect } from 'react';
import Layout from './components/Layout';
import ProfileForm from './components/ProfileForm';
import PlanDashboard from './components/PlanDashboard';
import PerformanceDashboard from './components/PerformanceDashboard';
import LoadingView from './components/LoadingView';
import AuthScreen from './components/AuthScreen';
import WeeklyReviewModal from './components/WeeklyReviewModal';
import UserProfileModal from './components/UserProfileModal';
import { UserProfile, MealPlan, User, DayPlan, Meal, MealFeedback, Milestone } from './types';
import { generateMealPlan, regenerateSingleMeal } from './services/geminiService';
import { authService } from './services/authService';
import { storageService } from './services/storageService';
import { supabase } from './services/supabaseClient';

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [mealPlan, setMealPlan] = useState<MealPlan | null>(null);
  const [milestones, setMilestones] = useState<Milestone[]>([]);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [rerollingState, setRerollingState] = useState<{ dayIndex: number, mealType: string } | null>(null);

  // Navigation State
  const [currentView, setCurrentView] = useState<'plan' | 'performance'>('plan');

  // Modals
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  // Check for active session on boot
  // Check for active session on boot & listen for changes
  useEffect(() => {
    // 1. Get initial session
    authService.getSessionUser().then(currentUser => {
      if (currentUser) {
        setUser(currentUser);
        loadUserData(currentUser.id);
      }
    }).finally(() => {
      setIsAuthChecking(false);
    });

    // 2. Listen for auth changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        const currentUser: User = {
          id: session.user.id,
          email: session.user.email || '',
          name: session.user.user_metadata.name || ''
        };
        setUser(currentUser);
        // We only load data if we didn't have a user before to avoid re-fetching unnecessarily
        // But for simplicity in this MVP, we can reload or rely on simple state
        if (!user || user.id !== currentUser.id) {
          loadUserData(currentUser.id);
        }
      } else {
        setUser(null);
        setProfile(null);
        setMealPlan(null);
        setMilestones([]);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const loadUserData = (userId: string) => {
    const data = storageService.getUserData(userId);
    if (data) {
      setProfile(data.profile);
      setMealPlan(data.mealPlan);
      setMilestones(data.milestones || []);
    }
  };

  const handleAuthSuccess = (authenticatedUser: User) => {
    setUser(authenticatedUser);
    loadUserData(authenticatedUser.id);
  };

  const handleLogout = async () => {
    await authService.logout();
    setUser(null);
    setProfile(null);
    setMealPlan(null);
    setMilestones([]);
  };

  const handleProfileSubmit = async (data: UserProfile) => {
    if (!user) return;

    setProfile(data);
    setIsLoading(true);
    setError(null);

    try {
      const generatedPlan = await generateMealPlan(data);
      setMealPlan(generatedPlan);
      // Automatically save to "DB"
      storageService.saveUserData(user.id, data, generatedPlan, milestones);
    } catch (err) {
      setError("We encountered an issue generating your plan. Please check your API Key and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateProfile = (updatedProfile: UserProfile) => {
    if (!user || !mealPlan) return;
    setProfile(updatedProfile);
    storageService.saveUserData(user.id, updatedProfile, mealPlan, milestones);
  };

  const handleAddMilestone = (weight: number, note: string, bodyFat?: number) => {
    if (!user || !profile || !mealPlan) return;

    const newMilestone: Milestone = {
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      weight,
      note,
      bodyFatPercentage: bodyFat
    };

    const updatedMilestones = [...milestones, newMilestone];
    setMilestones(updatedMilestones);

    // Auto-update current weight in profile
    const updatedProfile = { ...profile, weightKg: weight };
    setProfile(updatedProfile);

    storageService.saveUserData(user.id, updatedProfile, mealPlan, updatedMilestones);
  };

  const handleDeleteMilestone = (id: string) => {
    if (!user || !profile || !mealPlan) return;
    const updatedMilestones = milestones.filter(m => m.id !== id);
    setMilestones(updatedMilestones);
    storageService.saveUserData(user.id, profile, mealPlan, updatedMilestones);
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
      storageService.saveUserData(user.id, profile, updatedPlan, milestones);

    } catch (err) {
      console.error(err);
      setError("Failed to regenerate meal. Please try again.");
    } finally {
      setRerollingState(null);
    }
  };

  const handleToggleIngredient = (dayIndex: number, mealType: string, ingredient: string) => {
    if (!user || !profile || !mealPlan) return;

    const updatedDays = [...mealPlan.days];
    const targetDay = { ...updatedDays[dayIndex] };

    // Using type assertion to access dynamic property safely in this controlled context
    const meal = targetDay[mealType as keyof DayPlan] as Meal;

    if (meal && typeof meal === 'object') {
      const currentChecked = meal.checkedIngredients || [];
      if (currentChecked.includes(ingredient)) {
        meal.checkedIngredients = currentChecked.filter(i => i !== ingredient);
      } else {
        meal.checkedIngredients = [...currentChecked, ingredient];
      }
    }

    const updatedPlan = { ...mealPlan, days: updatedDays };
    setMealPlan(updatedPlan);
    storageService.saveUserData(user.id, profile, updatedPlan, milestones);
  };

  const handleReset = () => {
    if (!user) return;
    // Just clear local state, doesn't delete user account
    setProfile(null);
    setMealPlan(null);
    setMilestones([]);
    storageService.clearUserData(user.id);
    setError(null);
  };

  // Triggered by the "Next Week" button in Layout
  const handleNextWeekRequest = () => {
    if (mealPlan) {
      setIsReviewModalOpen(true);
    } else {
      handleReset();
    }
  };

  // Called when the Review Modal is submitted
  const handleReviewSubmit = async (feedback: MealFeedback[]) => {
    if (!user || !profile) return;

    setIsReviewModalOpen(false);
    setIsLoading(true);
    setError(null);

    try {
      // Pass feedback to the generator
      const generatedPlan = await generateMealPlan(profile, feedback);
      setMealPlan(generatedPlan);
      storageService.saveUserData(user.id, profile, generatedPlan, milestones);
    } catch (err) {
      setError("Failed to generate optimized plan. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  if (isAuthChecking) {
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
      hasProfile={!!profile}
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

        {!profile && !isLoading && (
          <ProfileForm onSubmit={handleProfileSubmit} isLoading={isLoading} />
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

        {profile && (
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