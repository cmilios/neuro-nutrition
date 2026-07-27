import React, { useEffect, useState } from 'react';
import { MealPlan, Meal, MealRerollReservation, MealType } from '../types';
import { Flame, Droplet, Wheat, Dumbbell, Clock, ChefHat, RefreshCw } from 'lucide-react';
import MealDetailsModal from './MealDetailsModal';

interface PlanDashboardProps {
  plan: MealPlan;
  onReroll: (dayIndex: number, mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack') => void;
  rerollingState: { dayIndex: number; mealType: string } | null;
  rerollRetry: {
    dayIndex: number;
    mealType: string;
    commandId?: string | null;
  } | null;
  pendingMealRerolls?: MealRerollReservation[];
  onToggleIngredient: (
    dayIndex: number,
    mealType: MealType,
    ingredientId: string,
    checked: boolean,
  ) => void;
  pendingIngredientIds?: string[];
  isReadOnly?: boolean;
}

const PlanDashboard: React.FC<PlanDashboardProps> = ({ 
  plan, 
  onReroll, 
  rerollingState,
  rerollRetry,
  pendingMealRerolls = [],
  onToggleIngredient,
  pendingIngredientIds = [],
  isReadOnly = false,
}) => {
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  const [selectedMeal, setSelectedMeal] = useState<{
    dayIndex: number;
    type: MealType;
  } | null>(null);

  useEffect(() => {
    if (activeDayIndex >= plan.days.length) setActiveDayIndex(0);
  }, [activeDayIndex, plan.days.length]);
  
  const activeDay = plan.days[activeDayIndex];

  if (!activeDay) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
        This saved plan is incomplete. Generate a new weekly plan to continue.
      </div>
    );
  }

  const isReserved = (day: string | undefined, type: string) =>
    !!day && pendingMealRerolls.some((reservation) =>
      reservation.day === day && reservation.mealType === type
    );
  const isRerolling = (type: string) =>
    (rerollingState?.dayIndex === activeDayIndex && rerollingState?.mealType === type)
    || isReserved(activeDay.day, type);
  const canRetry = (type: string) =>
    rerollRetry?.dayIndex === activeDayIndex
    && rerollRetry?.mealType === type
    && rerollRetry.commandId === null;

  const handleMealClick = (type: MealType) => {
    setSelectedMeal({ dayIndex: activeDayIndex, type });
  };

  const handleModalIngredientToggle = (ingredientId: string, checked: boolean) => {
    if (!selectedMeal || isReadOnly) return;
    onToggleIngredient(
      selectedMeal.dayIndex,
      selectedMeal.type,
      ingredientId,
      checked,
    );
  };

  const selectedMealValue = selectedMeal
    ? plan.days[selectedMeal.dayIndex]?.[selectedMeal.type]
    : null;
  const selectedMealIsPending = selectedMeal
    ? isReserved(plan.days[selectedMeal.dayIndex]?.day, selectedMeal.type) || (
      rerollingState?.dayIndex === selectedMeal.dayIndex
      && rerollingState.mealType === selectedMeal.type
    )
    : false;

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Summary Header */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-2xl p-6 sm:p-8 text-white shadow-xl">
        <h2 className="text-2xl font-bold mb-2">Nutritionist's Summary</h2>
        <p className="text-slate-300 leading-relaxed max-w-3xl">{plan.weeklySummary}</p>
        
        <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
           {/* We display the current day's targets in the header as a "Today's Focus" */}
           <MacroBadge icon={<Flame size={18} className="text-orange-400" />} label="Calories" value={`${activeDay.dailySummary.calories}`} unit="kcal" />
           <MacroBadge icon={<Dumbbell size={18} className="text-blue-400" />} label="Protein" value={`${activeDay.dailySummary.protein}`} unit="g" />
           <MacroBadge icon={<Wheat size={18} className="text-yellow-400" />} label="Carbs" value={`${activeDay.dailySummary.carbs}`} unit="g" />
           <MacroBadge icon={<Droplet size={18} className="text-rose-400" />} label="Fats" value={`${activeDay.dailySummary.fats}`} unit="g" />
        </div>
      </div>

      {/* Day Navigation */}
      <div className="flex overflow-x-auto pb-2 gap-2 hide-scrollbar">
        {plan.days.map((day, idx) => (
          <button
            key={idx}
            onClick={() => setActiveDayIndex(idx)}
            className={`
              whitespace-nowrap px-5 py-2.5 rounded-full font-medium transition-all text-sm
              ${activeDayIndex === idx 
                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20' 
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}
            `}
          >
            {day.day}
          </button>
        ))}
      </div>

      {/* Meals Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <MealCard 
          type="Breakfast" 
          meal={activeDay.breakfast} 
          color="emerald" 
          onReroll={() => onReroll(activeDayIndex, 'breakfast')}
          isLoading={isRerolling('breakfast')}
          canRetry={canRetry('breakfast')}
          isReadOnly={isReadOnly || isRerolling('breakfast')}
          onClick={() => handleMealClick('breakfast')}
        />
        <MealCard 
          type="Lunch" 
          meal={activeDay.lunch} 
          color="amber" 
          onReroll={() => onReroll(activeDayIndex, 'lunch')}
          isLoading={isRerolling('lunch')}
          canRetry={canRetry('lunch')}
          isReadOnly={isReadOnly || isRerolling('lunch')}
          onClick={() => handleMealClick('lunch')}
        />
        <MealCard 
          type="Dinner" 
          meal={activeDay.dinner} 
          color="indigo" 
          onReroll={() => onReroll(activeDayIndex, 'dinner')}
          isLoading={isRerolling('dinner')}
          canRetry={canRetry('dinner')}
          isReadOnly={isReadOnly || isRerolling('dinner')}
          onClick={() => handleMealClick('dinner')}
        />
        <MealCard 
          type="Snack" 
          meal={activeDay.snack} 
          color="rose" 
          onReroll={() => onReroll(activeDayIndex, 'snack')}
          isLoading={isRerolling('snack')}
          canRetry={canRetry('snack')}
          isReadOnly={isReadOnly || isRerolling('snack')}
          onClick={() => handleMealClick('snack')}
        />
      </div>

      {/* Details Modal */}
      {selectedMeal && selectedMealValue && (
        <MealDetailsModal 
          isOpen={!!selectedMeal}
          onClose={() => setSelectedMeal(null)}
          meal={selectedMealValue}
          mealType={selectedMeal.type}
          onToggleIngredient={handleModalIngredientToggle}
          isReadOnly={isReadOnly || selectedMealIsPending}
          pendingIngredientIds={pendingIngredientIds}
        />
      )}
    </div>
  );
};

const MacroBadge = ({ icon, label, value, unit }: { icon: React.ReactNode, label: string, value: string, unit: string }) => (
  <div className="bg-white/10 backdrop-blur-md rounded-xl p-3 flex items-center gap-3">
    <div className="p-2 bg-white/10 rounded-lg">{icon}</div>
    <div>
      <div className="text-xs text-slate-400 uppercase tracking-wider font-semibold">{label}</div>
      <div className="font-bold text-lg">{value}<span className="text-sm font-normal text-slate-400 ml-1">{unit}</span></div>
    </div>
  </div>
);

interface MealCardProps {
  type: string;
  meal: Meal;
  color: 'emerald' | 'amber' | 'indigo' | 'rose';
  onReroll: () => void;
  onClick: () => void;
  isLoading: boolean;
  canRetry: boolean;
  isReadOnly: boolean;
}

const MealCard: React.FC<MealCardProps> = ({
  type,
  meal,
  color,
  onReroll,
  onClick,
  isLoading,
  canRetry,
  isReadOnly,
}) => {
  const colorStyles = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-100',
    rose: 'bg-rose-50 text-rose-700 border-rose-100',
  };

  return (
    <div 
      onClick={onClick}
      className="bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all overflow-hidden group relative cursor-pointer"
    >
      {isLoading && (
        <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-10 flex items-center justify-center cursor-default" onClick={e => e.stopPropagation()}>
          <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin" />
        </div>
      )}
      
      <div className={`px-6 py-3 border-b border-dashed flex justify-between items-center ${colorStyles[color]}`}>
        <h3 className="font-bold uppercase tracking-wide text-sm">{type}</h3>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-xs font-semibold bg-white/60 px-2 py-1 rounded-md">
             <Clock size={12} /> {meal.cookingTimeMinutes}m
          </div>
          <button 
            onClick={(e) => { e.stopPropagation(); onReroll(); }}
            disabled={isLoading || isReadOnly}
            className="p-1.5 hover:bg-white/60 rounded-md transition-colors text-current opacity-70 hover:opacity-100"
            title={canRetry ? "Try Again" : "Reroll this meal"}
            aria-label={canRetry ? "Try Again" : "Reroll this meal"}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>
      
      <div className="p-6">
        <h4 className="text-xl font-bold text-slate-900 mb-2 group-hover:text-emerald-700 transition-colors">{meal.name}</h4>
        <p className="text-slate-600 text-sm mb-4 leading-relaxed line-clamp-2">{meal.description}</p>
        
        <div className="mb-4">
          <h5 className="text-xs font-semibold text-slate-400 uppercase mb-2 flex items-center gap-1">
            <ChefHat size={12} /> Ingredients
          </h5>
          <div className="flex flex-wrap gap-1.5">
            {meal.ingredients.slice(0, 5).map((ing, i) => (
              <span key={i} className="inline-block px-2.5 py-1 bg-slate-100 text-slate-600 text-xs rounded-md">
                {ing}
              </span>
            ))}
            {meal.ingredients.length > 5 && (
              <span className="inline-block px-2.5 py-1 bg-slate-50 text-slate-400 text-xs rounded-md">
                +{meal.ingredients.length - 5} more
              </span>
            )}
          </div>
        </div>

        <div className="flex justify-between items-center pt-4 border-t border-slate-100">
           <div className="flex gap-3 text-xs font-medium text-slate-500">
             <span className="flex items-center gap-1"><Flame size={12} className="text-orange-400"/> {meal.macros.calories}</span>
             <span className="flex items-center gap-1"><Dumbbell size={12} className="text-blue-400"/> {meal.macros.protein}g</span>
             <span className="flex items-center gap-1"><Wheat size={12} className="text-yellow-400"/> {meal.macros.carbs}g</span>
             <span className="flex items-center gap-1"><Droplet size={12} className="text-rose-400"/> {meal.macros.fats}g</span>
           </div>
        </div>
      </div>
    </div>
  );
};

export default PlanDashboard;
