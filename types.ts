// Domain Entities

export enum Gender {
  Male = 'Male',
  Female = 'Female',
  Other = 'Other'
}

export enum ActivityLevel {
  Sedentary = 'Sedentary (Little or no exercise)',
  LightlyActive = 'Lightly Active (Exercise 1-3 days/week)',
  ModeratelyActive = 'Moderately Active (Exercise 3-5 days/week)',
  VeryActive = 'Very Active (Hard exercise 6-7 days/week)',
  ExtraActive = 'Extra Active (Very hard exercise & physical job)'
}

export enum Goal {
  LoseWeight = 'Lose Weight',
  MaintainWeight = 'Maintain Weight',
  GainMuscle = 'Gain Muscle'
}

export enum DietType {
  Standard = 'Standard (Balanced)',
  Keto = 'Ketogenic',
  Vegan = 'Vegan',
  Vegetarian = 'Vegetarian',
  Paleo = 'Paleo',
  Mediterranean = 'Mediterranean'
}

export interface UserProfile {
  age: number;
  gender: Gender;
  heightCm: number;
  weightKg: number;
  targetWeightKg?: number;
  activityLevel: ActivityLevel;
  goal: Goal;
  dietType: DietType;
  allergies?: string;
  photo?: string; // Base64 encoded image string
}

export interface MacroNutrients {
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
}

export interface Meal {
  name: string;
  description: string;
  ingredients: string[];
  ingredientIds: string[];
  checkedIngredientIds: string[];
  instructions: string[];
  macros: MacroNutrients;
  cookingTimeMinutes: number;
  prepTimeMinutes: number;
  portions?: number | null;
  checkedIngredients?: string[];
}

export interface DayPlan {
  day: string;
  breakfast: Meal;
  lunch: Meal;
  dinner: Meal;
  snack: Meal;
  dailySummary: MacroNutrients;
}

export interface MealPlan {
  weeklySummary: string;
  days: DayPlan[];
}

export interface AuthoritativeWeeklyPlanRow {
  planId: string;
  userId: string;
  document: MealPlan;
  schemaVersion: number;
  revision: number;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  deactivatedAt: string | null;
  predecessorPlanId: string | null;
  generationId: string | null;
  nextGenerationId?: string | null;
  nextGenerationLockedAt?: string | null;
}

export type WeeklyPlanCommandStatus = 'succeeded' | 'in_progress' | 'failed';

export interface WeeklyPlanCommandError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface WeeklyPlanCommandOutcome {
  commandId: string;
  status: WeeklyPlanCommandStatus;
  result: AuthoritativeWeeklyPlanRow | null;
  error: WeeklyPlanCommandError | null;
}

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface IngredientProgressCommand {
  commandId: string;
  userId: string;
  planId: string;
  displayedRevision: number;
  day: string;
  mealType: MealType;
  ingredientId: string;
  checked: boolean;
}

export interface MealRerollCommand {
  commandId: string;
  displayedPlanId: string;
  displayedRevision: number;
  day: string;
  mealType: MealType;
}

export interface NextWeeklyPlanCommand {
  commandId: string;
  displayedPlanId: string;
  displayedRevision: number;
  feedback: MealFeedback[];
  currentPlan: MealPlan;
  reviewType: 'empty' | 'partial';
}

export interface MealRerollReservation {
  commandId: string;
  planId: string;
  day: string;
  mealType: MealType;
  reservedAt: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Milestone {
  id: string;
  date: string;
  weight: number;
  bodyFatPercentage?: number;
  note?: string;
}

export interface UserData {
  profile: UserProfile | null;
  mealPlan: MealPlan | null;
  milestones: Milestone[];
}

export interface MealFeedback {
  day: string;
  type: string;
  name: string;
  cooked: boolean;
  liked: boolean;
}
