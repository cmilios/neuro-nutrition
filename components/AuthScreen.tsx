import React, { useState } from 'react';
import { User } from '../types';
import { authService } from '../services/authService';
import { Leaf, Mail, Lock, User as UserIcon, ArrowRight, Loader2 } from 'lucide-react';

interface AuthScreenProps {
  onSuccess: (user: User) => void;
}

const AuthScreen: React.FC<AuthScreenProps> = ({ onSuccess }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setIsLoading(true);

    try {
      if (isLogin) {
        const user = await authService.login(formData.email, formData.password);
        onSuccess(user);
      } else {
        if (!formData.name) throw new Error("Name is required");
        const { user, needsEmailConfirmation } = await authService.register(
          formData.email,
          formData.password,
          formData.name,
        );
        if (needsEmailConfirmation) {
          // No session yet — don't log them in; prompt them to confirm first.
          setInfo(`Almost there! We've sent a confirmation link to ${formData.email}. Please confirm your email, then log in.`);
          setIsLogin(true);
          setFormData({ ...formData, password: '' });
        } else {
          onSuccess(user);
        }
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Authentication failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4">
      <div className="mb-8 text-center animate-fade-in">
        <div className="bg-emerald-600 p-3 rounded-xl text-white inline-block mb-4 shadow-lg shadow-emerald-600/20">
          <Leaf size={32} />
        </div>
        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-emerald-600 to-teal-500">
          NeuroNutrition
        </h1>
        <p className="text-slate-400 mt-2">AI-Powered Meal Planning Architecture</p>
      </div>

      <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md border border-slate-100 animate-fade-in delay-100">
        <div className="flex gap-4 mb-8 border-b border-slate-100">
          <button
            onClick={() => { setIsLogin(true); setError(''); setInfo(''); }}
            className={`flex-1 pb-4 text-sm font-semibold transition-colors relative ${isLogin ? 'text-emerald-600' : 'text-slate-400 hover:text-slate-600'
              }`}
          >
            Log In
            {isLogin && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-emerald-600 rounded-t-full" />}
          </button>
          <button
            onClick={() => { setIsLogin(false); setError(''); setInfo(''); }}
            className={`flex-1 pb-4 text-sm font-semibold transition-colors relative ${!isLogin ? 'text-emerald-600' : 'text-slate-400 hover:text-slate-600'
              }`}
          >
            Create Account
            {!isLogin && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-emerald-600 rounded-t-full" />}
          </button>
        </div>

        {error && (
          <div className="mb-6 p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100 font-medium">
            {error}
          </div>
        )}

        {info && (
          <div className="mb-6 p-3 bg-emerald-50 text-emerald-700 text-sm rounded-lg border border-emerald-100 font-medium">
            {info}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {!isLogin && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Full Name</label>
              <div className="relative">
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
                  placeholder="John Doe"
                />
                <UserIcon className="absolute left-3 top-3.5 text-slate-400" size={18} />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Email Address</label>
            <div className="relative">
              <input
                type="email"
                required
                value={formData.email}
                onChange={e => setFormData({ ...formData, email: e.target.value })}
                className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
                placeholder="you@example.com"
              />
              <Mail className="absolute left-3 top-3.5 text-slate-400" size={18} />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Password</label>
            <div className="relative">
              <input
                type="password"
                required
                value={formData.password}
                onChange={e => setFormData({ ...formData, password: e.target.value })}
                className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
                placeholder="••••••••"
              />
              <Lock className="absolute left-3 top-3.5 text-slate-400" size={18} />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-3.5 rounded-xl transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <Loader2 className="animate-spin" size={20} />
                {isLogin ? 'Logging in...' : 'Creating Account...'}
              </>
            ) : (
              <>
                {isLogin ? 'Sign In' : 'Create Account'}
                <ArrowRight size={20} />
              </>
            )}
          </button>
        </form>
      </div>

      <p className="mt-8 text-center text-xs text-slate-400">
        Secure authentication & cloud sync powered by Supabase.
      </p>
    </div>
  );
};

export default AuthScreen;