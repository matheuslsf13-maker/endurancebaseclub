// NTP-style clock sync: brackets a server-time call with two local timestamps
// (t0 before, t1 after) and derives the offset from the midpoint, so marks
// timestamped with `now()` line up across timekeepers' devices regardless of
// each device's own clock drift. See design spec §7.2.

export interface ClockSample {
  t0: number;
  t1: number;
  server: number;
}

export interface ClockState {
  offset_ms: number;
  rtt_ms: number;
  synced_at: number;
}

interface EffectiveSample {
  offset: number;
  rtt: number;
  addedAt: number;
}

/** A sample whose offset differs from the newest one by more than this is from before a device
 * clock step (an OS/NTP/NITZ correction), not network jitter: it is dropped (B1-M11). */
const CLOCK_STEP_MS = 1_000;

export class ClockSync {
  private readonly maxSamples: number;
  private readonly nowFn: () => number;
  private readonly initial: ClockState | null;
  private readonly maxInitialAgeMs: number;
  private samples: EffectiveSample[] = [];

  /**
   * `initial`: the state saved by an earlier sync, used until the first sample arrives. Once it is
   * older than `maxInitialAgeMs` its offset is still applied (better than the raw device clock),
   * but the clock no longer reports itself `synced`.
   */
  constructor(opts?: { maxSamples?: number; now?: () => number; initial?: ClockState | null; maxInitialAgeMs?: number }) {
    this.maxSamples = opts?.maxSamples ?? 10;
    this.nowFn = opts?.now ?? Date.now;
    this.initial = opts?.initial ?? null;
    this.maxInitialAgeMs = opts?.maxInitialAgeMs ?? Infinity;
  }

  addSample(s: ClockSample): void {
    const rtt = s.t1 - s.t0;
    if (rtt < 0) return;
    const offset = Math.round(s.server - (s.t0 + s.t1) / 2);
    // After a device clock step every earlier sample is off by the size of the step; keeping them
    // would let a pre-step minimum-RTT sample win for up to `maxSamples` more samples.
    this.samples = this.samples.filter(x => Math.abs(x.offset - offset) <= CLOCK_STEP_MS);
    this.samples.push({ offset, rtt, addedAt: this.nowFn() });
    if (this.samples.length > this.maxSamples) this.samples.shift();
  }

  private effective(): EffectiveSample | null {
    if (this.samples.length === 0) {
      if (!this.initial) return null;
      return { offset: this.initial.offset_ms, rtt: this.initial.rtt_ms, addedAt: this.initial.synced_at };
    }
    return this.samples.reduce((min, s) => (s.rtt < min.rtt ? s : min));
  }

  get offsetMs(): number | null {
    return this.effective()?.offset ?? null;
  }

  get rttMs(): number | null {
    return this.effective()?.rtt ?? null;
  }

  get synced(): boolean {
    if (this.samples.length > 0) return true;
    return this.initial !== null && this.nowFn() - this.initial.synced_at <= this.maxInitialAgeMs;
  }

  get syncedAt(): number | null {
    return this.effective()?.addedAt ?? null;
  }

  now(): number {
    return this.nowFn() + (this.offsetMs ?? 0);
  }

  state(): ClockState | null {
    const eff = this.effective();
    if (!eff) return null;
    return { offset_ms: eff.offset, rtt_ms: eff.rtt, synced_at: eff.addedAt };
  }
}

export async function takeSample(serverTime: () => Promise<number>, now: () => number = Date.now): Promise<ClockSample> {
  const t0 = now();
  const server = await serverTime();
  const t1 = now();
  return { t0, t1, server };
}
