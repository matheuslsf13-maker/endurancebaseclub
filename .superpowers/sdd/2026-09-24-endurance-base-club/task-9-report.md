# Task 9 report — Domain foundations: presets, categories, event index, bib resolution, fixtures

Branch: `task/9` in worktree `/home/claude/ebc-wt/t9`. Commit: `f7c9c74` "feat(domain): presets, categories, event index and bib resolution".

## What was implemented

- `src/domain/testing/fixtures.ts` — the fixture builders exactly as given in the brief (`makeEvent`, `makeRace`, `makeWave`, `makeAthlete`, `makeEntry`, `makeMark`, `makeResolution`, `makeTimekeeper`, plus `T0`/`SEC`/`MIN`/`iso`/`nextId`). Transcribed verbatim.
- `src/domain/presets.ts` — `MODALITY_LABEL`, `generateAgeGroups`, `defaultRaceConfig`, `RacePreset`/`RACE_PRESETS` (11 presets), `normalizeRaceConfig`.
- `src/domain/categories.ts` — `EntryCategory`, `ageOn`, `athleteAge`, `entryCategory`, `sexLabel`, `groupKey`, `groupLabel`, `validateAgeGroups`.
- `src/domain/eventModel.ts` — `EventIndex`, `indexEvent`, `entryWave`, `entryDisplayName`, `legAthleteId`, `mergeById`.
- `src/domain/bib.ts` — `BibResolution`, `normalizeBib`, `resolveBib`.

All signatures match the "Domain signatures" block in `contracts.md` exactly (names, parameter order, return types).

### Design/implementation notes (decisions not spelled out verbatim in the brief)

- **`defaultRaceConfig`**: `teamSize > 1` selects the team variant (only `geral` ranking, empty `age_groups`); `teamSize <= 1` is individual. This matches both given tests (`defaultRaceConfig(1)` individual, `defaultRaceConfig(2)` team) and the Task 3 SQL brief's mirrored description.
- **`generateAgeGroups(start, step, last)`**: first bucket `até ${start-1}` (min 0, max `start-1`); then `step`-wide buckets while the bucket start `< last`; then `${last}+` (max null). Verified by hand against both given examples (`generateAgeGroups(20,10,60)` and `generateAgeGroups(18,5,28)`).
- **`RACE_PRESETS['revezamento-trio-triathlon']` legs**: the brief's Step 4 notes only pin `team_size: 3` for this preset; the name ("triathlon sprint") and spec §9 ("Revezamento trio triathlon (equipe 3)") point to the same distances as the Triathlon Sprint preset (750 m swim / 20 km bike / 5 km run), so I used those. No other task pins different distances for it (checked the plan doc).
- **`entryCategory` sex/age rule**: implemented as one uniform rule ("all members M" → M, "all members F" → F, else MISTO; age combined via `team_age_rule`) rather than branching on `team_size`. For a single-member (individual) entry this reduces exactly to "the athlete's own sex/age" since `every()`/`sum`/`oldest`/`youngest` over one element all yield that element — verified against the individual-category test. Guarded against the vacuous-truth edge case of zero resolvable members (`members.length > 0 &&` before `.every(...)`), which isn't exercised by any given test but would otherwise silently misreport sex as `M`.
- **`ageOn`**: pure integer arithmetic on the `YYYY-MM-DD` parts (no `Date`/timezone involved) — `year_end` = event year − birth year; `event_date` subtracts one more year unless the birthday (month/day) has already occurred by the event's month/day. Verified against all three given assertions.
- **`groupKey`/`groupLabel`**: `'∅'` placeholder for missing age/level in keys (so a "missing" group still sorts/groups distinctly from any real value), `'Sem faixa'`/`'Sem nível'` in labels, per the brief's Step 4 notes.
- **`resolveBib`**: exact normalized-string match first; if the input is all-digits, a numeric-equivalent fallback that only considers entries whose *own* bib is also all-digits (so `"7"` matches `"007"` but a digit-only search never accidentally matches an alphanumeric bib like `"12A"`). "Not found" message uses the normalized input; DNS/DSQ warning messages use the matched entry's own (unnormalized) `bib`, per the brief's explicit instruction ("use the entry's bib").
- **`mergeById`**: replace-if-newer-or-incomparable logic exactly as described (`incoming.updated_at >= current.updated_at`, or replace when either side lacks `updated_at`); unknown ids appended in incoming order; original order preserved for existing ids. This lets the same generic function merge mark deltas (which carry `updated_at`) and full-replace payloads like waves (`WaveRow` has no `updated_at` field at all, so it's always "incomparable" → always replaces with the freshly fetched row), matching how `admin_live`/`pub_live`/`tk_sync` are specified to return marks as deltas but waves/resolutions in full each time.
- **`eventModel.test.ts`**: only prose was given for this file in the brief ("`indexEvent` builds all maps and `wavesByRace` sorted by `position`; ..."), so I authored the test file myself, covering every behavior in that prose: `indexEvent`'s maps (including out-of-position-order input to prove the sort), `entryWave`'s own-wave / first-of-race / no-waves-at-all cases, `entryDisplayName`'s team_name / joined-names / bib-fallback cases, `legAthleteId`'s found/not-found cases, and `mergeById`'s newer-incoming / newer-current / missing-`updated_at` / equal-timestamp / unknown-id cases.

## TDD evidence

**RED** — before any domain implementation file existed, with fixtures + all 4 test files in place:

```
$ npx vitest run src/domain
...
 FAIL  src/domain/bib.test.ts [ src/domain/bib.test.ts ]
Error: Failed to resolve import "./bib" from "src/domain/bib.test.ts". Does the file exist?
 FAIL  src/domain/categories.test.ts [ src/domain/categories.test.ts ]
Error: Failed to resolve import "./categories" from "src/domain/categories.test.ts". Does the file exist?
 FAIL  src/domain/eventModel.test.ts [ src/domain/eventModel.test.ts ]
Error: Failed to resolve import "./eventModel" from "src/domain/eventModel.test.ts". Does the file exist?
 FAIL  src/domain/presets.test.ts [ src/domain/presets.test.ts ]
Error: Failed to resolve import "./presets" from "src/domain/presets.test.ts". Does the file exist?

 Test Files  4 failed (4)
      Tests  no tests
```

**GREEN** — after implementing `presets.ts`, `categories.ts`, `eventModel.ts`, `bib.ts`:

```
$ npx vitest run src/domain --reporter=verbose
 ✓ src/domain/categories.test.ts > categories > computes age by rule
 ✓ src/domain/categories.test.ts > categories > individual category
 ✓ src/domain/categories.test.ts > categories > team sex and age rules
 ✓ src/domain/categories.test.ts > categories > missing birth date gives no age
 ✓ src/domain/categories.test.ts > categories > uses precomputed public ages
 ✓ src/domain/categories.test.ts > categories > ignores level when the event has none
 ✓ src/domain/categories.test.ts > categories > labels and keys
 ✓ src/domain/categories.test.ts > categories > validates age groups
 ✓ src/domain/eventModel.test.ts > eventModel > indexEvent builds all maps and sorts wavesByRace by position
 ✓ src/domain/eventModel.test.ts > eventModel > entryWave returns the entry wave, or the first wave of the race (by position) when wave_id is null
 ✓ src/domain/eventModel.test.ts > eventModel > entryWave returns null when the race has no waves
 ✓ src/domain/eventModel.test.ts > eventModel > entryDisplayName prefers team_name
 ✓ src/domain/eventModel.test.ts > eventModel > entryDisplayName joins athlete names in member-position order when there is no team_name
 ✓ src/domain/eventModel.test.ts > eventModel > entryDisplayName falls back to the bib when no member name is known
 ✓ src/domain/eventModel.test.ts > eventModel > legAthleteId returns the member whose legs include the index, or null
 ✓ src/domain/eventModel.test.ts > eventModel > mergeById replaces with a newer incoming, keeps a newer current, and appends unknown ids in order
 ✓ src/domain/eventModel.test.ts > eventModel > mergeById replaces when either side lacks updated_at, and on equal timestamps
 ✓ src/domain/presets.test.ts > presets > individual default config
 ✓ src/domain/presets.test.ts > presets > team default config
 ✓ src/domain/presets.test.ts > presets > generates age groups
 ✓ src/domain/presets.test.ts > presets > has the race presets
 ✓ src/domain/presets.test.ts > presets > normalizes partial configs
 ✓ src/domain/bib.test.ts > bib resolution > normalizes
 ✓ src/domain/bib.test.ts > bib resolution > matches exact, trimmed and numeric-equivalent bibs
 ✓ src/domain/bib.test.ts > bib resolution > reports unknown or empty bibs
 ✓ src/domain/bib.test.ts > bib resolution > warns (does not block) for DNS and DSQ

 Test Files  4 passed (4)
      Tests  26 passed (26)
```

## Final verification (post-commit)

```
$ npx vitest run src/domain
 Test Files  4 passed (4)
      Tests  26 passed (26)

$ npx vitest run
 Test Files  6 passed (6)     # 4 domain + src/lib/format.test.ts + src/lib/storage.test.ts (Task 1, untouched)
      Tests  37 passed (37)

$ npm run typecheck
> tsc --noEmit -p tsconfig.json
(no output — exit code 0)
```

## Files changed

New files only (no existing files touched):
- `/home/claude/ebc-wt/t9/src/domain/presets.ts` (95 lines)
- `/home/claude/ebc-wt/t9/src/domain/presets.test.ts` (42 lines)
- `/home/claude/ebc-wt/t9/src/domain/categories.ts` (110 lines)
- `/home/claude/ebc-wt/t9/src/domain/categories.test.ts` (57 lines)
- `/home/claude/ebc-wt/t9/src/domain/eventModel.ts` (86 lines)
- `/home/claude/ebc-wt/t9/src/domain/eventModel.test.ts` (100 lines, authored by me per the brief's prose spec)
- `/home/claude/ebc-wt/t9/src/domain/bib.ts` (39 lines)
- `/home/claude/ebc-wt/t9/src/domain/bib.test.ts` (22 lines)
- `/home/claude/ebc-wt/t9/src/domain/testing/fixtures.ts` (41 lines, verbatim from brief)

9 files, 592 insertions, 0 deletions. `git status --short` confirms nothing outside `src/domain/` was modified (`src/lib/types.ts`, `src/lib/format.ts` and all other shared files are untouched).

## Self-review findings

Reviewed every file's diff line by line after committing (`git show --stat HEAD`, full diff read). No issues found requiring a fix:
- No unused imports; every imported type from `src/lib/types` is used.
- No `console.*`/`TODO`/`FIXME`/`debugger` left in the new code.
- Verified by hand (not just by the tests) that `generateAgeGroups`, `ageOn`, `resolveBib`'s numeric-equivalence, `mergeById`'s replace condition, and `validateAgeGroups`' overlap check are correct on the boundary cases the given tests probe (adjacent-but-non-overlapping age buckets, digit-only vs. alphanumeric bibs, equal-timestamp merges).
- Confirmed the `defaultRaceConfig` values against both this task's brief and the Task 3 brief's mirrored SQL description (`default_race_config`) — the two are specified with identical values, so no drift risk was found (Task 3 hadn't been merged/run in this worktree yet, so this is a text-level cross-check, not a runtime one).
- Confirmed only files in this task's ownership list were created/touched; no edits to shared files (`package.json`, `src/App.tsx`, `src/lib/types.ts`, `src/lib/api.ts`).
- One deliberate, documented interpretation call: `revezamento-trio-triathlon`'s leg distances (not pinned by any given test, only `team_size: 3` is) — chosen to mirror Triathlon Sprint per the preset's own name and the spec text; flagged above under "Design/implementation notes" in case a later task expected something else.

No blocking issues. No scope grew beyond the brief's file list.

## Concerns

- `eventModel.test.ts` was written by me from prose (not given verbatim in the brief), unlike the other three test files which were transcribed exactly. I kept it deliberately literal to the one-line spec in the brief and to the "Domain signatures" doc comments, but a later task (or reviewer) should double-check `entryDisplayName`'s exact fallback semantics (join only resolvable names, fall back to `Nº <bib>` only when *zero* names resolve) matches what Tasks 17/19/21/22 etc. expect when they render entry names — nothing in `contracts.md` or the other task briefs contradicts this, but it's the one place in this task where I had to make a judgment call on exact behavior rather than transcribe a given assertion.
- `revezamento-trio-triathlon` preset's leg distances (750/20000/5000, mirroring Triathlon Sprint) are an inference from the preset's name and spec §9, not a directly asserted value in any brief — see note above.

Report path: `/home/claude/endurance-base-club/.superpowers/sdd/2026-09-24-endurance-base-club/task-9-report.md`
