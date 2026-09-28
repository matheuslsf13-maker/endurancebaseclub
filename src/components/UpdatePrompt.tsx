import { useEffect, useRef } from 'react';
import { useToast } from './ui';

const EVENT = 'ebc:sw-need-refresh';

/**
 * Ruling 26: the timekeeper link (`#/c/<token>`) must never see the update prompt — a
 * cronometrista mid-race must not be interrupted; a new build there only takes over on the next
 * launch. Every other route (including no hash at all) is free to show it. Exported as a pure
 * predicate (rather than inlined in main.tsx) so this one-line safety rule has its own unit tests.
 */
export function shouldPromptForUpdate(hash: string): boolean {
  return !hash.startsWith('#/c/');
}

interface NeedRefreshDetail {
  /** Wraps the service worker's `updateSW(true)`: sends skip-waiting, then reloads once it takes over. */
  update: () => void;
}

export interface RegisterSWCallbacks {
  onNeedRefresh: () => void;
  onNeedReload: () => void;
}

/**
 * Builds the two callbacks `registerSW` (virtual:pwa-register) needs, kept here — instead of
 * inlined in main.tsx — so Ruling 26's guarantee has its own unit tests:
 *
 * - `onNeedRefresh`: dispatches the toast event exactly once per waiting build (vite-plugin-pwa
 *   1.3.0 calls it from both the 'installed'(isExternal) and 'waiting' listeners for a tab open
 *   more than ~60 s — without the guard the organizer sees the "Nova versão disponível" toast
 *   twice), and never on `#/c/` (Ruling 26).
 * - `onNeedReload`: workbox-window's default behaviour is `window.location.reload()` in *every*
 *   controlled tab once another tab of the same origin applies the update (`controllerchange`).
 *   That includes an open timekeeper tab — exactly the reload Ruling 26 exists to prevent, since a
 *   MARCAR tap or a half-typed bib would be lost. Passing this callback instead means the
 *   timekeeper tab only reloads on its own next launch, matching every other silent-update path.
 *
 * `getUpdate` is called lazily (only once a refresh is actually needed) so the caller can pass a
 * reference to `updateSW` itself before that binding exists yet (registerSW returns it).
 */
export function buildRegisterSWCallbacks(getUpdate: () => () => void): RegisterSWCallbacks {
  let notified = false;
  return {
    onNeedRefresh() {
      if (!shouldPromptForUpdate(location.hash)) return;
      if (notified) return;
      notified = true;
      window.dispatchEvent(new CustomEvent(EVENT, { detail: { update: getUpdate() } }));
    },
    onNeedReload() {
      if (shouldPromptForUpdate(location.hash)) window.location.reload();
    },
  };
}

/**
 * Mounted once at the app root, inside the providers. main.tsx dispatches `ebc:sw-need-refresh`
 * whenever a new build is waiting to activate — never on the timekeeper route (Ruling 26): a
 * cronometrista mid-race must never be interrupted, so the update there only applies on next launch.
 * Everywhere else this shows a small, non-blocking prompt the organizer chooses when to act on.
 */
export function UpdatePrompt() {
  const toast = useToast();
  // Which toast (if any) this component currently has open — needed to dismiss it below.
  const toastIdRef = useRef<string | null>(null);

  useEffect(() => {
    function onNeedRefresh(event: Event) {
      const { update } = (event as CustomEvent<NeedRefreshDetail>).detail;
      toastIdRef.current = toast.show({
        message: 'Nova versão disponível',
        durationMs: 0,
        actions: [{ label: 'Atualizar', onClick: update, testid: 'sw-update' }],
        testid: 'sw-update-toast',
      });
    }
    // Round 2 N3: this toast is mounted once at the app root (outside the router), so it is not
    // remounted or reconsidered on an in-app navigation — including "Voltar à cronometragem"
    // (C-Minor-7) carrying it from `#/` straight into `#/c/:token`, where it would sit over the
    // "Em prova" rows and can swallow a tap meant for one of them (Ruling 26's hazard class: the
    // timekeeper route must never be interrupted by an update notice). Dismissed the moment the
    // hash enters that route, whether or not it was ever actionable there in the first place.
    function onHashChange() {
      if (toastIdRef.current && !shouldPromptForUpdate(location.hash)) {
        toast.dismiss(toastIdRef.current);
        toastIdRef.current = null;
      }
    }
    window.addEventListener(EVENT, onNeedRefresh);
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener(EVENT, onNeedRefresh);
      window.removeEventListener('hashchange', onHashChange);
    };
  }, [toast]);

  return null;
}
