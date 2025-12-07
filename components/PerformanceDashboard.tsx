import React from 'react';
import { Milestone, UserProfile } from '../types';
import { TrendingUp, TrendingDown, Target, Activity, Calendar } from 'lucide-react';

interface PerformanceDashboardProps {
  milestones: Milestone[];
  userProfile: UserProfile;
}

const PerformanceDashboard: React.FC<PerformanceDashboardProps> = ({ milestones, userProfile }) => {
  // Prepare Data
  // Combine profile creation or initial state with milestones if needed. 
  // For now, assume milestones contain the history.
  // If no milestones, use current profile weight as a single point.
  
  const sortedData = [...milestones].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  
  // If no milestones, construct a virtual one from current profile
  if (sortedData.length === 0) {
      sortedData.push({
          id: 'initial',
          date: new Date().toISOString(),
          weight: userProfile.weightKg
      });
  }

  const currentWeight = userProfile.weightKg;
  const startWeight = sortedData[0].weight;
  const targetWeight = userProfile.targetWeightKg;
  
  const totalChange = currentWeight - startWeight;
  const isLossGoal = userProfile.goal.includes('Lose');
  
  // Calculate Progress %
  let progressPercent = 0;
  if (targetWeight) {
      const totalToLose = startWeight - targetWeight;
      const lostSoFar = startWeight - currentWeight;
      if (totalToLose !== 0) {
          progressPercent = Math.min(100, Math.max(0, (lostSoFar / totalToLose) * 100));
      }
  }

  // BMI Calculation
  const heightM = userProfile.heightCm / 100;
  const bmi = (currentWeight / (heightM * heightM)).toFixed(1);
  
  // Chart Helpers
  const getChartData = () => {
    if (sortedData.length < 2) return null;
    
    const weights = sortedData.map(d => d.weight);
    const minWeight = Math.min(...weights, targetWeight || weights[0]) - 1;
    const maxWeight = Math.max(...weights, targetWeight || weights[0]) + 1;
    const range = maxWeight - minWeight;
    
    const chartHeight = 200;
    const chartWidth = 800; // viewBox width
    
    const startTime = new Date(sortedData[0].date).getTime();
    const endTime = new Date(sortedData[sortedData.length - 1].date).getTime();
    const timeRange = endTime - startTime || 1; // avoid divide by zero

    const points = sortedData.map(d => {
        const x = ((new Date(d.date).getTime() - startTime) / timeRange) * chartWidth;
        const y = chartHeight - ((d.weight - minWeight) / range) * chartHeight;
        return `${x},${y}`;
    }).join(' ');
    
    // Target Line
    let targetY = 0;
    if (targetWeight) {
        targetY = chartHeight - ((targetWeight - minWeight) / range) * chartHeight;
    }

    return { points, targetY, chartWidth, chartHeight, minWeight, maxWeight };
  };

  const chartData = getChartData();

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-2">
        <div>
            <h2 className="text-2xl font-bold text-slate-900">Performance Dashboard</h2>
            <p className="text-slate-500">Track your progress towards {targetWeight ? `${targetWeight}kg` : 'your goal'}</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
            <div className="flex items-center gap-2 mb-2 text-slate-400 text-xs font-bold uppercase tracking-wide">
                <WeightIcon /> Current Weight
            </div>
            <div className="text-2xl font-bold text-slate-900">{currentWeight} <span className="text-sm font-normal text-slate-500">kg</span></div>
        </div>
        
        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
            <div className="flex items-center gap-2 mb-2 text-slate-400 text-xs font-bold uppercase tracking-wide">
                <Target size={14} /> Goal
            </div>
            <div className="text-2xl font-bold text-slate-900">{targetWeight ? targetWeight : '--'} <span className="text-sm font-normal text-slate-500">kg</span></div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
            <div className="flex items-center gap-2 mb-2 text-slate-400 text-xs font-bold uppercase tracking-wide">
                <Activity size={14} /> Total Change
            </div>
            <div className={`text-2xl font-bold ${totalChange <= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                {totalChange > 0 ? '+' : ''}{totalChange.toFixed(1)} <span className="text-sm font-normal text-slate-500">kg</span>
            </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
            <div className="flex items-center gap-2 mb-2 text-slate-400 text-xs font-bold uppercase tracking-wide">
                <Activity size={14} /> BMI
            </div>
            <div className="text-2xl font-bold text-slate-900">{bmi}</div>
        </div>
      </div>

      {/* Progress Bar */}
      {targetWeight && (
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
           <div className="flex justify-between text-sm font-medium mb-2">
              <span className="text-slate-600">Progress to Goal</span>
              <span className="text-emerald-600">{progressPercent.toFixed(0)}%</span>
           </div>
           <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
              <div 
                className="bg-emerald-500 h-full rounded-full transition-all duration-1000 ease-out" 
                style={{ width: `${progressPercent}%` }}
              ></div>
           </div>
        </div>
      )}

      {/* Chart */}
      <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
         <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
            <TrendingUp size={18} className="text-emerald-600" /> Weight Trend
         </h3>
         
         {chartData ? (
             <div className="w-full aspect-[2/1] md:aspect-[3/1] relative">
                <svg viewBox={`0 0 ${chartData.chartWidth} ${chartData.chartHeight}`} className="w-full h-full overflow-visible">
                    {/* Grid Lines (Optional - simplified) */}
                    <line x1="0" y1="0" x2={chartData.chartWidth} y2="0" stroke="#f1f5f9" strokeWidth="1" />
                    <line x1="0" y1={chartData.chartHeight} x2={chartData.chartWidth} y2={chartData.chartHeight} stroke="#f1f5f9" strokeWidth="1" />
                    
                    {/* Target Line */}
                    {targetWeight && (
                        <line 
                           x1="0" 
                           y1={chartData.targetY} 
                           x2={chartData.chartWidth} 
                           y2={chartData.targetY} 
                           stroke="#10b981" 
                           strokeWidth="1" 
                           strokeDasharray="4 4" 
                           opacity="0.5" 
                        />
                    )}

                    {/* Trend Line */}
                    <polyline 
                        fill="none" 
                        stroke="#0ea5e9" 
                        strokeWidth="3" 
                        points={chartData.points} 
                        strokeLinecap="round" 
                        strokeLinejoin="round"
                    />
                    
                    {/* Start Dot */}
                    <circle cx="0" cy={chartData.points.split(' ')[0].split(',')[1]} r="4" fill="#0ea5e9" />
                    {/* End Dot */}
                    <circle cx={chartData.chartWidth} cy={chartData.points.split(' ').pop()?.split(',')[1]} r="4" fill="#0ea5e9" />
                </svg>
                
                {/* Labels */}
                <div className="flex justify-between text-xs text-slate-400 mt-2 font-medium">
                    <span>{new Date(sortedData[0].date).toLocaleDateString()}</span>
                    <span>{new Date(sortedData[sortedData.length - 1].date).toLocaleDateString()}</span>
                </div>
             </div>
         ) : (
             <div className="h-64 flex items-center justify-center bg-slate-50 rounded-xl border border-dashed border-slate-200 text-slate-400">
                <div className="text-center">
                    <Calendar size={32} className="mx-auto mb-2 opacity-50" />
                    <p>Not enough data to map trends.</p>
                    <p className="text-xs">Log at least 2 milestones to see the chart.</p>
                </div>
             </div>
         )}
      </div>
    </div>
  );
};

const WeightIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="5" r="3"></circle>
        <path d="M6.5 8a2 2 0 0 0-1.905 1.457l-1.028 4.265A2 2 0 0 0 5.51 16.208l6.393 1.278a1 1 0 0 0 .194 0l6.393-1.278a2 2 0 0 0 1.943-2.486l-1.028-4.265A2 2 0 0 0 17.5 8h-11z"></path>
        <path d="M12 17v5"></path>
        <path d="M7 22h10"></path>
    </svg>
)

export default PerformanceDashboard;