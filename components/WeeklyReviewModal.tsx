import React, { useEffect, useState } from 'react';
import { MealPlan, MealFeedback } from '../types';
import { ThumbsUp, Check, ArrowRight, X } from 'lucide-react';

const mealTypes = ['Breakfast', 'Lunch', 'Dinner', 'Snack'] as const;

interface WeeklyReviewModalProps {
  currentPlan: MealPlan;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (feedback: MealFeedback[]) => void;
}

const WeeklyReviewModal: React.FC<WeeklyReviewModalProps> = ({
  currentPlan,
  isOpen,
  onClose,
  onSubmit
}) => {
  const [feedback, setFeedback] = useState<MealFeedback[]>([]);

  useEffect(() => {
    if (isOpen) setFeedback([]);
  }, [isOpen]);

  // Initialize feedback state map if needed, or build it dynamically
  const getFeedback = (day: string, type: string, name: string) => {
    return feedback.find(f => f.day === day && f.type === type && f.name === name) || {
      day,
      type,
      name,
      cooked: false,
      liked: false
    };
  };

  const updateFeedback = (day: string, type: string, name: string, field: 'cooked' | 'liked', value: boolean) => {
    const existingIndex = feedback.findIndex(f => f.day === day && f.type === type && f.name === name);
    let newFeedbackList = [...feedback];

    if (existingIndex === -1) {
      // Add new entry
      const newItem: MealFeedback = {
        day,
        type,
        name,
        cooked: false,
        liked: false,
        [field]: value
      };
      // If liking, implicitly cooked
      if (field === 'liked' && value) newItem.cooked = true;
      newFeedbackList.push(newItem);
    } else {
      // Update existing
      newFeedbackList[existingIndex] = { ...newFeedbackList[existingIndex], [field]: value };
      // Logic checks
      if (field === 'liked' && value) {
        newFeedbackList[existingIndex].cooked = true;
      }
      if (field === 'cooked' && !value) {
        newFeedbackList[existingIndex].liked = false;
      }
    }
    setFeedback(newFeedbackList);
  };

  const completeMealReviewFeedback = () =>
    feedback.length === 0 ? [] :
    currentPlan.days.flatMap((day) =>
      mealTypes.map((type) => {
        const meal = day[type.toLowerCase() as 'breakfast' | 'lunch' | 'dinner' | 'snack'];
        return getFeedback(day.day, type, meal.name);
      })
    );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose}></div>
      
      <div className="relative bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] border border-slate-200 shadow-2xl overflow-hidden flex flex-col animate-fade-in">
        <div className="bg-slate-50 border-b border-slate-100 p-6 flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Review Your Week</h2>
            <p className="text-slate-500 text-sm">Help us optimize your next plan by telling us what you cooked and liked.</p>
          </div>
           <button 
              onClick={onClose}
              className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-400 hover:text-slate-600"
            >
              <X size={24} />
            </button>
        </div>

        <div className="overflow-y-auto p-6 custom-scrollbar">
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            If you review any meal, untouched meals become Uncooked Meals and are replaced in your Next Weekly Plan.
          </div>
          {currentPlan.days.map((day, dayIdx) => (
            <div key={dayIdx} className="mb-8 last:mb-0">
              <h3 className="font-bold text-emerald-700 bg-emerald-50 px-4 py-2 rounded-lg inline-block mb-4 text-sm uppercase tracking-wide">
                {day.day}
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {mealTypes.map((type) => {
                  const meal = day[type.toLowerCase() as keyof typeof day];
                  if (!meal || typeof meal !== 'object' || !('name' in meal)) return null;
                  const item = meal as any; // safe cast due to loop
                  const state = getFeedback(day.day, type, item.name);

                  return (
                    <div key={type} className="border border-slate-200 rounded-xl p-4 bg-white shadow-sm hover:border-slate-300 transition-colors">
                      <div className="text-xs font-semibold text-slate-400 uppercase mb-1">{type}</div>
                      <div className="font-medium text-slate-800 text-sm mb-4 line-clamp-2 h-10 leading-tight" title={item.name}>
                        {item.name}
                      </div>
                      
                      <div className="flex gap-2">
                        <button
                          onClick={() => updateFeedback(day.day, type, item.name, 'cooked', !state.cooked)}
                          className={`
                            flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition-all border
                            ${state.cooked 
                              ? 'bg-emerald-600 text-white border-emerald-600' 
                              : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}
                          `}
                        >
                          <Check size={14} /> Cooked
                        </button>
                        <button
                          onClick={() => updateFeedback(day.day, type, item.name, 'liked', !state.liked)}
                          disabled={!state.cooked}
                          className={`
                            flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition-all border
                            ${state.liked 
                              ? 'bg-rose-500 text-white border-rose-500' 
                              : state.cooked 
                                ? 'bg-white text-slate-500 border-slate-200 hover:bg-rose-50 hover:text-rose-500 hover:border-rose-200'
                                : 'bg-slate-100 text-slate-300 border-transparent cursor-not-allowed'}
                          `}
                        >
                          <ThumbsUp size={14} /> Liked
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="bg-slate-50 border-t border-slate-100 p-4 flex justify-between items-center shrink-0">
          <button
             onClick={() => onSubmit([])} // Empty array means skip logic
             className="text-slate-500 hover:text-slate-700 text-sm font-medium px-4"
          >
            Continue Without Review
          </button>
          
          <button
            onClick={() => onSubmit(completeMealReviewFeedback())}
            className="bg-slate-900 text-white px-6 py-3 rounded-xl font-bold hover:bg-slate-800 transition-all flex items-center gap-2 shadow-lg hover:shadow-xl hover:-translate-y-0.5"
          >
            Generate Next Plan
            <ArrowRight size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default WeeklyReviewModal;
