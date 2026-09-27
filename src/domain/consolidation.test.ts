import { describe, it, expect } from 'vitest';
import { median, computeCrossing, computeEntryTiming, computeEventTiming, UNASSIGNED_ISSUE_AFTER_MS } from './consolidation';
import type { IssueType } from './consolidation';
import type { MarkRow, ResolutionRow, WaveRow } from '../lib/types';
import { makeRace, makeWave, makeEntry, makeMark, makeResolution, makeTimekeeper, makeAthlete, T0, SEC, MIN, iso } from './testing/fixtures';

const race = makeRace();
const cfg = race.config;
const L0 = T0 + 10 * MIN;

describe('median', () => {
  it('handles odd, even and empty', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(3);
    expect(median([])).toBeNull();
  });
});

describe('computeCrossing', () => {
  it('uses the median and flags divergence (10:05, 10:06, 10:19 → 10:06)', () => {
    const marks = [makeMark({ at: L0 + 5 * SEC, timekeeper_id: 'tk1' }), makeMark({ at: L0 + 6 * SEC, timekeeper_id: 'tk2' }), makeMark({ at: L0 + 19 * SEC, timekeeper_id: 'tk3' })];
    const c = computeCrossing({ legIndex: 0, marks, resolution: null, config: cfg });
    expect(c.official_ms).toBe(L0 + 6 * SEC);
    expect(c.official_source).toBe('median');
    expect(c.spread_ms).toBe(14 * SEC);
    expect(c.divergent).toBe(true);
  });
  it('two close marks: median is the mean, no divergence', () => {
    const c = computeCrossing({ legIndex: 0, marks: [makeMark({ at: L0, timekeeper_id: 'tk1' }), makeMark({ at: L0 + SEC, timekeeper_id: 'tk2' })], resolution: null, config: cfg });
    expect(c.official_ms).toBe(L0 + 500);
    expect(c.divergent).toBe(false);
  });
  it('organizer can pick a specific mark or type a manual time', () => {
    const a = makeMark({ at: L0, timekeeper_id: 'tk1' });
    const b = makeMark({ at: L0 + 5 * SEC, timekeeper_id: 'tk2' });
    const pick = computeCrossing({ legIndex: 0, marks: [a, b], resolution: makeResolution({ entry_id: 'en1', leg_index: 0, mode: 'mark', mark_id: b.id }), config: cfg });
    expect(pick.official_ms).toBe(L0 + 5 * SEC);
    expect(pick.official_source).toBe('mark');
    const manual = computeCrossing({ legIndex: 0, marks: [a, b], resolution: makeResolution({ entry_id: 'en1', leg_index: 0, mode: 'manual', manual_ts: iso(L0 + 2 * SEC) }), config: cfg });
    expect(manual.official_ms).toBe(L0 + 2 * SEC);
    expect(manual.official_source).toBe('manual');
    const none = computeCrossing({ legIndex: 0, marks: [], resolution: makeResolution({ entry_id: 'en1', leg_index: 0, mode: 'manual', manual_ts: iso(L0) }), config: cfg });
    expect(none.official_ms).toBe(L0);
  });
  it('reference timekeeper policy falls back to the median', () => {
    const refCfg = { ...cfg, time_source: 'reference' as const, reference_timekeeper_id: 'tk2' };
    const marks = [makeMark({ at: L0, timekeeper_id: 'tk1' }), makeMark({ at: L0 + 2 * SEC, timekeeper_id: 'tk2' }), makeMark({ at: L0 + 3 * SEC, timekeeper_id: 'tk3' })];
    expect(computeCrossing({ legIndex: 0, marks, resolution: null, config: refCfg })).toMatchObject({ official_ms: L0 + 2 * SEC, system_source: 'reference' });
    expect(computeCrossing({ legIndex: 0, marks: [marks[0], marks[2]], resolution: null, config: refCfg })).toMatchObject({ official_ms: L0 + 1500, system_source: 'median' });
  });
  it('keeps only the earliest mark per timekeeper and ignores discarded marks', () => {
    const first = makeMark({ at: L0, timekeeper_id: 'tk1' });
    const dup = makeMark({ at: L0 + 300, timekeeper_id: 'tk1' });
    const other = makeMark({ at: L0 + 500, timekeeper_id: 'tk2' });
    const gone = makeMark({ at: L0 + 50 * SEC, timekeeper_id: 'tk3', discarded: true, discarded_by: 'organizer' });
    const c = computeCrossing({ legIndex: 0, marks: [dup, other, first, gone], resolution: null, config: cfg });
    expect(c.candidates.map(x => x.mark_id)).toEqual([first.id, other.id]);
    expect(c.duplicates).toEqual([dup.id]);
    expect(c.official_ms).toBe(L0 + 250);
  });
  it('falls back to the system time when the chosen mark was discarded', () => {
    const a = makeMark({ at: L0, timekeeper_id: 'tk1' });
    const b = makeMark({ at: L0 + SEC, timekeeper_id: 'tk2', discarded: true, discarded_by: 'organizer' });
    const c = computeCrossing({ legIndex: 0, marks: [a, b], resolution: makeResolution({ entry_id: 'en1', leg_index: 0, mode: 'mark', mark_id: b.id }), config: cfg });
    expect(c.chosen_mark_discarded).toBe(true);
    expect(c.official_ms).toBe(L0);
  });
});

describe('computeEntryTiming', () => {
  const relay = makeRace({ team_size: 2 });
  const team = makeEntry({ team_name: 'Tubarões', members: [{ athlete_id: 'a1', position: 0, legs: [0] }, { athlete_id: 'a2', position: 1, legs: [1] }] });
  it('relay handoff: the end of leg 1 starts leg 2 for the next athlete', () => {
    const m0 = makeMark({ at: L0, leg_index: 0 });
    const t1 = computeEntryTiming(team, relay, makeWave(), [m0], []);
    expect(t1.status).toBe('on_course');
    expect(t1.current_leg).toBe(1);
    expect(t1.current_leg_start_ms).toBe(L0);
    expect(t1.legs[1].athlete_id).toBe('a2');
    const t2 = computeEntryTiming(team, relay, makeWave(), [m0, makeMark({ at: T0 + 30 * MIN, leg_index: 1 })], []);
    expect(t2.status).toBe('finished');
    expect(t2.legs.map(l => l.leg_ms)).toEqual([10 * MIN, 20 * MIN]);
    expect(t2.total_ms).toBe(30 * MIN);
  });
  it('adds penalties and honors status overrides', () => {
    const marks = [makeMark({ at: L0, leg_index: 0 }), makeMark({ at: T0 + 30 * MIN, leg_index: 1 })];
    expect(computeEntryTiming(makeEntry({ penalty_ms: 60_000 }), race, makeWave(), marks, []).final_ms).toBe(31 * MIN);
    expect(computeEntryTiming(makeEntry({ status: 'dnf' }), race, makeWave(), marks, []).status).toBe('dnf');
  });
  it('not started without a wave start and without marks', () => {
    const t = computeEntryTiming(makeEntry(), race, makeWave({ start_at: null }), [], []);
    expect(t.status).toBe('not_started');
    expect(t.current_leg).toBeNull();
  });
});

describe('computeEventTiming issues', () => {
  const base = { races: [race], waves: [makeWave()], entries: [makeEntry()], athletes: [makeAthlete()], timekeepers: [makeTimekeeper({ id: 'tk1', name: 'Ana' }), makeTimekeeper({ id: 'tk2', name: 'Bia' }), makeTimekeeper({ id: 'tk3', name: 'Caio' })], resolutions: [] as any[] };
  it('late wave start recomputes everything (Review Focus 5)', () => {
    const marks = [makeMark({ at: L0, leg_index: 0 }), makeMark({ at: T0 + 30 * MIN, leg_index: 1 })];
    const before = computeEventTiming({ ...base, waves: [makeWave({ start_at: null })], marks }, T0 + 40 * MIN);
    expect(before.issues.map(i => i.type)).toContain('no_start');
    expect(before.byEntry.get('en1')!.total_ms).toBeNull();
    const after = computeEventTiming({ ...base, waves: [makeWave({ start_at: iso(T0) })], marks }, T0 + 40 * MIN);
    expect(after.issues.map(i => i.type)).not.toContain('no_start');
    expect(after.byEntry.get('en1')!.total_ms).toBe(30 * MIN);
  });
  it('divergence issue only while unresolved', () => {
    const marks = [makeMark({ at: L0, timekeeper_id: 'tk1' }), makeMark({ at: L0 + 14 * SEC, timekeeper_id: 'tk2' })];
    const open = computeEventTiming({ ...base, marks }, T0 + 20 * MIN);
    const div = open.issues.find(i => i.type === 'divergence')!;
    expect(div.message).toContain('Nº 101');
    expect(div.message).toContain('divergência de 14,0 s');
    const resolved = computeEventTiming({ ...base, marks, resolutions: [makeResolution({ entry_id: 'en1', leg_index: 0, mode: 'system' })] }, T0 + 20 * MIN);
    expect(resolved.issues.find(i => i.type === 'divergence')).toBeUndefined();
  });
  it('outlier near the next crossing suggests moving it (Review Focus 1)', () => {
    const wrong = makeMark({ at: T0 + 30 * MIN + 2 * SEC, timekeeper_id: 'tk3', leg_index: 0 });
    const marks = [
      makeMark({ at: L0, timekeeper_id: 'tk1', leg_index: 0 }), makeMark({ at: L0 + SEC, timekeeper_id: 'tk2', leg_index: 0 }), wrong,
      makeMark({ at: T0 + 30 * MIN, timekeeper_id: 'tk1', leg_index: 1 }), makeMark({ at: T0 + 30 * MIN + 500, timekeeper_id: 'tk2', leg_index: 1 }),
    ];
    const r = computeEventTiming({ ...base, marks }, T0 + 40 * MIN);
    const div = r.issues.find(i => i.type === 'divergence' && i.leg_index === 0)!;
    expect(div.mark_ids).toEqual([wrong.id]);
    expect(div.suggested_leg_index).toBe(1);
    expect(r.byEntry.get('en1')!.legs[0].crossing.official_ms).toBe(L0 + SEC); // median stays robust
  });
  it('missing crossing, order, duplicates, unassigned and not finished', () => {
    const onlyFinish = computeEventTiming({ ...base, marks: [makeMark({ at: T0 + 30 * MIN, leg_index: 1 })] }, T0 + 40 * MIN);
    expect(onlyFinish.issues.find(i => i.type === 'missing_crossing')!.leg_index).toBe(0);
    expect(onlyFinish.byEntry.get('en1')!.total_ms).toBe(30 * MIN);
    const reversed = computeEventTiming({ ...base, marks: [makeMark({ at: T0 + 20 * MIN, leg_index: 0 }), makeMark({ at: T0 + 10 * MIN, leg_index: 1 })] }, T0 + 40 * MIN);
    expect(reversed.issues.find(i => i.type === 'order')!.leg_index).toBe(1);
    const dups = computeEventTiming({ ...base, marks: [makeMark({ at: L0 }), makeMark({ at: L0 + 200 })] }, T0 + 40 * MIN);
    expect(dups.issues.find(i => i.type === 'duplicate')!.message).toContain('Ana marcou mais de uma vez');
    const now = T0 + 40 * MIN;
    const un = computeEventTiming({ ...base, marks: [makeMark({ at: now - 61 * SEC, entry_id: null, leg_index: null }), makeMark({ at: now - 10 * SEC, entry_id: null, leg_index: null })] }, now);
    expect(un.issues.filter(i => i.type === 'unassigned')).toHaveLength(1);
    const running = computeEventTiming({ ...base, marks: [makeMark({ at: L0 })] }, now);
    expect(running.issues.map(i => i.type)).toContain('not_finished');
    const mixed = computeEventTiming({ ...base, marks: [makeMark({ at: now - 61 * SEC, entry_id: null, leg_index: null }), makeMark({ at: L0 })] }, now);
    expect(mixed.issues.map(i => i.severity)).toEqual(['warning', 'info']); // sorted by severity first
  });
});

describe('computeCrossing edge cases', () => {
  it('has no time and no source without candidates', () => {
    const c = computeCrossing({ legIndex: 1, marks: [makeMark({ at: L0, leg_index: 0 })], resolution: null, config: cfg });
    expect(c).toMatchObject({ candidates: [], duplicates: [], median_ms: null, spread_ms: null, system_ms: null, system_source: null, official_ms: null, official_source: null, divergent: false, chosen_mark_discarded: false });
  });
  it('counts each organization mark (no timekeeper) as its own candidate', () => {
    const a = makeMark({ at: L0, timekeeper_id: null });
    const b = makeMark({ at: L0 + SEC, timekeeper_id: null });
    const c = computeCrossing({ legIndex: 0, marks: [a, b], resolution: null, config: cfg });
    expect(c.candidates.map(x => x.mark_id)).toEqual([a.id, b.id]);
    expect(c.duplicates).toEqual([]);
    expect(c.official_ms).toBe(L0 + 500);
  });
  it('reference policy without a chosen timekeeper uses the median, even with organization marks', () => {
    const refCfg = { ...cfg, time_source: 'reference' as const, reference_timekeeper_id: null };
    const marks = [makeMark({ at: L0, timekeeper_id: null }), makeMark({ at: L0 + 2 * SEC, timekeeper_id: 'tk1' })];
    expect(computeCrossing({ legIndex: 0, marks, resolution: null, config: refCfg })).toMatchObject({ official_ms: L0 + SEC, system_source: 'median', official_source: 'median' });
  });
});

describe('computeEntryTiming edge cases', () => {
  it('a started wave without crossings is on course in leg 0 since the start', () => {
    expect(computeEntryTiming(makeEntry(), race, makeWave(), [], [])).toMatchObject({ status: 'on_course', current_leg: 0, current_leg_start_ms: T0, total_ms: null, final_ms: null });
  });
  it('a finish without a wave start is finished but has no total', () => {
    const marks = [makeMark({ at: L0, leg_index: 0 }), makeMark({ at: T0 + 30 * MIN, leg_index: 1 })];
    const t = computeEntryTiming(makeEntry(), race, makeWave({ start_at: null }), marks, []);
    expect(t).toMatchObject({ status: 'finished', start_ms: null, total_ms: null, final_ms: null, current_leg: null, current_leg_start_ms: null });
    expect(t.legs.map(l => l.leg_ms)).toEqual([null, 20 * MIN]);
  });
  it("ignores other entries' marks and resolutions", () => {
    const t = computeEntryTiming(makeEntry(), race, makeWave(), [makeMark({ at: L0, entry_id: 'en2' })], [makeResolution({ entry_id: 'en2', leg_index: 0, mode: 'manual', manual_ts: iso(L0) })]);
    expect(t.legs[0].crossing).toMatchObject({ candidates: [], official_ms: null, resolution: null });
    expect(t.current_leg).toBe(0);
  });
});

describe('computeEventTiming issue details', () => {
  const now = T0 + 40 * MIN; // 08:40:00 in Brasília
  const base = { races: [race], waves: [makeWave()], entries: [makeEntry()], athletes: [makeAthlete()], timekeepers: [makeTimekeeper({ id: 'tk1', name: 'Ana' }), makeTimekeeper({ id: 'tk2', name: 'Bia' })], resolutions: [] as ResolutionRow[] };
  const unassignedBy = (timekeeper_id: string | null) => makeMark({ at: now - 61_300, timekeeper_id, entry_id: null, leg_index: null }); // 08:38:58.7
  const gone = makeMark({ at: L0 + SEC, timekeeper_id: 'tk2', discarded: true, discarded_by: 'organizer' });
  const cases: { name: string; type: IssueType; marks: MarkRow[]; waves?: WaveRow[]; resolutions?: ResolutionRow[]; message: string }[] = [
    { name: 'divergence', type: 'divergence', marks: [makeMark({ at: L0, timekeeper_id: 'tk1' }), makeMark({ at: L0 + 14 * SEC, timekeeper_id: 'tk2' })], message: 'Nº 101 · Perna 1 (Natação): divergência de 14,0 s entre cronometristas' },
    { name: 'duplicate', type: 'duplicate', marks: [makeMark({ at: L0 }), makeMark({ at: L0 + 200 })], message: 'Nº 101 · Perna 1 (Natação): Ana marcou mais de uma vez' },
    { name: 'chosen mark discarded', type: 'chosen_mark_discarded', marks: [makeMark({ at: L0 }), gone], resolutions: [makeResolution({ entry_id: 'en1', leg_index: 0, mode: 'mark', mark_id: gone.id })], message: 'Nº 101 · Perna 1 (Natação): a marcação escolhida foi descartada' },
    { name: 'missing crossing', type: 'missing_crossing', marks: [makeMark({ at: T0 + 30 * MIN, leg_index: 1 })], message: 'Nº 101 · Perna 1 (Natação): passagem não registrada (há passagem posterior)' },
    { name: 'order', type: 'order', marks: [makeMark({ at: T0 + 20 * MIN, leg_index: 0 }), makeMark({ at: T0 + 10 * MIN, leg_index: 1 })], message: 'Nº 101 · Perna 2 (Corrida): passagem antes da anterior/largada' },
    { name: 'no start', type: 'no_start', marks: [makeMark({ at: L0 })], waves: [makeWave({ start_at: null })], message: 'Nº 101: marcação sem largada registrada (Largada geral)' },
    { name: 'no start (race without waves)', type: 'no_start', marks: [makeMark({ at: L0 })], waves: [], message: 'Nº 101: marcação sem largada registrada' },
    { name: 'not finished', type: 'not_finished', marks: [makeMark({ at: L0 })], message: 'Nº 101: ainda em prova' },
    { name: 'unassigned (timekeeper)', type: 'unassigned', marks: [unassignedBy('tk2')], message: 'Marcação 08:38:58.7 (Bia) sem atleta' },
    { name: 'unassigned (organization)', type: 'unassigned', marks: [unassignedBy(null)], message: 'Marcação 08:38:58.7 (Organização) sem atleta' },
    { name: 'unassigned (timekeeper not loaded yet)', type: 'unassigned', marks: [unassignedBy('tk9')], message: 'Marcação 08:38:58.7 (Cronometrista) sem atleta' },
  ];
  it.each(cases)('$name message', ({ type, marks, waves, resolutions, message }) => {
    const r = computeEventTiming({ ...base, marks, waves: waves ?? base.waves, resolutions: resolutions ?? base.resolutions }, now);
    expect(r.issues.find(i => i.type === type)?.message).toBe(message);
  });
  it('two timekeepers: the misassigned mark comes first in mark_ids so it can be moved (Review Focus 1)', () => {
    // tk2 missed the swim finish, then tapped the run finish offline and it was filed as leg 0.
    const swim = makeMark({ at: L0, timekeeper_id: 'tk1', leg_index: 0 });
    const wrong = makeMark({ at: T0 + 30 * MIN + SEC, timekeeper_id: 'tk2', leg_index: 0 });
    const finish = makeMark({ at: T0 + 30 * MIN, timekeeper_id: 'tk1', leg_index: 1 });
    const div = computeEventTiming({ ...base, marks: [swim, wrong, finish] }, now).issues.find(i => i.type === 'divergence')!;
    expect(div).toMatchObject({ entry_id: 'en1', race_id: 'r1', leg_index: 0, suggested_leg_index: 1, mark_ids: [wrong.id, swim.id] });
  });
  it('a divergence with no mark beyond the threshold still names the mark farthest from the median', () => {
    // 0 s, 2 s, 4 s: spread 4 s > 3 s, yet each mark is ≤ 2 s from the 2 s median; the 0 s / 4 s tie goes to the earlier candidate.
    const first = makeMark({ at: L0, timekeeper_id: 'tk1' });
    const marks = [makeMark({ at: L0 + 4 * SEC, timekeeper_id: 'tk3' }), makeMark({ at: L0 + 2 * SEC, timekeeper_id: 'tk2' }), first];
    const div = computeEventTiming({ ...base, marks }, now).issues.find(i => i.type === 'divergence')!;
    expect(div.mark_ids).toEqual([first.id]);
    expect(div.suggested_leg_index).toBeUndefined();
  });
  it('reports duplicates once per timekeeper', () => {
    const ana2 = makeMark({ at: L0 + 200, timekeeper_id: 'tk1' });
    const bia2 = makeMark({ at: L0 + 300, timekeeper_id: 'tk2' });
    const marks = [makeMark({ at: L0, timekeeper_id: 'tk1' }), ana2, makeMark({ at: L0 + 100, timekeeper_id: 'tk2' }), bia2];
    const dups = computeEventTiming({ ...base, marks }, now).issues.filter(i => i.type === 'duplicate');
    expect(dups.map(i => [i.message, i.mark_ids])).toEqual([
      ['Nº 101 · Perna 1 (Natação): Ana marcou mais de uma vez', [ana2.id]],
      ['Nº 101 · Perna 1 (Natação): Bia marcou mais de uma vez', [bia2.id]],
    ]);
  });
  it('a crossing at or before the wave start is out of order', () => {
    const r = computeEventTiming({ ...base, marks: [makeMark({ at: T0, leg_index: 0 })] }, now);
    expect(r.issues.filter(i => i.type === 'order').map(i => i.leg_index)).toEqual([0]);
  });
  it('an unassigned mark becomes an issue only after 60 s and while not discarded', () => {
    const late = makeMark({ at: now - 61 * SEC, entry_id: null, leg_index: null });
    const marks = [late, makeMark({ at: now - 60 * SEC, entry_id: null, leg_index: null }), makeMark({ at: now - 5 * MIN, entry_id: null, leg_index: null, discarded: true, discarded_by: 'timekeeper' })];
    expect(computeEventTiming({ ...base, marks }, now).issues.filter(i => i.type === 'unassigned')).toEqual([
      { type: 'unassigned', severity: 'warning', message: 'Marcação 08:38:59.0 (Ana) sem atleta', mark_ids: [late.id] },
    ]);
  });
  it('exports the 60 s unassigned threshold (spec §8) the timekeeper screen shares', () => {
    expect(UNASSIGNED_ISSUE_AFTER_MS).toBe(60_000);
  });
  it('orders issues of the same severity by message, with numeric-aware bibs', () => {
    const r = computeEventTiming({ ...base, entries: [makeEntry(), makeEntry({ id: 'en2', bib: '9' })], marks: [] }, now);
    expect(r.issues.map(i => i.message)).toEqual(['Nº 9: ainda em prova', 'Nº 101: ainda em prova']);
  });
});
