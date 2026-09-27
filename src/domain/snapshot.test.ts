import { describe, it, expect } from 'vitest';
import { classifyRace } from './ranking';
import { buildFinalizeRows } from './snapshot';
import type { EntryTiming, TimingStatus } from './consolidation';
import type { AthleteRow, EntryRow } from '../lib/types';
import { makeRace, makeEntry, makeAthlete, makeEvent, T0, MIN } from './testing/fixtures';

const ev = { date: '2026-10-11', levels: [] as string[] };
function timing(entry_id: string, final_ms: number | null, status: TimingStatus = final_ms === null ? 'on_course' : 'finished'): EntryTiming {
  return { entry_id, race_id: 'r1', start_ms: T0, legs: [], total_ms: final_ms, final_ms, status, current_leg: null, current_leg_start_ms: null };
}

/**
 * Same fixture race/entries/timings as ranking.test.ts (duplicated here, not imported, so this
 * file does not depend on another test module's internals): 9 finishers with a tie at 18 min, one
 * DNF and one DNS.
 */
function buildFixtureClassification() {
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
  const cls = classifyRace(race, entries, timings, athletes, ev);
  return { cls, athletes };
}

const idOf = (entryId: string) => entryId.replace('e-', '');

describe('buildFinalizeRows', () => {
  const { cls, athletes } = buildFixtureClassification();
  const rows = buildFinalizeRows(makeEvent(), cls, athletes);

  it('returns one row per classified entry', () => {
    expect(rows).toHaveLength(11);
  });

  it('snapshots a ranked finisher (f1)', () => {
    const row = rows.find(r => idOf(r.entry_id) === 'f1')!;
    expect(row.athlete_ids).toEqual(['f1']);
    expect(row.status).toBe('finished');
    expect(row.final_ms).toBe(20 * MIN);
    expect(row.overall_pos).toBe(4);
    expect(row.data.positions).toEqual({ overall: 4, sex: 1, finishers: 9 });
    expect(row.data.category).toEqual({ sex: 'F', age: 36, age_group: '30-39', level: null });
    expect(row.data.podiums).toContainEqual({ ranking_id: 'geral', ranking_name: 'Geral', group_label: 'Feminino', podium_pos: 1 });
    expect(row.data.members).toEqual([{ athlete_id: 'f1', name: 'F1', legs: [0] }]);
    expect(row.data.legs[0]).toEqual({ leg_index: 0, modality: 'run', label: 'Corrida', distance_m: 5000, athlete_id: 'f1', time_ms: null });
    expect(row.data.event).toEqual({ id: 'e1', name: 'Evento Teste', date: '2026-10-11' });
    expect(row.data.race).toEqual({ id: 'r1', name: cls.race.name, team_size: 1 });
  });

  it('snapshots an unranked entry (m5, dnf)', () => {
    const row = rows.find(r => idOf(r.entry_id) === 'm5')!;
    expect(row.status).toBe('dnf');
    expect(row.final_ms).toBeNull();
    expect(row.overall_pos).toBeNull();
    expect(row.data.podiums).toEqual([]);
  });
});
