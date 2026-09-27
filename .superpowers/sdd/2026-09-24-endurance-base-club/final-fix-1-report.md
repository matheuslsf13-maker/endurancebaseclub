# Final fix wave — Fixer 1 report (server, domain, libraries, auth)

Worktree `C:\ENDURANCE\ebc-wt\ff1`, branch `fix/final-1`, base `6244b7e`. Not pushed.
All 25 items of "## Fixer 1" in final-fix-wave.md are fixed; none skipped. Every item was driven by a
failing test first (RED kept below), then the fix (GREEN). SQL fixes edit migrations 0003–0006 in place
(no 0007) with assertions in `supabase/tests/*.sql` (no psql meta-commands).

## Shared snapshot helpers for Fixer 2 (item 5) — `src/domain/snapshot.ts`

```ts
/** Official classification of a FINALIZED race rebuilt from its stored results only (rows of other
 *  races are ignored). Rows: ranked by frozen overall_pos (bib tie-break), then unranked in the live
 *  status order; gap_ms to the leader; podiums from data.podiums in live order. */
export function classificationFromResults(race: RaceRow, results: ResultRow[], levels: string[]): RaceClassification;

export type DriftField = 'status' | 'final_ms' | 'overall_pos' | 'podiums';
export interface EntryDrift {
  entry_id: string;
  bib: string;
  change: 'added' | 'removed' | 'changed';   // added = entry registered after finalizing; removed = only in the snapshot
  fields: DriftField[];                        // for 'changed', in this order; [] otherwise
}
/** Per entry, what the live classification of that race now disagrees with in the stored snapshot
 *  (exactly what finalizing again would change). [] = still official; .length = "Há N alterações". */
export function snapshotDrift(live: RaceClassification, results: ResultRow[]): EntryDrift[];
```

Usage for Fixer 2 (ResultsTab / Revisão):
- `const official = classificationFromResults(race, agg.results, agg.event.levels)` for a race with
  `race.finalized_at` → pass to `ClassificationTable`/`PodiumView` exactly like a live `RaceClassification`
  (rows carry snapshot `EntryRow`s whose members have `name`; `entryDisplayName` now falls back to that name).
- `const n = snapshotDrift(classifications.get(race.id)!, agg.results).length` → drift banner when `n > 0`.
- `exportWorkbook` needs no change: `buildEventWorkbook(agg, timing, classifications, now)` now derives the
  finalized races' Classificação/Pódios/Resumo from `agg.results` itself.
- Also exported now from `src/domain/ranking.ts`: `compareBib`, `UNRANKED_STATUS_ORDER`, `isRanked`
  (`final_ms > 0` required, item 18).
- `crossingSourceLabel(c, tkById, marks, config?)` (`src/domain/labels.ts`) takes an optional 4th
  argument; ReviewTab should pass `race.config` so the reference timekeeper is named from
  `reference_timekeeper_id` (without it, the old ts-equality fallback is used).

## Items

| # | Item | Status | Where (files:lines at HEAD) | Covering tests |
|---|------|--------|-----------------------------|----------------|
| 1 | A-I1 duplicate drops reference timekeeper; validate ref only when time_source = reference | fixed | 0003_admin_events.sql:120-128 (validate_race_config), :443-449 (admin_duplicate_event) | 20_admin_events.sql "A-I1" blocks |
| 2 | A-I2 offline "Sair" keeps ebc.auth | fixed | src/features/auth/session.tsx:66-90 (dropSession removes ebc.auth, -user, -code-verifier), :103-106 + :136 + :177 + :196 + :215 (signedOut guard) | auth.test.tsx "stays signed out after an offline Sair…", "an explicit sign-in after Sair…" |
| 3 | B1-I2 legs/team size after entries | fixed | SQL: 0003:591-602 (team_size / team-race leg-count refusals), :616-624 (individual members' legs rewritten 0..N-1); domain: eventModel.ts:60-69 (legAthleteId lone-member fallback), suggestLeg.ts:50-52 (member legs < race.legs.length) | 20 "B1-I2" blocks; eventModel.test, suggestLeg.test "stale member legs" |
| 4 | C-I3 server: refuse deleting a started wave / wave with entries | fixed | 0003:658-676 | 20 "C-I3" blocks (started wave, wave with 1 entry, empty wave still removable) |
| 5 | B1-I1/B2-I2 domain: shared reconstruction, snapshotDrift, workbook from snapshot | fixed | snapshot.ts:71-230; PublicEventPage.tsx (imports + call site only: `classificationFromResults(race, raceResults, payload.event.levels)`); workbook.ts:71-118 (official = snapshot for finalized races), :124-171 (Resumo, "Sim (…) — difere do ao vivo (N inscrições)") | snapshot.test.ts (classificationFromResults ×3, snapshotDrift ×5); workbook.test.ts finalized describe |
| 6 | A-M2 api.ts pt-BR error map | fixed | src/lib/api.ts:24-86 (SERVER_ERRORS, serverError, thrownToApiError) | api.test.ts 13 new/updated cases |
| 7 | A-M3 admin_get_event hides secret | fixed | 0003:231-233 | 40_timing "A-M3" block |
| 8 | A-M4 select … for update | fixed | 0005_timing.sql:129-131 and :143 (tk_sync both reads), :216-218 (admin_update_mark) | 40_timing "A-M4" block (pg_get_functiondef) |
| 9 | A-M5 long names / slug cap | fixed | 0003:16-39 (next_unique_public_slug cap, new internal `event_slug(name, date)`), :365 and :373 (callers) | 20 "A-M5" block |
| 10 | A-M6 EXECUTE matrix | fixed (test) | supabase/tests/60_security.sql:17-37 | itself; discrimination shown below |
| 11 | A-M7 `athlete_ids @> array[id]` | fixed | 0004:36-56, :312; 0006_public_grants.sql:137 | 30 "A-M7" block (no `= any(...)`, uses `@>`, planner uses results_athletes_idx) |
| 12 | A-M8 no wave re-parenting, no event change | fixed | 0003:511-514 (event), :641-652 (foreign wave id → "Onda inválida"; conflict update scoped to the race, no race_id) | 20 "A-M8" block |
| 13 | B2-m7 server: athlete_id follows the moved-to leg | fixed | 0005:253-277 | 40 "B2-m7" block; updated identical re-send test (now sends the leg's athlete like the phone) |
| 14 | C-Minor-2 server: empty/invalid date | fixed | 0003:289-297 | 20 "C-Minor-2" asserts ('', '31/02/2026', update with '') |
| 15 | B1-M1 year-only birth date | fixed | src/lib/importMapping.ts:49-73 | importMapping.test "rejects a year-only birth date…" |
| 16 | B1-M2 sheet names | fixed | writer.ts:31-52 (case-insensitive uniqueness, apostrophe trim); workbook.ts:285-302 ("Class. – <prova>") | writer.test ×2; workbook.test sheet order + "distinguishable after the 31-character cut" |
| 17 | B1-M3 stats skip DSQ / non-positive legs | fixed | src/domain/stats.ts:16-30 | stats.test "skips unusable performances" |
| 18 | B1-M4 total ≤ 0 not ranked | fixed | src/domain/ranking.ts:14-24 | ranking.test "B1-M4" |
| 19 | B1-M6 "foi descartada ou movida" | fixed | consolidation.ts:208-210 | consolidation.test table case + "moved chosen mark" |
| 20 | B1-M7 status with crossings | fixed (see concern 1) | consolidation.ts:23-25 (IssueType), :227-237; labels.ts ISSUE_LABEL.status_with_crossings = 'Status com passagens' | consolidation.test "B1-M7" |
| 21 | B1-M8 Marcações 'usada' vs 'não usada (decisão)' | fixed | workbook.ts:332-381 (feedsOfficial + Marcações) | workbook.test "Marcações: usada only…", "overruled by a manual time" |
| 22 | B1-M9 formatPace carry | fixed | src/lib/format.ts:73-84 | format.test "formatPace rounds…" |
| 23 | B1-M10 floor ms to tenths in the workbook | fixed | workbook.ts:12-24 (floorTenths/clockCell/durationCell/spanCell), :211-282 (Tempos), :285-302 (Class.), :307-330 (Pódios) | workbook.test "floored to tenths like the screen" |
| 24 | T15 Resumo Concluintes + reference label | fixed | workbook.ts:124-171 (counts from the sheet's classification; new column "Chegada sem tempo"); labels.ts:52-78 (optional config) + workbook Tempos passes race.config | workbook.test "Concluintes…", "reference timekeeper label…" |
| 25 | B1-M11 + B2-m4 clock | fixed | src/lib/clock.ts:24-77 (1 s step filter at :53, maxInitialAgeMs/synced at :32-44, :74-77); src/hooks/useClock.ts:13-34 (12 h) | clock.test ×2; useClock.test "older than 12 h" |

### Server messages the UI now receives (for Fixer 3's RaceEditor/EventsPage)
- `Não é possível alterar o tamanho da equipe com inscrições`
- `Não é possível alterar o número de pernas de uma prova por equipes com inscrições`
- `Não é possível remover a onda "<nome>" porque ela já largou`
- `Não é possível remover a onda "<nome>" porque ela tem 1 inscrição` / `… tem N inscrições`
- `Onda inválida` (a wave id of another race), `Não é possível mover a prova para outro evento`
- `Informe a data do evento` (empty or malformed date)
- The marks lock message is unchanged and still wins first: `Não é possível alterar pernas ou tamanho da equipe depois que há marcações`.
- An individual race's leg-count change with entries (and no marks) now SUCCEEDS and rewrites every entry's member legs to 0..N-1.

## RED → GREEN evidence

SQL (scratch runner = reset ebc_ff1 + 00_helpers + the one file; each fix applied only after its RED):
- item 4: `20_admin_events.sql:164: ERROR: expected error P0001 but statement succeeded: select public.admin_save_race(… 'waves', '[]')` (wave with start_at)
- item 12: `20:226: ERROR: expected error P0001 but statement succeeded: … 'waves', [{id: wave_other …}]`
- item 1: `20:270: ERROR: the copy must not keep the source event's reference timekeeper, got 883b1306-…`
- item 3 (SQL): `20:314: ERROR: an individual race going from 1 to 3 legs must give every lone member legs [0,1,2], got [… "members": [{"legs": [0] …`
- item 9: `20:359: ERROR: Endereço público inválido` (admin_save_event)
- item 14: `20:368: ERROR: expected errcode P0001 but got 22007 (invalid input syntax for type date: "")`
- → `PASS supabase/tests/20_admin_events.sql`
- item 11: `30:263: ERROR: public.admin_list_athletes() must not look results up with = any(r.athlete_ids)` → PASS 30, 50
- item 13: `40:179: ERROR: moving a mark to leg 1 must give it leg 1's athlete (B), got 2c5557da-…` (A kept)
- item 7: `40:202: ERROR: admin_get_event must never return a timekeeper secret` → PASS 40
- item 8: the lock assertion run against the BASE tk_sync/admin_update_mark definitions (re-created in a rolled-back transaction): `ERROR: tk_sync must lock the mark in both of its reads (first read and the re-read after a lost insert race)`; against HEAD: PASS.
- item 10: passes on the correct grants (test-only item). Discrimination: with `grant execute on function public.slugify(text) to anon` → `ERROR: anon EXECUTE differs from tk_*/pub_*/server_time for: slugify(text)`; with `revoke execute on function public.pub_events() from anon` → `… for: pub_events()`.

TypeScript (vitest in WSL):
- item 2: RED 1 `auth.test.tsx:502 expected '{"access_token":"t","refresh_token":"…' to be null`; after the storage removal RED 2 `auth.test.tsx:510 Expected "anon" Received "organizer"` (TOKEN_REFRESHED restored the session); GREEN 35/35.
- item 6: 13 failing (`keeps the HTTP status and code…`, `shows statement timeout/unique violation/foreign key/22P02/22007/23502/PGRST202/40P01/unknown 4xx in Portuguese`, 5xx network-class, 57014 retryable, thrown English) → GREEN (api+auth 95/95).
- item 3 (domain): `expected null to be 'a1'` (legAthleteId); `suggestLeg … expected {leg_index: 2 …} to match {leg_index: 1, warning: 'already_finished'}`; entryDisplayName name fallback RED on base → GREEN.
- item 18: `expected ['neg','zero','m1',…] to deeply equal ['m1',…,'m4','neg','zero','m5','f6']`
- item 17: records `expected [{ run, … }] to deeply equal [ObjectContaining{…}]` (the DSQ 15:00 was the record)
- item 22: `expected '4:59 /km' to be '5:00 /km'`
- items 19/20: `Expected "…foi descartada ou movida" Received "…foi descartada"`; `expected undefined to match object { severity: 'warning', … }` → GREEN 40/40.
- item 15: `expected [ { row: 5, … } ] to deeply equal [ { row: 2, … }, …(3) ]` ("1990" imported as 1905) → GREEN.
- item 25: `expected 5000 to be 2000` (clock step), `expected true to be false` ×2 (stale saved state) → GREEN 14/14.
- item 16 (writer): `expected 'Tempos – Corrida 5K' to be 'Tempos – Corrida 5K (2)'`, `expected "'Prova da Lagoa'" to be 'Prova da Lagoa'` → GREEN.
- item 5 (helpers): 8 failing `TypeError: classificationFromResults is not a function` / `snapshotDrift is not a function` → GREEN 11/11; public tests (reconstruction moved) 9/9.
- items 5 (workbook) / 16 prefix / 21 / 23 / 24: workbook.test 10 failing (sheet order, Resumo header, Class. sheet, Marcações, snapshot sheets, drift cell, Concluintes, reference label, overruled mark, tenths) → GREEN 23/23.

## Final gates (WSL, ff1, HEAD 07adbc1)

Command (one run, exit 0):
`wsl.exe -d Ubuntu-24.04 -u root -e bash -lc 'cd /mnt/c/ENDURANCE/ebc-wt/ff1 && npm run typecheck && npx vitest run && npm run test:integration && EBC_DB=ebc_ff1 bash scripts/test-sql.sh'`

```
> endurance-base-club@1.0.0 typecheck
> tsc --noEmit -p tsconfig.json
(clean)

vitest run
 Test Files  40 passed (40)
      Tests  667 passed (667)
   Duration  165.77s
(stderr lines only from src/components/ui/ui.test.tsx act()/ResizeObserver noise, pre-existing, not failures)

test:integration (ebc_t8 :54331, ebc_shim :54391 — no clash with Fixer 3's ebc_e2e/:54321/:4173)
 Test Files  2 passed (2)
      Tests  16 passed (16)

EBC_DB=ebc_ff1 bash scripts/test-sql.sh
PASS supabase/tests/00_helpers.sql
PASS supabase/tests/10_schema.sql
PASS supabase/tests/20_admin_events.sql
PASS supabase/tests/30_admin_athletes_entries.sql
PASS supabase/tests/40_timing.sql
PASS supabase/tests/50_public.sql
PASS supabase/tests/60_security.sql
EXIT=0
```

Baseline before the wave (same DB): test-sql 7/7 PASS. Vitest went from 620 (review evidence) to 667 tests.

Extra scratch check (not committed, DB `ebc_ff1x`, dropped afterwards): admin_update_mark's lone-member
fallback — an individual entry whose stored legs are `{0}` in a 2-leg race; moving a mark to leg 1 gives
`NOTICE: FALLBACK OK: athlete_id = <the lone member>`.

## Commits (6244b7e..07adbc1)

```
1b064a8 fix(sql): harden admin_save_race, event duplication, slugs and dates      (items 1, 3 SQL, 4, 9, 12, 14)
50a1846 perf(sql): look athlete results up with athlete_ids @> array[id]          (item 11)
755b164 fix(sql): lock marks on read-then-write, refresh athlete_id on moves, hide secrets (items 7, 8, 13)
f67b3ed test(sql): assert the full anon/authenticated EXECUTE matrix              (item 10)
3f921f1 fix(auth): an offline "Sair" with an expired token really signs out        (item 2)
5bcf1b5 fix(api): show pt-BR text for every non-P0001/42501 server error           (item 6)
f241a0f fix(domain): tolerate stale member legs after a race format change         (item 3 domain)
ba899a6 fix(domain): never rank a finish whose total is zero or negative           (item 18)
dca4973 fix(stats): skip DSQ results and non-positive leg times                    (item 17)
77852a9 fix(format): round paces to the nearest second with carry                  (item 22)
8530f3d fix(consolidation): flag status/crossing contradictions; moved chosen marks (items 19, 20)
fa27621 fix(import): reject year-only birth dates and implausible serials          (item 15)
38d71de fix(clock): survive device clock steps; age out the saved offset          (item 25)
3f0c177 fix(xlsx): sheet names unique ignoring case, no edge apostrophes           (item 16 writer)
b524f11 feat(domain): shared finalized-race reconstruction and snapshot drift      (item 5 helpers + PublicEventPage call site)
07adbc1 fix(workbook): official sheets from the snapshot; conferência consistency  (items 5 workbook, 16 prefix, 21, 23, 24)
```
Each commit ends with the single trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Working tree clean; not pushed.

## Concerns

1. **Item 20 severity (design choice).** The list says "warning … when a DNS/DSQ/DNF entry has crossings". A DNF after an early leg and a DSQ after finishing normally HAVE crossings, and a warning counts as a pendência forever (it cannot be dismissed), so the issue is a **warning** only when the crossings contradict the status (DNS with any crossing; DNF with a finish crossing) and **info** otherwise (still listed in Revisão, not counted as pending). Same message pattern `Nº X está como <STATUS> mas tem passagens`. Question for the controller: keep this split, or make every case a warning?
2. **E2E (Fixer 3 owns tests/e2e):** `tests/e2e/03_review_results.sh` filters `ws.title.startswith('Classificação')`; the sheets are now "Class. – <prova>" (item 16), so that loop silently checks nothing (the run still passes on the Tempos counts). It should use `startswith('Class.')`.
3. **For Fixer 2:** pass `race.config` as the 4th argument of `crossingSourceLabel` in ReviewTab; CrossingEditor's own copy "A marcação escolhida foi descartada — escolha outra decisão." could say "descartada ou movida" like the issue; the Revisão type filter picks up the new "Status com passagens" label automatically. With item 13, `admin_update_mark` now refreshes `athlete_id`, so B2-m7's phone part can stop counting a rejection once the server copy matches.
4. **5xx → code 'network'** (item 6, "network-class"): the timekeeper phone treats a server outage like a dropped connection (marks stay pending and retry; its banner reads "Sem internet"), and TanStack retries such queries (main.tsx retries `network`). Messages differ ("Servidor indisponível no momento…").
5. **Item 15 boundary:** the report's "3653 (≥ 1910)" is off by one — serial 3653 is 1909-12-31; the floor used is 3654 = 1910-01-01.
6. **Resumo counts of a finalized race** (items 5/24) now come from the snapshot classification (so the row agrees with the Classificação sheet); "Pendências" stays live (organizer work to do). A new column "Chegada sem tempo" sits between Concluintes and Em prova (10 columns).
7. **session.tsx hardcodes the auth storage keys** (`ebc.auth`, `-user`, `-code-verifier`) because `src/lib/supabase.ts` (storageKey) is outside my ownership; keep them in sync if the storageKey ever changes.
8. `admin_update_mark`'s lone-member fallback for `athlete_id` (entry whose stored legs do not include the leg) is exercised only by a scratch check (see gates section), not by a committed test — with item 3 the server rewrites individual members' legs, so the path is defensive.
