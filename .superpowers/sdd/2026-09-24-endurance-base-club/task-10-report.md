# Task 10 report: time consolidation and leg suggestion

Branch `task/10` in worktree `/home/claude/ebc-wt/t10` (based on `task/9` @ `f7c9c74`). Commit: `fb6c7d7` "feat(domain): median time consolidation, issues and leg suggestion". There's no fix commit because the self-review found nothing to change.

**Status: DONE.** All tests pass, the typecheck is clean, and the brief's contract tests are unchanged.

Note on the resumed run: the coordinator's resume message said Step 2b's tests were missing. They weren't: the first run had already written them to `suggestLeg.test.ts` before it stopped. This run confirmed RED from that state, then implemented, verified and committed.

## What was implemented

- **`src/domain/consolidation.ts`**
  - Types, exactly as in "Domain signatures": `Candidate`, `Crossing`, `TimingStatus`, `LegTiming`, `EntryTiming`, `IssueType`, `Issue`, `EventTiming`.
  - `median`: sorts a copy, so the input array is never changed.
  - `computeCrossing`:
    - filters out discarded marks and keeps only this leg's marks, then sorts by `(ts, id)`;
    - makes one candidate per `timekeeper_id ?? 'org:'+id` and sends later marks to `duplicates`;
    - computes `median_ms` and `spread_ms`;
    - picks the system time: the reference timekeeper's candidate under the `'reference'` policy, otherwise the median;
    - applies the organizer's `manual`, `mark` or `system` resolution, setting `chosen_mark_discarded` when needed;
    - sets `divergent`.
  - `computeEntryTiming`:
    - leg k starts at the official time of leg k−1, or at the wave start for leg 0 (this is the relay handoff);
    - `leg_ms`, `total_ms`, and `final_ms` with the penalty;
    - status overrides, then `finished` / `on_course` / `not_started`;
    - `current_leg` and `current_leg_start_ms` when the entry is on course.
  - `computeEventTiming(agg, nowMs)`:
    - times every entry, using `entryWave`;
    - builds the 8 pt-BR issue types with the exact message formats from the brief;
    - sorts issues by error, then warning, then info, then message.
- **`src/domain/suggestLeg.ts`**
  - `LegSuggestion` and `suggestLeg`, following spec §7.5 and the brief's algorithm.
  - The Step 2b (Ruling 2) helper: `AssignmentPlan` and `planBibAssignment`. It calls `resolveBib`, reports a missing race as `'Prova da inscrição não encontrada'`, and runs `suggestLeg` over the marks **excluding `markId`**. The returned `warning` is the bib warning or `Nº <bib> já concluiu — registrada como fim da <label> (<k+1>/<N>)`, and the bib warning wins when both apply.
- Both modules are pure: time only comes in as `nowMs` or `tsMs`, and there are no `Date.now()` calls. They reuse `indexEvent`, `entryWave`, `legAthleteId`, `resolveBib` and `formatClock`. No Task 1 or Task 9 files were modified.

### Choices the brief doesn't spell out (each is pinned by a test)

1. **Order of `mark_ids` in divergence issues (Review Focus 1 with two timekeepers).**
   - The brief says "mark_ids = outlier mark ids" but doesn't fix their order. Task 24's button calls `updateMark(mark_ids[0], { leg_index: suggested_leg_index })`.
   - With exactly 2 candidates, both marks are outliers. If tk2 missed the swim finish and its run-finish tap was filed under leg 0, the correct swim mark comes first in time order. Keeping time order would make the Review tab move the correct mark instead of the wrong one.
   - So the outlier that produced `suggested_leg_index` is listed first, followed by the other outliers in time order.
   - `suggested_leg_index` is the first matching leg `j` of the first outlier (in time order) that has a match, as the brief states.
2. **Duplicate issues are grouped per timekeeper.** The message names a single timekeeper (`<name> marcou mais de uma vez`). If two timekeepers each double-tap the same crossing, you get two issues, and each one's `mark_ids` holds that timekeeper's duplicates. In the common case (one timekeeper) this is identical to the brief.
3. **Name for a timekeeper that isn't in the aggregate.**
   - The brief's placeholder is `<name|Organização>`. I use `'Organização'` only when `timekeeper_id` is null (an organizer mark).
   - An id that isn't in `timekeepers` gets `'Cronometrista'`. This can really happen: timekeeper registration doesn't bump `events.version`, so `useEventData` only merges live mark deltas and won't reload `timekeepers` for a timekeeper who registers mid-event. Labelling their marks "Organização" would be wrong.
4. **How messages are sorted.** Issues are compared with `Intl.Collator('pt-BR', { numeric: true })`, so `Nº 9` sorts before `Nº 101`, and unassigned-mark messages sort chronologically.
5. **`no_start` when there is no wave.** If the entry has no wave at all (the race has no waves), the message drops the parentheses: `Nº <bib>: marcação sem largada registrada`. The server makes this state impossible; the branch is defensive.
6. **An athlete who is a member but has no legs.** `suggestLeg` falls back to all legs. This is possible when `team_size` is larger than the number of legs.
7. **Reference policy with no reference timekeeper chosen** (`reference_timekeeper_id: null`). The median is used; an organizer mark (null timekeeper) never counts as "the reference".
8. **Missing race.** `computeEventTiming` skips an entry whose race isn't in the aggregate, since there are no legs or config to time it with. That entry has no `byEntry` row.
9. **Mark and resolution filtering in `computeEntryTiming`.** It also keeps only marks and resolutions with `entry_id === entry.id` (spec §8 step 1), so callers such as Task 22's `onCourse` can safely pass the whole event's marks. `suggestLeg` does the same, as the brief requires ("the entry's non-discarded marks").

## Tests

- `src/domain/consolidation.test.ts` (239 lines):
  - The brief's Step 1 code is copied verbatim; I extracted it mechanically from the brief. The only change is two added `import type` lines.
  - I appended extra tests:
    - `computeCrossing` edge cases (3): no candidates, organizer marks, reference policy with no timekeeper chosen;
    - `computeEntryTiming` edge cases (3): wave started with no crossings, a finish without a start, other entries' marks and resolutions;
    - `computeEventTiming issue details` (16): a table of exact messages covering all 8 issue types, the two-timekeeper Review Focus 1 case, duplicates per timekeeper, the order check against the wave start, the 60 s / discarded rule for unassigned marks, and numeric-aware sorting.
- `src/domain/suggestLeg.test.ts` (105 lines):
  - The brief's Step 2 code is copied verbatim; the import line now also imports `planBibAssignment`.
  - `suggestLeg edge cases` (4): only the entry's own marks count; the closest leg wins within the window; `last` is taken over all legs; fallback to all legs.
  - `planBibAssignment` (7): the brief's 4 cases (unknown bib, the next leg from other marks, the reassigned mark excluded, a DNS warning), plus a missing race, forwarding `athleteId`, and the already-finished message with the bib warning taking precedence.

`diff` against the brief shows the given test code is intact apart from those import changes.

## TDD evidence

**RED**: the test files were in place and neither module existed yet.

```
$ npx vitest run src/domain
 FAIL  src/domain/consolidation.test.ts [ src/domain/consolidation.test.ts ]
Error: Failed to resolve import "./consolidation" from "src/domain/consolidation.test.ts". Does the file exist?
 FAIL  src/domain/suggestLeg.test.ts [ src/domain/suggestLeg.test.ts ]
Error: Failed to resolve import "./suggestLeg" from "src/domain/suggestLeg.test.ts". Does the file exist?
 Test Files  2 failed | 4 passed (6)
      Tests  26 passed (26)          # Task 9's existing tests
```

**GREEN**: after adding `consolidation.ts` and `suggestLeg.ts`.

```
$ npx vitest run src/domain
 Test Files  6 passed (6)
      Tests  80 passed (80)          # 26 Task 9 + 54 new (36 consolidation, 18 suggestLeg/planBibAssignment)
```

**Mutation check.** My extra tests had only been seen failing on a missing module. To prove each one catches the specific bug it targets, I applied 21 realistic single-point mutations to the finished code, one at a time, and restored the sources byte-for-byte afterwards (checked with `cmp`). **The intended test caught all 21.** The mutations were:

- `mark_ids` left in time order;
- the first leg in the window instead of the closest;
- `last` computed only over candidate legs;
- no fallback when a member has no legs;
- the reassigned mark not excluded;
- `athleteId` dropped;
- the already-finished warning winning over the bib warning;
- the entry filter removed in `suggestLeg`;
- a null reference timekeeper matching organizer marks;
- all organizer marks sharing one key;
- `>` changed to `>=` for the 60 s rule;
- discarded unassigned marks reported;
- plain string sort instead of the pt-BR collator;
- an unknown timekeeper labelled "Organização";
- one duplicate issue per crossing;
- "finished" requiring a start;
- `<=` changed to `<` in the order check;
- the entry filter removed for marks, and separately for resolutions, in `computeEntryTiming`;
- the parentheses kept in the no-wave `no_start` message;
- `current_leg` defaulting to 1.

(I dropped one equivalent mutant: `candidates >= 1`. A single candidate always has spread 0, so that change can't affect `divergent`.)

## Final verification (after the commit)

```
$ npx vitest run src/domain        → Test Files 6 passed (6) · Tests 80 passed (80)
$ npx vitest run                   → Test Files 8 passed (8) · Tests 91 passed (91)   (no warnings/errors in output)
$ npm run typecheck                → tsc --noEmit -p tsconfig.json, exit code 0
```

I also checked that `Date.parse` handles Postgres's JSON `timestamptz` format (`…00.123456+00:00`, truncated to the ms) as well as the ms/`Z` forms.

## Files changed

All four files are new, and no existing file was touched (`git diff --name-only f7c9c74..HEAD`):

- `/home/claude/ebc-wt/t10/src/domain/consolidation.ts` (273 lines)
- `/home/claude/ebc-wt/t10/src/domain/consolidation.test.ts` (239 lines)
- `/home/claude/ebc-wt/t10/src/domain/suggestLeg.ts` (83 lines)
- `/home/claude/ebc-wt/t10/src/domain/suggestLeg.test.ts` (105 lines)

Total: 700 insertions.

## Self-review findings

After committing, I checked the code against every algorithm bullet line by line:

- **median**: odd count, even count with `Math.round`, empty → `null`.
- **computeCrossing**: discarded and leg filter, `(ts,id)` sort, candidate key, duplicates, median and spread over candidates, reference policy, manual / mark / system resolution, and `chosen_mark_discarded` when the chosen mark isn't among this leg's non-discarded marks. The divergence rule is `≥ 2` candidates and spread `>` threshold.
- **computeEntryTiming**: start, leg start, `leg_ms`, `total_ms` from the last leg's official time, `final_ms`, the status order, and `current_leg` / `current_leg_start_ms`.
- **The eight issues**: types, severities and exact messages; "with exactly 2 candidates both count"; comparing only with the *other* legs' medians within `same_crossing_window_s`; the order check against the previous official time or the start; `nowMs − ts > 60 000`; sorting.
- **suggestLeg**: the window, the entry's non-discarded marks that have a leg, candidate legs sorted, the closest leg within the window as `same_crossing`, `last` over all legs using `median < ts − window`, the smallest candidate after `last`, otherwise the last candidate with `already_finished`, and `legAthleteId`.
- **planBibAssignment**: resolve, find the race, suggest without `markId`, and warning precedence.

Everything matched, and nothing needed fixing. Other checks:

- Every import is used, and the code has no `console`, `TODO` or `Date.now()`.
- Only the 4 files owned by this task were created.
- Special characters match the brief byte for byte: `º` U+00BA, `·` U+00B7, `—` U+2014.

## Concerns (none blocking)

1. **"Finished" without a start differs between the brief and the spec.**
   - The brief says a finish crossing present → `finished`, whether or not the wave has a start. I implemented that and pinned it with a test.
   - Spec §8's wording is "finished (tem chegada e largada)", i.e. it needs both.
   - With the brief's rule, an entry whose wave was never started but which has a finish is `finished` with `total_ms`/`final_ms` = null, plus a `no_start` warning.
   - Task 11 only ranks entries that are `finished` with a non-null `final_ms`, so this entry stays unranked. But Task 11's list of unranked statuses (`on_course, not_started, dnf, dns, dsq`) doesn't include `finished`, so Task 11 should decide where such a row goes.
   - If the controller prefers the spec's wording, it's a one-line change plus that test.
2. **The order check only compares with the immediately previous leg.** `order` compares only with the previous official time or the start, as the brief literally says. If a leg is missing, a later crossing that is out of order (e.g. leg 2 earlier than leg 0 while leg 1 is missing) only shows up as `missing_crossing` until the gap is filled. It isn't silent, because the entry still gets an error.
3. **Grammar of the "already finished" message.** The mandated text `fim da <label>` reads wrongly for masculine leg labels ("fim da Ciclismo"). Task 22's `assignmentMessage` uses the same form, so changing it would need a coordinated wording change in both places, for example `fim da perna <k+1> (<label>)`.
4. **The Task 22 and 24 teams should know about choices 1 and 3.** `mark_ids[0]` of a divergence issue is the mark to move. An unknown timekeeper id is labelled "Cronometrista".

Report path: `/home/claude/endurance-base-club/.superpowers/sdd/2026-09-24-endurance-base-club/task-10-report.md`

---

## Fix round 1 (controller rulings 8, 10, 11)

Commit: `bc8513e` "fix(domain): leg suggestion across all legs, divergence mark fallback, pt-BR wording", on top of `fb6c7d7` on `task/10`. It touches 4 files: 40 insertions and 13 deletions. **Status: DONE.**

### What changed

1. **Ruling 8: pt-BR wording** (`src/domain/suggestLeg.ts`, `planBibAssignment`).
   - The already-finished warning now reads `Nº ${bib} já concluiu — registrada como fim da perna ${k+1}/${N} (${label})`, for example `Nº 101 já concluiu — registrada como fim da perna 2/2 (Corrida)`.
   - This resolves concern 3 above. Task 22's `assignmentMessage` still uses the old "fim da <label>" form in its brief, so Task 22 should be updated to match.
2. **Ruling 10: `same_crossing` over all legs** (`suggestLeg`).
   - **Step 1 (same crossing):** looks at every leg of the entry that already has a crossing median and picks the one closest to `tsMs` within `same_crossing_window_s`. `athleteId` is ignored here. Ties still go to the lower leg index, because the medians are walked in leg order.
   - **Step 2 (next leg):** only this step is limited to the selected athlete's legs (`memberLegs` when non-empty, otherwise all legs). `last` is still taken over all legs, and the already-finished fallback is unchanged.
   - I rewrote the doc comment to describe both steps and why `athleteId` is ignored in step 1: at a relay handoff, the on-course list already shows the next athlete as current.
3. **Ruling 11: a divergence issue always names at least one mark** (`src/domain/consolidation.ts`, `divergenceRefs`).
   - When no candidate is farther than the threshold from the median (and there aren't exactly 2 candidates), the list falls back to the single candidate farthest from the median. A new helper, `farthestFrom`, does this; on a tie it keeps the first candidate in `c.candidates` order, which is sorted by time then id.
   - The suggested-move logic then runs on that list as before.
   - `divergenceRefs` is only called for divergent crossings, which always have at least 2 candidates, so the fallback never gets an empty list.

### Tests covering the fixes

- **Ruling 8:** the expectation at `src/domain/suggestLeg.test.ts:108` (it was line 101 before the Ruling 10 test was inserted above it) in *"warns when the entry already finished, and the bib warning wins over it"* now expects `'Nº 101 já concluiu — registrada como fim da perna 2/2 (Corrida)'`. This is the only pre-existing test I changed.
- **Ruling 10:** new test `suggestLeg edge cases > confirming a relay handoff finds the finished leg even with the next athlete selected`.
  - Setup: a relay where a1 does leg 0 and a2 does leg 1, and a leg-0 mark already exists at T0+10 min.
  - A new mark at T0+10 min 5 s with `athleteId: 'a2'` gives `{ leg_index: 0, reason: 'same_crossing', athlete_id: 'a1' }`.
  - No existing test depended on the old restricted behavior. The trio, "last over all legs" and "falls back to all legs" tests have no mark within the window, and the "closest leg" test passes no `athleteId`. All of them pass unchanged.
- **Ruling 11:** new test `computeEventTiming issue details > a divergence with no mark beyond the threshold still names the mark farthest from the median`.
  - Setup: marks at 0 s, 2 s and 4 s after L0, from tk1, tk2 and tk3. They are passed in reverse order so the tie-break is really exercised.
  - The spread is 4 s, which is over the 3 s threshold, but no mark is more than 2 s from the 2 s median.
  - Expected: `mark_ids` equals exactly `[<0 s mark id>]`, and `suggested_leg_index` is undefined.
  - Mutation check: changing the tie-break from `>` to `>=` (ties go to the later candidate) makes this test fail. The source was restored and verified afterwards.

### RED (tests first, before any code change)

```
$ npx vitest run src/domain/suggestLeg.test.ts src/domain/consolidation.test.ts
 FAIL  consolidation.test.ts > computeEventTiming issue details > a divergence with no mark beyond the threshold still names the mark farthest from the median
AssertionError: expected [] to deeply equal [ 'm66' ]
 FAIL  suggestLeg.test.ts > suggestLeg edge cases > confirming a relay handoff finds the finished leg even with the next athlete selected
-   "athlete_id": "a1",  "leg_index": 0,  "reason": "same_crossing",
+   "athlete_id": "a2",  "leg_index": 1,  "reason": "next",          ← old code: wrong leg
 FAIL  suggestLeg.test.ts > planBibAssignment > warns when the entry already finished, and the bib warning wins over it
-   "warning": "Nº 101 já concluiu — registrada como fim da perna 2/2 (Corrida)",
+   "warning": "Nº 101 já concluiu — registrada como fim da Corrida (2/2)",
 Test Files  2 failed (2)
      Tests  3 failed | 53 passed (56)
```

### GREEN

```
$ npx vitest run src/domain/suggestLeg.test.ts src/domain/consolidation.test.ts
 Test Files  2 passed (2)
      Tests  56 passed (56)

$ npx vitest run
 Test Files  8 passed (8)
      Tests  93 passed (93)          # 91 before + 2 new; no warnings/errors in output

$ npm run typecheck
> tsc --noEmit -p tsconfig.json      # exit code 0
```

### Remaining concerns

- Concerns 1 and 2 from the first round are unchanged: "finished" without a start per the brief, and the order check only against the immediately previous leg.
- Concern 3 is resolved by Ruling 8, apart from the Task 22 `assignmentMessage` wording noted above.
