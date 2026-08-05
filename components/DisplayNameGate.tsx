import React, { useState } from 'react';
import { Leaf, Loader2 } from 'lucide-react';

interface DisplayNameGateProps {
  onLogout: () => Promise<void>;
  onSave: (name: string) => Promise<void>;
}

const DisplayNameGate: React.FC<DisplayNameGateProps> = ({ onLogout, onSave }) => {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const trimmedName = name.trim();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!trimmedName || isSaving) return;

    setIsSaving(true);
    setError(null);
    try {
      await onSave(trimmedName);
    } catch {
      setError('Could not save your Display Name. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const logout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    setError(null);
    try {
      await onLogout();
    } catch {
      setError('Could not log out. Please try again.');
      setIsLoggingOut(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl">
        <div className="mb-6 flex items-center gap-3">
          <span className="rounded-xl bg-emerald-600 p-2 text-white">
            <Leaf size={22} />
          </span>
          <h1 className="text-2xl font-black text-slate-950">
            Choose your Display Name
          </h1>
        </div>

        <p className="mb-6 text-sm leading-relaxed text-slate-600">
          Add the name you want NeuroNutrition to use before loading your account.
        </p>

        <form onSubmit={submit} className="space-y-4">
          <label className="block text-sm font-semibold text-slate-700">
            Display Name
            <input
              autoComplete="name"
              autoFocus
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
            />
          </label>

          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

          <button
            type="submit"
            disabled={!trimmedName || isSaving || isLoggingOut}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving && <Loader2 className="animate-spin" size={17} />}
            {isSaving ? 'Saving…' : 'Save'}
          </button>
        </form>

        <button
          type="button"
          disabled={isSaving || isLoggingOut}
          onClick={() => void logout()}
          className="mt-4 w-full rounded-xl px-5 py-3 text-sm font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-60"
        >
          {isLoggingOut ? 'Logging out…' : 'Log Out'}
        </button>
      </div>
    </main>
  );
};

export default DisplayNameGate;
