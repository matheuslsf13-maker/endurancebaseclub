import { describe, it, expect } from 'vitest';
import { ClockSync, takeSample } from './clock';

describe('ClockSync', () => {
  it('falls back to the device clock until synced', () => {
    const c = new ClockSync({ now: () => 1_000 });
    expect(c.synced).toBe(false);
    expect(c.offsetMs).toBeNull();
    expect(c.now()).toBe(1_000);
  });
  it('uses the minimum-RTT sample', () => {
    const c = new ClockSync({ now: () => 10_000 });
    c.addSample({ t0: 1000, t1: 1400, server: 6200 }); // rtt 400 → offset 5000
    c.addSample({ t0: 2000, t1: 2100, server: 7100 }); // rtt 100 → offset 5050
    c.addSample({ t0: 3000, t1: 3300, server: 8000 }); // rtt 300 → offset 4850
    expect(c.offsetMs).toBe(5050);
    expect(c.rttMs).toBe(100);
    expect(c.now()).toBe(15_050);
  });
  it('keeps only the last N samples and ignores negative RTT', () => {
    const c = new ClockSync({ maxSamples: 2, now: () => 0 });
    c.addSample({ t0: 0, t1: 10, server: 105 });
    c.addSample({ t0: 0, t1: 50, server: 225 });
    c.addSample({ t0: 0, t1: 40, server: 320 });
    c.addSample({ t0: 10, t1: 5, server: 999 });
    expect(c.offsetMs).toBe(300);
  });
  it('persists and restores state', () => {
    const c = new ClockSync({ now: () => 5_000 });
    c.addSample({ t0: 1000, t1: 1100, server: 2050 });
    expect(c.state()).toEqual({ offset_ms: 1000, rtt_ms: 100, synced_at: 5000 });
    const d = new ClockSync({ now: () => 9_000, initial: c.state() });
    expect(d.synced).toBe(true);
    expect(d.now()).toBe(10_000);
  });
  it('takeSample brackets the server call', async () => {
    let t = 100;
    const s = await takeSample(async () => { t += 50; return 999; }, () => (t += 10));
    expect(s).toEqual({ t0: 110, t1: 170, server: 999 });
  });
});
