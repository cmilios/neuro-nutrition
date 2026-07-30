import React from 'react';
import { Loader2 } from 'lucide-react';

const LoadingView: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center py-20 animate-fade-in">
      <div className="relative mb-8">
        <div className="absolute inset-0 bg-emerald-100 rounded-full animate-ping opacity-25"></div>
        <div className="relative bg-white p-6 rounded-full shadow-lg border border-slate-200">
           <Loader2 className="w-12 h-12 text-emerald-600 animate-spin" />
        </div>
      </div>
      <h2 className="text-2xl font-bold text-slate-900 mb-2">Designing Your Plan</h2>
      <div className="space-y-2 text-center">
         <p className="text-slate-500">Analyzing biometrics...</p>
         <p className="text-slate-400 text-sm">Calculating macronutrient targets & TDEE</p>
      </div>
    </div>
  );
};

export default LoadingView;
