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
