# Task 26 report — Public pages (events, live/official results, athlete profile)

Branch: `task/26` (worktree `/home/user/ebc-wt/t26`), base `221d2db` (feat/ebc-app + Task 20 merged).

## Implemented (by file)

- `src/features/public/PublicHome.tsx`
  - `PublicShell` (exported): the public shell reused by all three pages — logo + "ENDURANCE BASE
    CLUB" (linking to `/`), `ThemeToggle`, and a link "Área da organização" → `#/entrar`. No admin
    navigation, no `useSession`/`useEventContext` import.
  - `EVENT_STATUS_LABEL` (exported): pt-BR label + `BadgeTone` per `EventStatus`, reused by
    `PublicEventPage` for the event header's status badge.
  - `PublicHome` (default export, `public-events` testid): `useQuery(['pub-events'], api.pub.events)`,
    sorted newest-first; a `Card` grid with each event's name (link to `#/p/<slug>`), date, location,
    and its status badge ("Ao vivo" in `success` tone, i.e. visually highlighted). Loading spinner,
    error banner, and a friendly empty state ("Nenhum evento público no momento").

- `src/features/public/PublicEventPage.tsx`
  - `usePublicLivePoll(slug, enabled)`: polls `api.pub.live(slug, since)` every 10 s
    (`PUBLIC_POLL_MS`) while `!document.hidden`, `since = current payload's server_now − 10 s`
    (`FETCH_OVERLAP_MS`, same constant per Global Constraints — poll interval and overlap are both
    10 s here, so a persisted delta cursor like the admin's isn't needed: each poll simply re-reads
    the last 10 s window from the payload's own, just-updated `server_now`). Single-flight via an
    `inFlight` ref; marks merged with `mergeById` (Ruling 43 — discarded marks flow through
    untouched, `computeEventTiming`/`classifyRace` already ignore them); resolutions/waves replaced
    wholesale (matches `admin_live`'s "always returns every resolution/wave" contract); the whole
    payload is refetched when `delta.version` changes. Pauses while hidden, resumes on
    `visibilitychange`, cleans up on unmount — modeled directly on `useEventData.ts`.
  - **Official vs. live classification** (the one design decision the brief didn't spell out in
    full): Ruling 41 says to use `ClassificationTable`/`PodiumView` with `athletesById` built from
    `pub_event`'s `athletes[]` and `linkAthletes='public'`, without carving out "only for the live
    case" — so both the live *and* the finalized view go through the same two Task-25 components,
    rather than a second, parallel results table for the official case:
    - Live (no `results` for that race yet): `computeEventTiming(payload, Date.now())` +
      `classifyRace(race, entries, timing.byEntry, athletesById, event)`, exactly like the admin's
      `ResultsTab`. `nowMs` only feeds `issues` (unused here), not `byEntry`, so `Date.now()` is fine
      without a synced clock.
    - Official (`results` exist for that race): `classificationFromResults(race, results,
      athletesById)` rebuilds the `RaceClassification` shape straight from the frozen
      `ResultRow.data` snapshots — a minimal `EntryRow` (bib, team_name, penalty_ms, members, all
      from the snapshot) and `EntryTiming` (legs/total/final/status from the snapshot; each leg's
      `Crossing` is a typed stub since `ClassificationTable` only reads `leg_ms` off it), rows sorted
      by the snapshot's own `overall_pos` (nulls last, unranked tie-broken by status then bib — same
      order as `domain/ranking.ts`, duplicated locally since it isn't exported), and podium groups
      rebuilt from every row's `data.podiums`, resolving each `RankingDef` from the race's current
      `config.rankings` by id (falls back to a name-only stub if that ranking no longer exists).
      Nothing is recomputed from live marks for a finalized race — it renders only what was frozen at
      `admin_finalize_race` time, per the brief ("show them ordered by `overall_pos`, from the
      snapshots").
  - Badge: "Resultado oficial" (info tone) when finalized, else "Parcial – ao vivo" (warning tone,
    en dash exactly as in the brief) with a small "Atualiza automaticamente a cada 10 segundos."
    note.
  - Race tabs: a `role="tablist"` button row (not the admin's route-based `Tabs`, since races here
    are not routes) driven by local `selectedRaceId` state.
  - `public-results` testid on the loading/error/success containers alike (stable target regardless
    of state). Friendly not-found banner (`query.error instanceof Error ? .message : 'Evento não
    encontrado'`) with a link back to `/`. `document.title = '<Evento> – Resultados'`.

- `src/features/public/PublicAthletePage.tsx`
  - `useQuery(['pub-athlete', athleteId], () => api.pub.athlete(athleteId))`; renders name + sex +
    city + team/club (via `sexLabel`) and `<StatsView athlete results publicMode />` — never reads
    `birth_date` or `public_profile` (per the Controller note: `pub_athlete`'s athlete object only
    carries `{id,name,sex,city,team_club}`). Friendly not-found/private message with a link back to
    `/`. `document.title = '<Atleta> – EnduranceBaseClub'`. `public-athlete` testid on every branch.

- `src/features/public/public.test.tsx` (new): 8 tests — `PublicHome` (list+links+"Ao vivo"
  highlight; empty state), `PublicEventPage` (live classification + link-only-if-`public_profile`;
  official badge + `overall_pos`-ordered rows + podium from snapshots; not-found; the 10 s poll
  merging an updated mark and re-ranking the table), `PublicAthletePage` (renders "Participações";
  not-found/private).

No other files were touched (`src/App.tsx`, `types.ts`, `api.ts`, `ClassificationTable.tsx`,
`PodiumView.tsx`, `StatsView.tsx` were only read).

## Decisions not spelled out in the brief

1. **Reusing `ClassificationTable`/`PodiumView` for the official/finalized view too** (via the
   snapshot adapter described above) rather than a second display for finalized races — see above;
   driven by Ruling 41's unqualified instruction to use those two components with
   `athletesById`/`linkAthletes='public'`, and by the brief listing `classifyRace`/`computeEventTiming`
   as consumed (only needed for the *live* path, confirming the official path is meant to bypass
   them and go straight from `results`).
2. **`instanceof Error` (not `instanceof ApiError`) for the not-found banners** on
   `PublicEventPage`/`PublicAthletePage`: in production every thrown error from `api.ts` is already
   an `ApiError` (which extends `Error`), so this is behaviorally identical there, but it also
   surfaces a plain `Error`'s message in tests without an extra `ApiError`-shaped mock.
3. **Poll cadence uses the payload's own `server_now` each time**, not a separate persisted
   `DeltaCursor` like `useEventData.ts`: since the public poll interval and the fetch overlap are
   both 10 s here (vs. the admin's 2 s poll / 10 s overlap needing a cursor to bridge them), reading
   `since = current cached payload.server_now − 10s` on every tick is already gap-free.
4. **Race picker is a local button/tablist**, not the shared `Tabs` component (races aren't routes)
   and not the admin's `Select`+`race-select` testid (not in the Public Test IDs list; brief calls
   for "tabs" specifically for this task).

## TDD evidence

RED — ran the new test file against the still-stub page components (temporarily `git stash`-ed the
three implementation files, keeping only the new test file):
```
$ npx vitest run src/features/public/public.test.tsx
 Test Files  1 failed (1)
      Tests  8 failed (8)
```
(all 8 failed — stub `<h1>PublicHome</h1>`-style components, no `api.pub.*` wiring; see raw output
in the session — timeouts/`Unable to find` errors on every assertion).

GREEN — restored the implementation (`git stash pop`) and re-ran:
```
$ npx vitest run src/features/public/public.test.tsx
 RUN  v5.0.1
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

Two rounds of fixes between RED and final GREEN (both in the *test* file, not the implementation):
- Scoped the "Beto Lima is not linked" assertion to `within(table)` — he legitimately also appears
  (unlinked, as always in `PodiumView`) as the sole male finisher's podium placement, which is
  correct app behavior, not a bug.
- Fixed the live-poll test's fixture: `pub_live`'s mocked delta must return *all* the event's waves
  (per contracts: "Live endpoints … return … all waves of the event every time"), not `[]` — an
  empty list is a real "wave deleted" signal the page correctly applies, which made every entry
  read as "sem largada" until the fixture reflected that contract.
- Aligned the not-found fallback text to the codebase's `instanceof Error` convention (was
  `instanceof ApiError`, which doesn't match a plain-`Error` rejection in tests, and left a stray
  trailing period vs. the brief's wording).

## Gates

Focused tests:
```
$ npx vitest run src/features/public/public.test.tsx
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

Full suite:
```
$ npx vitest run
 Test Files  35 passed (35)
      Tests  451 passed (451)
```

Typecheck:
```
$ npm run typecheck
> tsc --noEmit -p tsconfig.json
(no output — clean)
```

Build:
```
$ npm run build
✓ 289 modules transformed.
dist/index.html                   0.81 kB │ gzip:   0.44 kB
dist/assets/index-*.css          25.32 kB │ gzip:   5.90 kB
dist/assets/index-*.js          789.50 kB │ gzip: 230.45 kB
✓ built in 717ms
```
(the >500 kB chunk-size warning is pre-existing and unrelated to this task — no code splitting was
touched).

## Self-review

- No import of admin-only modules (`useSession`, `useEventContext`, `RequireOrganizer`, `Layout`)
  anywhere in the three public pages — confirmed by inspection and by the fact `RequireOrganizer`
  never gates `/`, `/p/:slug`, `/atleta/:athleteId` in `App.tsx` (unchanged, only read).
  `PublicShell` renders its own minimal header instead.
  Manually checked every import in the three changed files resolves to a used identifier.
- No `supabase.from` anywhere; only `api.pub.*`.
- No new dependency added; no shared file (`App.tsx`, `types.ts`, `api.ts`, `package.json`) touched.
- Every displayed time goes through `formatDateBR`/`formatDuration`/`formatGap` (via
  `ClassificationTable`/`PodiumView`) — no raw `toLocaleTimeString()`.
- Public payload's discarded marks (Ruling 43) flow untouched through `mergeById` into
  `computeEventTiming`, which already excludes discarded marks from `Crossing.candidates` — verified
  by reading `consolidation.ts` (not modified) rather than re-deriving that behavior here.
- Mobile: reused kit components (`Card`, `Badge`, `Table` via `ClassificationTable`, `EmptyState`,
  `Spinner`) and the same 44 px-tall touch targets as the rest of the app (tab buttons `min-h-11`,
  shell links `min-h-11`); `Table` already scrolls horizontally on narrow screens.

## Concerns

- The finalized-race adapter (`classificationFromResults`) duplicates two small private constants
  from `domain/ranking.ts` (`UNRANKED_STATUS_ORDER` ordering, numeric-aware bib compare) because
  that module doesn't export them; if `ranking.ts`'s unranked ordering ever changes, this local copy
  would need updating in lockstep. Flagging for the wide-branch review rather than exporting from a
  file this task doesn't own.
- `reconstructPodiums`' fallback `RankingDef` stub (`{ dims: [], size: 3 }`) only fires if a
  finalized race's `config.rankings` no longer contains a ranking id a stored snapshot references
  (e.g., an organizer deleted that ranking after finalizing) — untested edge case, low risk since
  reconfiguring a finalized race's rankings isn't a flow the organizer UI otherwise exposes.

## Status

DONE.

## Fix round 1

Branch: `task/26` (worktree `C:\ENDURANCE\ebc-wt\t26`), base `cd06143` (T26 + feat/ebc-app merged).
Commit: `ef3a9a3`.

### Finding addressed

Review **Important 1**: `reconstructPodiums` (`src/features/public/PublicEventPage.tsx`, was around
line 76-101) sorted a finalized race's podium groups *within one ranking* alphabetically by
`group_label` (`a.group_label.localeCompare(b.group_label, 'pt-BR')`), instead of the canonical
spec §9 order (sex M, F, MISTO; age groups by `min`; levels in event order) that
`domain/ranking.ts`'s `buildPodiums`/`compareGroupOrder` already use for the live view. Effects:
Feminino rendered before Masculino on the official page while the live view/admin showed Masculino
first; age labels misordered ("até 19" sorted after "60+", since digits collate before letters).
Untested before because the fixture only ever had one populated group per ranking.

### Changes

- `src/domain/ranking.ts:99` — exported the existing `compareGroupOrder(dims, a, b, ageGroups,
  levels)` (previously module-private). No behavior change: same implementation, same call sites
  inside the file (`buildPodiums`), just made public so another module can reuse it. Added a
  doc-comment note pointing at the new caller.
- `src/features/public/PublicEventPage.tsx`:
  - `reconstructPodiums` (line ~79) now takes an extra `levels: string[]` parameter, tracks each
    group's representative `EntryCategory` (`groupCategory: Map<string, EntryCategory>`, captured
    from `r.data.category` the first time a group is seen — every member of a `ranking_id::group_label`
    key shares the same relevant category dimensions), and replaces the alphabetical tie-break with
    `compareGroupOrder(a.ranking.dims, groupCategory.get(a.group_key)!, groupCategory.get(b.group_key)!, race.config.age_groups, levels)`
    (line ~106). The primary sort key — ranking order from `race.config.rankings` — was already
    correct and is unchanged.
  - `classificationFromResults` (line ~106) now takes and forwards a `levels: string[]` parameter
    to `reconstructPodiums`.
  - The call site in `PublicEventPage`'s `cls` `useMemo` (line ~237) now passes
    `payload.event.levels` (the same source `classifyRace`'s live path already uses via `event.levels`).
  - New imports: `compareGroupOrder` from `../../domain/ranking`, `EntryCategory` from
    `../../domain/categories` (both already-exported types/functions from files this task does not
    own the *contents* of, but only imports from — no other change to either file besides the
    controller-granted export).

### Covering tests

- `src/features/public/public.test.tsx` — new test in the `PublicEventPage` describe block:
  `"orders a finalized race's podium groups per spec §9 (sex M, F; age by min) and matches the live
  view's order for the same data"`. Fixture: 6 single-leg entries, 3 women / 3 men, crossed with
  three age brackets from the default age-group ladder (`"até 19"`, `"20-29"`, `"60+"`), each
  finishing at a distinct time, race config patched to `cumulative: true` (so every athlete
  naturally podiums in both the `geral` and `faixa` rankings — the test targets group *order*, not
  the separate cumulative/non-cumulative exclusion rule, which is already covered in
  `ranking.test.ts`). Renders the same underlying data twice — once as a finalized race (`results`
  populated, reconstructed via `classificationFromResults`) and once as a live race (`results: []`,
  computed via `computeEventTiming` + `classifyRace`) — and asserts the DOM order of `<p>` group
  labels inside `[data-testid="podiums"]` equals the canonical spec §9 sequence in *both* renders:
  `['Masculino', 'Feminino', 'Masculino · até 19', 'Masculino · 20-29', 'Masculino · 60+', 'Feminino · até 19', 'Feminino · 20-29', 'Feminino · 60+']`.
- `src/domain/ranking.test.ts` — new `describe('compareGroupOrder …')` block (3 tests) directly
  exercising the newly-exported function: sex order M/F/MISTO, age-group order by `min` (`"até 19"`
  first, `"60+"` last), and level order by position in `event.levels` (`"Sem nível"`/`null` last).
  Locks down the exported contract independent of the reconstruction call site.

### TDD evidence

RED — added the new `public.test.tsx` test (and the fixture helpers it needs) against the
still-buggy `PublicEventPage.tsx`:
```
$ npx vitest run src/features/public/public.test.tsx
 ❯ src/features/public/public.test.tsx (9 tests | 1 failed) 333ms
   ❯ PublicEventPage (5)
     × orders a finalized race's podium groups per spec §9 (sex M, F; age by min) and matches the live view's order for the same data 31ms

AssertionError: expected [ 'Feminino', 'Masculino', …(6) ] to deeply equal [ 'Masculino', 'Feminino', …(6) ]

- Expected
+ Received

  [
-   "Masculino",
    "Feminino",
-   "Masculino · até 19",
-   "Masculino · 20-29",
-   "Masculino · 60+",
-   "Feminino · até 19",
+   "Masculino",
    "Feminino · 20-29",
    "Feminino · 60+",
+   "Feminino · até 19",
+   "Masculino · 20-29",
+   "Masculino · 60+",
+   "Masculino · até 19",
  ]

 Test Files  1 failed (1)
      Tests  1 failed | 8 passed (9)
```
(Reproduces the review's exact finding: Feminino before Masculino, "até 19" sorting after "60+".)

One intermediate iteration: the first fixture draft left the race at the default `cumulative: false`,
which (correctly, per spec) excluded every athlete from the `faixa` ranking once `geral` had already
awarded all 6 of them (3 per sex, `size: 3`) — the *live* render then showed only 2 podium groups
(`geral`'s Masculino/Feminino) with `faixa` empty, failing the second half of the assertion for an
unrelated reason (the exclusion rule, not the ordering bug). Patched the race's `config.cumulative`
to `true` in the fixture so every athlete podiums in both rankings, keeping the test scoped to group
*order* only.

GREEN — after the `ranking.ts` export and the `PublicEventPage.tsx` fix:
```
$ npx vitest run src/features/public/public.test.tsx src/domain/ranking.test.ts
 Test Files  2 passed (2)
      Tests  18 passed (18)
```

### Gates

Full suite:
```
$ npx vitest run
 Test Files  35 passed (35)
      Tests  455 passed (455)
```
(451 → 455: the 4 new tests — 1 in `public.test.tsx`, 3 in `ranking.test.ts`.)

Typecheck:
```
$ npm run typecheck
> tsc --noEmit -p tsconfig.json
(no output — clean)
```

Build:
```
$ npm run build
✓ 289 modules transformed.
dist/index.html                   0.81 kB │ gzip:   0.44 kB
dist/assets/index-*.css          27.88 kB │ gzip:   6.29 kB
dist/assets/index-*.js          789.60 kB │ gzip: 230.50 kB
✓ built in 641ms
```
(same pre-existing >500 kB chunk-size warning, unrelated to this fix — no code splitting touched.)

### Files changed

- `src/domain/ranking.ts` (export only, no behavior change)
- `src/domain/ranking.test.ts` (+3 tests for the export)
- `src/features/public/PublicEventPage.tsx` (the fix)
- `src/features/public/public.test.tsx` (+1 test + fixtures)

### Concerns

- None new. The two Minor items from the review (PublicHome's `instanceof ApiError`, the
  `usePublicLivePoll` `refetched` guard, and the duplicated `UNRANKED_STATUS_ORDER`/bib-collator
  constants) were left untouched per the round's scope (deferred to the final review).
- `reconstructPodiums`'s fallback `RankingDef` stub path (a finalized race whose `config.rankings`
  no longer contains a ranking id a stored snapshot references) still has no direct test — same
  known/accepted gap noted in the original report, unrelated to this fix.

### Status

DONE.
