import { describe, it, expect } from 'vitest';
import { suggestLeg, planBibAssignment } from './suggestLeg';
import { makeRace, makeEntry, makeMark, T0, SEC, MIN } from './testing/fixtures';

const solo = makeRace();
const soloEntry = makeEntry();
describe('suggestLeg', () => {
  it('first arrival is leg 0', () => {
    expect(suggestLeg({ entry: soloEntry, race: solo, marks: [], tsMs: T0 + 10 * MIN })).toMatchObject({ leg_index: 0, reason: 'next', warning: null, athlete_id: 'a1' });
  });
  it('another timekeeper confirming the same crossing gets the same leg', () => {
    const marks = [makeMark({ at: T0 + 10 * MIN, leg_index: 0, timekeeper_id: 'tk2' })];
    expect(suggestLeg({ entry: soloEntry, race: solo, marks, tsMs: T0 + 10 * MIN + 2 * SEC })).toMatchObject({ leg_index: 0, reason: 'same_crossing' });
  });
  it('a later arrival is the next leg', () => {
    const marks = [makeMark({ at: T0 + 10 * MIN, leg_index: 0 })];
    expect(suggestLeg({ entry: soloEntry, race: solo, marks, tsMs: T0 + 40 * MIN })).toMatchObject({ leg_index: 1, reason: 'next' });
  });
  it('warns when the entry already finished', () => {
    const marks = [makeMark({ at: T0 + 10 * MIN, leg_index: 0 }), makeMark({ at: T0 + 30 * MIN, leg_index: 1 })];
    expect(suggestLeg({ entry: soloEntry, race: solo, marks, tsMs: T0 + 60 * MIN })).toMatchObject({ leg_index: 1, warning: 'already_finished' });
  });
  it('relay: selecting the second athlete targets their leg even if leg 1 was missed', () => {
    const duo = makeRace({ team_size: 2 });
    const e = makeEntry({ team_name: 'Tubarões', members: [{ athlete_id: 'a1', position: 0, legs: [0] }, { athlete_id: 'a2', position: 1, legs: [1] }] });
    expect(suggestLeg({ entry: e, race: duo, marks: [], tsMs: T0 + 30 * MIN, athleteId: 'a2' })).toMatchObject({ leg_index: 1, athlete_id: 'a2' });
  });
  it('athlete doing two legs of a trio race', () => {
    const trio = makeRace({ team_size: 2, legs: [{ modality: 'run', label: 'Corrida', distance_m: 5000 }, { modality: 'bike', label: 'Ciclismo', distance_m: 20000 }, { modality: 'run', label: 'Corrida', distance_m: 2500 }] });
    const e = makeEntry({ team_name: 'Dupla', members: [{ athlete_id: 'a1', position: 0, legs: [0, 2] }, { athlete_id: 'a2', position: 1, legs: [1] }] });
    expect(suggestLeg({ entry: e, race: trio, marks: [], tsMs: T0 + 20 * MIN, athleteId: 'a1' }).leg_index).toBe(0);
    const marks = [makeMark({ at: T0 + 20 * MIN, leg_index: 0 }), makeMark({ at: T0 + 55 * MIN, leg_index: 1 })];
    expect(suggestLeg({ entry: e, race: trio, marks, tsMs: T0 + 70 * MIN, athleteId: 'a1' }).leg_index).toBe(2);
  });
  it('ignores discarded marks', () => {
    const marks = [makeMark({ at: T0 + 10 * MIN, leg_index: 0, discarded: true, discarded_by: 'timekeeper' })];
    expect(suggestLeg({ entry: soloEntry, race: solo, marks, tsMs: T0 + 40 * MIN }).leg_index).toBe(0);
  });
});

describe('suggestLeg edge cases', () => {
  it('only considers marks of the given entry', () => {
    const marks = [makeMark({ at: T0 + 10 * MIN, leg_index: 0, entry_id: 'en2' })];
    expect(suggestLeg({ entry: soloEntry, race: solo, marks, tsMs: T0 + 40 * MIN })).toMatchObject({ leg_index: 0, reason: 'next' });
  });
  it('same crossing picks the closest leg when two legs are within the window', () => {
    const withTransition = makeRace({ legs: [{ modality: 'swim', label: 'Natação', distance_m: 750 }, { modality: 'other', label: 'Transição', distance_m: null }, { modality: 'run', label: 'Corrida', distance_m: 5000 }] });
    const e = makeEntry({ members: [{ athlete_id: 'a1', position: 0, legs: [0, 1, 2] }] });
    const marks = [makeMark({ at: T0 + 10 * MIN, leg_index: 0 }), makeMark({ at: T0 + 10 * MIN + 20 * SEC, leg_index: 1 })];
    expect(suggestLeg({ entry: e, race: withTransition, marks, tsMs: T0 + 10 * MIN + 15 * SEC })).toMatchObject({ leg_index: 1, reason: 'same_crossing' });
  });
  it('the last passed leg is taken over all legs, not only the selected athlete legs', () => {
    // a1 runs legs 0 and 2; leg 0 was missed and only a2's leg 1 was marked → a1 arriving now ends leg 2.
    const trio = makeRace({ team_size: 2, legs: [{ modality: 'run', label: 'Corrida', distance_m: 5000 }, { modality: 'bike', label: 'Ciclismo', distance_m: 20000 }, { modality: 'run', label: 'Corrida', distance_m: 2500 }] });
    const e = makeEntry({ team_name: 'Dupla', members: [{ athlete_id: 'a1', position: 0, legs: [0, 2] }, { athlete_id: 'a2', position: 1, legs: [1] }] });
    const marks = [makeMark({ at: T0 + 55 * MIN, leg_index: 1 })];
    expect(suggestLeg({ entry: e, race: trio, marks, tsMs: T0 + 70 * MIN, athleteId: 'a1' })).toMatchObject({ leg_index: 2, reason: 'next', athlete_id: 'a1' });
  });
  it('falls back to all legs when the athlete is not a member or has no legs', () => {
    const duo = makeRace({ team_size: 2 });
    const e = makeEntry({ team_name: 'Dupla', members: [{ athlete_id: 'a1', position: 0, legs: [0, 1] }, { athlete_id: 'a2', position: 1, legs: [] }] });
    const marks = [makeMark({ at: T0 + 10 * MIN, leg_index: 0 })];
    expect(suggestLeg({ entry: e, race: duo, marks, tsMs: T0 + 40 * MIN, athleteId: 'a2' })).toMatchObject({ leg_index: 1, athlete_id: 'a1', warning: null });
    expect(suggestLeg({ entry: e, race: duo, marks, tsMs: T0 + 40 * MIN, athleteId: 'zz' })).toMatchObject({ leg_index: 1, athlete_id: 'a1', warning: null });
  });
  it('confirming a relay handoff finds the finished leg even with the next athlete selected', () => {
    // The on-course list already shows a2 as current, so the second timekeeper taps a2 for a1's handoff.
    const duo = makeRace({ team_size: 2 });
    const e = makeEntry({ team_name: 'Tubarões', members: [{ athlete_id: 'a1', position: 0, legs: [0] }, { athlete_id: 'a2', position: 1, legs: [1] }] });
    const marks = [makeMark({ at: T0 + 10 * MIN, leg_index: 0, timekeeper_id: 'tk1' })];
    expect(suggestLeg({ entry: e, race: duo, marks, tsMs: T0 + 10 * MIN + 5 * SEC, athleteId: 'a2' })).toMatchObject({ leg_index: 0, reason: 'same_crossing', athlete_id: 'a1' });
  });
});

describe('planBibAssignment', () => {
  const racesById = new Map([[solo.id, solo]]);
  it('reports an unknown bib', () => {
    expect(planBibAssignment({ entries: [soloEntry], racesById, marks: [], markId: null, tsMs: T0 + 10 * MIN, bibText: '999' })).toEqual({ error: 'Nº 999 não encontrado' });
  });
  it('reports an entry whose race is not loaded', () => {
    expect(planBibAssignment({ entries: [soloEntry], racesById: new Map(), marks: [], markId: null, tsMs: T0 + 10 * MIN, bibText: '101' })).toEqual({ error: 'Prova da inscrição não encontrada' });
  });
  it('suggests the leg from the other marks of the entry', () => {
    const leg0 = makeMark({ at: T0 + 10 * MIN, leg_index: 0 });
    expect(planBibAssignment({ entries: [soloEntry], racesById, marks: [leg0], markId: 'new-mark', tsMs: T0 + 40 * MIN, bibText: ' 101 ' }))
      .toMatchObject({ entry: { id: 'en1' }, race: { id: 'r1' }, suggestion: { leg_index: 1, reason: 'next', athlete_id: 'a1' }, warning: null });
  });
  it('ignores the mark being reassigned', () => {
    const own = makeMark({ at: T0 + 10 * MIN, leg_index: 0 });
    expect(planBibAssignment({ entries: [soloEntry], racesById, marks: [own], markId: own.id, tsMs: T0 + 10 * MIN, bibText: '101' }))
      .toMatchObject({ suggestion: { leg_index: 0, reason: 'next' } });
  });
  it('passes the selected athlete to the leg suggestion', () => {
    const duo = makeRace({ id: 'r2', team_size: 2 });
    const team = makeEntry({ id: 'en2', race_id: 'r2', bib: '202', team_name: 'Tubarões', members: [{ athlete_id: 'a1', position: 0, legs: [0] }, { athlete_id: 'a2', position: 1, legs: [1] }] });
    const plan = planBibAssignment({ entries: [soloEntry, team], racesById: new Map([[solo.id, solo], [duo.id, duo]]), marks: [], markId: null, tsMs: T0 + 30 * MIN, bibText: '202', athleteId: 'a2' });
    expect(plan).toMatchObject({ entry: { id: 'en2' }, race: { id: 'r2' }, suggestion: { leg_index: 1, athlete_id: 'a2' } });
  });
  it('warns (without blocking) for a DNS entry', () => {
    const dns = makeEntry({ status: 'dns' });
    expect(planBibAssignment({ entries: [dns], racesById, marks: [], markId: null, tsMs: T0 + 10 * MIN, bibText: '101' }))
      .toMatchObject({ entry: { id: 'en1' }, suggestion: { leg_index: 0 }, warning: 'Nº 101 está marcado como DNS' });
  });
  it('warns when the entry already finished, and the bib warning wins over it', () => {
    const marks = [makeMark({ at: T0 + 10 * MIN, leg_index: 0 }), makeMark({ at: T0 + 30 * MIN, leg_index: 1 })];
    const args = { racesById, marks, markId: null, tsMs: T0 + 60 * MIN, bibText: '101' };
    expect(planBibAssignment({ ...args, entries: [soloEntry] }))
      .toMatchObject({ suggestion: { leg_index: 1, warning: 'already_finished' }, warning: 'Nº 101 já concluiu — registrada como fim da perna 2/2 (Corrida)' });
    expect(planBibAssignment({ ...args, entries: [makeEntry({ status: 'dns' })] }))
      .toMatchObject({ suggestion: { leg_index: 1, warning: 'already_finished' }, warning: 'Nº 101 está marcado como DNS' });
  });
});
