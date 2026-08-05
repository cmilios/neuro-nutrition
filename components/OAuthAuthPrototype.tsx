/**
 * ============================================================================
 * THROWAWAY PROTOTYPE — ticket #46 "Prototype OAuth entry, Display Name
 * onboarding, and Account Security". NOT production code.
 *
 * Question it answers: what should the responsive auth experience look and
 * behave like once Google + Apple sit alongside email/password?
 *
 * How to view: run the dev server (npm run dev) and open
 *   /neuro-nutrition/?prototype=oauth-auth
 * Cycle the three auth-entry variants with the floating bottom bar or ← / →.
 * Use the "Demo controls" panel to flip provider availability, simulate the
 * redirect/loading state, and jump between the three surfaces.
 *
 * Everything here is in-memory and stubbed — no Supabase, no persistence,
 * no error handling beyond what makes it runnable. Delete this file and the
 * gate in App.tsx once a direction is chosen. See branch prototype/oauth-auth-46.
 * ============================================================================
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Leaf,
  Mail,
  Lock,
  User as UserIcon,
  ArrowRight,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Check,
  X,
  KeyRound,
} from 'lucide-react';

/* ------------------------------------------------------------------ stubs */

type Provider = 'google' | 'apple';
type Surface = 'auth' | 'displayName' | 'security';
type VariantKey = 'A' | 'B' | 'C';

const VARIANT_NAMES: Record<VariantKey, string> = {
  A: 'Providers first',
  B: 'Email-first, express providers',
  C: 'Method chooser',
};
const VARIANT_ORDER: VariantKey[] = ['A', 'B', 'C'];

// Brand marks (lucide has no brand glyphs). Kept tiny and inline.
const GoogleMark = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.2 17.7 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
    <path fill="#FBBC05" d="M10.4 28.7c-.5-1.4-.8-2.9-.8-4.5s.3-3.1.8-4.5l-7.8-6.1C1 16.8 0 20.3 0 24s1 7.2 2.6 10.4l7.8-5.7z" />
    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.7-3.7-13.6-9.8l-7.8 5.7C6.5 42.6 14.6 48 24 48z" />
  </svg>
);

const AppleMark = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M16.365 1.43c0 1.14-.417 2.2-1.11 3.02-.79.94-2.09 1.67-3.28 1.57-.14-1.13.44-2.28 1.13-3.04.78-.87 2.16-1.5 3.26-1.55zM20.5 17.02c-.6 1.38-.89 1.99-1.66 3.21-1.07 1.68-2.58 3.78-4.46 3.79-1.67.02-2.1-1.09-4.37-1.08-2.27.01-2.74 1.1-4.41 1.08-1.88-.02-3.31-1.9-4.38-3.58C-.62 17.5-.9 12.1 1.32 9.16c1.05-1.42 2.7-2.32 4.24-2.32 1.57 0 2.55 1.09 4.28 1.09 1.68 0 2.7-1.09 4.28-1.09 1.38 0 2.85.75 3.9 2.05-3.42 1.88-2.86 6.77 2.48 8.13z" />
  </svg>
);

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------- shared UI pieces */

interface ProviderButtonProps {
  provider: Provider;
  label: string;
  loading: boolean;
  disabled: boolean;
  variant?: 'full' | 'compact';
  onClick: () => void;
}

const ProviderButton: React.FC<ProviderButtonProps> = ({
  provider,
  label,
  loading,
  disabled,
  variant = 'full',
  onClick,
}) => {
  const Mark = provider === 'google' ? GoogleMark : AppleMark;
  if (variant === 'compact') {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || loading}
        aria-label={label}
        title={label}
        className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
      >
        {loading ? <Loader2 className="animate-spin" size={18} /> : <Mark size={20} />}
        <span className="text-sm font-semibold capitalize">{provider}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-300 bg-white py-3 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
    >
      {loading ? <Loader2 className="animate-spin" size={18} /> : <Mark size={18} />}
      {label}
    </button>
  );
};

const Divider: React.FC<{ text?: string }> = ({ text = 'or' }) => (
  <div className="flex items-center gap-3 py-1 text-xs font-medium uppercase tracking-wider text-slate-400">
    <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
    {text}
    <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
  </div>
);

const Field: React.FC<{
  icon: React.ReactNode;
  label: string;
  type: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}> = ({ icon, label, type, value, placeholder, onChange }) => (
  <div className="space-y-1.5">
    <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
      {label}
    </label>
    <div className="relative">
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-200 py-3 pl-10 pr-4 outline-none transition-all focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
      />
      <span className="absolute left-3 top-3.5 text-slate-400">{icon}</span>
    </div>
  </div>
);

const PrimaryButton: React.FC<{
  loading: boolean;
  children: React.ReactNode;
}> = ({ loading, children }) => (
  <button
    type="submit"
    disabled={loading}
    className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-3.5 font-bold text-white shadow-lg transition-all hover:-translate-y-0.5 hover:bg-slate-800 disabled:opacity-70 dark:bg-emerald-600 dark:hover:bg-emerald-500"
  >
    {loading ? <Loader2 className="animate-spin" size={20} /> : children}
  </button>
);

const Tabs: React.FC<{
  isLogin: boolean;
  onChange: (isLogin: boolean) => void;
}> = ({ isLogin, onChange }) => (
  <div className="mb-7 flex gap-4 border-b border-slate-100 dark:border-slate-700">
    {[true, false].map((login) => (
      <button
        key={String(login)}
        onClick={() => onChange(login)}
        className={`relative flex-1 pb-4 text-sm font-semibold transition-colors ${
          isLogin === login
            ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-slate-400 hover:text-slate-600'
        }`}
      >
        {login ? 'Log In' : 'Create Account'}
        {isLogin === login && (
          <div className="absolute bottom-0 left-0 h-0.5 w-full rounded-t-full bg-emerald-600 dark:bg-emerald-400" />
        )}
      </button>
    ))}
  </div>
);

const Shell: React.FC<{ children: React.ReactNode; wide?: boolean }> = ({
  children,
  wide,
}) => (
  <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
    <div className="mb-8 text-center">
      <div className="mb-4 inline-block rounded-xl bg-emerald-600 p-3 text-white shadow-lg shadow-emerald-600/20">
        <Leaf size={32} />
      </div>
      <h1 className="bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-3xl font-bold text-transparent">
        NeuroNutrition
      </h1>
      <p className="mt-2 text-slate-400">AI-Powered Meal Planning Architecture</p>
    </div>
    <div
      className={`w-full ${
        wide ? 'max-w-lg' : 'max-w-md'
      } rounded-2xl border border-slate-200 bg-white p-8 shadow-xl dark:border-slate-800 dark:bg-slate-900`}
    >
      {children}
    </div>
  </div>
);

/* ----------------------------------------------------- provider-aware hook */

interface AuthEntryProps {
  googleOn: boolean;
  appleOn: boolean;
  redirecting: Provider | null;
  onProvider: (p: Provider) => void;
}

/* ----------------------------------------------- Variant A — providers first */

const VariantA: React.FC<AuthEntryProps> = ({
  googleOn,
  appleOn,
  redirecting,
  onProvider,
}) => {
  const [isLogin, setIsLogin] = useState(true);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const anyProvider = googleOn || appleOn;
  return (
    <Shell>
      <Tabs isLogin={isLogin} onChange={setIsLogin} />

      {anyProvider && (
        <div className="mb-5 space-y-3">
          {googleOn && (
            <ProviderButton
              provider="google"
              label="Continue with Google"
              loading={redirecting === 'google'}
              disabled={redirecting !== null}
              onClick={() => onProvider('google')}
            />
          )}
          {appleOn && (
            <ProviderButton
              provider="apple"
              label="Continue with Apple"
              loading={redirecting === 'apple'}
              disabled={redirecting !== null}
              onClick={() => onProvider('apple')}
            />
          )}
        </div>
      )}

      {anyProvider && <Divider />}

      <form
        onSubmit={(e) => e.preventDefault()}
        className={`space-y-5 ${anyProvider ? 'mt-5' : ''}`}
      >
        {!isLogin && (
          <Field
            icon={<UserIcon size={18} />}
            label="Full Name"
            type="text"
            value={form.name}
            placeholder="John Doe"
            onChange={(v) => setForm({ ...form, name: v })}
          />
        )}
        <Field
          icon={<Mail size={18} />}
          label="Email Address"
          type="email"
          value={form.email}
          placeholder="you@example.com"
          onChange={(v) => setForm({ ...form, email: v })}
        />
        <Field
          icon={<Lock size={18} />}
          label="Password"
          type="password"
          value={form.password}
          placeholder="••••••••"
          onChange={(v) => setForm({ ...form, password: v })}
        />
        <PrimaryButton loading={false}>
          {isLogin ? 'Sign In' : 'Create Account'}
          <ArrowRight size={20} />
        </PrimaryButton>
      </form>
    </Shell>
  );
};

/* -------------------------------- Variant B — email-first, express providers */

const VariantB: React.FC<AuthEntryProps> = ({
  googleOn,
  appleOn,
  redirecting,
  onProvider,
}) => {
  const [isLogin, setIsLogin] = useState(true);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const anyProvider = googleOn || appleOn;
  return (
    <Shell>
      <Tabs isLogin={isLogin} onChange={setIsLogin} />

      <form onSubmit={(e) => e.preventDefault()} className="space-y-5">
        {!isLogin && (
          <Field
            icon={<UserIcon size={18} />}
            label="Full Name"
            type="text"
            value={form.name}
            placeholder="John Doe"
            onChange={(v) => setForm({ ...form, name: v })}
          />
        )}
        <Field
          icon={<Mail size={18} />}
          label="Email Address"
          type="email"
          value={form.email}
          placeholder="you@example.com"
          onChange={(v) => setForm({ ...form, email: v })}
        />
        <Field
          icon={<Lock size={18} />}
          label="Password"
          type="password"
          value={form.password}
          placeholder="••••••••"
          onChange={(v) => setForm({ ...form, password: v })}
        />
        <PrimaryButton loading={false}>
          {isLogin ? 'Sign In' : 'Create Account'}
          <ArrowRight size={20} />
        </PrimaryButton>
      </form>

      {anyProvider && (
        <div className="mt-7">
          <Divider text="Faster sign-in" />
          <div className="mt-4 flex gap-3">
            {googleOn && (
              <ProviderButton
                provider="google"
                label="Continue with Google"
                variant="compact"
                loading={redirecting === 'google'}
                disabled={redirecting !== null}
                onClick={() => onProvider('google')}
              />
            )}
            {appleOn && (
              <ProviderButton
                provider="apple"
                label="Continue with Apple"
                variant="compact"
                loading={redirecting === 'apple'}
                disabled={redirecting !== null}
                onClick={() => onProvider('apple')}
              />
            )}
          </div>
        </div>
      )}
    </Shell>
  );
};

/* --------------------------------------- Variant C — progressive method chooser */

const VariantC: React.FC<AuthEntryProps> = ({
  googleOn,
  appleOn,
  redirecting,
  onProvider,
}) => {
  const [isLogin, setIsLogin] = useState(true);
  const [emailOpen, setEmailOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });

  const MethodCard: React.FC<{
    icon: React.ReactNode;
    title: string;
    subtitle: string;
    onClick: () => void;
    active?: boolean;
    loading?: boolean;
  }> = ({ icon, title, subtitle, onClick, active, loading }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={redirecting !== null && !loading}
      className={`flex w-full items-center gap-4 rounded-xl border p-4 text-left transition disabled:opacity-60 ${
        active
          ? 'border-emerald-500 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-950/40'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700'
      }`}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-100">
        {loading ? <Loader2 className="animate-spin" size={20} /> : icon}
      </span>
      <span className="flex-1">
        <span className="block font-semibold text-slate-800 dark:text-slate-100">
          {title}
        </span>
        <span className="block text-xs text-slate-400">{subtitle}</span>
      </span>
      <ChevronRight size={18} className="text-slate-300" />
    </button>
  );

  return (
    <Shell wide>
      <div className="mb-6 text-center">
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">
          {isLogin ? 'Welcome back' : 'Create your account'}
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Choose how you'd like to continue
        </p>
        <div className="mt-4 inline-flex rounded-lg bg-slate-100 p-1 text-sm font-semibold dark:bg-slate-800">
          {[true, false].map((login) => (
            <button
              key={String(login)}
              onClick={() => {
                setIsLogin(login);
                setEmailOpen(false);
              }}
              className={`rounded-md px-4 py-1.5 transition ${
                isLogin === login
                  ? 'bg-white text-emerald-600 shadow-sm dark:bg-slate-900 dark:text-emerald-400'
                  : 'text-slate-500'
              }`}
            >
              {login ? 'Log In' : 'Sign Up'}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {googleOn && (
          <MethodCard
            icon={<GoogleMark size={20} />}
            title="Continue with Google"
            subtitle="Use your Google account"
            loading={redirecting === 'google'}
            onClick={() => onProvider('google')}
          />
        )}
        {appleOn && (
          <MethodCard
            icon={<AppleMark size={20} />}
            title="Continue with Apple"
            subtitle="Use your Apple ID"
            loading={redirecting === 'apple'}
            onClick={() => onProvider('apple')}
          />
        )}
        <MethodCard
          icon={<Mail size={20} />}
          title="Continue with email"
          subtitle={isLogin ? 'Email and password' : 'Create with email and password'}
          active={emailOpen}
          onClick={() => setEmailOpen((v) => !v)}
        />

        {emailOpen && (
          <form
            onSubmit={(e) => e.preventDefault()}
            className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50"
          >
            {!isLogin && (
              <Field
                icon={<UserIcon size={18} />}
                label="Full Name"
                type="text"
                value={form.name}
                placeholder="John Doe"
                onChange={(v) => setForm({ ...form, name: v })}
              />
            )}
            <Field
              icon={<Mail size={18} />}
              label="Email Address"
              type="email"
              value={form.email}
              placeholder="you@example.com"
              onChange={(v) => setForm({ ...form, email: v })}
            />
            <Field
              icon={<Lock size={18} />}
              label="Password"
              type="password"
              value={form.password}
              placeholder="••••••••"
              onChange={(v) => setForm({ ...form, password: v })}
            />
            <PrimaryButton loading={false}>
              {isLogin ? 'Sign In' : 'Create Account'}
              <ArrowRight size={20} />
            </PrimaryButton>
          </form>
        )}
      </div>
    </Shell>
  );
};

/* ----------------------------------------- Redirect / loading full-screen state */

const RedirectingScreen: React.FC<{ provider: Provider }> = ({ provider }) => (
  <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-slate-50 p-4 dark:bg-slate-950">
    <div className="flex items-center gap-3">
      {provider === 'google' ? <GoogleMark size={28} /> : <AppleMark size={28} />}
      <Loader2 className="animate-spin text-slate-500" size={28} />
    </div>
    <p className="text-center text-slate-500 dark:text-slate-400">
      Redirecting you to {provider === 'google' ? 'Google' : 'Apple'} to sign in
      securely…
    </p>
    <p className="text-xs text-slate-400">
      You'll come right back to NeuroNutrition when you're done.
    </p>
  </div>
);

/* -------------------------------------------- Display Name onboarding (shared) */

const DisplayNameOnboarding: React.FC<{
  provider: Provider;
  onDone: () => void;
}> = ({ provider, onDone }) => {
  const [name, setName] = useState('');
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 inline-flex rounded-xl bg-emerald-100 p-2.5 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
          <UserIcon size={22} />
        </div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
          What should we call you?
        </h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          You signed in with {provider === 'google' ? 'Google' : 'Apple'}, but we
          didn't get a name. Add a Display Name to personalize your plans.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onDone();
          }}
          className="mt-6 space-y-5"
        >
          <Field
            icon={<UserIcon size={18} />}
            label="Display Name"
            type="text"
            value={name}
            placeholder="e.g. Alex"
            onChange={setName}
          />
          <PrimaryButton loading={false}>
            Continue
            <ArrowRight size={20} />
          </PrimaryButton>
        </form>
        <p className="mt-4 text-center text-xs text-slate-400">
          Required once — you won't be asked again.
        </p>
      </div>
    </div>
  );
};

/* ---------------------------------------------- Account Security (shared) panel */

const AccountSecurityPanel: React.FC<{
  googleOn: boolean;
  appleOn: boolean;
}> = ({ googleOn, appleOn }) => {
  // Prototype fixture: an OAuth-only user (Google connected, no password set).
  const [connections, setConnections] = useState<Record<Provider, boolean>>({
    google: true,
    apple: false,
  });
  const hasPassword = false; // OAuth-only user
  const connectedCount =
    (connections.google ? 1 : 0) + (connections.apple ? 1 : 0);

  const Row: React.FC<{
    provider: Provider;
    available: boolean;
  }> = ({ provider, available }) => {
    const connected = connections[provider];
    const Mark = provider === 'google' ? GoogleMark : AppleMark;
    if (!available && !connected) return null; // provider hidden until configured
    return (
      <div className="flex items-center justify-between rounded-xl border border-slate-200 p-4 dark:border-slate-700">
        <div className="flex items-center gap-3">
          <Mark size={22} />
          <div>
            <p className="font-semibold capitalize text-slate-800 dark:text-slate-100">
              {provider}
            </p>
            <p className="text-xs text-slate-400">
              {connected ? 'Connected' : 'Not connected'}
            </p>
          </div>
        </div>
        {connected ? (
          <button
            onClick={() =>
              setConnections((c) => ({ ...c, [provider]: false }))
            }
            disabled={connectedCount === 1 && !hasPassword}
            title={
              connectedCount === 1 && !hasPassword
                ? 'Set a password before disconnecting your only sign-in method'
                : undefined
            }
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-300"
          >
            <X size={15} /> Disconnect
          </button>
        ) : (
          <button
            onClick={() =>
              setConnections((c) => ({ ...c, [provider]: true }))
            }
            className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white dark:bg-emerald-600"
          >
            <Check size={15} /> Connect
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="flex min-h-screen items-start justify-center bg-slate-50 p-4 pt-16 dark:bg-slate-950">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-6 flex items-center gap-3">
          <ShieldCheck className="text-emerald-600" size={24} />
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            Account Security
          </h2>
        </div>

        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Connected sign-in methods
        </h3>
        <div className="space-y-3">
          <Row provider="google" available={googleOn} />
          <Row provider="apple" available={appleOn} />
        </div>

        {/* OAuth-only password guidance */}
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/30">
          <div className="flex items-start gap-3">
            <KeyRound className="mt-0.5 text-amber-600 dark:text-amber-400" size={20} />
            <div>
              <p className="font-semibold text-amber-900 dark:text-amber-200">
                {hasPassword ? 'Password set' : 'No password set'}
              </p>
              <p className="mt-1 text-sm text-amber-800 dark:text-amber-300/90">
                {hasPassword
                  ? 'You can sign in with your email and password.'
                  : "You sign in with Google or Apple only. Add a password so you can still sign in if a provider is unavailable — we won't ask for a current password."}
              </p>
              {!hasPassword && (
                <button className="mt-3 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700">
                  Set a password
                </button>
              )}
            </div>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          Prototype fixture: OAuth-only account (Google connected, no password).
        </p>
      </div>
    </div>
  );
};

/* ---------------------------------------------------- floating switcher bar */

const SwitcherBar: React.FC<{
  current: VariantKey;
  onCycle: (dir: 1 | -1) => void;
}> = ({ current, onCycle }) => (
  <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-slate-900 px-2 py-1.5 text-white shadow-2xl ring-1 ring-white/10">
    <button
      onClick={() => onCycle(-1)}
      className="rounded-full p-2 hover:bg-white/10"
      aria-label="Previous variant"
    >
      <ChevronLeft size={18} />
    </button>
    <span className="min-w-[15rem] text-center text-sm font-semibold">
      {current} — {VARIANT_NAMES[current]}
    </span>
    <button
      onClick={() => onCycle(1)}
      className="rounded-full p-2 hover:bg-white/10"
      aria-label="Next variant"
    >
      <ChevronRight size={18} />
    </button>
  </div>
);

/* ----------------------------------------------------------- demo controls */

const DemoControls: React.FC<{
  surface: Surface;
  setSurface: (s: Surface) => void;
  googleOn: boolean;
  appleOn: boolean;
  setGoogleOn: (v: boolean) => void;
  setAppleOn: (v: boolean) => void;
}> = ({ surface, setSurface, googleOn, appleOn, setGoogleOn, setAppleOn }) => {
  const Toggle: React.FC<{
    label: string;
    on: boolean;
    onChange: (v: boolean) => void;
  }> = ({ label, on, onChange }) => (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="text-slate-600 dark:text-slate-300">{label}</span>
      <button
        onClick={() => onChange(!on)}
        className={`h-5 w-9 rounded-full p-0.5 transition ${
          on ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
        }`}
      >
        <span
          className={`block h-4 w-4 rounded-full bg-white transition ${
            on ? 'translate-x-4' : ''
          }`}
        />
      </button>
    </label>
  );

  return (
    <div className="fixed left-4 top-4 z-50 w-56 rounded-xl border border-slate-200 bg-white/95 p-4 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
      <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">
        Demo controls
      </p>
      <div className="mb-3">
        <p className="mb-1.5 text-xs font-semibold text-slate-500">Surface</p>
        <div className="grid grid-cols-1 gap-1">
          {(
            [
              ['auth', 'Auth entry'],
              ['displayName', 'Display Name'],
              ['security', 'Account Security'],
            ] as [Surface, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSurface(key)}
              className={`rounded-lg px-3 py-1.5 text-left text-sm transition ${
                surface === key
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
        <p className="mb-1 text-xs font-semibold text-slate-500">
          Provider availability
        </p>
        <Toggle label="Google" on={googleOn} onChange={setGoogleOn} />
        <Toggle label="Apple" on={appleOn} onChange={setAppleOn} />
      </div>
      <p className="mt-3 text-[11px] leading-snug text-slate-400">
        Turn a provider off to see it disappear from every surface — each is
        gated independently. Click a provider button to see the redirect state
        and the missing-name prompt.
      </p>
    </div>
  );
};

/* ------------------------------------------------------------- entry point */

const OAuthAuthPrototype: React.FC = () => {
  const params = new URLSearchParams(window.location.search);
  const initialVariant = (params.get('variant') as VariantKey) || 'A';
  const [variant, setVariant] = useState<VariantKey>(
    VARIANT_ORDER.includes(initialVariant) ? initialVariant : 'A',
  );
  const [surface, setSurface] = useState<Surface>('auth');
  const [googleOn, setGoogleOn] = useState(true);
  const [appleOn, setAppleOn] = useState(true);
  const [redirecting, setRedirecting] = useState<Provider | null>(null);
  const [showNamePrompt, setShowNamePrompt] = useState<Provider | null>(null);

  const cycle = (dir: 1 | -1) => {
    const idx = VARIANT_ORDER.indexOf(variant);
    const next =
      VARIANT_ORDER[(idx + dir + VARIANT_ORDER.length) % VARIANT_ORDER.length];
    setVariant(next);
    const url = new URL(window.location.href);
    url.searchParams.set('variant', next);
    window.history.replaceState({}, '', url);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          (el as HTMLElement).isContentEditable)
      )
        return;
      if (e.key === 'ArrowLeft') cycle(-1);
      if (e.key === 'ArrowRight') cycle(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Simulate the OAuth redirect round-trip, then land on the missing-name
  // prompt (the interesting onboarding case).
  const onProvider = async (p: Provider) => {
    setRedirecting(p);
    await wait(1400);
    setRedirecting(null);
    setShowNamePrompt(p);
  };

  const entryProps: AuthEntryProps = {
    googleOn,
    appleOn,
    redirecting,
    onProvider,
  };

  const body = useMemo(() => {
    if (redirecting) return <RedirectingScreen provider={redirecting} />;
    if (surface === 'security')
      return <AccountSecurityPanel googleOn={googleOn} appleOn={appleOn} />;
    if (surface === 'displayName')
      return (
        <div className="relative min-h-screen bg-slate-50 dark:bg-slate-950">
          <DisplayNameOnboarding provider="google" onDone={() => {}} />
        </div>
      );
    if (variant === 'A') return <VariantA {...entryProps} />;
    if (variant === 'B') return <VariantB {...entryProps} />;
    return <VariantC {...entryProps} />;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redirecting, surface, variant, googleOn, appleOn]);

  return (
    <>
      {body}
      {showNamePrompt && surface === 'auth' && (
        <DisplayNameOnboarding
          provider={showNamePrompt}
          onDone={() => setShowNamePrompt(null)}
        />
      )}
      <DemoControls
        surface={surface}
        setSurface={setSurface}
        googleOn={googleOn}
        appleOn={appleOn}
        setGoogleOn={setGoogleOn}
        setAppleOn={setAppleOn}
      />
      {surface === 'auth' && !redirecting && (
        <SwitcherBar current={variant} onCycle={cycle} />
      )}
    </>
  );
};

export default OAuthAuthPrototype;
