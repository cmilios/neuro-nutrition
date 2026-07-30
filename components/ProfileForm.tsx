import React, { useState, useEffect } from 'react';
import { UserProfile, Gender, ActivityLevel, Goal, DietType } from '../types';
import { ChevronRight, Activity, Ruler, Weight, User as UserIcon, Camera, Save, Heart, Loader2, RefreshCw, Target } from 'lucide-react';
import { healthService } from '../services/healthService';

interface ProfileFormProps {
  initialData?: UserProfile | null;
  onSubmit: (profile: UserProfile) => void | Promise<void>;
  isLoading: boolean;
  isEditing?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onPlanRelevantDirtyChange?: (dirty: boolean) => void;
}

const defaultHealthProfile: UserProfile = {
  age: 30,
  gender: Gender.Male,
  heightCm: 175,
  weightKg: 75,
  targetWeightKg: 70,
  activityLevel: ActivityLevel.ModeratelyActive,
  goal: Goal.LoseWeight,
  dietType: DietType.Standard,
  allergies: '',
  photo: '',
};

const planRelevantFields: Array<keyof UserProfile> = [
  'age',
  'gender',
  'heightCm',
  'weightKg',
  'targetWeightKg',
  'activityLevel',
  'goal',
  'dietType',
  'allergies',
];

const ProfileForm: React.FC<ProfileFormProps> = ({
  initialData,
  onSubmit,
  isLoading,
  isEditing = false,
  onDirtyChange,
  onPlanRelevantDirtyChange,
}) => {
  const [formData, setFormData] = useState<UserProfile>(defaultHealthProfile);

  const [isSyncingHealth, setIsSyncingHealth] = useState(false);

  useEffect(() => {
    if (initialData) {
      setFormData(initialData);
    }
  }, [initialData]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => {
      const baseline = initialData ?? defaultHealthProfile;
      const next = {
        ...prev,
        [name]: (name === 'age' || name === 'heightCm' || name === 'weightKg' || name === 'targetWeightKg') ? Number(value) : value
      };
      onDirtyChange?.(JSON.stringify(next) !== JSON.stringify(baseline));
      onPlanRelevantDirtyChange?.(
        planRelevantFields.some((field) => next[field] !== baseline[field]),
      );
      return next;
    });
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData(prev => {
          const next = { ...prev, photo: reader.result as string };
          onDirtyChange?.(
            JSON.stringify(next) !== JSON.stringify(initialData ?? defaultHealthProfile),
          );
          return next;
        });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleHealthSync = async () => {
    setIsSyncingHealth(true);
    try {
      const healthData = await healthService.syncAppleHealth();
      
      setFormData(prev => {
        const next = { ...prev, ...healthData };
        onDirtyChange?.(
          JSON.stringify(next) !== JSON.stringify(initialData ?? defaultHealthProfile),
        );
        return next;
      });
    } catch (error) {
      console.error("Failed to sync health data", error);
    } finally {
      setIsSyncingHealth(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void onSubmit(formData);
  };

  return (
    <div className="max-w-2xl mx-auto">
      {!isEditing && (
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold text-slate-900 mb-4">Let's build your plan.</h1>
          <p className="text-lg text-slate-600">
            Enter your biometrics below. Our AI nutritionist will calculate your TDEE and create a personalized weekly plan.
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className={`${!isEditing ? 'bg-white shadow-xl shadow-slate-200/50 border border-slate-200 rounded-2xl' : ''} overflow-hidden`}>
        <div className={`space-y-8 ${!isEditing ? 'p-8' : ''}`}>
          
          {/* Health Sync Integration */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="bg-white p-2.5 rounded-xl border border-slate-100 text-rose-500 shadow-sm">
                 <Heart size={24} fill="currentColor" />
              </div>
              <div>
                 <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                   Apple Health
                   <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-600 text-[10px] font-bold uppercase tracking-wider">Beta</span>
                 </h3>
                 <p className="text-xs text-slate-500">Sync weight, height, and age automatically</p>
              </div>
            </div>
            <button 
               type="button"
               onClick={handleHealthSync}
               disabled={isSyncingHealth}
               className={`
                 px-4 py-2 text-sm font-semibold rounded-lg shadow-sm flex items-center gap-2 transition-all
                 ${isSyncingHealth 
                    ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed' 
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200'}
               `}
            >
               {isSyncingHealth ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} 
               {isSyncingHealth ? 'Syncing...' : 'Sync Data'}
            </button>
          </div>

          {/* Section 1: Identity & Photo */}
          <div>
            <h2 className="text-sm font-semibold text-emerald-600 uppercase tracking-wide mb-4 flex items-center gap-2">
              <UserIcon size={16} /> Identity
            </h2>
            
            <div className="flex flex-col sm:flex-row gap-6 items-start">
               {/* Photo Uploader */}
               <div className="shrink-0 group relative">
                 <div className="w-24 h-24 rounded-full bg-slate-100 border-2 border-slate-200 flex items-center justify-center overflow-hidden">
                   {formData.photo ? (
                     <img src={formData.photo} alt="Profile" className="w-full h-full object-cover" />
                   ) : (
                     <UserIcon className="text-slate-300" size={40} />
                   )}
                 </div>
                 <label className="absolute bottom-0 right-0 bg-emerald-600 text-white p-1.5 rounded-full cursor-pointer hover:bg-emerald-700 transition-colors shadow-sm">
                   <Camera size={14} />
                   <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
                 </label>
               </div>

               <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Age</label>
                    <input
                      type="number"
                      name="age"
                      value={formData.age}
                      onChange={handleChange}
                      className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
                      required
                      min={10}
                      max={100}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Gender</label>
                    <select
                      name="gender"
                      value={formData.gender}
                      onChange={handleChange}
                      className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all bg-white"
                    >
                      {Object.values(Gender).map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </div>
               </div>
            </div>
          </div>

          {/* Section 2: Body Metrics */}
          <div>
            <h2 className="text-sm font-semibold text-emerald-600 uppercase tracking-wide mb-4 flex items-center gap-2">
              <Ruler size={16} /> Body Metrics
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Height (cm)</label>
                <div className="relative">
                  <input
                    type="number"
                    name="heightCm"
                    value={formData.heightCm}
                    onChange={handleChange}
                    className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all pl-10"
                    required
                  />
                  <Ruler className="absolute left-3 top-3.5 text-slate-400" size={18} />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Weight (kg)</label>
                <div className="relative">
                  <input
                    type="number"
                    name="weightKg"
                    value={formData.weightKg}
                    onChange={handleChange}
                    className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all pl-10"
                    required
                  />
                  <Weight className="absolute left-3 top-3.5 text-slate-400" size={18} />
                </div>
              </div>
              
               <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Target Weight (kg)</label>
                <div className="relative">
                  <input
                    type="number"
                    name="targetWeightKg"
                    value={formData.targetWeightKg || ''}
                    onChange={handleChange}
                    placeholder="Optional"
                    className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all pl-10"
                  />
                  <Target className="absolute left-3 top-3.5 text-slate-400" size={18} />
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Lifestyle & Goals */}
          <div>
            <h2 className="text-sm font-semibold text-emerald-600 uppercase tracking-wide mb-4 flex items-center gap-2">
              <Activity size={16} /> Lifestyle & Goals
            </h2>
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Activity Level</label>
                <select
                  name="activityLevel"
                  value={formData.activityLevel}
                  onChange={handleChange}
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all bg-white"
                >
                  {Object.values(ActivityLevel).map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Goal</label>
                  <select
                    name="goal"
                    value={formData.goal}
                    onChange={handleChange}
                    className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all bg-white"
                  >
                    {Object.values(Goal).map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Diet Preference</label>
                  <select
                    name="dietType"
                    value={formData.dietType}
                    onChange={handleChange}
                    className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all bg-white"
                  >
                    {Object.values(DietType).map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>

               <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Allergies or Dislikes (Optional)</label>
                <input
                  type="text"
                  name="allergies"
                  value={formData.allergies || ''}
                  onChange={handleChange}
                  placeholder="e.g. Peanuts, Shellfish, I hate broccoli"
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
                />
              </div>
            </div>
          </div>
        </div>

        <div className={`${!isEditing ? 'bg-slate-50 p-6 border-t border-slate-100' : 'pt-6'} flex justify-end`}>
          <button
            type="submit"
            disabled={isLoading}
            className={`
              flex items-center gap-2 px-8 py-3 rounded-xl font-semibold text-lg text-white transition-all w-full sm:w-auto justify-center
              ${isLoading ? 'bg-slate-400 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700 shadow-lg hover:shadow-emerald-500/30 hover:-translate-y-0.5'}
            `}
          >
            {isLoading ? (isEditing ? 'Saving...' : 'Optimizing Plan...') : (isEditing ? 'Save Changes' : 'Generate Meal Plan')}
            {!isLoading && (isEditing ? <Save size={20} /> : <ChevronRight size={20} />)}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ProfileForm;
