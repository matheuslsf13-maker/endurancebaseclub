import { describe, it, expect } from 'vitest';
import { indexEvent, entryWave, entryDisplayName, legAthleteId, mergeById } from './eventModel';
import { makeRace, makeWave, makeAthlete, makeEntry, makeTimekeeper } from './testing/fixtures';

describe('eventModel', () => {
  it('indexEvent builds all maps and sorts wavesByRace by position', () => {
    const race1 = makeRace({ id: 'r1' });
    const race2 = makeRace({ id: 'r2' });
    const w1 = makeWave({ id: 'w1', race_id: 'r1', position: 1 });
    const w0 = makeWave({ id: 'w0', race_id: 'r1', position: 0 });
    const w2 = makeWave({ id: 'w2', race_id: 'r2', position: 0 });
    const athlete = makeAthlete({ id: 'a1' });
    const entry = makeEntry({ id: 'en1', race_id: 'r1' });
    const tk = makeTimekeeper({ id: 'tk1' });

    const idx = indexEvent({ races: [race1, race2], waves: [w1, w0, w2], entries: [entry], athletes: [athlete], timekeepers: [tk] });

    expect(idx.racesById.get('r1')).toBe(race1);
    expect(idx.racesById.get('r2')).toBe(race2);
    expect(idx.wavesById.get('w1')).toBe(w1);
    expect(idx.wavesById.get('w0')).toBe(w0);
    expect(idx.wavesByRace.get('r1')!.map(w => w.id)).toEqual(['w0', 'w1']);
    expect(idx.wavesByRace.get('r2')!.map(w => w.id)).toEqual(['w2']);
    expect(idx.entriesById.get('en1')).toBe(entry);
    expect(idx.entriesByRace.get('r1')!.map(e => e.id)).toEqual(['en1']);
    expect(idx.athletesById.get('a1')).toBe(athlete);
    expect(idx.timekeepersById.get('tk1')).toBe(tk);
  });

  it('entryWave returns the entry wave, or the first wave of the race (by position) when wave_id is null', () => {
    const w0 = makeWave({ id: 'w0', race_id: 'r1', position: 0 });
    const w1 = makeWave({ id: 'w1', race_id: 'r1', position: 1 });
    // Pass out of order to confirm sorting drives "first".
    const idx = indexEvent({ races: [makeRace({ id: 'r1' })], waves: [w1, w0], entries: [], athletes: [], timekeepers: [] });

    const withWave = makeEntry({ race_id: 'r1', wave_id: 'w1' });
    expect(entryWave(withWave, idx)).toBe(w1);

    const withoutWave = makeEntry({ race_id: 'r1', wave_id: null });
    expect(entryWave(withoutWave, idx)).toBe(w0);
  });

  it('entryWave returns null when the race has no waves', () => {
    const idx = indexEvent({ races: [], waves: [], entries: [], athletes: [], timekeepers: [] });
    const entry = makeEntry({ race_id: 'r9', wave_id: null });
    expect(entryWave(entry, idx)).toBeNull();
  });

  it('entryDisplayName prefers team_name', () => {
    const idx = indexEvent({ races: [], waves: [], entries: [], athletes: [], timekeepers: [] });
    const entry = makeEntry({ team_name: 'Tubarões' });
    expect(entryDisplayName(entry, idx)).toBe('Tubarões');
  });

  it('entryDisplayName joins athlete names in member-position order when there is no team_name', () => {
    const a1 = makeAthlete({ id: 'a1', name: 'Ana Souza' });
    const a2 = makeAthlete({ id: 'a2', name: 'Bruno Lima' });
    const idx = indexEvent({ races: [], waves: [], entries: [], athletes: [a2, a1], timekeepers: [] });
    const entry = makeEntry({ team_name: null, members: [{ athlete_id: 'a2', position: 1, legs: [1] }, { athlete_id: 'a1', position: 0, legs: [0] }] });
    expect(entryDisplayName(entry, idx)).toBe('Ana Souza / Bruno Lima');
  });

  it('entryDisplayName falls back to the bib when no member name is known', () => {
    const idx = indexEvent({ races: [], waves: [], entries: [], athletes: [], timekeepers: [] });
    const entry = makeEntry({ team_name: null, bib: '42', members: [{ athlete_id: 'ghost', position: 0, legs: [0] }] });
    expect(entryDisplayName(entry, idx)).toBe('Nº 42');
  });

  it('legAthleteId returns the member whose legs include the index, or null', () => {
    const entry = makeEntry({ members: [{ athlete_id: 'a1', position: 0, legs: [0] }, { athlete_id: 'a2', position: 1, legs: [1, 2] }] });
    expect(legAthleteId(entry, 0)).toBe('a1');
    expect(legAthleteId(entry, 2)).toBe('a2');
    expect(legAthleteId(entry, 5)).toBeNull();
  });

  it('mergeById replaces with a newer incoming, keeps a newer current, and appends unknown ids in order', () => {
    type Row = { id: string; updated_at?: string; v: string };
    const current: Row[] = [
      { id: '1', updated_at: '2026-01-01T00:00:00.000Z', v: 'old-1' },
      { id: '2', updated_at: '2026-01-01T00:00:00.000Z', v: 'old-2' },
    ];
    const incoming: Row[] = [
      { id: '1', updated_at: '2026-01-02T00:00:00.000Z', v: 'new-1' }, // newer -> replaces
      { id: '2', updated_at: '2025-01-01T00:00:00.000Z', v: 'stale-2' }, // older -> current kept
      { id: '3', updated_at: '2026-01-01T00:00:00.000Z', v: 'brand-new-3' }, // unknown id -> appended
    ];
    const merged = mergeById(current, incoming);
    expect(merged.map(r => r.id)).toEqual(['1', '2', '3']);
    expect(merged[0].v).toBe('new-1');
    expect(merged[1].v).toBe('old-2');
    expect(merged[2].v).toBe('brand-new-3');
  });

  it('mergeById replaces when either side lacks updated_at, and on equal timestamps', () => {
    type Row = { id: string; updated_at?: string; v: string };
    expect(mergeById<Row>([{ id: '1', v: 'old' }], [{ id: '1', v: 'new' }])[0].v).toBe('new');
    expect(mergeById<Row>([{ id: '1', updated_at: '2026-01-01T00:00:00.000Z', v: 'old' }], [{ id: '1', v: 'new-no-ts' }])[0].v).toBe('new-no-ts');
    expect(mergeById<Row>([{ id: '1', updated_at: '2026-01-01T00:00:00.000Z', v: 'old' }], [{ id: '1', updated_at: '2026-01-01T00:00:00.000Z', v: 'same-ts' }])[0].v).toBe('same-ts');
  });
});
