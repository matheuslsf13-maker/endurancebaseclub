## Task 13: Synced clock and offline outbox

**Files:**
- Create: `src/lib/clock.ts`, `src/lib/clock.test.ts`, `src/lib/outbox.ts`, `src/lib/outbox.test.ts`

**Interfaces:**
- Consumes: `src/lib/storage.ts`, `TkMarkInput`.
- Produces: `ClockSync`, `takeSample`, `ClockState`, `Outbox`, `LocalMark`, `OutboxItem` (see "Libs signatures").

Rules: an RTT < 0 sample is ignored; `offset = server − (t0 + t1)/2` (round to integer ms); the effective offset is the one of the minimum-RTT sample among the last `maxSamples` (default 10); with no samples but an `initial` state, use it (`synced` true, `syncedAt` from state); `now()` = `now() + (offset ?? 0)`; `state()` returns `{offset_ms, rtt_ms, synced_at}` of the effective sample (`synced_at` = injected `now()` when that sample was added). Outbox persists `{items: {[id]: OutboxItem}}` under its key via `writeJSON` after every mutation; corrupted JSON → empty.

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/clock.test.ts
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
```

```ts
// src/lib/outbox.test.ts
import { describe, it, expect } from 'vitest';
import { Outbox } from './outbox';
import { memoryStorage } from './storage';

const base = { ts: '2026-10-11T11:10:00.000Z', device_ts: '2026-10-11T11:10:00.000Z', clock_offset_ms: 0, clock_rtt_ms: 80, entry_id: null, leg_index: null, athlete_id: null, discarded: false };
describe('Outbox', () => {
  it('stores new marks as pending and persists them', () => {
    const s = memoryStorage(); let t = 1;
    new Outbox(s, 'k', () => t++).upsert({ id: 'm1', ...base });
    const again = new Outbox(s, 'k');
    expect(again.get('m1')!.state).toBe('pending');
    expect(again.pendingCount()).toBe(1);
  });
  it('only confirms marks that did not change while in flight', () => {
    const s = memoryStorage(); let t = 1; const o = new Outbox(s, 'k', () => t++);
    o.upsert({ id: 'm1', ...base });
    o.upsert({ id: 'm2', ...base, ts: '2026-10-11T11:11:00.000Z' });
    const batch = o.pending();
    o.markSent(batch);
    const { local_updated_at: _ignored, ...m2 } = batch[1];
    o.upsert({ ...m2, entry_id: 'en1', leg_index: 0 });
    o.applyResult(['m1', 'm2'], []);
    expect(o.get('m1')!.state).toBe('synced');
    expect(o.get('m2')!.state).toBe('pending');
  });
  it('records rejections and re-queues on edit', () => {
    const s = memoryStorage(); let t = 1; const o = new Outbox(s, 'k', () => t++);
    o.upsert({ id: 'm1', ...base });
    o.markSent(o.pending());
    o.applyResult([], [{ id: 'm1', reason: 'Perna inválida' }]);
    expect(o.get('m1')).toMatchObject({ state: 'rejected', reason: 'Perna inválida' });
    expect(o.pendingCount()).toBe(0);
    o.upsert({ id: 'm1', ...base, discarded: true });
    expect(o.get('m1')!.state).toBe('pending');
  });
  it('orders by ts and honors limits', () => {
    const s = memoryStorage(); const o = new Outbox(s, 'k');
    o.upsert({ id: 'late', ...base, ts: '2026-10-11T11:20:00.000Z' });
    o.upsert({ id: 'early', ...base, ts: '2026-10-11T11:00:00.000Z' });
    expect(o.all().map(i => i.mark.id)).toEqual(['early', 'late']);
    expect(o.pending(1).map(m => m.id)).toEqual(['early']);
  });
  it('survives corrupted storage', () => {
    const s = memoryStorage(); s.setItem('k', '{oops');
    expect(new Outbox(s, 'k').all()).toEqual([]);
  });
});
```

- [ ] **Step 2:** run `npx vitest run src/lib` → FAIL. **Step 3:** implement. **Step 4:** run → PASS. **Step 5: Commit** (`feat(lib): synced clock and offline outbox`).

---

