import { describe, it, expect } from 'vitest';
import { classifyRace } from './ranking';
import type { EntryTiming, TimingStatus } from './consolidation';
import type { AthleteRow, EntryRow } from '../lib/types';
import { makeRace, makeEntry, makeAthlete, T0, MIN } from './testing/fixtures';

const ev = { date: '2026-10-11', levels: [] as string[] };
function timing(entry_id: string, final_ms: number | null, status: TimingStatus = final_ms === null ? 'on_course' : 'finished'): EntryTiming {
  return { entry_id, race_id: 'r1', start_ms: T0, legs: [], total_ms: final_ms, final_ms, status, current_leg: null, current_leg_start_ms: null };
}
const people: [string, 'M' | 'F', string | null, number | null, EntryRow['status']?][] = [
  ['f1', 'F', '1990-01-01', 20 * MIN], ['f2', 'F', '2000-01-01', 21 * MIN], ['f3', 'F', '1992-01-01', 22 * MIN],
  ['f4', 'F', '1988-01-01', 23 * MIN], ['f5', 'F', '2001-01-01', 24 * MIN],
  ['m1', 'M', '1995-01-01', 18 * MIN], ['m2', 'M', '1995-05-05', 18 * MIN], ['m3', 'M', '1980-01-01', 19 * MIN],
  ['m4', 'M', null, 25 * MIN], ['m5', 'M', '1990-01-01', null, 'dnf'], ['f6', 'F', '1990-01-01', null, 'dns'],
];
const athletes = new Map<string, AthleteRow>(people.map(([id, sex, birth]) => [id, makeAthlete({ id, sex, birth_date: birth, name: id.toUpperCase() })]));
const entries = people.map(([id, , , , status], i) => makeEntry({ id: `e-${id}`, bib: String(i + 1), status: status ?? 'ok', members: [{ athlete_id: id, position: 0, legs: [0] }] }));
const timings = new Map(people.map(([id, , , fin, status]) => [`e-${id}`, timing(`e-${id}`, fin, status === 'dnf' ? 'dnf' : status === 'dns' ? 'dns' : undefined)]));
const race = makeRace({ legs: [{ modality: 'run', label: 'Corrida', distance_m: 5000 }] });
const idOf = (r: { entry: EntryRow }) => r.entry.id.replace('e-', '');

describe('classifyRace', () => {
  const cls = classifyRace(race, entries, timings, athletes, ev);
  it('orders finishers with shared positions for ties, then non-finishers', () => {
    expect(cls.rows.map(idOf)).toEqual(['m1', 'm2', 'm3', 'f1', 'f2', 'f3', 'f4', 'f5', 'm4', 'm5', 'f6']);
    expect(cls.rows.map(r => r.overall_pos)).toEqual([1, 1, 3, 4, 5, 6, 7, 8, 9, null, null]);
    expect(cls.finishers).toBe(9);
  });
  it('computes sex positions, gaps and per-ranking positions', () => {
    const byId = new Map(cls.rows.map(r => [idOf(r), r]));
    expect(byId.get('m4')!.sex_pos).toBe(4);
    expect(byId.get('f1')!.sex_pos).toBe(1);
    expect(byId.get('f1')!.gap_ms).toBe(2 * MIN);
    expect(byId.get('f4')!.ranking_pos).toEqual({ geral: 4, faixa: 3 });
  });
  it('non-cumulative podiums skip athletes already awarded', () => {
    const geral = cls.podiums.filter(p => p.ranking.id === 'geral');
    expect(geral.map(g => [g.group_label, g.places.map(p => [idOf(p.ranked), p.podium_pos])])).toEqual([
      ['Masculino', [['m1', 1], ['m2', 1], ['m3', 3]]],
      ['Feminino', [['f1', 1], ['f2', 2], ['f3', 3]]],
    ]);
    const faixa = cls.podiums.filter(p => p.ranking.id === 'faixa');
    expect(faixa.map(g => [g.group_label, g.places.map(p => [idOf(p.ranked), p.podium_pos])])).toEqual([
      ['Masculino · Sem faixa', [['m4', 1]]],
      ['Feminino · 20-29', [['f5', 1]]],
      ['Feminino · 30-39', [['f4', 1]]],
    ]);
  });
  it('cumulative podiums repeat athletes', () => {
    const cum = classifyRace({ ...race, config: { ...race.config, cumulative: true } }, entries, timings, athletes, ev);
    const faixa = cum.podiums.filter(p => p.ranking.id === 'faixa');
    expect(faixa.map(g => [g.group_label, g.places.map(p => idOf(p.ranked))])).toEqual([
      ['Masculino · 30-39', ['m1', 'm2']], ['Masculino · 40-49', ['m3']], ['Masculino · Sem faixa', ['m4']],
      ['Feminino · 20-29', ['f2', 'f5']], ['Feminino · 30-39', ['f1', 'f3', 'f4']],
    ]);
  });
  it('team races group by Masculino, Feminino, Misto', () => {
    const duo = makeRace({ team_size: 2 });
    const ath = new Map<string, AthleteRow>([['x1', makeAthlete({ id: 'x1', sex: 'M' })], ['x2', makeAthlete({ id: 'x2', sex: 'M' })], ['y1', makeAthlete({ id: 'y1', sex: 'F' })], ['y2', makeAthlete({ id: 'y2', sex: 'F' })]]);
    const mk = (id: string, a: string, b: string) => makeEntry({ id, team_name: id, members: [{ athlete_id: a, position: 0, legs: [0] }, { athlete_id: b, position: 1, legs: [1] }] });
    const es = [mk('mix', 'x1', 'y1'), mk('fem', 'y1', 'y2'), mk('mas', 'x1', 'x2')];
    const tm = new Map([['mix', timing('mix', 30 * MIN)], ['fem', timing('fem', 31 * MIN)], ['mas', timing('mas', 32 * MIN)]]);
    const c = classifyRace(duo, es, tm, ath, ev);
    expect(c.podiums.map(p => p.group_label)).toEqual(['Masculino', 'Feminino', 'Misto']);
  });
  it('Controller Ruling 9: a finish with no resolvable final time is unranked and sorts before on_course', () => {
    // "Finished" here means a finish crossing was recorded but final_ms is null (e.g. no wave
    // start to compute a total from) — it must NOT count as ranked, and among the unranked rows
    // it sorts first: before on_course, not_started, dnf, dns, dsq.
    const ghostAthlete = makeAthlete({ id: 'ghost', sex: 'M', birth_date: null, name: 'GHOST' });
    const ocAthlete = makeAthlete({ id: 'oc', sex: 'M', birth_date: null, name: 'OC' });
    const ghostEntry = makeEntry({ id: 'e-ghost', bib: '90', members: [{ athlete_id: 'ghost', position: 0, legs: [0] }] });
    const ocEntry = makeEntry({ id: 'e-oc', bib: '91', members: [{ athlete_id: 'oc', position: 0, legs: [0] }] });
    const extraAthletes = new Map(athletes).set('ghost', ghostAthlete).set('oc', ocAthlete);
    const extraTimings = new Map(timings)
      .set('e-ghost', timing('e-ghost', null, 'finished'))
      .set('e-oc', timing('e-oc', null, 'on_course'));

    const withGhost = classifyRace(race, [...entries, ghostEntry, ocEntry], extraTimings, extraAthletes, ev);

    expect(withGhost.rows.map(idOf)).toEqual(['m1', 'm2', 'm3', 'f1', 'f2', 'f3', 'f4', 'f5', 'm4', 'ghost', 'oc', 'm5', 'f6']);
    const ghostRow = withGhost.rows.find(r => idOf(r) === 'ghost')!;
    expect(ghostRow.overall_pos).toBeNull();
    expect(ghostRow.sex_pos).toBeNull();
    expect(withGhost.finishers).toBe(9);
  });
});
