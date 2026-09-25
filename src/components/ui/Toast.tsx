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

// A toast's auto-dismiss countdown. `handle` is the live setTimeout (null
// while paused); `hovering`/`focused` are independent holds — the mouse can
// leave while focus (e.g. on the action button) stays inside, and vice
// versa, so the timer only resumes once *both* have cleared.
interface TimerState {
  remainingMs: number;
  startedAt: number | null;
  handle: ReturnType<typeof setTimeout> | null;
  hovering: boolean;
  focused: boolean;
}

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
  const timers = useRef(new Map<string, TimerState>());

  useEffect(
    () => () => {
      for (const state of timers.current.values()) {
        if (state.handle !== null) clearTimeout(state.handle);
      }
      timers.current.clear();
    },
    [],
  );

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
    const state = timers.current.get(id);
    if (state && state.handle !== null) clearTimeout(state.handle);
    timers.current.delete(id);
  }, []);

  const show = useCallback(
    (t: ToastInput) => {
      const id = nextToastId();
      setToasts((current) => [...current, { ...t, id }]);
      const durationMs = t.durationMs ?? DEFAULT_DURATION_MS;
      if (durationMs > 0) {
        timers.current.set(id, {
          remainingMs: durationMs,
          startedAt: Date.now(),
          handle: setTimeout(() => dismiss(id), durationMs),
          hovering: false,
          focused: false,
        });
      }
      return id;
    },
    [dismiss],
  );

  // `reason` tracks mouse hover and keyboard focus independently: the timer
  // only restarts once both are clear, so tabbing onto the action button
  // while still hovering (or the reverse) doesn't resume it early.
  const pause = useCallback((id: string, reason: 'hovering' | 'focused') => {
    const state = timers.current.get(id);
    if (!state) return;
    state[reason] = true;
    if (state.handle !== null && state.startedAt !== null) {
      clearTimeout(state.handle);
      state.remainingMs = Math.max(0, state.remainingMs - (Date.now() - state.startedAt));
      state.handle = null;
      state.startedAt = null;
    }
  }, []);

  const resume = useCallback(
    (id: string, reason: 'hovering' | 'focused') => {
      const state = timers.current.get(id);
      if (!state) return;
      state[reason] = false;
      if (state.hovering || state.focused || state.handle !== null) return;
      state.startedAt = Date.now();
      state.handle = setTimeout(() => dismiss(id), state.remainingMs);
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
            onMouseEnter={() => pause(t.id, 'hovering')}
            onMouseLeave={() => resume(t.id, 'hovering')}
            onFocus={() => pause(t.id, 'focused')}
            onBlur={() => resume(t.id, 'focused')}
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
