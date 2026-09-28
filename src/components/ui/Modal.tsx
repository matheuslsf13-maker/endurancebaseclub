import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type ModalSize = 'md' | 'lg' | 'xl';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  /** false disables click-outside-to-close on the backdrop; Escape and any explicit close control
   * (the "×" button, a form's own Cancelar) still work. Defaults to true. Data-entry forms set this
   * to false so a stray tap outside the dialog — easy to trigger on a phone — never silently
   * discards what the organizer typed. */
  closeOnBackdrop?: boolean;
}

const SIZE_CLASSES: Record<ModalSize, string> = {
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

// Elements a dialog can hand focus to. Deliberately layout-free (no
// offsetParent/getBoundingClientRect checks) so it works the same in jsdom
// tests as in a real browser.
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

// A module-level stack of every currently-open Modal's dialog element, top of stack last. Every
// open Modal adds its own `document` keydown listener (needed so each dialog keeps working
// independently of render order), but with two dialogs open — today only "+ Novo atleta" nested
// inside "Nova/Editar inscrição" (spec §12) — *both* listeners used to react to the same keydown:
// Escape closed both dialogs at once (losing whatever the organizer had typed in the outer form),
// and the two focus traps fought over Tab. Consulting this stack lets a listener act only when its
// own dialog is the top-most one, so Escape closes just the inner dialog and Tab stays inside it.
const openStack: HTMLDivElement[] = [];

export function Modal({ open, onClose, title, children, footer, size = 'md', closeOnBackdrop = true }: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Registers this dialog on the shared stack for as long as it's open, topmost last.
  useEffect(() => {
    if (!open) return;
    const container = dialogRef.current;
    if (!container) return;
    openStack.push(container);
    return () => {
      const i = openStack.indexOf(container);
      if (i !== -1) openStack.splice(i, 1);
    };
  }, [open]);

  // Escape closes; Tab/Shift+Tab is trapped inside the dialog while it's open. Only the top-most
  // open dialog's listener acts on a given keydown — see `openStack` above.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      const container = dialogRef.current;
      if (!container || openStack[openStack.length - 1] !== container) return;
      if (e.key === 'Escape') {
        // A widget nested inside the dialog (e.g. EntryForm's athlete combobox) that already
        // called `preventDefault()` on its own Escape handling — to close just its popup — has
        // claimed this keystroke; the dialog itself must not also close on it.
        if (e.defaultPrevented) return;
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = getFocusable(container);
      if (focusables.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !container.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !container.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  // On open, remember what had focus and move focus into the dialog; on
  // close, give it back. Deliberately keyed only on `open` so it runs once
  // per open/close transition, not on every re-render while open.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const container = dialogRef.current;
    if (container) {
      const target = getFocusable(container)[0] ?? container;
      target.focus();
    }
    return () => {
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        data-testid="modal-backdrop"
        aria-hidden="true"
        className="absolute inset-0 bg-black/60"
        onClick={closeOnBackdrop ? onClose : undefined}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative z-10 flex max-h-[85vh] w-full flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl ${SIZE_CLASSES[size]}`}
      >
        <div className="flex items-center justify-between gap-4 border-b border-border p-4 sm:p-6">
          <h2 id={titleId} className="brand-title text-lg font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-xl hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className="overflow-y-auto p-4 sm:p-6">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-border p-4 sm:p-6">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
