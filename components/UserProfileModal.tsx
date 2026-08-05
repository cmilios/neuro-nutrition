import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  LogOut,
  Monitor,
  Moon,
  Palette,
  RotateCcw,
  ShieldCheck,
  Sun,
  UserRound,
  X,
} from 'lucide-react';
import type { Milestone, UserProfile } from '../types';
import {
  passwordPolicyMessage,
  satisfiesPasswordPolicy,
} from '../services/passwordPolicy';
import MilestoneTracker from './MilestoneTracker';
import ProfileForm from './ProfileForm';
import {
  getThemePreference,
  setThemePreference,
  type ThemePreference,
} from '../services/theme';
import type { ConnectedSignInMethod } from '../services/authService';
import {
  getProviderMode,
  type OAuthProvider,
} from '../services/oauthProviderFlagsService';

type AccountSection = 'health' | 'appearance' | 'security' | 'start-over';

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfile | null;
  milestones: Milestone[];
  email: string;
  name: string;
  hasCurrentPlan: boolean;
  planMutationsDisabled: boolean;
  onUpdateProfile: (profile: UserProfile, replacePlan: boolean) => Promise<void>;
  onAddMilestone: (weight: number, note: string, bodyFat?: number) => void;
  onDeleteMilestone: (id: string) => void;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  onSetPassword: (newPassword: string) => Promise<ConnectedSignInMethod[]>;
  onGetConnectedSignInMethods: () => Promise<ConnectedSignInMethod[]>;
  onDisconnectSignInMethod: (identityId: string) => Promise<void>;
  onSendRecovery: () => Promise<void>;
  onStartOver: () => Promise<void>;
  onLogout: () => Promise<void>;
}

const sections: Array<{
  id: AccountSection;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
}> = [
  { id: 'health', label: 'Health Profile', icon: UserRound },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'security', label: 'Security', icon: ShieldCheck },
  { id: 'start-over', label: 'Start Over', icon: RotateCcw },
];

const focusableSelector =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

const providerNames: Record<string, string> = {
  apple: 'Apple',
  email: 'Email/password',
  google: 'Google',
};

const getProviderName = (provider: string): string =>
  providerNames[provider]
  ?? provider.charAt(0).toUpperCase() + provider.slice(1);

const isOAuthProvider = (provider: string): provider is OAuthProvider =>
  provider === 'google' || provider === 'apple';

const UserProfileModal: React.FC<UserProfileModalProps> = ({
  isOpen,
  onClose,
  profile,
  milestones,
  email,
  name,
  hasCurrentPlan,
  planMutationsDisabled,
  onUpdateProfile,
  onAddMilestone,
  onDeleteMilestone,
  onChangePassword,
  onSetPassword,
  onGetConnectedSignInMethods,
  onDisconnectSignInMethod,
  onSendRecovery,
  onStartOver,
  onLogout,
}) => {
  const [activeSection, setActiveSection] = useState<AccountSection>('health');
  const [healthSubview, setHealthSubview] = useState<'details' | 'milestones'>('details');
  const [healthDirty, setHealthDirty] = useState(false);
  const [planRelevantDirty, setPlanRelevantDirty] = useState(false);
  const [replacePlan, setReplacePlan] = useState(false);
  const [pendingExit, setPendingExit] = useState<(() => void) | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileStatus, setProfileStatus] = useState<{
    kind: 'success' | 'error';
    message: string;
  } | null>(null);
  const [replacementRetry, setReplacementRetry] = useState<UserProfile | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [securityErrors, setSecurityErrors] = useState<Record<string, string>>({});
  const [securityStatus, setSecurityStatus] = useState<{
    kind: 'success' | 'error';
    message: string;
  } | null>(null);
  const [securitySaving, setSecuritySaving] = useState(false);
  const [connectedMethods, setConnectedMethods] = useState<ConnectedSignInMethod[]>([]);
  const [connectedMethodsLoading, setConnectedMethodsLoading] = useState(false);
  const [connectedMethodsLoaded, setConnectedMethodsLoaded] = useState(false);
  const [connectedMethodsError, setConnectedMethodsError] = useState<string | null>(null);
  const [connectedMethodsReloadKey, setConnectedMethodsReloadKey] = useState(0);
  const [disconnectingIdentityId, setDisconnectingIdentityId] = useState<string | null>(null);
  const [recoverySending, setRecoverySending] = useState(false);
  const [startOverConfirming, setStartOverConfirming] = useState(false);
  const [startOverRunning, setStartOverRunning] = useState(false);
  const [startOverError, setStartOverError] = useState<string | null>(null);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemePreference>(getThemePreference);
  const dialogRef = useRef<HTMLDivElement>(null);
  const guardDialogRef = useRef<HTMLDivElement>(null);
  const firstTabRef = useRef<HTMLButtonElement>(null);
  const currentPasswordRef = useRef<HTMLInputElement>(null);
  const newPasswordRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const healthDirtyRef = useRef(false);
  const hasPasswordIdentity = connectedMethodsError !== null
    || connectedMethods.some((method) => method.provider === 'email');
  const unavailableOnlyMethod = connectedMethodsLoaded
    && connectedMethods.length === 1
    && isOAuthProvider(connectedMethods[0].provider)
    && getProviderMode(connectedMethods[0].provider) === 'off'
    ? connectedMethods[0]
    : null;

  const clearPasswordDraft = () => {
    setCurrentPassword('');
    setNewPassword('');
    setPasswordConfirmation('');
    setSecurityErrors({});
    setSecurityStatus(null);
  };

  const finishClose = () => {
    clearPasswordDraft();
    onClose();
  };

  const guardHealthExit = (action: () => void) => {
    if (healthDirtyRef.current) {
      setPendingExit(() => action);
      return;
    }
    action();
  };

  const requestClose = () => guardHealthExit(finishClose);

  const changeSection = (section: AccountSection) => {
    if (section === activeSection) return;
    guardHealthExit(() => {
      clearPasswordDraft();
      setActiveSection(section);
    });
  };

  useEffect(() => {
    if (!isOpen) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    setActiveSection('health');
    setHealthSubview('details');
    setHealthDirty(false);
    healthDirtyRef.current = false;
    setPlanRelevantDirty(false);
    setReplacePlan(false);
    setPendingExit(null);
    setProfileStatus(null);
    setStartOverConfirming(false);
    setStartOverError(null);
    setLogoutError(null);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => firstTabRef.current?.focus(), 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
        return;
      }
      const focusRoot = guardDialogRef.current ?? dialogRef.current;
      if (event.key !== 'Tab' || !focusRoot) return;
      const focusable = Array.from(
        focusRoot.querySelectorAll<HTMLElement>(focusableSelector),
      ) as HTMLElement[];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || activeSection !== 'security') return;
    let cancelled = false;
    setConnectedMethodsLoading(true);
    setConnectedMethodsLoaded(false);
    setConnectedMethodsError(null);
    void onGetConnectedSignInMethods()
      .then((methods) => {
        if (!cancelled) setConnectedMethods(methods);
      })
      .catch(() => {
        if (!cancelled) {
          setConnectedMethodsError('Connected sign-in methods could not be loaded. Please try again.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setConnectedMethodsLoading(false);
          setConnectedMethodsLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeSection, connectedMethodsReloadKey, isOpen, onGetConnectedSignInMethods]);

  if (!isOpen) return null;

  const handleTabKeyDown = (event: React.KeyboardEvent, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? sections.length - 1
        : (index + direction + sections.length) % sections.length;
    changeSection(sections[nextIndex].id);
    window.setTimeout(() => {
      dialogRef.current
        ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]
        ?.focus();
    }, 0);
  };

  const saveProfile = async (updatedProfile: UserProfile) => {
    setProfileSaving(true);
    setProfileStatus(null);
    try {
      await onUpdateProfile(updatedProfile, replacePlan && planRelevantDirty);
      setHealthDirty(false);
      healthDirtyRef.current = false;
      setPlanRelevantDirty(false);
      setReplacePlan(false);
      setReplacementRetry(null);
      setProfileStatus({
        kind: 'success',
        message: replacePlan
          ? 'Your Health Profile was saved and Weekly Plan replacement started.'
          : 'Health Profile saved.',
      });
    } catch (error) {
      setProfileStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Health Profile could not be saved.',
      });
      if (replacePlan && (error as { retryable?: boolean })?.retryable !== false) {
        setReplacementRetry(updatedProfile);
      }
    } finally {
      setProfileSaving(false);
    }
  };

  const submitPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    const errors: Record<string, string> = {};
    if (hasPasswordIdentity && !currentPassword) errors.current = 'Enter your current password.';
    if (hasPasswordIdentity && newPassword === currentPassword && newPassword) {
      errors.new = 'Choose a different password.';
    }
    if (!satisfiesPasswordPolicy(newPassword)) {
      errors.new = passwordPolicyMessage;
    }
    if (newPassword !== passwordConfirmation) errors.confirmation = 'Passwords do not match.';
    setSecurityErrors(errors);
    setSecurityStatus(null);
    if (Object.keys(errors).length) {
      window.setTimeout(() => {
        if (errors.current) currentPasswordRef.current?.focus();
        else if (errors.new) newPasswordRef.current?.focus();
        else confirmationRef.current?.focus();
      }, 0);
      return;
    }

    setSecuritySaving(true);
    try {
      if (hasPasswordIdentity) {
        await onChangePassword(currentPassword, newPassword);
      } else {
        setConnectedMethods(await onSetPassword(newPassword));
      }
      clearPasswordDraft();
      setSecurityStatus({
        kind: 'success',
        message: hasPasswordIdentity
          ? 'Password changed. Other sessions were signed out.'
          : 'Password set. Your session remains active.',
      });
    } catch (error) {
      const code = (error as { code?: string })?.code;
      clearPasswordDraft();
      if (code === 'invalid_credentials' || code === 'same_password') {
        setSecurityErrors({
          [code === 'invalid_credentials' ? 'current' : 'new']:
            code === 'invalid_credentials'
              ? 'Current password is incorrect.'
              : 'Choose a different password.',
        });
        window.setTimeout(() => {
          if (code === 'invalid_credentials') currentPasswordRef.current?.focus();
          else newPasswordRef.current?.focus();
        }, 0);
      } else {
        const messagesByCode: Record<string, string> = {
          session_not_found: 'Your session has expired. Log in again, then retry the password change.',
          refresh_token_not_found: 'Your session has expired. Log in again, then retry the password change.',
          refresh_token_already_used: 'Your session has expired. Log in again, then retry the password change.',
          reauthentication_needed: 'For your security, verify your identity again before changing your password.',
          reauthentication_not_valid: 'Identity verification expired or was not accepted. Verify again and retry.',
          mfa_verification_failed: 'Multi-factor verification is required. Complete verification, then retry.',
          mfa_challenge_expired: 'The multi-factor challenge expired. Start verification again, then retry.',
          insufficient_aal: 'Multi-factor verification is required before you can change your password.',
          user_sso_managed: 'Your password is managed by your organization. Use your single sign-on provider to change it.',
          unexpected_failure: 'The security service is temporarily unavailable. Please try again.',
          request_timeout: 'The security request timed out. Please try again.',
          over_request_rate_limit: 'Too many security requests were made. Wait a moment, then try again.',
        };
        setSecurityStatus({
          kind: 'error',
          message: messagesByCode[code ?? '']
            ?? 'Password could not be changed. Please try again or use password recovery.',
        });
      }
    } finally {
      setSecuritySaving(false);
    }
  };

  const disconnectMethod = async (method: ConnectedSignInMethod) => {
    if (connectedMethods.length === 1 && !hasPasswordIdentity) {
      setSecurityStatus({
        kind: 'error',
        message: 'Add a password or another sign-in method before disconnecting your only sign-in method.',
      });
      return;
    }

    setDisconnectingIdentityId(method.identityId);
    setSecurityStatus(null);
    try {
      await onDisconnectSignInMethod(method.identityId);
      setConnectedMethods(await onGetConnectedSignInMethods());
      setSecurityStatus({
        kind: 'success',
        message: `${getProviderName(method.provider)} disconnected.`,
      });
    } catch {
      setSecurityStatus({
        kind: 'error',
        message: 'The sign-in method could not be disconnected. Please try again.',
      });
    } finally {
      setDisconnectingIdentityId(null);
    }
  };

  const requestRecovery = async () => {
    clearPasswordDraft();
    setRecoverySending(true);
    try {
      await onSendRecovery();
      setSecurityStatus({
        kind: 'success',
        message: `Recovery email sent to ${email}. Your current session remains active.`,
      });
    } catch (error) {
      const code = (error as { code?: string })?.code;
      const messagesByCode: Record<string, string> = {
        over_email_send_rate_limit:
          'Too many recovery emails were requested. Wait a moment, then try again.',
        request_timeout:
          'The recovery request timed out. Please try again.',
        unexpected_failure:
          'The recovery service is temporarily unavailable. Please try again.',
      };
      setSecurityStatus({
        kind: 'error',
        message: messagesByCode[code ?? '']
          ?? 'Recovery email could not be sent. Please try again.',
      });
    } finally {
      setRecoverySending(false);
    }
  };

  const runStartOver = async () => {
    setStartOverRunning(true);
    setStartOverError(null);
    try {
      await onStartOver();
    } catch (error) {
      setStartOverError(error instanceof Error ? error.message : 'Could not start over. Please try again.');
      setStartOverRunning(false);
    }
  };

  const runLogout = () => {
    guardHealthExit(async () => {
      setLogoutError(null);
      try {
        await onLogout();
      } catch (error) {
        setLogoutError(error instanceof Error ? error.message : 'Could not log out. Please try again.');
      }
    });
  };

  const updateTheme = (preference: ThemePreference) => {
    setTheme(preference);
    setThemePreference(preference);
  };

  const themeOptions: Array<{
    value: ThemePreference;
    label: string;
    description: string;
    icon: React.ComponentType<{ size?: number }>;
  }> = [
    {
      value: 'system',
      label: 'System',
      description: 'Match this device',
      icon: Monitor,
    },
    {
      value: 'light',
      label: 'Light',
      description: 'Always use light mode',
      icon: Sun,
    },
    {
      value: 'dark',
      label: 'Dark',
      description: 'Always use dark mode',
      icon: Moon,
    },
  ];

  return (
    <div className="fixed inset-0 z-[100]">
      <button
        type="button"
        aria-label="Close Account"
        className="absolute inset-0 h-full w-full cursor-default bg-slate-950/65 backdrop-blur-sm"
        onClick={requestClose}
      />
      <div className="relative flex h-full items-center justify-center sm:p-4">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="account-title"
          className="relative flex h-full w-full max-w-5xl flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl sm:h-[min(760px,92vh)] sm:rounded-3xl md:flex-row"
        >
          <button type="button" onClick={requestClose} aria-label="Close Account" className="absolute right-4 top-4 z-10 rounded-full p-2 text-slate-500 hover:bg-slate-100">
            <X size={22} />
          </button>
          <aside className="flex shrink-0 flex-col border-b border-slate-200 bg-slate-50 md:w-72 md:border-b-0 md:border-r">
            <div className="flex items-center justify-between p-4 md:p-6">
              <div className="min-w-0">
                <h2 id="account-title" className="text-xl font-black text-slate-950">Account</h2>
                <p className="truncate text-sm font-semibold text-slate-700">{name || email}</p>
                <p className="truncate text-xs text-slate-500">{email}</p>
              </div>
            </div>
            <div
              role="tablist"
              aria-label="Account sections"
              className="flex gap-1 overflow-x-auto px-3 pb-3 md:block md:space-y-1 md:overflow-visible md:px-4"
            >
              {sections.map((section, index) => {
                const Icon = section.icon;
                const selected = section.id === activeSection;
                return (
                  <button
                    key={section.id}
                    ref={index === 0 ? firstTabRef : undefined}
                    type="button"
                    role="tab"
                    id={`account-tab-${section.id}`}
                    aria-selected={selected}
                    aria-controls={`account-panel-${section.id}`}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => changeSection(section.id)}
                    onKeyDown={(event) => handleTabKeyDown(event, index)}
                    className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold md:w-full ${
                      selected ? 'bg-white text-slate-950 shadow-sm ring-1 ring-inset ring-slate-200' : 'text-slate-600 hover:bg-white/70'
                    }`}
                  >
                    <Icon size={17} />
                    {section.label}
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="flex min-h-0 flex-1 flex-col">
            <header className="hidden shrink-0 items-center justify-between border-b border-slate-100 px-7 py-4 md:flex">
              <p className="text-sm font-semibold text-slate-500">Account settings</p>
              <span aria-hidden="true" />
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-7 lg:p-10">
              <div
                id={`account-panel-${activeSection}`}
                role="tabpanel"
                aria-labelledby={`account-tab-${activeSection}`}
              >
                {activeSection === 'health' && (
                  <div>
                    <h3 className="mb-1 text-2xl font-black text-slate-950">Health Profile</h3>
                    <p className="mb-6 text-sm text-slate-500">Personal details used to tailor your Weekly Plans.</p>
                    {profile && (
                      <div className="mb-6 flex gap-2 border-b border-slate-200">
                        <button type="button" onClick={() => setHealthSubview('details')} className={`px-3 py-2 text-sm font-bold ${healthSubview === 'details' ? 'border-b-2 border-emerald-600 text-emerald-700' : 'text-slate-500'}`}>Details</button>
                        <button type="button" onClick={() => guardHealthExit(() => setHealthSubview('milestones'))} className={`px-3 py-2 text-sm font-bold ${healthSubview === 'milestones' ? 'border-b-2 border-emerald-600 text-emerald-700' : 'text-slate-500'}`}>Milestones</button>
                      </div>
                    )}
                    {healthSubview === 'details' ? (
                      <>
                        <ProfileForm
                          initialData={profile}
                          onSubmit={saveProfile}
                          isLoading={profileSaving}
                          isEditing={!!profile}
                          onDirtyChange={(dirty) => {
                            healthDirtyRef.current = dirty;
                            setHealthDirty(dirty);
                          }}
                          onPlanRelevantDirtyChange={(dirty) => {
                            setPlanRelevantDirty(dirty);
                            if (!dirty) setReplacePlan(false);
                          }}
                        />
                        {hasCurrentPlan && planRelevantDirty && (
                          <label className="mt-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                            <input
                              type="checkbox"
                              checked={replacePlan}
                              onChange={(event) => setReplacePlan(event.target.checked)}
                              className="mt-1 h-4 w-4"
                            />
                            <span>
                              <span className="block text-sm font-bold text-slate-900">Create a new Weekly Plan from these changes</span>
                              <span className="mt-1 block text-xs leading-5 text-slate-600">
                                Your Current Weekly Plan will be replaced only if generation succeeds and cannot be restored in the app.
                              </span>
                            </span>
                          </label>
                        )}
                    {profileStatus && (
                      <p
                        role={profileStatus.kind === 'error' ? 'alert' : 'status'}
                        className={`mt-4 flex items-center gap-2 text-sm font-semibold ${
                          profileStatus.kind === 'error' ? 'text-red-700' : 'text-emerald-700'
                        }`}
                      >
                        {profileStatus.kind === 'error'
                          ? <AlertTriangle size={17} />
                          : <CheckCircle2 size={17} />}
                        {profileStatus.message}
                      </p>
                    )}
                    {replacementRetry && (
                      <button
                        type="button"
                        onClick={() => void saveProfile(replacementRetry)}
                        disabled={profileSaving}
                        className="mt-3 text-sm font-bold text-emerald-700 underline disabled:opacity-50"
                      >
                        Retry Weekly Plan replacement
                      </button>
                    )}
                      </>
                    ) : profile ? (
                      <div>
                        <MilestoneTracker
                          milestones={milestones}
                          currentWeight={profile.weightKg}
                          onAddMilestone={onAddMilestone}
                          onDeleteMilestone={onDeleteMilestone}
                        />
                      </div>
                    ) : null}
                  </div>
                )}

                {activeSection === 'security' && (
                  <div className="max-w-xl">
                    <h3 className="mb-1 text-2xl font-black text-slate-950">Security</h3>
                    <p className="mb-6 text-sm text-slate-500">Protect your password and active sessions.</p>
                    <div className="mb-6 rounded-xl bg-slate-50 p-4">
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Email</p>
                      <p className="mt-1 text-sm font-semibold text-slate-800">{email}</p>
                    </div>
                    <section aria-labelledby="connected-methods-title" className="mb-8">
                      <h4 id="connected-methods-title" className="font-bold text-slate-900">
                        Connected sign-in methods
                      </h4>
                      {connectedMethodsLoading ? (
                        <p className="mt-2 text-sm text-slate-500">Loading connected methods…</p>
                      ) : connectedMethodsError ? (
                        <div className="mt-2">
                          <p role="alert" className="text-sm text-red-700">{connectedMethodsError}</p>
                          <button
                            type="button"
                            onClick={() => setConnectedMethodsReloadKey((key) => key + 1)}
                            className="mt-2 text-sm font-bold text-emerald-700"
                          >
                            Retry connected methods
                          </button>
                        </div>
                      ) : (
                        <ul aria-label="Connected sign-in methods" className="mt-3 space-y-2">
                          {connectedMethods.map((method) => {
                            const providerUnavailable =
                              isOAuthProvider(method.provider)
                              && getProviderMode(method.provider) === 'off';
                            return (
                              <li key={method.identityId} className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 p-3">
                                <span>
                                  <span className="block text-sm font-semibold text-slate-800">
                                    {getProviderName(method.provider)}
                                  </span>
                                  {providerUnavailable && (
                                    <span className="mt-0.5 block text-xs font-semibold text-amber-700">
                                      Sign-in temporarily unavailable
                                    </span>
                                  )}
                                </span>
                                <button
                                  type="button"
                                  aria-label={`Disconnect ${getProviderName(method.provider)}`}
                                  disabled={disconnectingIdentityId !== null}
                                  onClick={() => void disconnectMethod(method)}
                                  className="text-sm font-bold text-red-700"
                                >
                                  {disconnectingIdentityId === method.identityId ? 'Disconnecting…' : 'Disconnect'}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {unavailableOnlyMethod && (
                        <p role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                          {getProviderName(unavailableOnlyMethod.provider)} sign-in is temporarily unavailable.{' '}
                          <a
                            href="https://github.com/cmilios/neuro-nutrition/issues/new"
                            target="_blank"
                            rel="noreferrer"
                            className="font-bold underline"
                          >
                            Contact support
                          </a>{' '}
                          for help accessing your account.
                        </p>
                      )}
                    </section>
                    {connectedMethodsLoaded && (
                    <form onSubmit={submitPassword} className="space-y-4">
                      {hasPasswordIdentity && (
                        <label className="block text-sm font-semibold text-slate-700">
                          Current password
                          <input
                            ref={currentPasswordRef}
                            type="password"
                            autoComplete="current-password"
                            value={currentPassword}
                            onChange={(event) => setCurrentPassword(event.target.value)}
                            aria-invalid={!!securityErrors.current}
                            aria-describedby={securityErrors.current ? 'current-password-error' : undefined}
                            className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3"
                          />
                          {securityErrors.current && <span id="current-password-error" className="mt-1 block text-xs text-red-700">{securityErrors.current}</span>}
                        </label>
                      )}
                      <label className="block text-sm font-semibold text-slate-700">
                        New password
                        <input
                          ref={newPasswordRef}
                          type="password"
                          autoComplete="new-password"
                          value={newPassword}
                          onChange={(event) => setNewPassword(event.target.value)}
                          aria-invalid={!!securityErrors.new}
                          aria-describedby="password-policy"
                          className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3"
                        />
                        <span id="password-policy" className={`mt-1 block text-xs ${securityErrors.new ? 'text-red-700' : 'text-slate-500'}`}>
                          {securityErrors.new || passwordPolicyMessage}
                        </span>
                      </label>
                      <label className="block text-sm font-semibold text-slate-700">
                        Confirm new password
                        <input
                          ref={confirmationRef}
                          type="password"
                          autoComplete="new-password"
                          value={passwordConfirmation}
                          onChange={(event) => setPasswordConfirmation(event.target.value)}
                          aria-invalid={!!securityErrors.confirmation}
                          aria-describedby={securityErrors.confirmation ? 'password-confirmation-error' : undefined}
                          className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3"
                        />
                        {securityErrors.confirmation && <span id="password-confirmation-error" className="mt-1 block text-xs text-red-700">{securityErrors.confirmation}</span>}
                      </label>
                      <button type="submit" disabled={securitySaving} className="flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white disabled:opacity-60">
                        <KeyRound size={17} /> {securitySaving
                          ? hasPasswordIdentity
                            ? 'Changing password…'
                            : 'Setting password…'
                          : hasPasswordIdentity
                            ? 'Change password'
                            : 'Set password'}
                      </button>
                    </form>
                    )}
                    {securityStatus && (
                      <p
                        role={securityStatus.kind === 'error' ? 'alert' : 'status'}
                        className={`mt-4 rounded-xl p-3 text-sm ${
                          securityStatus.kind === 'error'
                            ? 'bg-red-50 text-red-800'
                            : 'bg-emerald-50 text-emerald-800'
                        }`}
                      >
                        {securityStatus.message}
                      </p>
                    )}
                    {hasPasswordIdentity && (
                    <div className="mt-8 border-t border-slate-200 pt-6">
                      <h4 className="font-bold text-slate-900">Forgot your current password?</h4>
                      <p className="mt-1 text-sm text-slate-500">Continue on the separate recovery screen without ending this session.</p>
                      <button type="button" disabled={recoverySending} onClick={requestRecovery} className="mt-3 text-sm font-bold text-emerald-700">
                        {recoverySending ? 'Sending…' : 'Send recovery email'}
                      </button>
                    </div>
                    )}
                  </div>
                )}

                {activeSection === 'appearance' && (
                  <div className="max-w-2xl">
                    <h3 className="mb-1 text-2xl font-black text-slate-950">Appearance</h3>
                    <p className="mb-6 text-sm text-slate-500">
                      Choose how NeuroNutrition looks on this device.
                    </p>
                    <fieldset>
                      <legend className="mb-3 text-sm font-bold text-slate-800">Theme</legend>
                      <div className="grid gap-3 sm:grid-cols-3">
                        {themeOptions.map((option) => {
                          const Icon = option.icon;
                          const selected = theme === option.value;
                          return (
                            <label
                              key={option.value}
                              className={`cursor-pointer rounded-2xl border p-4 ${
                                selected
                                  ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-500/20'
                                  : 'border-slate-200 bg-white hover:border-emerald-300'
                              }`}
                            >
                              <input
                                type="radio"
                                name="theme"
                                value={option.value}
                                checked={selected}
                                onChange={() => updateTheme(option.value)}
                                className="sr-only"
                              />
                              <span className="flex items-center gap-3">
                                <span className={`rounded-xl border p-2 ${
                                  selected
                                    ? 'border-emerald-300 bg-white text-emerald-700'
                                    : 'border-slate-200 bg-slate-50 text-slate-500'
                                }`}>
                                  <Icon size={20} />
                                </span>
                                <span>
                                  <span className="block text-sm font-bold text-slate-900">{option.label}</span>
                                  <span className="mt-0.5 block text-xs text-slate-500">{option.description}</span>
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                  </div>
                )}

                {activeSection === 'start-over' && (
                  <div className="max-w-xl">
                    <h3 className="mb-1 text-2xl font-black text-slate-950">Start Over</h3>
                    <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-slate-700">
                      Start Over removes your Current Weekly Plan so you can create a fresh one. Your Health Profile, milestones and previous plan history remain saved. You cannot restore the removed plan in the app.
                    </p>
                    {!hasCurrentPlan && (
                      <p id="start-over-disabled" className="mt-4 text-sm text-slate-500">There is no Current Weekly Plan to remove.</p>
                    )}
                    {!startOverConfirming ? (
                      <button
                        type="button"
                        disabled={!hasCurrentPlan || planMutationsDisabled}
                        aria-describedby={!hasCurrentPlan ? 'start-over-disabled' : undefined}
                        onClick={() => setStartOverConfirming(true)}
                        className="mt-6 rounded-xl bg-red-700 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Start Over
                      </button>
                    ) : (
                      <div role="alertdialog" aria-label="Confirm Start Over" className="mt-6 rounded-xl border border-red-200 p-5">
                        <p className="font-bold text-slate-950">Remove your Current Weekly Plan?</p>
                        <div className="mt-4 flex gap-3">
                          <button type="button" disabled={startOverRunning} onClick={() => setStartOverConfirming(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold">Cancel</button>
                          <button type="button" disabled={startOverRunning} onClick={runStartOver} className="rounded-xl bg-red-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
                            {startOverRunning ? 'Starting over…' : 'Start Over'}
                          </button>
                        </div>
                      </div>
                    )}
                    {startOverError && (
                      <div role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">
                        {startOverError}
                        <button type="button" onClick={runStartOver} className="ml-3 font-bold underline">Retry</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="shrink-0 border-t border-slate-200 bg-white p-3">
              <button type="button" onClick={runLogout} className="flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold text-red-700 hover:bg-red-50">
                <LogOut size={17} /> Log Out
              </button>
              {logoutError && <p role="alert" className="mt-2 text-center text-xs text-red-700">{logoutError}</p>}
            </div>
          </section>
        </div>
      </div>

      {pendingExit && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/45 p-4">
          <div ref={guardDialogRef} role="alertdialog" aria-modal="true" aria-labelledby="unsaved-title" className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <AlertTriangle className="text-amber-600" />
            <h3 id="unsaved-title" className="mt-3 text-xl font-black text-slate-950">Discard unsaved Health Profile changes?</h3>
            <p className="mt-2 text-sm text-slate-600">Your edits have not been saved.</p>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" autoFocus onClick={() => setPendingExit(null)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold">Keep Editing</button>
              <button
                type="button"
                onClick={() => {
                  const action = pendingExit;
                  setPendingExit(null);
                  setHealthDirty(false);
                  healthDirtyRef.current = false;
                  setPlanRelevantDirty(false);
                  setReplacePlan(false);
                  action();
                }}
                className="rounded-xl bg-red-700 px-4 py-2 text-sm font-bold text-white"
              >
                Discard Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserProfileModal;
