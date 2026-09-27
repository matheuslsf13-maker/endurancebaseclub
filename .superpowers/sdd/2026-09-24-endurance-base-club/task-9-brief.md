## Task 9: Domain foundations — presets, categories, event index, bib resolution, fixtures

**Files:**
- Create: `src/domain/presets.ts`, `src/domain/presets.test.ts`, `src/domain/categories.ts`, `src/domain/categories.test.ts`, `src/domain/eventModel.ts`, `src/domain/eventModel.test.ts`, `src/domain/bib.ts`, `src/domain/bib.test.ts`, `src/domain/testing/fixtures.ts`

**Interfaces:**
- Consumes: `src/lib/types.ts`.
- Produces: signatures in "Domain signatures" for presets, categories, eventModel, bib; fixtures below (used by Tasks 10–12, 15).

- [ ] **Step 1: Write `src/domain/testing/fixtures.ts`**

```ts
import type { AthleteRow, EntryRow, EventRow, MarkRow, RaceConfig, RaceRow, ResolutionRow, TimekeeperRow, WaveRow } from '../../lib/types';
import { defaultRaceConfig } from '../presets';

export const T0 = Date.parse('2026-10-11T11:00:00.000Z'); // 08:00:00 in Brasília
export const SEC = 1000;
export const MIN = 60_000;
export const iso = (ms: number) => new Date(ms).toISOString();
let seq = 0;
export const nextId = (p: string) => `${p}${++seq}`;

export function makeEvent(p: Partial<EventRow> = {}): EventRow {
  return { id: 'e1', name: 'Evento Teste', date: '2026-10-11', location: 'Vila Velha', description: '', levels: [], status: 'ao_vivo', is_public: true, public_slug: 'evento-teste', version: 1, ...p };
}
export function makeRace(p: Partial<RaceRow> & { configPatch?: Partial<RaceConfig> } = {}): RaceRow {
  const { configPatch, ...rest } = p;
  const team_size = rest.team_size ?? 1;
  return {
    id: 'r1', event_id: 'e1', name: 'Aquathlon', position: 0, team_size,
    legs: [{ modality: 'swim', label: 'Natação', distance_m: 750 }, { modality: 'run', label: 'Corrida', distance_m: 5000 }],
    config: { ...defaultRaceConfig(team_size), ...(configPatch ?? {}) }, finalized_at: null, ...rest,
  };
}
export function makeWave(p: Partial<WaveRow> = {}): WaveRow {
  return { id: 'w1', race_id: 'r1', name: 'Largada geral', position: 0, start_at: iso(T0), ...p };
}
export function makeAthlete(p: Partial<AthleteRow> = {}): AthleteRow {
  return { id: 'a1', name: 'Ana Souza', sex: 'F', birth_date: '1990-06-15', city: null, team_club: null, public_profile: true, ...p };
}
export function makeEntry(p: Partial<EntryRow> = {}): EntryRow {
  return { id: 'en1', event_id: 'e1', race_id: 'r1', wave_id: 'w1', bib: '101', team_name: null, level: null, status: 'ok', penalty_ms: 0, notes: '', members: [{ athlete_id: 'a1', position: 0, legs: [0, 1] }], ...p };
}
export function makeMark(p: Partial<MarkRow> & { at: number }): MarkRow {
  const { at, ...rest } = p;
  return { id: nextId('m'), event_id: 'e1', timekeeper_id: 'tk1', ts: iso(at), device_ts: iso(at), clock_offset_ms: 0, clock_rtt_ms: 80, entry_id: 'en1', leg_index: 0, athlete_id: null, discarded: false, discarded_by: null, created_at: iso(at), updated_at: iso(at), ...rest };
}
export function makeResolution(p: Partial<ResolutionRow> & Pick<ResolutionRow, 'entry_id' | 'leg_index' | 'mode'>): ResolutionRow {
  return { event_id: 'e1', mark_id: null, manual_ts: null, note: '', updated_at: iso(T0), ...p };
}
export function makeTimekeeper(p: Partial<TimekeeperRow> = {}): TimekeeperRow {
  return { id: 'tk1', name: 'Ana', active: true, ...p };
}
```

- [ ] **Step 2: Write failing tests**

`src/domain/presets.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { defaultRaceConfig, generateAgeGroups, RACE_PRESETS, normalizeRaceConfig, MODALITY_LABEL } from './presets';

describe('presets', () => {
  it('individual default config', () => {
    const c = defaultRaceConfig(1);
    expect(c.rankings.map(r => r.id)).toEqual(['geral', 'faixa']);
    expect(c.rankings[0]).toEqual({ id: 'geral', name: 'Geral', dims: ['sex'], size: 3 });
    expect(c.rankings[1]).toEqual({ id: 'faixa', name: 'Faixa etária', dims: ['sex', 'age'], size: 3 });
    expect(c.age_groups.map(g => g.label)).toEqual(['até 19', '20-29', '30-39', '40-49', '50-59', '60+']);
    expect(c).toMatchObject({ cumulative: false, same_crossing_window_s: 30, divergence_threshold_s: 3, time_source: 'median', age_rule: 'year_end', team_age_rule: 'sum', reference_timekeeper_id: null });
  });
  it('team default config', () => {
    const c = defaultRaceConfig(2);
    expect(c.rankings).toEqual([{ id: 'geral', name: 'Geral', dims: ['sex'], size: 3 }]);
    expect(c.age_groups).toEqual([]);
  });
  it('generates age groups', () => {
    expect(generateAgeGroups(20, 10, 60)).toEqual([
      { label: 'até 19', min: 0, max: 19 }, { label: '20-29', min: 20, max: 29 }, { label: '30-39', min: 30, max: 39 },
      { label: '40-49', min: 40, max: 49 }, { label: '50-59', min: 50, max: 59 }, { label: '60+', min: 60, max: null },
    ]);
    expect(generateAgeGroups(18, 5, 28).map(g => g.label)).toEqual(['até 17', '18-22', '23-27', '28+']);
  });
  it('has the race presets', () => {
    const ids = RACE_PRESETS.map(p => p.id);
    expect(ids).toEqual(['corrida-5k', 'corrida-10k', 'natacao-1500', 'ciclismo-20k', 'duathlon', 'aquathlon', 'triathlon-sprint', 'triathlon-olimpico', 'revezamento-dupla-aquathlon', 'revezamento-trio-triathlon', 'personalizada']);
    const sprint = RACE_PRESETS.find(p => p.id === 'triathlon-sprint')!;
    expect(sprint.legs.map(l => [l.modality, l.distance_m])).toEqual([['swim', 750], ['bike', 20000], ['run', 5000]]);
    expect(RACE_PRESETS.find(p => p.id === 'duathlon')!.legs.map(l => l.distance_m)).toEqual([5000, 20000, 2500]);
    expect(RACE_PRESETS.find(p => p.id === 'revezamento-dupla-aquathlon')!.team_size).toBe(2);
    expect(RACE_PRESETS.find(p => p.id === 'revezamento-trio-triathlon')!.team_size).toBe(3);
    expect(MODALITY_LABEL.swim).toBe('Natação');
  });
  it('normalizes partial configs', () => {
    expect(normalizeRaceConfig(null, 2)).toEqual(defaultRaceConfig(2));
    const c = normalizeRaceConfig({ divergence_threshold_s: -1, same_crossing_window_s: 0, rankings: [] }, 1);
    expect(c.divergence_threshold_s).toBe(3);
    expect(c.same_crossing_window_s).toBe(30);
    expect(c.rankings).toEqual([]);
  });
});
```

`src/domain/categories.test.ts`:
```ts
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
```

`src/domain/eventModel.test.ts`: `indexEvent` builds all maps and `wavesByRace` sorted by `position`; `entryWave` returns the entry's wave or, when `wave_id` is null, the first wave of the race; `entryDisplayName` returns `team_name` when present else athlete names joined `' / '` (falls back to `'Nº <bib>'` when names are unknown); `legAthleteId(entry, k)` returns the member whose `legs` contains `k` or `null`; `mergeById(current, incoming)` replaces items with the same id when `incoming.updated_at >= current.updated_at` (or when either lacks `updated_at`), keeps the newer one otherwise, appends unknown ids, and preserves order by the original array followed by new items.

`src/domain/bib.test.ts` (Review Focus 2):
```ts
import { describe, it, expect } from 'vitest';
import { normalizeBib, resolveBib } from './bib';
import { makeEntry } from './testing/fixtures';

const entries = [makeEntry({ id: 'e7', bib: '007' }), makeEntry({ id: 'e101', bib: '101' }), makeEntry({ id: 'e5', bib: '5', status: 'dns' }), makeEntry({ id: 'e9', bib: '9', status: 'dsq' }), makeEntry({ id: 'e12a', bib: '12A' })];
describe('bib resolution', () => {
  it('normalizes', () => { expect(normalizeBib('  101 ')).toBe('101'); expect(normalizeBib(' 12a ')).toBe('12A'); });
  it('matches exact, trimmed and numeric-equivalent bibs', () => {
    expect(resolveBib(entries, ' 101 ')).toMatchObject({ entry: { id: 'e101' }, warning: null });
    expect(resolveBib(entries, '7')).toMatchObject({ entry: { id: 'e7' } });
    expect(resolveBib(entries, '0101')).toMatchObject({ entry: { id: 'e101' } });
    expect(resolveBib(entries, '12a')).toMatchObject({ entry: { id: 'e12a' } });
  });
  it('reports unknown or empty bibs', () => {
    expect(resolveBib(entries, '999')).toEqual({ error: 'Nº 999 não encontrado' });
    expect(resolveBib(entries, '  ')).toEqual({ error: 'Digite o nº de peito' });
  });
  it('warns (does not block) for DNS and DSQ', () => {
    expect(resolveBib(entries, '5')).toMatchObject({ entry: { id: 'e5' }, warning: 'Nº 5 está marcado como DNS' });
    expect(resolveBib(entries, '9')).toMatchObject({ entry: { id: 'e9' }, warning: 'Nº 9 está marcado como DSQ' });
  });
});
```

- [ ] **Step 3: Run** `npx vitest run src/domain` → FAIL.

- [ ] **Step 4: Implement.** Notes:
  - `defaultRaceConfig(teamSize)`: exactly the values asserted above (`teamSize > 1` → team variant). Must match SQL `default_race_config` from Task 3.
  - `generateAgeGroups(start, step, last)`: `até ${start-1}` (min 0) then `[a, a+step-1]` while `a < last`, then `${last}+` with `max null`.
  - Presets: names `Corrida 5 km`, `Corrida 10 km`, `Natação 1.500 m`, `Ciclismo 20 km`, `Duathlon` (run 5000, bike 20000, run 2500), `Aquathlon` (swim 750, run 5000), `Triathlon Sprint` (750/20000/5000), `Triathlon Olímpico` (1500/40000/10000), `Revezamento em dupla (natação + corrida)` (team 2; swim 750, run 5000), `Revezamento em trio (triathlon sprint)` (team 3), `Personalizada` (one `run` leg, 5000). Leg labels = `MODALITY_LABEL[modality]`.
  - `normalizeRaceConfig(partial, teamSize)`: start from defaults; copy each field only if valid (enums in range; numbers finite and > 0; arrays are arrays; `reference_timekeeper_id` string or null).
  - `ageOn`: `year_end` → `eventYear - birthYear`; `event_date` → full years at the event date (string arithmetic on `YYYY-MM-DD`, no `Date` time zone pitfalls).
  - `athleteAge`: birth_date → `ageOn`; else `age_year_end`/`age_event` by rule; else null.
  - `entryCategory`: sex rule (§9), team ages by `team_age_rule` (null if any member lacks an age), `age_group` = first group containing the age, `level` = `entry.level` only if `event.levels` includes it.
  - `groupKey(dims, cat)`: `[]` → `'all'`; else values joined by `|` where sex → `cat.sex`, age → `cat.age_group ?? '∅'`, level → `cat.level ?? '∅'`. `groupLabel`: `[]` → `'Geral'`; parts: `sexLabel`, `age_group ?? 'Sem faixa'`, `level ?? 'Sem nível'`, joined `' · '`.
  - `validateAgeGroups`: messages `Faixa "<label>": idade final menor que a inicial` and `Faixas "<a>" e "<b>" se sobrepõem`.
  - `resolveBib`: `normalizeBib` = trim + uppercase; exact match first; if the input is all digits, match entries whose bib is all digits with the same integer value; DNS/DSQ warnings `Nº <bib> está marcado como DNS|DSQ` (use the entry's bib).
- [ ] **Step 5: Run** → PASS. **Step 6: Commit** (`feat(domain): presets, categories, event index and bib resolution`).

---

