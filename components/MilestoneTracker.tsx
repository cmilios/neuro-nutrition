import React, { useState } from 'react';
import { Milestone } from '../types';
import { Plus, Trash2, TrendingDown, TrendingUp, Minus, Activity } from 'lucide-react';

interface MilestoneTrackerProps {
  milestones: Milestone[];
  currentWeight: number;
  onAddMilestone: (weight: number, note: string, bodyFat?: number) => void;
  onDeleteMilestone: (id: string) => void;
}

const MilestoneTracker: React.FC<MilestoneTrackerProps> = ({ 
  milestones, 
  currentWeight, 
  onAddMilestone,
  onDeleteMilestone
}) => {
  const [newWeight, setNewWeight] = useState<string>(currentWeight.toString());
  const [bodyFat, setBodyFat] = useState<string>('');
  const [note, setNote] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWeight) return;
    
    onAddMilestone(Number(newWeight), note, bodyFat ? Number(bodyFat) : undefined);
    setNote('');
    setBodyFat('');
  };

  const sortedMilestones = [...milestones].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  
  const startWeight = sortedMilestones.length > 0 ? sortedMilestones[sortedMilestones.length - 1].weight : currentWeight;
  const weightDiff = currentWeight - startWeight;
  
  return (
    <div className="space-y-8">
      {/* Current Stats */}
      <div className="bg-slate-900 text-white p-6 rounded-2xl flex items-center justify-between shadow-lg">
         <div>
            <div className="text-slate-400 text-xs font-bold uppercase tracking-wide">Current Weight</div>
            <div className="text-3xl font-bold">{currentWeight} <span className="text-lg font-normal text-slate-400">kg</span></div>
         </div>
         <div className="text-right">
             <div className="text-slate-400 text-xs font-bold uppercase tracking-wide">Total Change</div>
             <div className={`text-xl font-bold flex items-center gap-1 justify-end ${weightDiff <= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {weightDiff > 0 ? <TrendingUp size={20} /> : weightDiff < 0 ? <TrendingDown size={20} /> : <Minus size={20}/>}
                {Math.abs(weightDiff).toFixed(1)} kg
             </div>
         </div>
      </div>

      {/* Add New Milestone */}
      <form onSubmit={handleSubmit} className="bg-slate-50 p-5 rounded-xl border border-slate-200 shadow-sm">
        <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
           <Activity size={16} className="text-emerald-600"/> Log Progress
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
           <div className="relative">
             <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1 block">Weight</label>
             <div className="relative">
                <input 
                  type="number" 
                  step="0.1"
                  value={newWeight}
                  onChange={(e) => setNewWeight(e.target.value)}
                  className="w-full pl-3 pr-8 py-2.5 rounded-lg border border-slate-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none bg-white"
                  placeholder="kg"
                  required
                />
                <span className="absolute right-3 top-2.5 text-slate-400 text-sm font-medium">kg</span>
             </div>
           </div>
           
           <div className="relative">
             <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1 block">Body Fat % (Opt)</label>
             <div className="relative">
                <input 
                  type="number" 
                  step="0.1"
                  value={bodyFat}
                  onChange={(e) => setBodyFat(e.target.value)}
                  className="w-full pl-3 pr-8 py-2.5 rounded-lg border border-slate-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none bg-white"
                  placeholder="%"
                />
                <span className="absolute right-3 top-2.5 text-slate-400 text-sm font-medium">%</span>
             </div>
           </div>
        </div>
        
        <div className="flex gap-3">
           <input 
             type="text" 
             value={note}
             onChange={(e) => setNote(e.target.value)}
             className="w-full flex-1 px-3 py-2.5 rounded-lg border border-slate-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none bg-white"
             placeholder="Notes (e.g. Feeling energetic!)"
           />
           <button 
             type="submit"
             className="bg-emerald-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2 shadow-sm"
           >
             <Plus size={18} /> Log
           </button>
        </div>
      </form>

      {/* History List */}
      <div>
        <h3 className="text-sm font-bold text-slate-700 mb-3">History</h3>
        <div className="space-y-3">
          {sortedMilestones.length === 0 ? (
            <p className="text-slate-400 text-sm italic text-center py-4 bg-slate-50 rounded-xl border border-dashed border-slate-200">No milestones logged yet.</p>
          ) : (
            sortedMilestones.map((ms) => (
              <div key={ms.id} className="flex items-center justify-between p-4 bg-white border border-slate-100 rounded-xl hover:border-emerald-200 transition-colors group shadow-sm">
                 <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6">
                    <div>
                        <div className="font-bold text-slate-800 text-lg">{ms.weight} <span className="text-sm font-normal text-slate-400">kg</span></div>
                        <div className="text-xs text-slate-400 font-medium">{new Date(ms.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
                    </div>
                    {ms.bodyFatPercentage && (
                        <div className="bg-slate-100 px-2 py-1 rounded-md text-xs font-semibold text-slate-600">
                            {ms.bodyFatPercentage}% BF
                        </div>
                    )}
                 </div>
                 
                 <div className="flex items-center gap-4 flex-1 justify-end">
                    {ms.note && (
                        <div className="text-sm text-slate-500 italic truncate max-w-[150px] hidden sm:block">
                            "{ms.note}"
                        </div>
                    )}
                    <button 
                    onClick={() => onDeleteMilestone(ms.id)}
                    className="text-slate-300 hover:text-red-500 transition-colors p-2 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100"
                    title="Delete Entry"
                    >
                    <Trash2 size={16} />
                    </button>
                 </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default MilestoneTracker;