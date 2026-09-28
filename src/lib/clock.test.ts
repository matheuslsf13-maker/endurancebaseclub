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
  it('drops samples whose offset differs from the newest by more than 1 s (device clock step, B1-M11)', () => {
    const c = new ClockSync({ now: () => 0 });
    c.addSample({ t0: 1000, t1: 1100, server: 6050 }); // rtt 100 -> offset 5000 (best RTT so far)
    c.addSample({ t0: 2000, t1: 2300, server: 7200 }); // rtt 300 -> offset 5050
    expect(c.offsetMs).toBe(5000);
    // The OS stepped the device clock 3 s forward: from now on its offset is ~2000. The old
    // minimum-RTT sample would otherwise keep winning (and shift every mark by 3 s) for ~200 s.
    c.addSample({ t0: 10_000, t1: 10_400, server: 12_200 }); // rtt 400 -> offset 2000
    expect(c.offsetMs).toBe(2000);
    expect(c.rttMs).toBe(400);
    // Samples within 1 s of the newest are kept and still compete on RTT.
    c.addSample({ t0: 11_000, t1: 11_050, server: 13_425 }); // rtt 50 -> offset 2400
    expect(c.offsetMs).toBe(2400);
  });
  it('keeps the good low-RTT samples when one slow, asymmetric sample arrives (not a clock step)', () => {
    const c = new ClockSync({ now: () => 0 });
    c.addSample({ t0: 1000, t1: 1100, server: 6050 }); // rtt 100 -> offset 5000 (true offset)
    c.addSample({ t0: 2000, t1: 2200, server: 7100 }); // rtt 200 -> offset 5000
    // Request 2.9 s, response 0.1 s on a congested link: rtt 3000, offset 6400 — its error (up to
    // rtt/2 = 1.5 s) explains the 1.4 s gap, so its interval overlaps the good samples'.
    c.addSample({ t0: 10_000, t1: 13_000, server: 17_900 });
    expect(c.offsetMs).toBe(5000);
    expect(c.rttMs).toBe(100);
    expect(c.state()).toEqual({ offset_ms: 5000, rtt_ms: 100, synced_at: 0 });
  });
  it('treats a restored state older than maxInitialAgeMs as not synchronized, but still applies its offset (B2-m4)', () => {
    const H = 3_600_000;
    const stale = new ClockSync({ now: () => 13 * H, initial: { offset_ms: 700, rtt_ms: 80, synced_at: 0 }, maxInitialAgeMs: 12 * H });
    expect(stale.synced).toBe(false);
    expect(stale.offsetMs).toBe(700);
    expect(stale.now()).toBe(13 * H + 700);
    const fresh = new ClockSync({ now: () => 11 * H, initial: { offset_ms: 700, rtt_ms: 80, synced_at: 0 }, maxInitialAgeMs: 12 * H });
    expect(fresh.synced).toBe(true);
    // A real sample makes it synchronized again.
    stale.addSample({ t0: 13 * H, t1: 13 * H + 100, server: 13 * H + 750 });
    expect(stale.synced).toBe(true);
  });
  it('takeSample brackets the server call', async () => {
    let t = 100;
    const s = await takeSample(async () => { t += 50; return 999; }, () => (t += 10));
    expect(s).toEqual({ t0: 110, t1: 170, server: 999 });
  });
});
