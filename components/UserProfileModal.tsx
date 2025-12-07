import React, { useState } from 'react';
import { UserProfile, Milestone } from '../types';
import ProfileForm from './ProfileForm';
import MilestoneTracker from './MilestoneTracker';
import { X, Settings, TrendingUp } from 'lucide-react';

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfile;
  milestones: Milestone[];
  onUpdateProfile: (profile: UserProfile) => void;
  onAddMilestone: (weight: number, note: string) => void;
  onDeleteMilestone: (id: string) => void;
}

const UserProfileModal: React.FC<UserProfileModalProps> = ({
  isOpen,
  onClose,
  profile,
  milestones,
  onUpdateProfile,
  onAddMilestone,
  onDeleteMilestone
}) => {
  const [activeTab, setActiveTab] = useState<'details' | 'milestones'>('details');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose}></div>
      
      <div className="relative bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] shadow-2xl overflow-hidden flex flex-col animate-fade-in">
        
        {/* Header */}
        <div className="bg-slate-50 border-b border-slate-100 p-6 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
             {profile.photo ? (
               <img src={profile.photo} alt="User" className="w-10 h-10 rounded-full object-cover border border-slate-200" />
             ) : (
               <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center font-bold text-lg">
                 {profile.age}
               </div>
             )}
             <div>
               <h2 className="text-xl font-bold text-slate-900">My Profile</h2>
               <div className="text-xs text-slate-500 font-medium">Manage your biometrics and progress</div>
             </div>
          </div>
          <button 
             onClick={onClose}
             className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-400 hover:text-slate-600"
          >
             <X size={24} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-100 px-6 gap-6">
           <button 
             onClick={() => setActiveTab('details')}
             className={`py-3 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'details' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
           >
             <Settings size={16} /> Edit Details
           </button>
           <button 
             onClick={() => setActiveTab('milestones')}
             className={`py-3 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'milestones' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
           >
             <TrendingUp size={16} /> Milestones
           </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto p-6 custom-scrollbar">
           {activeTab === 'details' ? (
             <ProfileForm 
               initialData={profile} 
               onSubmit={(data) => { onUpdateProfile(data); onClose(); }} 
               isLoading={false}
               isEditing={true}
             />
           ) : (
             <MilestoneTracker 
               milestones={milestones}
               currentWeight={profile.weightKg}
               onAddMilestone={onAddMilestone}
               onDeleteMilestone={onDeleteMilestone}
             />
           )}
        </div>

      </div>
    </div>
  );
};

export default UserProfileModal;