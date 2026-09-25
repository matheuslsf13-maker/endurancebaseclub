# Task 11 Report — Domain: classification, podiums, finalize snapshot

Branch: `task/11` · Worktree: `/home/claude/ebc-wt/t11` · Commit: `b8eb0df feat(domain): classification, podiums and finalize snapshot`

## Implementation

### `src/domain/ranking.ts`

`classifyRace(race, entries, timings, athletesById, event): RaceClassification` (spec §9):

- **Ranked vs unranked** (`isRanked`): a row is ranked only when `timing.status === 'finished' && timing.final_ms !== null`. **Controller Ruling 9** is implemented here: a `finished` crossing with a null `final_ms` (finish mark recorded, no wave start to total from) is *not* ranked.
- **Ranked rows**: sorted by `final_ms` ascending, numeric-aware bib (`Intl.Collator('pt-BR', {numeric:true})`, same technique already used for issue messages in `consolidation.ts`) as the display tie-break. Positions use competition ("1224") ranking via `competitionRanks` — tied values share the lower position, the next distinct value resumes at its own 1-based rank.
- **Unranked rows**: sorted by `UNRANKED_STATUS_ORDER` = `finished(null final_ms)=0, on_course=1, not_started=2, dnf=3, dns=4, dsq=5`, then bib. The `finished=0` slot is exactly Ruling 9: a "ghost finish" sorts ahead of `on_course`.
- **`sex_pos`** and **`ranking_pos[rd.id]`**: both computed with the same `groupedPositions` helper — group the *ranked* rows (already sorted) by a key function (`category.sex`, or `groupKey(rd.dims, category)` per configured ranking), then competition-rank within each group. Unranked rows get `sex_pos: null` and every `ranking_pos[id]: null`.
- **`gap_ms`**: `final_ms − leader.final_ms` for ranked rows (leader = the fastest ranked row), `null` for unranked rows.
- **Podiums** (`buildPodiums`): iterates `race.config.rankings` in config order. For each ranking, candidates are all ranked rows (`cumulative: true`) or ranked rows minus everyone already placed in an earlier ranking's podium (`cumulative: false`, tracked in a running `placedElsewhere` set — only rows that actually received a place, i.e. `podium_pos <= size`, count as "placed"). Candidates are grouped by `groupKey(rd.dims, category)`, groups are ordered by `compareGroupOrder` (sex M/F/MISTO, then age-group `min` ascending with "Sem faixa"/null last, then `event.levels` index ascending with "Sem nível"/null last — only for the dimensions actually present in `rd.dims`), and within each group positions are **recomputed from scratch** (not reusing `ranking_pos`) and trimmed to `rd.size`. A group with zero remaining places is omitted.

### `src/domain/snapshot.ts`

`buildFinalizeRows(event, cls, athletesById): FinalizeRowInput[]` maps **every** row of `cls.rows` (ranked and unranked alike) to a `FinalizeRowInput`:

- `entry_id`, `athlete_ids` (member athlete ids, sorted by `position`), `status`/`final_ms`/`overall_pos` taken straight from the `RankedEntry`.
- `data: ResultSnapshot` — `event`/`race` sub-objects, `members` (name resolved via `athletesById`, falling back to `EntryMember.name` then `''`), `legs` built from `cls.race.legs` merged with `legAthleteId(entry, k)` and `timing.legs[k]?.leg_ms ?? null`, `category` straight from the `RankedEntry`, `positions` (`{overall, sex, finishers: cls.finishers}`), and `podiums` — every place the entry won across `cls.podiums`, collected once via a `podiumsByEntry` index (an entry can win more than one ranking under a cumulative config).

## Tests + results

TDD per the brief: both test files were written first (Steps 1–2), confirmed to fail (Step 3, RED), then `ranking.ts`/`snapshot.ts` were implemented (Step 4) and both suites passed unmodified on the first implementation attempt (Step 5, GREEN — no test-code changes were needed after the first run).

**RED** (before `ranking.ts`/`snapshot.ts` existed):
```
FAIL  src/domain/ranking.test.ts
Error: Failed to resolve import "./ranking" from "src/domain/ranking.test.ts". Does the file exist?
FAIL  src/domain/snapshot.test.ts
Error: Failed to resolve import "./ranking" from "src/domain/snapshot.test.ts". Does the file exist?
Test Files  2 failed (2) · Tests  no tests
```

**GREEN** (after implementation):
```
npx vitest run src/domain/ranking.test.ts   → Test Files 1 passed (1) · Tests 6 passed (6)
npx vitest run src/domain/snapshot.test.ts  → Test Files 1 passed (1) · Tests 3 passed (3)
npx vitest run src/domain                    → Test Files 8 passed (8) · Tests 89 passed (89)
npx vitest run                               → Test Files 10 passed (10) · Tests 100 passed (100)
npm run typecheck                            → clean (tsc --noEmit, no output/errors)
```

`ranking.test.ts` (6 tests, verbatim from the brief + 1 added):
1. orders finishers with shared positions for ties, then non-finishers
2. computes sex positions, gaps and per-ranking positions
3. non-cumulative podiums skip athletes already awarded
4. cumulative podiums repeat athletes
5. team races group by Masculino, Feminino, Misto
6. **added** — "Controller Ruling 9: a finish with no resolvable final time is unranked and sorts before on_course": two synthetic entries appended to the base fixture — `ghost` (`timing.status: 'finished'`, `final_ms: null`) and `oc` (`status: 'on_course'`). Asserts full row order `[...9 ranked..., 'ghost', 'oc', 'm5', 'f6']` (ghost before on_course, before the pre-existing dnf/dns), `ghost.overall_pos`/`sex_pos` both `null`, and `finishers` unchanged at 9.

`snapshot.test.ts` (3 tests, built from the brief's prose description via a local fixture helper that duplicates — not imports — `ranking.test.ts`'s setup, as instructed):
1. `buildFinalizeRows(...)` returns 11 rows.
2. Ranked finisher `f1`: `athlete_ids`, `status`, `final_ms`, `overall_pos`, `data.positions`, `data.category`, `data.podiums` (contains the `geral`/Feminino/1st place), `data.members`, `data.legs[0]`, `data.event`, `data.race` — all match the brief's literal values.
3. Unranked `m5` (dnf): `status`, `final_ms: null`, `overall_pos: null`, `data.podiums: []`.

## Files changed

- `src/domain/ranking.ts` (new, 216 lines) — `classifyRace`, `RankedEntry`, `PodiumPlace`, `PodiumGroup`, `RaceClassification`.
- `src/domain/ranking.test.ts` (new, 79 lines).
- `src/domain/snapshot.ts` (new, 67 lines) — `buildFinalizeRows`.
- `src/domain/snapshot.test.ts` (new, 61 lines).

No other files touched — Task 9/10 outputs (`presets.ts`, `categories.ts`, `eventModel.ts`, `bib.ts`, `consolidation.ts`, `suggestLeg.ts`, `testing/fixtures.ts`) and shared files (`src/lib/types.ts`, `package.json`, etc.) are all untouched (`git status` was clean of anything but the 4 new files before staging).

## Self-review

- **Re-verified by hand** every numeric expectation in the given `ranking.test.ts` (positions, sex positions, gaps, `ranking_pos`, podium exclusion/re-ranking, group ordering) against the fixture's raw birth dates/times before trusting the green run — all matched the brief's own worked example (`f4`'s `faixa: 3`).
- **Internal-consistency check**: for the `geral` ranking (`dims: ['sex']`), `ranking_pos.geral` must equal `sex_pos` for every entry, since both group purely by `category.sex`. Confirmed by inspection (both computed via the same `groupedPositions` helper with equivalent key functions); not asserted directly by a test, so noting it here as a corroborating check rather than a gap.
- **Ties in podium `size`**: used `Array.prototype.sort` (stable per spec) for group ordering; ties in `compareGroupOrder` only occur when comparing a group to itself (a given `dims` combination has exactly one group), so stability isn't load-bearing here but isn't a risk either.
- **Defensive fallback**: `classifyRace` falls back to a synthesized `not_started`/entry-status timing when `timings` has no entry for a given id (not exercised by any test — `computeEventTiming` in Task 10 always populates every entry of a valid race — but keeps the function total instead of throwing/asserting on a technically-possible caller gap).
- **Casts**: two narrow, commented `as number` casts (`finalOf`, and one inline in `classifyRace`) convert `final_ms: number | null` to `number` at the exact points where `isRanked`/the `ranked` filter already guarantee non-null; kept to a minimum and documented rather than threading a type-narrowing generic through the whole module.
- Ran the full suite (`npx vitest run`, 100/100) and `npm run typecheck` **after** committing, not just before, to confirm the committed tree is what was verified.

## Concerns

- None blocking. One note for whoever writes the Results UI (Task 25) or the finalize RPC (likely Task 8/12-adjacent): `buildFinalizeRows` persists a row for *every* entry including unranked ones (`dns`/`dnf`/`dsq`/`on_course`/`not_started`), per the brief's "row for m5: ... `data.podiums []`" example — so `admin_finalize_race` should expect `rows.length === entries.length` for the race, not just the finisher count.
- The numeric-aware bib tie-break (`Intl.Collator(..., {numeric:true})`) is implemented per the brief's instruction and mirrors the existing pattern in `consolidation.ts`, but no test in this task's fixtures actually exercises a case where numeric vs. lexicographic bib ordering would differ (all ties in the given fixtures involve single-digit bibs, or bibs that never need comparing because their rows differ in status/time already). Not a defect — just flagging that this specific detail rides on the existing codebase convention rather than a project-specific regression test.
