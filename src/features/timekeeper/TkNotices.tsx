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
/** One at a time: a new notice replaces the previous, so misclicks never pile notices up over the
 * rows and MARCAR (organizer feedback 2026-09-28). */
const MAX_SHOWN = 1;

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
    setNotices(list => {
      const next = [...list, { ...n, id }];
      for (const gone of next.slice(0, -MAX_SHOWN)) {
        const timer = timers.current.get(gone.id);
        if (timer !== undefined) clearTimeout(timer);
        timers.current.delete(gone.id);
      }
      return next.slice(-MAX_SHOWN);
    });
    timers.current.set(id, setTimeout(() => dismiss(id), n.durationMs ?? DEFAULT_DURATION_MS));
    return id;
  }, [dismiss]);

  return { notices, show, dismiss };
}

/** The notice, fixed at the bottom as one compact card — the text over the full width with × beside
 * it, the actions in one short row under it (a grid, so the DOM order stays text, actions, ×):
 * `pointer-events-none` everywhere but on its buttons. */
export function TkNoticeLayer({ notices, onDismiss }: { notices: TkNotice[]; onDismiss: (id: string) => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex flex-col items-center gap-2 px-3 pb-3">
      {notices.map(n => (
        <div
          key={n.id}
          data-testid={n.testid}
          role={n.alert ? 'alert' : 'status'}
          className="pointer-events-none grid w-full max-w-md grid-cols-[1fr_auto] items-center gap-x-1 rounded-xl border border-border bg-surface-2 pl-3 pr-1 text-sm leading-snug text-fg shadow-lg"
        >
          <div className="col-start-1 row-start-1 min-w-0 py-1">{n.message}</div>
          {n.actions && n.actions.length > 0 && (
            <div className="col-start-1 row-start-2 flex flex-wrap gap-2 pb-2">
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
          <button
            type="button"
            aria-label="Fechar"
            onClick={() => onDismiss(n.id)}
            className="col-start-2 row-start-1 pointer-events-auto inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      ))}
    </div>
  );
}
