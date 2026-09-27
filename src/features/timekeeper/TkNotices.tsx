// Short-lived notices of the timekeeper screen (assignment ✓, errors, "Desfazer"). The kit's toasts
// catch every tap that lands on them, and at the bottom of a phone that is exactly where the "Em
// prova" rows and MARCAR are: a tap meant for an arrival would hit the toast (or its "Desfazer")
// and be lost (B2-m1). These let every tap through to the screen below, except on their buttons.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '../../components/ui';

export interface TkNoticeAction { label: string; onClick: () => void; testid?: string }
export interface TkNoticeInput {
  message: ReactNode;
  actions?: TkNoticeAction[];
  testid?: string;
  /** Announced as an alert (errors) instead of a status. */
  alert?: boolean;
  durationMs?: number;
}
interface TkNotice extends TkNoticeInput { id: string }

const DEFAULT_DURATION_MS = 5_000;
/** At most this many at once, newest last: the notices never pile up over the screen. */
const MAX_SHOWN = 3;

let seq = 0;

export interface TkNotices {
  notices: TkNotice[];
  show(n: TkNoticeInput): string;
  dismiss(id: string): void;
}

export function useTkNotices(): TkNotices {
  const [notices, setNotices] = useState<TkNotice[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of pending.values()) clearTimeout(t);
      pending.clear();
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    setNotices(list => list.filter(n => n.id !== id));
    const t = timers.current.get(id);
    if (t !== undefined) clearTimeout(t);
    timers.current.delete(id);
  }, []);

  const show = useCallback((n: TkNoticeInput) => {
    seq += 1;
    const id = `tk-notice-${seq}`;
    setNotices(list => [...list, { ...n, id }].slice(-MAX_SHOWN));
    timers.current.set(id, setTimeout(() => dismiss(id), n.durationMs ?? DEFAULT_DURATION_MS));
    return id;
  }, [dismiss]);

  return { notices, show, dismiss };
}

/** The notices, fixed at the bottom: `pointer-events-none` everywhere but on their buttons. */
export function TkNoticeLayer({ notices, onDismiss }: { notices: TkNotice[]; onDismiss: (id: string) => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex flex-col items-center gap-2 p-4">
      {notices.map(n => (
        <div
          key={n.id}
          data-testid={n.testid}
          role={n.alert ? 'alert' : 'status'}
          className="pointer-events-none flex w-full max-w-sm items-start gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm text-fg shadow-lg"
        >
          <div className="min-w-0 flex-1">
            {n.message}
            {n.actions && n.actions.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {n.actions.map(a => (
                  <Button
                    key={a.label}
                    size="sm"
                    variant="secondary"
                    data-testid={a.testid}
                    className="pointer-events-auto"
                    onClick={() => {
                      onDismiss(n.id);
                      a.onClick();
                    }}
                  >
                    {a.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            aria-label="Fechar"
            onClick={() => onDismiss(n.id)}
            className="pointer-events-auto inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      ))}
    </div>
  );
}
