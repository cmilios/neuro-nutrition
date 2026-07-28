import React, { useEffect } from 'react';
import { ArrowLeft, ArrowRight, FlaskConical } from 'lucide-react';

export type PrototypeVariant = 'A' | 'B' | 'C';

const VARIANTS: Array<{ key: PrototypeVariant; name: string }> = [
  { key: 'A', name: 'Settings rail' },
  { key: 'B', name: 'Account hub' },
  { key: 'C', name: 'Focused stack' },
];

interface PrototypeSwitcherProps {
  current: PrototypeVariant;
  onChange: (variant: PrototypeVariant) => void;
}

const PrototypeSwitcher: React.FC<PrototypeSwitcherProps> = ({ current, onChange }) => {
  const cycle = (direction: -1 | 1) => {
    const currentIndex = VARIANTS.findIndex((variant) => variant.key === current);
    const nextIndex = (currentIndex + direction + VARIANTS.length) % VARIANTS.length;
    onChange(VARIANTS[nextIndex].key);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.matches('input, textarea, select, [contenteditable="true"]')
        || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
      ) {
        return;
      }

      event.preventDefault();
      cycle(event.key === 'ArrowLeft' ? -1 : 1);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [current]);

  if (import.meta.env.PROD) return null;

  const label = VARIANTS.find((variant) => variant.key === current);

  return (
    <div
      aria-label="Account modal prototype variants"
      className="fixed bottom-20 left-1/2 z-[220] flex -translate-x-1/2 items-center gap-1 rounded-full border border-slate-700 bg-slate-950 p-1.5 text-white shadow-2xl sm:bottom-4"
    >
      <span className="flex items-center gap-1.5 pl-2 pr-1 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300">
        <FlaskConical size={13} aria-hidden="true" />
        Prototype
      </span>
      <button
        type="button"
        onClick={() => cycle(-1)}
        className="rounded-full p-2 text-slate-300 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-emerald-400"
        aria-label="Previous variant"
      >
        <ArrowLeft size={17} />
      </button>
      <div className="min-w-36 text-center text-xs font-semibold" aria-live="polite">
        {label?.key} — {label?.name}
      </div>
      <button
        type="button"
        onClick={() => cycle(1)}
        className="rounded-full p-2 text-slate-300 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-emerald-400"
        aria-label="Next variant"
      >
        <ArrowRight size={17} />
      </button>
    </div>
  );
};

export default PrototypeSwitcher;
