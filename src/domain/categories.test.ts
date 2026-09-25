import { describe, it, expect } from 'vitest';
import { ageOn, entryCategory, groupLabel, groupKey, sexLabel, validateAgeGroups } from './categories';
import { generateAgeGroups } from './presets';
import { makeAthlete, makeEntry, makeRace } from './testing/fixtures';

const ev = { date: '2026-10-11', levels: ['Elite', 'Base'] };
describe('categories', () => {
  it('computes age by rule', () => {
    expect(ageOn('1990-12-31', '2026-10-11', 'year_end')).toBe(36);
    expect(ageOn('1990-12-31', '2026-10-11', 'event_date')).toBe(35);
    expect(ageOn('1990-10-11', '2026-10-11', 'event_date')).toBe(36);
  });
  it('individual category', () => {
    const a = makeAthlete({ birth_date: '1990-06-15' });
    expect(entryCategory(makeEntry({ level: 'Elite' }), new Map([[a.id, a]]), makeRace(), ev)).toEqual({ sex: 'F', age: 36, age_group: '30-39', level: 'Elite' });
  });
  it('team sex and age rules', () => {
    const a1 = makeAthlete({ id: 'a1', sex: 'M', birth_date: '1990-01-01' });
    const a2 = makeAthlete({ id: 'a2', sex: 'F', birth_date: '1986-01-01' });
    const r = makeRace({ team_size: 2, configPatch: { team_age_rule: 'sum', age_groups: [{ label: 'até 79', min: 0, max: 79 }, { label: '80+', min: 80, max: null }] } });
    const e = makeEntry({ team_name: 'Tubarões', members: [{ athlete_id: 'a1', position: 0, legs: [0] }, { athlete_id: 'a2', position: 1, legs: [1] }] });
    const m = new Map([[a1.id, a1], [a2.id, a2]]);
    expect(entryCategory(e, m, r, ev)).toMatchObject({ sex: 'MISTO', age: 76, age_group: 'até 79' });
    expect(entryCategory(e, m, { ...r, config: { ...r.config, team_age_rule: 'oldest' } }, ev).age).toBe(40);
    expect(entryCategory(e, m, { ...r, config: { ...r.config, team_age_rule: 'youngest' } }, ev).age).toBe(36);
    const allMale = new Map([[a1.id, a1], [a2.id, { ...a2, sex: 'M' as const }]]);
    expect(entryCategory(e, allMale, r, ev).sex).toBe('M');
  });
  it('missing birth date gives no age', () => {
    const a = makeAthlete({ birth_date: null });
    expect(entryCategory(makeEntry(), new Map([[a.id, a]]), makeRace(), ev)).toMatchObject({ age: null, age_group: null });
  });
  it('uses precomputed public ages', () => {
    const a = makeAthlete({ birth_date: null, age_year_end: 41, age_event: 40 });
    expect(entryCategory(makeEntry(), new Map([[a.id, a]]), makeRace(), ev).age).toBe(41);
    const r = makeRace({ configPatch: { age_rule: 'event_date' } });
    expect(entryCategory(makeEntry(), new Map([[a.id, a]]), r, ev).age).toBe(40);
  });
  it('ignores level when the event has none', () => {
    const a = makeAthlete();
    expect(entryCategory(makeEntry({ level: 'Elite' }), new Map([[a.id, a]]), makeRace(), { date: '2026-10-11', levels: [] }).level).toBeNull();
  });
  it('labels and keys', () => {
    const cat = { sex: 'F', age: 36, age_group: '30-39', level: 'Elite' } as const;
    expect(groupLabel([], cat)).toBe('Geral');
    expect(groupLabel(['sex', 'age'], cat)).toBe('Feminino · 30-39');
    expect(groupLabel(['sex', 'age', 'level'], { ...cat, age_group: null })).toBe('Feminino · Sem faixa · Elite');
    expect(groupKey([], cat)).toBe('all');
    expect(groupKey(['sex', 'age'], cat)).toBe('F|30-39');
    expect(sexLabel('MISTO')).toBe('Misto');
  });
  it('validates age groups', () => {
    expect(validateAgeGroups([{ label: 'a', min: 20, max: 29 }, { label: 'b', min: 25, max: 34 }])).toHaveLength(1);
    expect(validateAgeGroups([{ label: 'a', min: 30, max: 20 }])).toHaveLength(1);
    expect(validateAgeGroups(generateAgeGroups(20, 10, 60))).toEqual([]);
  });
});
