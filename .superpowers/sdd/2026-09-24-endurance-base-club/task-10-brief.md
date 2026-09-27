## Task 10: Domain — time consolidation and leg suggestion (core of timing)

**Files:**
- Create: `src/domain/consolidation.ts`, `src/domain/consolidation.test.ts`, `src/domain/suggestLeg.ts`, `src/domain/suggestLeg.test.ts`

**Interfaces:**
- Consumes: Task 9 (`presets`, `eventModel`, fixtures), `src/lib/format.ts`.
- Produces: `median`, `computeCrossing`, `computeEntryTiming`, `computeEventTiming`, `suggestLeg` and the `Crossing`/`EntryTiming`/`Issue`/`EventTiming`/`LegSuggestion` types (see "Domain signatures").

Algorithm (spec §8, implement exactly):
- `median(values)`: sorted; odd → middle; even → `Math.round((a+b)/2)`; empty → null.
- `computeCrossing`: consider marks with `!discarded && leg_index === legIndex` (callers pass only the entry's marks), sorted by `(ts, id)`. Candidate key = `timekeeper_id ?? 'org:' + mark.id`; first mark per key is the candidate, later ones go to `duplicates`. `median_ms`/`spread_ms` over candidates. System = reference timekeeper's candidate when `time_source === 'reference'` and it exists (`system_source 'reference'`), else median (`'median'`). Official: resolution `manual` → `Date.parse(manual_ts)` (`'manual'`); `mark` → the referenced mark if it is among the non-discarded marks of this leg (`'mark'`), otherwise `chosen_mark_discarded = true` and use system; `system`/none → system. `divergent = candidates.length >= 2 && spread_ms > divergence_threshold_s * 1000`.
- `computeEntryTiming`: start = wave `start_at`; per leg: crossing, `athlete_id = legAthleteId`, `start_ms` = previous official (or start for leg 0), `leg_ms` = official − start when both exist. `total_ms` = last official − start; `final_ms = total_ms + penalty_ms`. Status: entry `dns|dnf|dsq` override; else last crossing present → `finished`; else start or any crossing present → `on_course`; else `not_started`. For `on_course`: `current_leg = (last k with official) + 1` (0 if none), `current_leg_start_ms` = that previous official or start.
- `computeEventTiming(agg, nowMs)`: timing for every entry (wave via `entryWave`), plus issues:
  - `divergence` (warning) when `crossing.divergent && !crossing.resolution`: outliers = candidates with `|ts − median| > threshold` (with exactly 2 candidates both count); for each outlier, compare with the medians of the **other** legs of the same entry: first leg `j` with `|ts − median_j| <= same_crossing_window_s*1000` → `suggested_leg_index = j`; `mark_ids` = outlier mark ids. Message: `Nº <bib> · Perna <k+1> (<label>): divergência de <spread s with 1 decimal, pt-BR> s entre cronometristas`.
  - `duplicate` (info): `Nº <bib> · Perna <k+1> (<label>): <timekeeper name|Organização> marcou mais de uma vez`, `mark_ids` = duplicates.
  - `chosen_mark_discarded` (warning): `Nº <bib> · Perna <k+1> (<label>): a marcação escolhida foi descartada`.
  - `missing_crossing` (error): leg `k` without official while some later leg has one: `Nº <bib> · Perna <k+1> (<label>): passagem não registrada (há passagem posterior)`.
  - `order` (error): official ≤ previous official (or ≤ start for leg 0): `Nº <bib> · Perna <k+1> (<label>): passagem antes da anterior/largada`.
  - `no_start` (warning): entry has non-discarded marks but no start: `Nº <bib>: marcação sem largada registrada (<wave name>)`.
  - `not_finished` (info): status `on_course`: `Nº <bib>: ainda em prova`.
  - `unassigned` (warning): non-discarded marks with `entry_id null` and `nowMs − ts > 60_000`: `Marcação <formatClock(ts,{tenths})> (<timekeeper name|Organização>) sem atleta`.
  - Sort issues: error, warning, info; then message.
- `suggestLeg` (spec §7.5): window = `same_crossing_window_s*1000`; consider the entry's non-discarded marks with a leg; `candidateLegs` = the selected athlete's legs (sorted) when `athleteId` is a member, else all legs; per-leg median; if any candidate leg has `|ts − median| <= window` → the closest one, reason `same_crossing`; else `last` = max leg (over **all** legs) with `median < ts − window` (−1 if none) → smallest candidate leg `> last`, reason `next`; none → last candidate leg, `warning 'already_finished'`. `athlete_id = legAthleteId(entry, leg)`.

- [ ] **Step 1: Write failing `src/domain/consolidation.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { median, computeCrossing, computeEntryTiming, computeEventTiming } from './consolidation';
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
```

- [ ] **Step 2: Write failing `src/domain/suggestLeg.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { suggestLeg } from './suggestLeg';
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
```

- [ ] **Step 2b (Ruling 2): shared bib-assignment helper** — also export from `src/domain/suggestLeg.ts`:

```ts
export type AssignmentPlan =
  | { entry: EntryRow; race: RaceRow; suggestion: LegSuggestion; warning: string | null }
  | { error: string };
export function planBibAssignment(args: {
  entries: EntryRow[]; racesById: Map<string, RaceRow>; marks: MarkRow[];
  markId: string | null; tsMs: number; bibText: string; athleteId?: string | null;
}): AssignmentPlan;
```

It calls `resolveBib(entries, bibText)` (error → `{ error }`), finds the entry's race (missing → `{ error: 'Prova da inscrição não encontrada' }`), runs `suggestLeg` over `marks` **excluding `markId`**, and returns `warning` = the bib warning, or `Nº <bib> já concluiu — registrada como fim da <label> (<k+1>/<N>)` when `suggestion.warning === 'already_finished'` (bib warning wins if both). Tests in `suggestLeg.test.ts`: unknown bib → `{ error: 'Nº 999 não encontrado' }`; valid bib on a solo entry with a leg-0 mark 30 min earlier and `markId` of a different mark → `suggestion.leg_index === 1`; the mark being reassigned is ignored (passing its own id with the same timestamp does not produce `same_crossing`); DNS entry → warning `Nº … está marcado como DNS`. Tasks 22–24 use this helper instead of re-implementing the lookup.

- [ ] **Step 3: Run** `npx vitest run src/domain` → FAIL. **Step 4: Implement** both modules per the algorithm above. **Step 5: Run** → PASS. **Step 6: Commit** (`feat(domain): median time consolidation, issues and leg suggestion`).

---

