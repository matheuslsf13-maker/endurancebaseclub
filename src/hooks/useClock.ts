import { useEffect } from 'react';
import { api } from '../lib/api';
import { ClockSync, takeSample } from '../lib/clock';
import type { ClockState } from '../lib/clock';
import { readJSON, safeLocalStorage, writeJSON } from '../lib/storage';

// Clock synchronized with the server (spec §7.2): one instance for the whole app, so every
// screen stamps and displays times with the same offset.
const STORAGE_KEY = 'ebc.clock';
const INITIAL_SAMPLES = 5;
const INITIAL_SPACING_MS = 300;
const RESYNC_MS = 20_000;

let clock: ClockSync | null = null;
let sampling = false;

function isClockState(v: unknown): v is ClockState {
  const s = v as Partial<ClockState> | null;
  return (
    typeof s === 'object' && s !== null &&
    Number.isFinite(s.offset_ms) && Number.isFinite(s.rtt_ms) && Number.isFinite(s.synced_at)
  );
}

function getClock(): ClockSync {
  if (!clock) {
    // The offset saved by the last sync keeps times right after a reload without internet.
    const saved = readJSON<unknown>(safeLocalStorage(), STORAGE_KEY, null);
    clock = new ClockSync({ initial: isClockState(saved) ? saved : null });
  }
  return clock;
}

async function sample(c: ClockSync): Promise<void> {
  try {
    c.addSample(await takeSample(() => api.serverTime()));
    const state = c.state();
    if (state) writeJSON(safeLocalStorage(), STORAGE_KEY, state);
  } catch {
    // Offline: keep the current offset until the next sample succeeds.
  }
}

function startSampling(c: ClockSync): void {
  if (sampling) return;
  sampling = true;
  void (async () => {
    for (let i = 0; i < INITIAL_SAMPLES; i++) {
      if (i > 0) await new Promise((resolve) => setTimeout(resolve, INITIAL_SPACING_MS));
      await sample(c);
    }
  })();
  setInterval(() => void sample(c), RESYNC_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void sample(c);
  });
}

/** The app-wide server-synchronized clock; the first caller starts the sampling loop. */
export function useClock(): ClockSync {
  const c = getClock();
  useEffect(() => startSampling(c), [c]);
  return c;
}
