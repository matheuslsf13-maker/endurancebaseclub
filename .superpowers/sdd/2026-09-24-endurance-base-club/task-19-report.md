# Task 19 report — Races tab (race editor)

## What was implemented

- `src/features/races/raceForm.ts` (new) — pure form helpers, all exported per the brief's
  interface:
  - `distanceToForm(distance_m)`, `parseDistance(text, unit)` — the display/parse pair for the
    "type text, comma or dot decimal, km ⇄ m" distance fields.
  - `raceToForm(race, waves)` — builds a `RaceForm` from a saved `RaceRow` + the event's waves
    (filtered to this race, sorted by position; falls back to one "Largada geral" if somehow none
    exist).
  - `presetToForm(preset, eventId)` — builds a fresh `RaceForm` from a `RacePreset`
    (`RACE_PRESETS`), with `defaultRaceConfig(preset.team_size)`.
  - `validateRaceForm(f)` — pt-BR messages: name required, ≥1 leg, per-leg distance validity
    (`other` may be blank, every other modality may not), age-group overlaps (delegates to
    `domain/categories.validateAgeGroups`), and podium size out of 1..10.
  - `formToPayload(f)` — converts to what `api.admin.saveRace` expects: legs to meters (km × 1000,
    comma accepted), **always** includes the full `waves` array (Ruling 12: a present array
    upserts by id and deletes what's missing — so the form must always carry the complete set) and
    the full `config` object (Ruling 14); wave payloads never carry `start_at` (Ruling 16: the
    server never changes it here, so the field simply never appears in this payload).
  - `teamSizeLabel(n)`, `legsSummary(legs)` — the list view's display helpers.
- `src/features/races/LegsEditor.tsx` (new) — "Pernas" section: ordered rows (modality, label,
  distance + unit), move up/down, remove (kept to ≥1 leg), `leg-add`. Changing modality only
  replaces the label when it still held the old modality's default label (a customized label is
  left alone).
- `src/features/races/AgeGroupsEditor.tsx` (new) — "Categorias" age-groups editor: rows
  (label/min/max), add/remove, a generator ("de X em X anos a partir de Y até Z") built on
  `generateAgeGroups`, and live overlap messages from `validateAgeGroups`.
- `src/features/races/RankingsEditor.tsx` (new) — "Pódio" editor: rows (name, Sexo/Faixa
  etária/Nível checkboxes — Nível disabled when the event has no levels — size 1..10), move
  up/down, remove, add, plus the "Premiação cumulativa" checkbox with explanatory hint text.
- `src/features/races/RaceEditor.tsx` (new) — the full editor: Dados (name, team size 1..6 with
  `teamSizeLabel`), Pernas, Largadas (name + **read-only** `"Largou às hh:mm:ss.d"` /
  `"Sem largada"` via `formatClock(…, {tenths:true})`, add/remove), Categorias (age rule radio,
  team age rule radio shown only for team_size > 1, `AgeGroupsEditor`), Pódio (`RankingsEditor`),
  Cronometragem (same-crossing window, divergence threshold, time-source radio +
  reference-timekeeper select from `agg.timekeepers`, disabled unless "reference" is chosen).
  `race-save` validates client-side first (banner on failure), else calls
  `api.admin.saveRace(formToPayload(form))`, `refresh()`s the event, shows the "Prova salva" toast
  and calls `onDone()`; a thrown `ApiError` (e.g. the server's leg/team_size-with-marks block) is
  shown verbatim in the same banner instead of navigating away. Crossing the individual↔team
  boundary on the team-size select opens the kit's `Confirm`; confirming resets
  `config.rankings`/`config.age_groups` to `defaultRaceConfig(newSize)`'s values explicitly
  (Ruling 14); canceling leaves the form untouched, so the select reverts.
- `src/features/races/RacesTab.tsx` (replaced the stub) — lists races (name, `finalizada` badge,
  `teamSizeLabel`, `legsSummary`, inscriptions count from `agg.entries`), `new-race` → an inline
  `race-preset` picker → `RaceEditor` prefilled via `presetToForm`; `race-edit-<id>` →
  `RaceEditor` prefilled via `raceToForm`; `race-delete-<id>` → `Confirm` → `api.admin.deleteRace`
  → `refresh()` → toast (or a toast with the server's message on failure).

## Decisions the brief didn't spell out

- **Waves payload never carries `start_at`.** Since Ruling 16 says the server ignores it for
  existing waves and new waves always start with none, `formToPayload` simply never includes the
  field — the cleanest way to guarantee the client can't be misread as trying to set it.
- **Wave `position` is always re-numbered from the form's array order** (index i), rather than
  trusting a stored `position` field, since the Largadas section has no reorder control (only
  add/remove) — array order *is* the order.
- **Team-size boundary confirm resets only `rankings`/`age_groups`**, per the brief; every other
  `config` field (window/divergence/time source/cumulative) survives the team-size change
  untouched. Changing team size *within* the same boundary (e.g. 2→3) applies immediately, no
  confirm — both sizes share the same default shape.
- **`leg-move-up-<i>` / `leg-move-down-<i>` / `leg-remove-<i>`, `wave-remove-<i>`,
  `ranking-*-<i>`, `agegroup-*-<i>`, `race-window`, `race-divergence`, `race-time-source-*`,
  `race-reference-timekeeper`, `race-edit-<id>`, `race-delete-<id>`, `race-cancel`** — test ids
  not listed in contracts.md (which only requires `new-race`, `race-preset`, `race-name`,
  `race-team-size`, `race-save`, `leg-add`, `wave-add`); chosen consistently between the
  components and `races.test.tsx`.
- **Distance field is `type="text"`** (per the brief: "distance typed as text so users can type
  `2,5`"), with `inputMode="decimal"` for a numeric mobile keyboard.
- Radios (age rule, team age rule, time source) have no shared kit component, so `RaceEditor`
  defines a small local `RadioOption`, styled consistently with the kit's `Checkbox`
  (`accentColor: var(--accent)`, `min-h-11` label).
- New race's `position` is set by `RacesTab` (`agg.races.length`) after `presetToForm`, which
  itself always returns `position: 0` per its documented signature (no event context available to
  a pure helper).

## TDD evidence

**RED** (`raceForm.ts` stubbed to `export {};`):
```
$ npx vitest run src/features/races/raceForm.test.ts
 Test Files  1 failed (1)
      Tests  23 failed (23)
```
(all 23 failed with `TypeError: <fn> is not a function`, e.g. `presetToForm is not a function`).

**RED** (`RacesTab.tsx` still the Task-17 stub, before `RaceEditor`/`LegsEditor`/etc. existed):
```
$ npx vitest run src/features/races/races.test.tsx
 Test Files  1 failed (1)
      Tests  10 failed (10)
```
(each failed on a missing `data-testid`, e.g. `Unable to find an element by: [data-testid="new-race"]`.)

**GREEN** (after implementing `raceForm.ts` and then all the UI files):
```
$ npx vitest run src/features/races/
 Test Files  2 passed (2)
      Tests  33 passed (33)
```

## Gate outputs

```
$ npx vitest run
 Test Files  1 failed | 26 passed (27)
      Tests  1 failed | 320 passed (321)
```
The one failure is **not in a file I own**:
`src/features/events/eventShell.test.tsx > EventLayout > renders the provas tab`, which asserts
`screen.findByText('RacesTab')` (the literal placeholder text of Task 17's stub). Replacing the
stub with the real editor — exactly what this task requires — necessarily breaks that assertion;
it is a shared, Task-17-owned test file outside this brief's Files block, so per the file-ownership
rule I did not edit it. The same collision will hit every other wave-2a task in turn as each one
replaces its own tab's stub (`entries`, `timing`, `review`, `results`), so it's an expected,
known cross-task conflict for the controller to resolve at merge time (e.g. updating that
parametrized test once all of wave 2a lands), not a defect in this task's code.

```
$ npm run typecheck
> tsc --noEmit -p tsconfig.json
(clean, no output)
```

```
$ npm run build
> vite build
✓ 235 modules transformed.
dist/index.html                   0.81 kB │ gzip:   0.44 kB
dist/assets/index-*.css          21.48 kB │ gzip:   5.19 kB
dist/assets/index-*.js          628.79 kB │ gzip: 182.43 kB
✓ built in 755ms
```
(the chunk-size warning is pre-existing/expected for a single-bundle Vite build with no
code-splitting configured — not something this task's Files block covers.)

## Files changed

- Modified: `src/features/races/RacesTab.tsx`
- Created: `src/features/races/RaceEditor.tsx`, `src/features/races/LegsEditor.tsx`,
  `src/features/races/AgeGroupsEditor.tsx`, `src/features/races/RankingsEditor.tsx`,
  `src/features/races/raceForm.ts`, `src/features/races/raceForm.test.ts`,
  `src/features/races/races.test.tsx`

No other files were touched (verified with `git status --porcelain`).

## Self-review findings

- Confirmed `formToPayload` never sends `start_at` for any wave (checked via the
  "always includes the full waves list…" test in `raceForm.test.ts`), satisfying Ruling 16
  literally rather than just in spirit.
- Confirmed the team-size-boundary reset only overwrites `rankings`/`age_groups`, never the rest of
  `config`, via the dedicated `races.test.tsx` tests (confirm/cancel paths both covered).
- Confirmed `validateRaceForm`'s "Distância inválida na perna N" uses 1-based leg numbering
  matching the UI's "Perna 1..N" convention (CLAUDE.md / contracts.md).
- Double-checked no `update`/`delete` semantics were introduced anywhere touching `marcacoes`
  (out of scope for this task; races/waves/config only).
- Removed two accidental unused imports (`Checkbox` in `AgeGroupsEditor.tsx` and
  `RaceEditor.tsx`) caught while writing the files, before the first typecheck run.

## Concerns

- The single failing full-suite test (`eventShell.test.tsx`'s "renders the provas tab") is
  described above under Gate outputs — it is an expected, out-of-scope collision with a
  Task-17-owned shared test file, not a defect introduced by this task, and I did not modify that
  file per the file-ownership rule.
- `RaceEditor` shows the full form as one long page (Dados/Pernas/Largadas/Categorias/Pódio/
  Cronometragem stacked in `Card`s) rather than as a modal, since the brief describes six
  substantial sections that would not fit comfortably in the kit's `Modal` at 390px width; this is
  a reasonable reading of "race editor" as a screen, not a dialog, but flagging the choice in case
  reviewers expected a modal.

## Fix round 1

Review came back "Needs fixes" with two Important findings. Both fixed on `task/19`.

### 1. `normalizeRaceConfig` (listed in the brief's Consumes) was never used

`raceToForm` took `race.config` verbatim instead of normalizing it against the race's
`team_size`, so a partial or legacy config (missing keys added since it was last saved) would
reach the editor's inputs with `undefined` fields instead of sane defaults.

Fix in `src/features/races/raceForm.ts`: `raceToForm` now builds
`config: normalizeRaceConfig(race.config, race.team_size)` instead of `config: race.config`, and
imports `normalizeRaceConfig` alongside the already-imported `defaultRaceConfig`. (`presetToForm`
needed no change — it already builds a fresh `defaultRaceConfig(preset.team_size)`, nothing to
normalize.)

New test in `raceForm.test.ts` (`raceToForm` describe block): a race whose config is missing keys
(simulated with `{ cumulative: true } as unknown as RaceConfig`, since `RaceConfig`'s own type
doesn't allow a partial object — a real legacy database row can still look like this) produces a
form whose `config` equals `normalizeRaceConfig(legacyConfig, race.team_size)`, with `rankings`,
`age_groups`, `divergence_threshold_s` and `time_source` filled in from
`defaultRaceConfig(team_size)` while the one field the legacy config did carry (`cumulative`)
survives.

### 2. Verbatim duplicated reorder logic

`LegsEditor.tsx`'s and `RankingsEditor.tsx`'s `move(i, dir)` functions were identical except for
the array name (`legs` vs `rankings`).

Fix: extracted `moveItem<T>(items: T[], i: number, dir: -1 | 1): T[]` into `raceForm.ts` — swaps
the item at `i` with its neighbor at `i + dir`, returning a **new** array; out of bounds is a
no-op that returns the **same** `items` reference unchanged (so a caller can skip calling
`onChange` when nothing moved, exactly as the original early-return did). Both `LegsEditor.move`
and `RankingsEditor.move` now call it:
```ts
function move(i: number, dir: -1 | 1) {
  const next = moveItem(legs, i, dir); // or `rankings`
  if (next !== legs) onChange(next);
}
```
The waves list has no reorder control (only add/remove, per the brief — Largadas order is just
array order), so there was nothing to change there.

New tests in `raceForm.test.ts` (`moveItem` describe block): no-op at either bound returns the
same array reference; a valid swap (up and down) returns a new array with the two items swapped,
and the input array itself is never mutated.

#### TDD evidence for this round

**RED** (stashed the `raceForm.ts` changes, keeping the new tests):
```
$ git stash push -- src/features/races/raceForm.ts
$ npx vitest run src/features/races/raceForm.test.ts
 Test Files  1 failed (1)
      Tests  3 failed | 23 passed (26)
```
(the normalization test failed on a mismatched `config` object — the old code returned
`race.config` verbatim; both `moveItem` tests failed with `TypeError: moveItem is not a function`.)

**GREEN** (restored `raceForm.ts`, `git stash pop`):
```
$ npx vitest run src/features/races/raceForm.test.ts
 Test Files  1 passed (1)
      Tests  26 passed (26)
```

#### Gate outputs for this round

```
$ npx vitest run src/features/races
 Test Files  2 passed (2)
      Tests  36 passed (36)
```
```
$ npx vitest run
 Test Files  1 failed | 26 passed (27)
      Tests  1 failed | 323 passed (324)
```
The one remaining failure is the same `eventShell.test.tsx > EventLayout > renders the provas
tab` noted in the first round (asserting the literal Task-17 stub text) — per the coordinator's
note it is being fixed on Task 17's side, so it was left as is.
```
$ npm run typecheck
> tsc --noEmit -p tsconfig.json
(clean, no output)
```
```
$ npm run build
✓ 235 modules transformed.
✓ built in 952ms
```

#### Files changed this round

`src/features/races/raceForm.ts`, `src/features/races/raceForm.test.ts`,
`src/features/races/LegsEditor.tsx`, `src/features/races/RankingsEditor.tsx` — all within this
task's existing Files block; nothing else touched (`git status --porcelain` confirmed).

Minor findings from the review were deferred, per the coordinator's instruction, and are not
addressed here.
