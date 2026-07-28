// PROTOTYPE for issue #27 — three Account modal variants on the existing app route,
// switchable via ?variant=A|B|C. All mutations are intentionally stubbed.
import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  KeyRound,
  LogOut,
  RotateCcw,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';
import { UserProfile } from '../types';
import PrototypeSwitcher, { PrototypeVariant } from './PrototypeSwitcher';

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfile;
  email: string;
}

type AccountSection = 'health' | 'security' | 'start-over';

const sections: Array<{
  id: AccountSection;
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  tone: string;
}> = [
  {
    id: 'health',
    label: 'Health Profile',
    description: 'Personal details used to tailor your Weekly Plan',
    icon: UserRound,
    tone: 'bg-emerald-100 text-emerald-700',
  },
  {
    id: 'security',
    label: 'Security',
    description: 'Password and active session protection',
    icon: ShieldCheck,
    tone: 'bg-blue-100 text-blue-700',
  },
  {
    id: 'start-over',
    label: 'Start Over',
    description: 'Remove the Current Weekly Plan and begin again',
    icon: RotateCcw,
    tone: 'bg-amber-100 text-amber-700',
  },
];

const getInitialVariant = (): PrototypeVariant => {
  const value = new URLSearchParams(window.location.search).get('variant')?.toUpperCase();
  return value === 'B' || value === 'C' ? value : 'A';
};

const PrototypeNotice: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="mb-5 flex items-start gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
    <span className="mt-0.5 rounded bg-violet-200 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider">
      Prototype
    </span>
    <span>{children}</span>
  </div>
);

const Field: React.FC<{
  label: string;
  defaultValue?: string | number;
  type?: string;
  hint?: string;
}> = ({ label, defaultValue, type = 'text', hint }) => (
  <label className="block">
    <span className="mb-1.5 block text-sm font-semibold text-slate-700">{label}</span>
    <input
      type={type}
      defaultValue={defaultValue}
      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
    />
    {hint && <span className="mt-1.5 block text-xs text-slate-500">{hint}</span>}
  </label>
);

const HealthProfilePanel: React.FC<{
  profile: UserProfile;
  onPrototypeAction: (message: string) => void;
}> = ({ profile, onPrototypeAction }) => (
  <div>
    <div className="mb-6">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">Personalization</p>
      <h3 className="mt-1 text-2xl font-bold text-slate-950">Health Profile</h3>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
        These details shape nutrition targets and meal recommendations in your Weekly Plan.
      </p>
    </div>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Age" type="number" defaultValue={profile.age} />
      <Field label="Weight" type="number" defaultValue={profile.weightKg} hint="Kilograms" />
      <Field label="Height" type="number" defaultValue={profile.heightCm} hint="Centimeters" />
      <Field label="Primary goal" defaultValue={profile.goal} />
    </div>
    <div className="mt-6 flex justify-end border-t border-slate-100 pt-5">
      <button
        type="button"
        onClick={() => onPrototypeAction('Health Profile changes were not saved in this prototype.')}
        className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
      >
        Save changes
      </button>
    </div>
  </div>
);

const SecurityPanel: React.FC<{ onPrototypeAction: (message: string) => void }> = ({
  onPrototypeAction,
}) => (
  <div>
    <div className="mb-6">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">Sign-in security</p>
      <h3 className="mt-1 text-2xl font-bold text-slate-950">Change password</h3>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
        Your current password confirms it is you. After the change, this device stays signed in
        and your other sessions are signed out.
      </p>
    </div>
    <div className="max-w-lg space-y-4">
      <Field label="Current password" type="password" />
      <Field
        label="New password"
        type="password"
        hint="Use at least 8 characters. Your new password must be different."
      />
      <Field label="Confirm new password" type="password" />
    </div>
    <div className="mt-6 flex justify-end border-t border-slate-100 pt-5">
      <button
        type="button"
        onClick={() => onPrototypeAction('Password was not changed in this prototype.')}
        className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-700 focus:ring-offset-2"
      >
        <KeyRound size={16} />
        Update password
      </button>
    </div>
  </div>
);

const StartOverPanel: React.FC<{ onPrototypeAction: (message: string) => void }> = ({
  onPrototypeAction,
}) => {
  const [confirmed, setConfirmed] = useState(false);

  return (
    <div>
      <div className="mb-6">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Plan controls</p>
        <h3 className="mt-1 text-2xl font-bold text-slate-950">Start Over</h3>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
          Start Over removes your Current Weekly Plan while preserving your Health Profile,
          milestones, AI Usage Records, and inactive plan history.
        </p>
      </div>
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <div className="flex gap-3">
          <div className="mt-0.5 rounded-lg bg-amber-100 p-2 text-amber-700">
            <AlertTriangle size={19} />
          </div>
          <div>
            <h4 className="font-bold text-amber-950">Your current meals will no longer be available.</h4>
            <p className="mt-1 text-sm leading-6 text-amber-900/75">
              You will return to profile setup and can create a new Weekly Plan.
            </p>
          </div>
        </div>
        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl bg-white/70 p-3 text-sm text-amber-950">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-amber-300 text-amber-700 focus:ring-amber-500"
          />
          <span>I understand what Start Over removes and preserves.</span>
        </label>
        <button
          type="button"
          disabled={!confirmed}
          onClick={() => onPrototypeAction('Start Over was not run in this prototype.')}
          className="mt-4 rounded-xl bg-amber-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Start Over
        </button>
      </div>
    </div>
  );
};

const SectionContent: React.FC<{
  section: AccountSection;
  profile: UserProfile;
  onPrototypeAction: (message: string) => void;
}> = ({ section, profile, onPrototypeAction }) => {
  if (section === 'security') return <SecurityPanel onPrototypeAction={onPrototypeAction} />;
  if (section === 'start-over') return <StartOverPanel onPrototypeAction={onPrototypeAction} />;
  return <HealthProfilePanel profile={profile} onPrototypeAction={onPrototypeAction} />;
};

const Identity: React.FC<{ profile: UserProfile; email: string; compact?: boolean }> = ({
  profile,
  email,
  compact = false,
}) => (
  <div className="flex min-w-0 items-center gap-3">
    {profile.photo ? (
      <img
        src={profile.photo}
        alt=""
        className={`${compact ? 'h-10 w-10' : 'h-12 w-12'} rounded-full border border-slate-200 object-cover`}
      />
    ) : (
      <div className={`${compact ? 'h-10 w-10' : 'h-12 w-12'} flex shrink-0 items-center justify-center rounded-full bg-emerald-100 font-bold text-emerald-700`}>
        {profile.age}
      </div>
    )}
    <div className="min-w-0">
      <p className="truncate font-bold text-slate-950">Your account</p>
      <p className="truncate text-xs text-slate-500">{email}</p>
    </div>
  </div>
);

const LogoutButton: React.FC<{
  onPrototypeAction: (message: string) => void;
  contained?: boolean;
}> = ({ onPrototypeAction, contained = false }) => (
  <button
    type="button"
    onClick={() => onPrototypeAction('Log Out was not run in this prototype.')}
    className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-red-700 transition focus:outline-none focus:ring-2 focus:ring-red-400 ${
      contained ? 'border border-red-200 bg-red-50 hover:bg-red-100' : 'hover:bg-red-50'
    }`}
  >
    <LogOut size={17} />
    Log Out
  </button>
);

const CloseButton: React.FC<{ onClose: () => void; buttonRef?: React.RefObject<HTMLButtonElement | null> }> = ({
  onClose,
  buttonRef,
}) => (
  <button
    ref={buttonRef}
    type="button"
    onClick={onClose}
    className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
    aria-label="Close Account"
  >
    <X size={22} />
  </button>
);

interface VariantProps {
  profile: UserProfile;
  email: string;
  activeSection: AccountSection;
  onSectionChange: (section: AccountSection) => void;
  onClose: () => void;
  onPrototypeAction: (message: string) => void;
  closeButtonRef: React.RefObject<HTMLButtonElement | null>;
}

const VariantA: React.FC<VariantProps> = ({
  profile,
  email,
  activeSection,
  onSectionChange,
  onClose,
  onPrototypeAction,
  closeButtonRef,
}) => (
  <div className="relative flex h-full w-full max-w-5xl flex-col overflow-hidden bg-white shadow-2xl sm:h-[min(760px,88vh)] sm:rounded-3xl md:flex-row">
    <aside className="flex shrink-0 flex-col border-b border-slate-200 bg-slate-50 md:w-72 md:border-b-0 md:border-r">
      <div className="flex items-center justify-between p-4 md:p-6">
        <Identity profile={profile} email={email} compact />
        <div className="md:hidden">
          <CloseButton onClose={onClose} buttonRef={closeButtonRef} />
        </div>
      </div>
      <nav aria-label="Account sections" className="flex gap-1 overflow-x-auto px-3 pb-3 md:block md:space-y-1 md:overflow-visible md:px-4">
        {sections.map((section) => {
          const Icon = section.icon;
          const selected = section.id === activeSection;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => onSectionChange(section.id)}
              className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition md:w-full ${
                selected ? 'bg-white text-slate-950 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:bg-white/70'
              }`}
              aria-current={selected ? 'page' : undefined}
            >
              <Icon size={17} className={selected ? 'text-emerald-600' : 'text-slate-400'} />
              {section.label}
            </button>
          );
        })}
      </nav>
      <div className="mt-auto hidden border-t border-slate-200 p-4 md:block">
        <LogoutButton onPrototypeAction={onPrototypeAction} />
      </div>
    </aside>
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="hidden shrink-0 items-center justify-between border-b border-slate-100 px-7 py-4 md:flex">
        <p className="text-sm font-semibold text-slate-500">Account settings</p>
        <CloseButton onClose={onClose} buttonRef={closeButtonRef} />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-5 pb-24 sm:p-7 md:pb-7 lg:p-10">
        <PrototypeNotice>Actions demonstrate hierarchy and feedback only; they do not change account data.</PrototypeNotice>
        <SectionContent section={activeSection} profile={profile} onPrototypeAction={onPrototypeAction} />
      </div>
      <div className="shrink-0 border-t border-slate-200 bg-white p-3 md:hidden">
        <LogoutButton contained onPrototypeAction={onPrototypeAction} />
      </div>
    </section>
  </div>
);

const VariantB: React.FC<VariantProps> = ({
  profile,
  email,
  activeSection,
  onSectionChange,
  onClose,
  onPrototypeAction,
  closeButtonRef,
}) => {
  const [showDetail, setShowDetail] = useState(false);
  const openSection = (section: AccountSection) => {
    onSectionChange(section);
    setShowDetail(true);
  };

  return (
    <div className="relative flex h-full w-full max-w-4xl flex-col overflow-hidden bg-slate-50 shadow-2xl sm:h-[min(760px,88vh)] sm:rounded-3xl">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5 py-4 sm:px-7">
        <div className="flex items-center gap-3">
          {showDetail && (
            <button
              type="button"
              onClick={() => setShowDetail(false)}
              className="rounded-full p-2 text-slate-500 hover:bg-slate-100"
              aria-label="Back to Account overview"
            >
              <ArrowLeft size={20} />
            </button>
          )}
          <div>
            <p className="text-lg font-bold text-slate-950">{showDetail ? sections.find((item) => item.id === activeSection)?.label : 'Account'}</p>
            <p className="text-xs text-slate-500">{showDetail ? 'Back to overview at any time' : 'Everything about you, in one place'}</p>
          </div>
        </div>
        <CloseButton onClose={onClose} buttonRef={closeButtonRef} />
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto p-5 pb-24 sm:p-7">
        {showDetail ? (
          <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <PrototypeNotice>This detail screen is a safe interaction mock; account data will not change.</PrototypeNotice>
            <SectionContent section={activeSection} profile={profile} onPrototypeAction={onPrototypeAction} />
          </div>
        ) : (
          <div className="mx-auto max-w-3xl">
            <div className="mb-6 rounded-2xl bg-gradient-to-br from-emerald-700 to-teal-600 p-5 text-white shadow-lg shadow-emerald-900/10 sm:p-6">
              <Identity profile={profile} email={email} />
              <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold">
                <span className="rounded-full bg-white/15 px-3 py-1.5">Weekly Plan active</span>
                <span className="rounded-full bg-white/15 px-3 py-1.5">Profile complete</span>
              </div>
            </div>
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Manage account</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {sections.map((section, index) => {
                const Icon = section.icon;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => openSection(section.id)}
                    className={`group flex min-h-40 flex-col rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md ${
                      index === 0 ? 'sm:col-span-2 sm:min-h-36' : ''
                    }`}
                  >
                    <span className={`mb-5 inline-flex w-fit rounded-xl p-2.5 ${section.tone}`}>
                      <Icon size={20} />
                    </span>
                    <span className="mt-auto flex w-full items-end justify-between gap-4">
                      <span>
                        <span className="block font-bold text-slate-950">{section.label}</span>
                        <span className="mt-1 block text-xs leading-5 text-slate-500">{section.description}</span>
                      </span>
                      <ChevronRight className="shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500" size={19} />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </main>
      <footer className="shrink-0 border-t border-slate-200 bg-white p-3 sm:px-7">
        <div className="mx-auto max-w-3xl">
          <LogoutButton onPrototypeAction={onPrototypeAction} />
        </div>
      </footer>
    </div>
  );
};

const VariantC: React.FC<VariantProps> = ({
  profile,
  email,
  activeSection,
  onSectionChange,
  onClose,
  onPrototypeAction,
  closeButtonRef,
}) => (
  <div className="relative flex h-full w-full max-w-2xl flex-col overflow-hidden bg-white shadow-2xl sm:h-auto sm:max-h-[88vh] sm:rounded-3xl">
    <header className="shrink-0 border-b border-slate-100 px-5 py-5 sm:px-7">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-2xl font-black tracking-tight text-slate-950">Account</p>
          <p className="mt-1 text-sm text-slate-500">Review one setting at a time.</p>
        </div>
        <CloseButton onClose={onClose} buttonRef={closeButtonRef} />
      </div>
      <div className="mt-5 rounded-2xl bg-slate-50 p-3">
        <Identity profile={profile} email={email} compact />
      </div>
    </header>
    <main className="min-h-0 flex-1 overflow-y-auto p-4 pb-24 sm:p-6">
      <PrototypeNotice>Expandable sections keep the mobile flow focused. Actions are stubbed.</PrototypeNotice>
      <div className="space-y-3">
        {sections.map((section) => {
          const Icon = section.icon;
          const expanded = activeSection === section.id;
          return (
            <section key={section.id} className={`overflow-hidden rounded-2xl border transition ${expanded ? 'border-slate-300 shadow-sm' : 'border-slate-200'}`}>
              <button
                type="button"
                onClick={() => onSectionChange(section.id)}
                className="flex w-full items-center gap-3 bg-white p-4 text-left focus:outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-500"
                aria-expanded={expanded}
              >
                <span className={`rounded-xl p-2 ${section.tone}`}><Icon size={18} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block font-bold text-slate-950">{section.label}</span>
                  {!expanded && <span className="block truncate text-xs text-slate-500">{section.description}</span>}
                </span>
                <ChevronDown size={19} className={`text-slate-400 transition ${expanded ? 'rotate-180' : ''}`} />
              </button>
              {expanded && (
                <div className="border-t border-slate-100 bg-slate-50/50 p-4 sm:p-6">
                  <SectionContent section={section.id} profile={profile} onPrototypeAction={onPrototypeAction} />
                </div>
              )}
            </section>
          );
        })}
      </div>
    </main>
    <footer className="shrink-0 border-t border-slate-200 bg-white p-3 sm:px-6">
      <LogoutButton contained onPrototypeAction={onPrototypeAction} />
    </footer>
  </div>
);

const UserProfileModal: React.FC<UserProfileModalProps> = ({
  isOpen,
  onClose,
  profile,
  email,
}) => {
  const [variant, setVariant] = useState<PrototypeVariant>(getInitialVariant);
  const [activeSection, setActiveSection] = useState<AccountSection>('health');
  const [notice, setNotice] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const changeVariant = (nextVariant: PrototypeVariant) => {
    const params = new URLSearchParams(window.location.search);
    params.set('variant', nextVariant);
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}${window.location.hash}`);
    setVariant(nextVariant);
    setNotice(null);
  };

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
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
    };
  }, [isOpen, onClose, variant]);

  useEffect(() => {
    if (isOpen) {
      setActiveSection('health');
      setNotice(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const sharedProps: VariantProps = {
    profile,
    email,
    activeSection,
    onSectionChange: (section) => {
      setActiveSection(section);
      setNotice(null);
    },
    onClose,
    onPrototypeAction: setNotice,
    closeButtonRef,
  };

  return (
    <div className="fixed inset-0 z-[100]">
      <button
        type="button"
        aria-label="Close Account"
        className="absolute inset-0 h-full w-full cursor-default bg-slate-950/65 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative flex h-full items-center justify-center sm:p-4">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={`Account modal prototype, variant ${variant}`}
          className="relative flex h-full w-full items-center justify-center"
        >
          {variant === 'A' && <VariantA {...sharedProps} />}
          {variant === 'B' && <VariantB {...sharedProps} />}
          {variant === 'C' && <VariantC {...sharedProps} />}
          {notice && (
            <div
              role="status"
              className="fixed left-1/2 top-4 z-[210] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm font-semibold text-emerald-900 shadow-xl"
            >
              <Check size={18} className="shrink-0 text-emerald-600" />
              <span className="flex-1">{notice}</span>
              <button type="button" onClick={() => setNotice(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Dismiss notice">
                <X size={16} />
              </button>
            </div>
          )}
        </div>
      </div>
      <PrototypeSwitcher current={variant} onChange={changeVariant} />
    </div>
  );
};

export default UserProfileModal;
