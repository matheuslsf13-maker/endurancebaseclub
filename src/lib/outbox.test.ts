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
