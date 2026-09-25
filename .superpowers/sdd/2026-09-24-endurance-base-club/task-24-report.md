# Task 24 report — Review tab (pending issues and official-time decisions)

## Files

- Modified: `src/features/review/ReviewTab.tsx` (was a stub) — pending-issues list grouped by
  severity with race/type filters, the "Todas as passagens" crossing search list, and the
  inline unassigned-mark bib assignment.
- Created: `src/features/review/CrossingEditor.tsx` — the modal that resolves one entry/leg
  crossing: candidate marks table (discard/restore, move to another leg or entry), the
  system/mark/manual decision radios, and a live leg-time/total preview.
- Created: `src/features/review/review.test.tsx` — 12 tests.

No other files were touched (file-ownership rule honored).

## Behavior implemented

**ReviewTab.tsx**
- `issues-list`: `timing.issues` grouped into Erros/Avisos/Info (in that order), each group
  always shown with its count so the organizer sees zero pendencies too; Info starts collapsed
  (`expanded.info = false`), the others expanded. Clicking a group header toggles it.
- Filters: "Prova" (`agg.races`) and "Tipo" (`ISSUE_LABEL` keys) selects narrow `timing.issues`
  before grouping.
- Per issue: severity badge + message; "Resolver" button when the issue carries both
  `entry_id` and `leg_index` (divergence, missing_crossing, order, duplicate,
  chosen_mark_discarded — the issue types that are scoped to one crossing); for a `divergence`
  issue with `suggested_leg_index`, a `move-mark-suggested` button reading "Mover marcação para
  a perna N (<label>)" that calls `updateMark(mark_ids[0], { leg_index: suggested })` then
  `refresh()` (Review Focus 1 / Ruling 11: `mark_ids[0]` is always the mark to move); for
  `unassigned` issues, an inline bib form (`UnassignedAssign`) that calls `planBibAssignment`
  (Ruling 2 — no local copy) and then `updateMark(mark.id, { entry_id, leg_index })`.
- "Todas as passagens": search box (`Buscar`, filters by bib or `entryDisplayName`) plus one
  `crossing-row` per entry × leg, showing official time (`formatClock(…, {tenths:true})`),
  `crossingSourceLabel`, candidate count, spread and a status badge (Sem passagem / Divergência /
  Escolha descartada / Resolvido / OK). Clicking a row opens `CrossingEditor` for that
  entry/leg — this is how an *already resolved* crossing is reopened, since a resolved
  divergence is no longer a pending issue (matches `consolidation.test.ts`'s "divergence issue
  only while unresolved").

**CrossingEditor.tsx**
- Header: `Nº <bib> · Perna k (<label>)`, subtitle with the entry's display name and (for a
  relay) the athlete assigned to that leg.
- Candidates table (built from `agg.marks` filtered to this entry+leg, not just
  `crossing.candidates`, so discarded/duplicate marks are visible too): cronometrista (or
  "Organização"/"Cronometrista" fallback), hora (`formatClock(ts, {millis:true})`), Δ to the
  median in seconds with sign, duplicate/discarded badges. Per-mark actions: Descartar/Restaurar
  → `updateMark(id, { discarded })`; a small inline form (leg `<Select>` defaulting to the
  current leg, optional bib `<Input>`) + "Mover" button → `updateMark(id, { leg_index })` when no
  bib is typed, or `planBibAssignment` + `updateMark(id, { entry_id, leg_index })` when a bib is
  typed (moving to a different inscription).
- Decision radios: `resolution-system` ("Tempo do sistema (mediana)" or "… (cronometrista de
  referência)" per `crossing.system_source`, with the time), `resolution-mark-<markId>` per
  candidate, `resolution-manual` + `resolution-manual-input` (`parseClockInput(text,
  event.date)`), plus a note field. `resolution-save` calls
  `setResolution(entryId, legIndex, mode, mode==='mark'?markId:null, manualTs, note)` then
  `refresh()` and closes; an invalid manual time shows a field error and does not call the API.
  "Remover decisão" (shown only when a resolution exists) calls `clearResolution` then `refresh()`
  and closes.
- Preview: recomputed with the domain, never ad-hoc arithmetic — builds a hypothetical
  `ResolutionRow` from the current radio selection, splices it into the entry's other
  resolutions, and calls `computeEntryTiming(entry, race, wave, entryMarks, resolutions)`; the
  card shows that leg's `leg_ms` and the entry's `total_ms` via `formatDuration`, so the
  organizer sees the effect of the choice — including on a later leg's start — before saving.
- Errors from any `api.admin.*` call are shown via `useToast` (`ApiError.message`), never
  swallowed.

## Decisions not spelled out in the brief

- **Empty severity groups stay visible** (e.g. "Avisos (0)") rather than being hidden — gives a
  stable at-a-glance overview and made the type-filter behavior easy to verify in tests. Nothing
  in the brief required hiding them.
- **"Resolver" only appears for issues with both `entry_id` and `leg_index`** (divergence,
  missing_crossing, order, duplicate, chosen_mark_discarded). `no_start` and `not_finished` are
  scoped to the whole entry (no single leg to open), and `unassigned` marks get the dedicated
  inline bib form instead — these three intentionally get no "Resolver" button.
- **Moving a mark to a different leg vs. a different entry** is one form per mark row: an empty
  bib field moves within the same entry (leg select only); a typed bib re-resolves the mark via
  `planBibAssignment`, which also picks the suggested leg for the target entry — this matches
  "mover para outra perna/inscrição" as one action instead of two separate controls.
- Saving a resolution or clearing one **closes the editor** after a successful `refresh()`;
  discard/restore/move on a mark keep it open (those are incremental edits the organizer likely
  repeats).

## TDD evidence

RED — before writing the components (`ReviewTab.tsx` was still the one-line stub and
`CrossingEditor.tsx` did not exist):

```
$ npx vitest run src/features/review/review.test.tsx
FAIL  src/features/review/review.test.tsx > ReviewTab: issues list > shows the divergence message
Error: Unable to find an element by: [data-testid="issues-list"]
...
Test Files  1 failed (1)
     Tests  12 failed (12)
```
(ReviewTab.tsx rendered only `<h1>ReviewTab</h1>`; every test failed the same way — missing
testids/controls.)

GREEN — after implementing both components:

```
$ npx vitest run src/features/review/review.test.tsx
 RUN  v5.0.1 /home/user/ebc-wt/t24
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

## Gate outputs

**Focused test file** — 12/12 passing, no console noise (checked with a grep for
warn/error/act(/unhandled — no matches):
```
Test Files  1 passed (1)
     Tests  12 passed (12)
```

**Full suite** — `npx vitest run`:
```
 Test Files  1 failed | 25 passed (26)
      Tests  1 failed | 299 passed (300)
```
The one failure is a pre-existing, out-of-scope test — see "Concerns" below. Every other test
file, including my own, is green.

**Typecheck** — `npm run typecheck`: clean, no output.

**Build** — `npm run build`:
```
✓ 233 modules transformed.
dist/index.html                   0.81 kB │ gzip:   0.44 kB
dist/assets/index-DECWE9rG.css   21.76 kB │ gzip:   5.26 kB
dist/assets/index-lXL85mkY.js   623.05 kB │ gzip: 181.45 kB
✓ built in 1.26s
```

## Self-review findings

- Verified per Ruling 11 that the fixture with no candidate beyond the divergence threshold
  still names a mark (`consolidation.ts`'s `farthestFrom` fallback) — the Review tab code only
  ever reads `mark_ids[0]`, which is always present for a divergence issue, so no extra
  null-check branch was needed there beyond the existing `issue.mark_ids?.[0]` guard.
- Confirmed `planBibAssignment` (not a local reimplementation) is used both for the unassigned-
  issue inline form and for the "move to another inscription" mini-form in `CrossingEditor`.
- Confirmed the preview never does manual ms subtraction: it always goes through
  `computeEntryTiming`, so a preview on a non-last leg correctly cascades into a new `total_ms`
  too (the domain function recomputes every subsequent leg's start from the hypothetical
  official time).
- `data-testid` on custom components (`Button`, `Input`, `Select`) checked against TypeScript's
  documented exemption for `data-*` attributes in JSX — confirmed via existing code
  (`ChangePasswordPage.tsx` already does this) and via a clean `typecheck` run.

## Concerns

- **One pre-existing test outside my file-ownership scope now fails**:
  `src/features/events/eventShell.test.tsx` → `EventLayout > renders the revisao tab` asserts
  `screen.findByText('ReviewTab')`, i.e. it still expects the Task 17 placeholder stub text.
  Since my brief requires replacing that stub with real content, and `eventShell.test.tsx` is
  not in my Files block (owned by Task 17), I did not touch it. This is the same collateral
  every wave-2 screen task will cause for its own tab's case in that `it.each`; the wave-2
  context flags this exact situation ("its review is still running, so small fixes to the shell
  may arrive later"). Recommend the controller update that assertion (e.g. to check a
  tab-specific heading/testid) once the wave-2 screens land, or accept it as expected transient
  breakage during integration. All 299 other tests pass, including all 12 of mine.
- The candidates-table row in `CrossingEditor` packs a labeled `Select` and `Input` (from the
  UI kit) plus two buttons into one cell; functional and keyboard-accessible, but visually dense
  on a narrow phone — the table sits inside the kit's own `overflow-x-auto` wrapper (`Table`) so
  it scrolls horizontally rather than overflowing the page, but a follow-up visual pass could
  tighten this if the controller wants it prettier.

## Commit

```
feat(review): pending issues and official time decisions
```

## Fix round 1

**Finding addressed (Important):** reopening a crossing whose resolution is `mode:'mark'`
pointing at a mark that has since been discarded showed no decision radio checked and, if
saved untouched, silently resent the same broken resolution.

**Root cause:** `computeCrossing` excludes a discarded mark from `crossing.candidates` (that's
what raises the `chosen_mark_discarded` issue and falls the official time back to the system
time), but `CrossingEditor` seeded its `mode`/`markId` state straight from `resolution` without
checking whether that mark was still among the candidates the radios are rendered from.

**Fix (`CrossingEditor.tsx`):**
- Added `markMissing`: true when `resolution.mode === 'mark'` and its `mark_id` is not among
  `crossing.candidates` (covers both "discarded" and, as a side benefit, "lost to a duplicate").
- `mode`/`markId` now initialize to `'system'`/`null` when `markMissing` is true, instead of
  blindly copying the stale resolution — matching what `official_ms`/`official_source` already
  fell back to.
- Added a visible warning, "A marcação escolhida foi descartada — escolha outra decisão.",
  rendered inside the Decisão fieldset whenever `markMissing` is true.
- No change was needed for "the discarded mark still appears in the candidates table with its
  badge and a Restaurar action" — `legMarks` was already built from all of the entry/leg's
  marks (not just `crossing.candidates`), so a discarded mark already showed its "Descartada"
  badge and a "Restaurar" button; this was verified by the new test, not newly added.
- `save()` needed no change: with `mode` now correctly seeded to `'system'`, saving without
  touching anything calls `setResolution(entryId, legIndex, 'system', null, null, note)`, which
  is what the finding asked for.
- Gave `resolution-manual-input` its own `aria-label="Hora manual"` (previously it had no
  accessible name of its own, only the radio next to it did).

**Test added** (`review.test.tsx`, `ReviewTab: resolving a divergence` describe block):
- `recovers when the chosen mark has since been discarded: warns, pre-selects system, saves
  system` — builds a resolution pointing at a mark that is `discarded: true`, opens the editor
  via "Resolver", asserts the warning text and `resolution-system` checked, asserts the
  discarded mark still shows its "Descartada" badge and a "Restaurar" button and that no
  `resolution-mark-<id>` radio exists for it, then clicks `resolution-save` and asserts
  `setResolution('en1', 0, 'system', null, null, '')`.
- `gives the manual time input its own accessible name` — asserts `getByLabelText('Hora
  manual')` resolves to the same element as `resolution-manual-input`.

**Gates:**
```
$ npx vitest run src/features/review
 Test Files  1 passed (1)
      Tests  14 passed (14)
```
```
$ npx vitest run
 Test Files  1 failed | 25 passed (26)
      Tests  1 failed | 301 passed (302)
```
(The one failure is the same pre-existing, out-of-scope `eventShell.test.tsx` stub-text case
noted above — unrelated to this fix, per the coordinator's instruction to ignore it.)
```
$ npm run typecheck
> tsc --noEmit -p tsconfig.json
(clean, no output)
```
```
$ npm run build
✓ 233 modules transformed.
✓ built in 1.00s
```
No console noise in the focused run (grepped for warn/error/act(/unhandled — no matches).

**Files touched:** `src/features/review/CrossingEditor.tsx`, `src/features/review/review.test.tsx`
only — no widening beyond the flagged component.

**Commit:** `fix(review): explain and reset a resolution whose mark was discarded`
