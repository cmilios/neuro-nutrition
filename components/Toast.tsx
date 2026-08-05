import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export interface ToastMessage {
  id: number;
  kind: 'info' | 'error';
  message: string;
}

interface ToastProps {
  toast: ToastMessage;
  onDismiss: () => void;
}

const Toast: React.FC<ToastProps> = ({ toast, onDismiss }) => {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    const timer = window.setTimeout(() => onDismissRef.current(), 5_000);
    return () => window.clearTimeout(timer);
  }, [toast.id]);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-[150] w-full px-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-sm sm:px-0">
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-auto flex w-full items-start gap-3 rounded-2xl border p-4 shadow-2xl ${
          toast.kind === 'error'
            ? 'border-red-200 bg-red-50 text-red-900'
            : 'border-slate-200 bg-white text-slate-800'
        }`}
      >
        <p className="min-w-0 flex-1 text-sm font-semibold leading-5">
          {toast.message}
        </p>
        <button
          type="button"
          aria-label="Dismiss notification"
          onClick={onDismiss}
          className="shrink-0 rounded-full p-1 text-current hover:bg-black/5"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};

export default Toast;
