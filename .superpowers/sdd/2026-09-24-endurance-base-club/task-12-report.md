# Task 12: Domain — athlete statistics — Report

## What I implemented

`src/domain/stats.ts` exports `computeAthleteStats(athleteId: string, results: ResultRow[]): AthleteStats`, a pure function turning an athlete's finalized `ResultRow` snapshots into the `AthleteStats` shape from `contracts.md` (copied verbatim into the file):

- **Counts**: `participations` (status not in `dns`/`not_started`), `finishes` (`finished`), `dnf` (`dnf` + `on_course`), `dns` (`dns` + `not_started`), `dsq` (`dsq`), `completion_rate` (`finishes/participations`, `null` when `participations === 0`).
- **Standings**: `wins_overall` (`overall_pos === 1`), `wins_category` (results with any podium entry at `podium_pos === 1`, counted once per result), `podiums` (results with any podium entry at `podium_pos <= 3`, once per result — "1 per prova" per spec §10), `best_overall_pos` (min `overall_pos`, `null` if none), `avg_percentile` (mean of `overall_pos/finishers` over results where both exist, guarded against `finishers === 0`).
- **Own-legs pool**: a single internal pass (`ownLegs`) collects every leg across all results where `leg.athlete_id === athleteId` and both `time_ms` and `distance_m` are non-null (no status filter — a completed leg counts even inside an otherwise-DNF result, per the brief's literal wording). `records`, `pace_by_modality`, `km_by_modality` and `evolution` are all derived from this one pool in a single loop, keyed by `(modality, distance_m)` or by `modality` as appropriate, using `Map`s (consistent with the grouping style already used in `eventModel.ts`).
  - `records`: per `(modality, distance_m)`, the leg with the minimum `time_ms`, with `pace` via `formatPace` and the originating `event_name`/`event_date`.
  - `pace_by_modality`: per modality, summed distance/time across those legs, paced via `formatPace` — **skips `other`** (no entry emitted).
  - `km_by_modality`: summed distance (km) per modality — **does not** skip `other` (only `pace_by_modality` does, per the brief).
  - `evolution`: the `(modality, distance_m)` group with the most points (strictly more than any other, minimum 2 to qualify), points sorted by date ascending; `null` when no group reaches 2.
- **`history`**: one row per result, sorted by `event.date` descending; `category` is a compact "Feminino · 30-39"-style string built from `data.category` (sex label + age group + level, omitting whatever is null — deliberately *not* the literal `groupLabel(['sex','age','level'], …)` output, which would show "Sem faixa"/"Sem nível" placeholders that don't match the brief's example); `podiums` formatted as `"<ranking_name>: <podium_pos>º (<group_label>)"`; `my_legs` filtered to the athlete's own legs (label + time_ms, including null times e.g. DNF).
- **`partners`**: other members seen across all results' `data.members`, counted and sorted by count desc then name (`localeCompare('pt-BR')`, consistent with the app's Brazilian-Portuguese context).

Reuses `formatPace` from `src/lib/format.ts` and `sexLabel` from `src/domain/categories.ts` (already-merged, stable, pure Task 9 export) rather than re-implementing the M/F/Misto label mapping.

## What I tested and results

`src/domain/stats.test.ts` — the exact test the brief specifies (4 `it`s: counts, records/paces, history/evolution/partners, empty input), **plus** 3 tests I added during self-review to close gaps the prescribed suite left untested:
- `dns`/`not_started` → `dns` bucket, and `completion_rate: null` when `participations === 0` even though `results` is non-empty (distinct from the "fully empty array" case already covered).
- `on_course` → `dnf` bucket, `dsq` → its own bucket, both still counted as participations.
- `other`-modality leg: present in `records` and `km_by_modality`, absent from `pace_by_modality`.

All 3 additions passed on first run against the already-written implementation (no bugs found by them, but they lock in behavior the original suite didn't exercise).

Full suite: `npx vitest run` → **13 files, 67 tests passed** (64 pre-existing + 3 added; no regressions). `npm run typecheck` → clean.

## TDD Evidence

**RED** — `npx vitest run src/domain/stats.test.ts` (before `stats.ts` existed):
```
 RUN  v5.0.1 /home/claude/ebc-wt/t12

 ❯ src/domain/stats.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/domain/stats.test.ts [ src/domain/stats.test.ts ]
Error: Failed to resolve import "./stats" from "src/domain/stats.test.ts". Does the file exist?
  Plugin: vite:import-analysis
  File: /home/claude/ebc-wt/t12/src/domain/stats.test.ts:2:36
...
 Test Files  1 failed (1)
      Tests  no tests
```
Expected: fails because `src/domain/stats.ts` (and `computeAthleteStats`) did not exist yet — a pure import-resolution failure, confirming the test was actually exercising the not-yet-written module.

**GREEN** — after implementing `src/domain/stats.ts`, `npx vitest run src/domain/stats.test.ts`:
```
 RUN  v5.0.1 /home/claude/ebc-wt/t12

 Test Files  1 passed (1)
      Tests  4 passed (4)
```
Then after adding the 3 self-review tests, the same command:
```
 RUN  v5.0.1 /home/claude/ebc-wt/t12

 Test Files  1 passed (1)
      Tests  7 passed (7)
```

**Full suite + typecheck** (final, pre-commit):
```
$ npm run typecheck
> tsc --noEmit -p tsconfig.json
TYPECHECK OK

$ npx vitest run
 Test Files  13 passed (13)
      Tests  67 passed (67)
```

## Files changed

- Created `/home/claude/ebc-wt/t12/src/domain/stats.ts` (implementation, matches Files block).
- Created `/home/claude/ebc-wt/t12/src/domain/stats.test.ts` (tests, matches Files block).
- No other files touched (verified via `git status --porcelain` before commit — only these two, both `A`).

## Self-review findings

- Checked `AthleteStats` fields against `contracts.md` field-by-field; interface copied verbatim.
- Verified the definitions from the brief line by line against the given test's numbers by hand (e.g. `avg_percentile = (1/20 + 3/12 + 5/30)/3`, `wins_category = 2` from two distinct results each with one `podium_pos === 1` entry, `podiums = 3` counting each qualifying result once even though one result's `podium_pos` was `2`).
- Identified and closed three coverage gaps the prescribed test left untested (see "What I tested" above) by adding targeted tests rather than leaving them unverified; all passed against the existing implementation without needing code changes.
- Considered whether to reuse `groupLabel`/`sexLabel` from `categories.ts` for the history `category` text: literal reuse of `groupLabel(['sex','age','level'], cat)` would print `"Sem faixa"`/`"Sem nível"` placeholders for the fixture's `level: null`, which contradicts the brief's own example output (`"Feminino · 30-39"`, no third segment) — so I wrote a small local `categoryText` helper that omits null dimensions instead, reusing only `sexLabel` (which has no such placeholder problem) from `categories.ts`.
- Considered scope of the `ownLegs` qualifying-leg filter: confirmed via the brief's literal wording that it applies no result-status filter (a completed leg's time counts toward records/pace/km/evolution even if the overall result is `dnf`), only "ignore null time or null distance" — implemented accordingly.
- Confirmed `km_by_modality` intentionally does **not** skip `other` (only `pace_by_modality` does) — this split is explicit in the brief's wording and is exactly what the added "other modality" test locks in.
- No edits to shared/DB-mirroring files; no camelCase duplicates of snake_case DTO fields; all identifiers/comments in English; the only user-facing (Portuguese) text produced is the podium/category strings, which are built from already-Portuguese data fields (`ranking_name`, `group_label`, `sexLabel()`) per the exact format the brief specifies, not new invented copy.
- Read the full diff (`git status`, then re-read `stats.ts` in full) before committing; nothing unused, no stray debug code, output pristine (no console warnings from my code — the one jsdom-perf-tip line in the suite output is pre-existing framework advice unrelated to this change).

## Issues or concerns

None. Implementation matches the brief and `contracts.md` exactly; all tests (prescribed + added) and typecheck pass; no scope creep beyond the two files in the Files block.
