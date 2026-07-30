import React, { useState } from 'react';
import { KeyRound, Leaf } from 'lucide-react';
import {
  passwordPolicyMessage,
  satisfiesPasswordPolicy,
} from '../services/passwordPolicy';
import { APPLICATION_BASE_PATH } from '../services/applicationRoutes';

interface PasswordRecoveryScreenProps {
  onComplete: (newPassword: string) => Promise<void>;
}

const PasswordRecoveryScreen: React.FC<PasswordRecoveryScreenProps> = ({
  onComplete,
}) => {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [complete, setComplete] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!satisfiesPasswordPolicy(password)) {
      setError(passwordPolicyMessage);
      return;
    }
    if (password !== confirmation) {
      setError('Passwords do not match.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onComplete(password);
      setPassword('');
      setConfirmation('');
      setComplete(true);
    } catch (recoveryError) {
      setPassword('');
      setConfirmation('');
      setError(recoveryError instanceof Error ? recoveryError.message : 'Password recovery failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl">
        <div className="mb-6 flex items-center gap-3">
          <span className="rounded-xl bg-emerald-600 p-2 text-white"><Leaf size={22} /></span>
          <h1 className="text-2xl font-black text-slate-950">Recover password</h1>
        </div>
        {complete ? (
          <div role="status">
            <p className="font-bold text-emerald-700">Your password has been updated.</p>
            <a href={APPLICATION_BASE_PATH} className="mt-4 inline-block text-sm font-bold text-emerald-700 underline">Return to NeuroNutrition</a>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <label className="block text-sm font-semibold text-slate-700">
              New password
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3"
              />
            </label>
            <label className="block text-sm font-semibold text-slate-700">
              Confirm new password
              <input
                type="password"
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3"
              />
            </label>
            <p className="text-xs text-slate-500">{passwordPolicyMessage}</p>
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <button type="submit" disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 font-bold text-white disabled:opacity-60">
              <KeyRound size={17} /> {saving ? 'Updating…' : 'Update password'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
};

export default PasswordRecoveryScreen;
