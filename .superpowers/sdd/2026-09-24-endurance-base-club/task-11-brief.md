## Task 11: Domain — classification, podiums, finalize snapshot

**Files:**
- Create: `src/domain/ranking.ts`, `src/domain/ranking.test.ts`, `src/domain/snapshot.ts`, `src/domain/snapshot.test.ts`

**Interfaces:**
- Consumes: Tasks 9–10 (`entryCategory`, `groupKey`, `groupLabel`, `EntryTiming`), types.
- Produces: `classifyRace`, `RankedEntry`, `PodiumGroup`, `RaceClassification`, `buildFinalizeRows`.

Rules (spec §9): ranked = `status === 'finished' && final_ms !== null`, ordered by `final_ms`, ties share the position (competition ranking), display tie-break by numeric-aware bib. Unranked rows follow in this status order: `on_course`, `not_started`, `dnf`, `dns`, `dsq` (then bib). `sex_pos` within entry sex. `ranking_pos[r.id]` = competition position inside `groupKey(r.dims)`. `gap_ms` = `final_ms − leader final_ms`. Podiums: for each ranking in config order, groups ordered by sex `M, F, MISTO`, then age group by `min` (`Sem faixa` last), then level by `event.levels` order (`Sem nível` last); places = ranked entries of the group, excluding (when `cumulative === false`) entries already placed in an earlier ranking, re-ranked with competition positions, keeping those with position `<= size`; omit empty groups.

- [ ] **Step 1: Write failing `src/domain/ranking.test.ts`**

```ts
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
});
```

(`faixa` for `f4` = 3 because `F|30-39` finishers are f1 (1990→36), f3 (1992→34), f4 (1988→38) in time order.)

- [ ] **Step 2: Write failing `src/domain/snapshot.test.ts`**: using the same fixture data (export the setup from the ranking test into a local helper within the snapshot test), `buildFinalizeRows(makeEvent(), cls, athletes)` returns 11 rows; row for `f1`: `athlete_ids ['f1']`, `status 'finished'`, `final_ms 20*MIN`, `overall_pos 4`, `data.positions {overall: 4, sex: 1, finishers: 9}`, `data.category {sex: 'F', age: 36, age_group: '30-39', level: null}`, `data.podiums` contains `{ranking_id: 'geral', ranking_name: 'Geral', group_label: 'Feminino', podium_pos: 1}`, `data.members [{athlete_id: 'f1', name: 'F1', legs: [0]}]`, `data.legs[0]` = `{leg_index: 0, modality: 'run', label: 'Corrida', distance_m: 5000, athlete_id: 'f1', time_ms: null}` (fixture timings have no legs → `time_ms` null), `data.event {id:'e1', name:'Evento Teste', date:'2026-10-11'}`, `data.race {id:'r1', name: race.name, team_size: 1}`; row for `m5`: `status 'dnf'`, `final_ms null`, `overall_pos null`, `data.podiums []`.
- [ ] **Step 3:** run → FAIL. **Step 4:** implement (`buildFinalizeRows` maps each `RankedEntry`: legs from `race.legs` merged with `timing.legs[k]?.leg_ms ?? null` and `legAthleteId`; podiums collected from `cls.podiums` places). **Step 5:** run → PASS. **Step 6: Commit** (`feat(domain): classification, podiums and finalize snapshot`).

---

