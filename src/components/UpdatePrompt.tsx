import { useEffect } from 'react';
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

/**
 * Mounted once at the app root, inside the providers. main.tsx dispatches `ebc:sw-need-refresh`
 * whenever a new build is waiting to activate — never on the timekeeper route (Ruling 26): a
 * cronometrista mid-race must never be interrupted, so the update there only applies on next launch.
 * Everywhere else this shows a small, non-blocking prompt the organizer chooses when to act on.
 */
export function UpdatePrompt() {
  const toast = useToast();

  useEffect(() => {
    function onNeedRefresh(event: Event) {
      const { update } = (event as CustomEvent<NeedRefreshDetail>).detail;
      toast.show({
        message: 'Nova versão disponível',
        durationMs: 0,
        actions: [{ label: 'Atualizar', onClick: update, testid: 'sw-update' }],
        testid: 'sw-update-toast',
      });
    }
    window.addEventListener(EVENT, onNeedRefresh);
    return () => window.removeEventListener(EVENT, onNeedRefresh);
  }, [toast]);

  return null;
}
