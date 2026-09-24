import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export type ToastTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface ToastAction {
  label: string;
  onClick: () => void;
  testid?: string;
}

export interface ToastInput {
  message: ReactNode;
  tone?: ToastTone;
  actions?: ToastAction[];
  testid?: string;
  durationMs?: number;
}

interface ToastItem extends ToastInput {
  id: string;
}

export interface ToastApi {
  show(t: ToastInput): string;
  dismiss(id: string): void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_DURATION_MS = 5000;

const TONE_CLASSES: Record<ToastTone, string> = {
  neutral: 'border-border bg-surface-2',
  success: 'border-success/40 bg-success/15',
  warning: 'border-warning/40 bg-warning/15',
  danger: 'border-danger/40 bg-danger/15',
};

let toastSeq = 0;
function nextToastId(): string {
  toastSeq += 1;
  return `toast-${Date.now()}-${toastSeq}`;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
    },
    [],
  );

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (t: ToastInput) => {
      const id = nextToastId();
      setToasts((current) => [...current, { ...t, id }]);
      const durationMs = t.durationMs ?? DEFAULT_DURATION_MS;
      if (durationMs > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), durationMs),
        );
      }
      return id;
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end">
        {toasts.map((t) => (
          <div
            key={t.id}
            data-testid={t.testid}
            role={t.tone === 'danger' ? 'alert' : 'status'}
            className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border px-4 py-3 text-fg shadow-lg ${TONE_CLASSES[t.tone ?? 'neutral']}`}
          >
            <div className="flex-1 text-sm">{t.message}</div>
            <div className="flex shrink-0 items-center gap-1">
              {t.actions?.map((action, i) => (
                <button
                  key={i}
                  type="button"
                  data-testid={action.testid}
                  onClick={() => {
                    action.onClick();
                    dismiss(t.id);
                  }}
                  className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-semibold underline underline-offset-2 hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  {action.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Fechar"
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
