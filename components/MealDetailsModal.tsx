import React from 'react';
import { Meal } from '../types';
import { X, Clock, Flame, Dumbbell, Wheat, Droplet, ChefHat, CheckSquare, Square } from 'lucide-react';

interface MealDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  meal: Meal;
  onToggleIngredient: (ingredient: string) => void;
  mealType: string;
}

const MealDetailsModal: React.FC<MealDetailsModalProps> = ({ 
  isOpen, 
  onClose, 
  meal, 
  onToggleIngredient,
  mealType 
}) => {
  if (!isOpen) return null;

  // Prevent background scrolling when modal is open
  React.useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, []);

  const checkedIngredients = new Set(meal.checkedIngredients || []);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity" 
        onClick={onClose}
      ></div>

      {/* Modal Content */}
      <div className="relative bg-white rounded-3xl w-full max-w-2xl max-h-[90vh] shadow-2xl overflow-hidden flex flex-col animate-fade-in">
        
        {/* Header */}
        <div className="bg-slate-50 border-b border-slate-100 p-6 flex justify-between items-start shrink-0">
          <div>
            <div className="text-xs font-bold text-emerald-600 uppercase tracking-wider mb-2">{mealType}</div>
            <h2 className="text-2xl font-bold text-slate-900 pr-8">{meal.name}</h2>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-400 hover:text-slate-600"
          >
            <X size={24} />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="overflow-y-auto p-6 space-y-8 custom-scrollbar">
          
          {/* Quick Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
             <div className="bg-orange-50 p-3 rounded-xl border border-orange-100 flex flex-col items-center justify-center text-center">
                <Flame size={20} className="text-orange-500 mb-1" />
                <span className="text-lg font-bold text-slate-800">{meal.macros.calories}</span>
                <span className="text-xs text-slate-500 uppercase font-semibold">Calories</span>
             </div>
             <div className="bg-blue-50 p-3 rounded-xl border border-blue-100 flex flex-col items-center justify-center text-center">
                <Dumbbell size={20} className="text-blue-500 mb-1" />
                <span className="text-lg font-bold text-slate-800">{meal.macros.protein}g</span>
                <span className="text-xs text-slate-500 uppercase font-semibold">Protein</span>
             </div>
             <div className="bg-yellow-50 p-3 rounded-xl border border-yellow-100 flex flex-col items-center justify-center text-center">
                <Wheat size={20} className="text-yellow-500 mb-1" />
                <span className="text-lg font-bold text-slate-800">{meal.macros.carbs}g</span>
                <span className="text-xs text-slate-500 uppercase font-semibold">Carbs</span>
             </div>
             <div className="bg-rose-50 p-3 rounded-xl border border-rose-100 flex flex-col items-center justify-center text-center">
                <Droplet size={20} className="text-rose-500 mb-1" />
                <span className="text-lg font-bold text-slate-800">{meal.macros.fats}g</span>
                <span className="text-xs text-slate-500 uppercase font-semibold">Fats</span>
             </div>
          </div>

          <div className="flex items-center gap-6 text-sm text-slate-600 border-y border-slate-100 py-4">
             <div className="flex items-center gap-2">
                <Clock size={16} className="text-emerald-600" />
                <span className="font-semibold">Prep:</span> {meal.prepTimeMinutes || 0} min
             </div>
             <div className="flex items-center gap-2">
                <Clock size={16} className="text-emerald-600" />
                <span className="font-semibold">Cook:</span> {meal.cookingTimeMinutes} min
             </div>
             <div className="flex items-center gap-2">
                <ChefHat size={16} className="text-emerald-600" />
                <span className="font-semibold">Total:</span> {(meal.prepTimeMinutes || 0) + meal.cookingTimeMinutes} min
             </div>
          </div>

          <p className="text-slate-600 leading-relaxed italic border-l-4 border-emerald-500 pl-4 bg-slate-50 py-2">
            {meal.description}
          </p>

          {/* Ingredients */}
          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
               Ingredients <span className="text-sm font-normal text-slate-400">(Check what you have)</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {meal.ingredients.map((ing, i) => {
                const isChecked = checkedIngredients.has(ing);
                return (
                  <div 
                    key={i} 
                    onClick={() => onToggleIngredient(ing)}
                    className={`
                      flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all select-none
                      ${isChecked 
                        ? 'bg-emerald-50 border-emerald-200 text-slate-400 line-through decoration-emerald-500/50' 
                        : 'bg-white border-slate-200 hover:border-emerald-300 text-slate-700 hover:shadow-sm'}
                    `}
                  >
                    {isChecked ? (
                      <CheckSquare className="text-emerald-500 shrink-0" size={20} />
                    ) : (
                      <Square className="text-slate-300 shrink-0" size={20} />
                    )}
                    <span className="text-sm font-medium">{ing}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Instructions */}
          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-4">Instructions</h3>
            <div className="space-y-6">
              {meal.instructions && meal.instructions.length > 0 ? (
                meal.instructions.map((step, i) => (
                  <div key={i} className="flex gap-4">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm">
                      {i + 1}
                    </div>
                    <p className="text-slate-700 leading-relaxed mt-1">
                      {step}
                    </p>
                  </div>
                ))
              ) : (
                <div className="p-4 bg-yellow-50 text-yellow-800 rounded-lg text-sm text-center">
                  Preparation instructions are not available for this older plan. <br/>
                  Please use the <strong>Reroll</strong> button on the dashboard card to generate details for this meal.
                </div>
              )}
            </div>
          </div>

        </div>
        
        {/* Footer */}
        <div className="bg-slate-50 border-t border-slate-100 p-4 shrink-0 flex justify-end">
           <button 
             onClick={onClose}
             className="px-6 py-2.5 bg-slate-900 text-white rounded-xl font-medium hover:bg-slate-800 transition-colors"
           >
             Close Details
           </button>
        </div>

      </div>
    </div>
  );
};

export default MealDetailsModal;