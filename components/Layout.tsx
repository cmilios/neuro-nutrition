import React, { ReactNode } from 'react';
import { Leaf, User as UserIcon, CalendarPlus, ChevronDown, PieChart, Utensils } from 'lucide-react';
import { User, UserProfile } from '../types';

interface LayoutProps {
  children: ReactNode;
  onOpenProfile: () => void;
  onNextWeek: () => void;
  user: User | null;
  userProfile: UserProfile | null;
  hasProfile: boolean;
  currentView?: 'plan' | 'performance';
  onViewChange?: (view: 'plan' | 'performance') => void;
  canRetryNextWeek?: boolean;
  planMutationsDisabled?: boolean;
}

const Layout: React.FC<LayoutProps> = ({ 
  children, 
  onOpenProfile, 
  onNextWeek, 
  user, 
  userProfile,
  hasProfile,
  currentView = 'plan',
  onViewChange,
  canRetryNextWeek = false,
  planMutationsDisabled = false,
}) => {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-emerald-600 p-2 rounded-lg text-white">
              <Leaf size={20} />
            </div>
            <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-emerald-600 to-teal-500 hidden sm:inline">
              NeuroNutrition
            </span>
          </div>
          
          {/* Main Navigation Tabs */}
          {hasProfile && onViewChange && (
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl mx-4 hidden md:flex">
               <button 
                 onClick={() => onViewChange('plan')}
                 className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${currentView === 'plan' ? 'bg-white shadow-sm text-emerald-700' : 'text-slate-500 hover:text-slate-700'}`}
               >
                 <Utensils size={14} /> Plan
               </button>
               <button 
                 onClick={() => onViewChange('performance')}
                 className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${currentView === 'performance' ? 'bg-white shadow-sm text-emerald-700' : 'text-slate-500 hover:text-slate-700'}`}
               >
                 <PieChart size={14} /> Performance
               </button>
            </div>
          )}
          
          <nav className="flex items-center gap-4">
             {/* Mobile View Toggle */}
             {hasProfile && onViewChange && (
                <button 
                  onClick={() => onViewChange(currentView === 'plan' ? 'performance' : 'plan')}
                  className="md:hidden p-2 text-slate-500 hover:text-emerald-600 bg-slate-100 rounded-lg"
                >
                   {currentView === 'plan' ? <PieChart size={20} /> : <Utensils size={20} />}
                </button>
             )}

             {user && (
               <button
                 type="button"
                 onClick={onOpenProfile}
                 aria-label="Open Account"
                 aria-haspopup="dialog"
                 title="Account"
                 className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-100 p-1.5 text-sm text-slate-700 transition hover:bg-slate-200 sm:px-3"
               >
                  {userProfile?.photo ? (
                    <img src={userProfile.photo} alt="" className="h-6 w-6 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white">
                      <UserIcon size={15} className="text-slate-500" />
                    </span>
                  )}
                  <span className="hidden font-semibold sm:inline">{user.name || user.email}</span>
                  <ChevronDown size={14} className="hidden text-slate-400 sm:block" />
               </button>
             )}

             {hasProfile && (
               <>
                 <button 
                  onClick={onNextWeek}
                  disabled={planMutationsDisabled}
                  className="text-sm font-bold text-slate-900 bg-emerald-100 hover:bg-emerald-200 px-3 py-1.5 rounded-lg flex items-center gap-2 transition-colors border border-emerald-200/50"
                  title={canRetryNextWeek ? "Retry the failed Next Weekly Plan" : "Generate plan for next week"}
                 >
                   <CalendarPlus size={16} className="text-emerald-700" />
                   <span className="hidden sm:inline text-emerald-800">
                     {canRetryNextWeek ? "Try Again" : "Next Week"}
                   </span>
                 </button>

               </>
             )}
          </nav>
        </div>
      </header>
      
      <main className="flex-grow max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>

      <footer className="bg-white border-t border-slate-200 mt-auto py-6">
        <div className="max-w-7xl mx-auto px-4 text-center text-slate-400 text-sm">
          <p>© {new Date().getFullYear()} NeuroNutrition. Powered by OpenAI.</p>
        </div>
      </footer>
    </div>
  );
};

export default Layout;
