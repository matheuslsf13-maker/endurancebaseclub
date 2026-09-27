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

export class ClockSync {
  private readonly maxSamples: number;
  private readonly nowFn: () => number;
  private readonly initial: ClockState | null;
  private readonly samples: EffectiveSample[] = [];

  constructor(opts?: { maxSamples?: number; now?: () => number; initial?: ClockState | null }) {
    this.maxSamples = opts?.maxSamples ?? 10;
    this.nowFn = opts?.now ?? Date.now;
    this.initial = opts?.initial ?? null;
  }

  addSample(s: ClockSample): void {
    const rtt = s.t1 - s.t0;
    if (rtt < 0) return;
    const offset = Math.round(s.server - (s.t0 + s.t1) / 2);
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
    return this.effective() !== null;
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
