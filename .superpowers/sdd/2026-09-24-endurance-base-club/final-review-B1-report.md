# Final review B1: pure domain and client libraries (e98799a..9cf9614, HEAD 9cf9614)

Reviewer: final whole-branch review, area B1 (src/domain/*, src/lib/{clock,csv,format,importMapping,outbox,storage}.ts, src/lib/xlsx/*), plus its interfaces with A (SQL payloads), B2 (timekeeper/review/results screens) and C (public/organizer UI).
Method: read every B1 source file in full, the spec (§4, §7 to §11, §16), CLAUDE.md global rules, contracts.md and the binding Rulings (2, 8, 9, 10, 11, 20, 22 to 24, 27, 28, 43, 53, 55). I traced the consumers of each domain function (EventContext, ResultsTab, exportWorkbook, PublicEventPage, tkStore/useTimekeeper, LiveBoard, ReviewTab/CrossingEditor, StatsView, ImportDialog, useClock) and the SQL they depend on (0003 admin_save_race, 0004 entry creation, 0005 tk_sync/admin_update_mark/admin_set_resolution/admin_finalize_race, 0006 pub_event). I ran no suites, as the brief asked. The evidence on this HEAD (620 green, typecheck clean) was accepted as given.

## Strengths

- **Consolidation follows spec §8 closely** (consolidation.ts:52-103). The earliest mark of each timekeeper is the candidate and later ones are duplicates. Each organization mark is its own candidate. The median of an even count is the mean of the two middle values, rounded (2 and 4 timekeepers are correct). The reference timekeeper falls back to the median. Manual and mark resolutions work, and a chosen mark that is no longer usable falls back to the system time and raises a warning. A divergence issue appears only while the crossing has no resolution. Window and threshold edges are consistent: same-crossing uses `<=`, "behind" uses a strict `<`, divergence uses `>` and unassigned uses `> 60 s`.
- **Relay handoff is structural, not special-cased.** The start of leg k is the official crossing of leg k−1 (consolidation.ts:117), so a resolution or manual time on leg k moves the start of leg k+1 automatically. `current_leg` and `current_leg_start_ms` come from the same data, so the on-course clock and the handoff always agree.
- **suggestLeg implements Ruling 10 exactly.** The same-crossing check runs over all legs (closest median wins) and only the "next" step is restricted to the selected athlete's legs. `planBibAssignment` (Ruling 2) excludes the mark being assigned, and its already-finished text follows Ruling 8's wording. Every caller (tkStore, LiveBoard, ReviewTab, CrossingEditor) goes through it, so no copies drifted.
- **Divergence issues follow Ruling 11.** An issue always names a mark, and the likely-misfiled outlier comes first with `suggested_leg_index`, which the Review tab uses directly.
- **Ranking matches spec §9.** It uses competition ranks (1, 2, 2, 4) with a numeric-aware bib tie-break for display. Unranked rows follow Ruling 9's order. Group order is M, F, MISTO, then age group by `min`, then level in event order, with "Sem faixa"/"Sem nível" last, and it only applies to the dimensions a ranking uses. Non-cumulative podiums recompute places from scratch after removing entries already awarded. `compareGroupOrder` is exported so the public snapshot view uses the same order.
- **Ages are time-zone safe.** They use plain date-part arithmetic (Feb-29 births behave like Postgres `age()`). The public payload's precomputed `age_event`/`age_year_end` (0006:71-72, cast to `timestamp` per Ruling 42) is read through `athleteAge`, so admin and public categories agree.
- **The XLSX writer is valid and minimal.** Part order in workbook, worksheet and styles is correct. The number formats are exactly `hh:mm:ss.0`, `[h]:mm:ss.0` and `0.0` (Ruling 24). Formulas carry cached values and `fullCalcOnLoad="1"` is set. Text and attributes are escaped and control characters stripped. Strings are inline (so bibs like "007" keep their leading zeros and a text cell starting with "=" can never become a formula). Null cells are omitted and the header can be frozen. The Tempos formulas mirror `leg_ms`/`total_ms`/`final_ms` exactly: a formula is written only when both endpoints exist.
- **format.ts handles time zones correctly.** Every clock display goes through `Intl` with `America/Sao_Paulo` and `hourCycle: 'h23'`. `parseClockInput` does the two-pass offset resolution, which stays correct if DST ever returns. `excelSerialBrasilia` is right (25569 plus the local offset).
- **The outbox is versioned by `local_updated_at` and fails safe.** `upsert` drops `sent_at_version`, so an edit made while a request is in flight can never be acked or rejected by the stale response (Ruling 44 M3). Corrupted storage degrades to an empty outbox instead of crashing. `isMemoryOnly` lets the screen warn when saving to the device fails. The sync loop that must be single-flight is (useTimekeeper.ts:195, 392-418).
- **The clock follows spec §7.2** (NTP midpoint, minimum RTT of the last 10 samples, persisted state). useClock takes single-flight samples, and api.serverTime rejects non-finite or zero values.
- **The import path is robust for Brazilian files.** CSV auto-detects the delimiter and strips the BOM. The cp1252 fallback lives in ImportDialog. Header and value matching ignore accents. Excel serial birth dates are converted. Error rows carry 1-based table positions.

## Issues

### Critical

None.

### Important

**I1. After finalization, the organizer's results and the XLSX keep using live data while public pages and statistics use the snapshot, and nothing detects the drift.**
- **Where:**
  - src/features/events/EventContext.tsx:50-56 builds `classifications` from live timing on every tick.
  - src/features/results/exportWorkbook.ts:15 and src/domain/workbook.ts:62-67 build the workbook, including Classificação and Pódios of finalized races, from those live classifications. workbook.ts:126 prints "Sim (<date>)" for Finalizada regardless.
  - src/features/results/ResultsTab.tsx:125-126 shows "Oficial · finalizada em …" over the live table.
  - The finalize confirm (ResultsTab.tsx:54) promises "a planilha/pódios não mudam mais sozinhos".
  - PublicEventPage.tsx:237-249 and the athlete statistics read `results` (the snapshot).
  - Nothing server-side stops later changes to a finalized race: tk_sync, admin_update_mark and admin_set_resolution do not check `finalized_at`, correctly so, since marks must never be lost.
- **Why it matters:** a timekeeper phone that was offline syncs after the podium ceremony, or the organizer fixes a resolution. The organizer's "Oficial" table and any XLSX exported later silently differ from the published official results, the podiums shown to the public and the athletes' stats. The on-screen promise is false. This goes to the heart of "official times and rankings".
- **Fix (small, B2/C screens with a B1 helper):** add a pure helper, for example `snapshotDrift(cls, results): string[]`, next to `buildFinalizeRows`. It compares the live `buildFinalizeRows(...)` with `agg.results` for the race, per entry, on status, final_ms, overall_pos and the podium list. For a finalized race with drift:
  - ResultsTab shows a warning: "Os dados mudaram desde a finalização (N inscrições) — finalize de novo para publicar".
  - workbook Resumo prints "Sim — difere do ao vivo".
  - Fix the confirm copy to say the published results only change when the race is finalized again.

  The alternative is to build Classificação/Pódios of finalized races from the snapshot. That is more invasive, and drift detection is still needed to know when to re-finalize.

**I2. A race's legs or team size can change after entries exist, and the stored member legs go stale.** This silently breaks the athlete-per-leg mapping, relay and team categories, the snapshot and statistics.
- **Where:**
  - supabase/migrations/0003_admin_events.sql:545-557 locks leg count, modalities and team_size only when non-discarded marks exist.
  - Member legs are materialized when an entry is created (0004:25 `create_individual_entry`, 0004:357/406 `admin_save_entry`) and never updated afterwards. The race editor has no guard.
  - B1 consumers take the member legs as truth: src/domain/eventModel.ts:60-62 `legAthleteId`, snapshot.ts:35-38 (`legs[].athlete_id`) and stats.ts:20-29 (`ownLegs`, filtered by `athlete_id`).
- **Example:** the organizer creates "Corrida 5 km" from the preset, bulk-registers or imports 150 athletes (members `legs: [0]`), then turns it into a duathlon.
  - Legs 1 and 2 have `athlete_id = null`.
  - The timekeeper and live board show no current athlete for them.
  - The finalized snapshot stores `athlete_id: null` for those legs, so the athletes' records, pace and km per modality never count them.
  - Changing team_size from 1 to 2 leaves one-member entries in a relay: categories come from one athlete, leg 1 has nobody, and relay handoff names are wrong.
  - A shorter leg list leaves member legs ≥ N. `suggestLeg` would then return an out-of-range leg if an `athleteId` were passed (suggestLeg.ts:50-56), and `planBibAssignment` would read `race.legs[k].label` of `undefined` (suggestLeg.ts:81-83). No caller passes `athleteId` today (Ruling 10), so that crash path is latent.
- **Why it matters:** this is a realistic setup-time edit with no warning. The damage only shows after the race, in statistics and categories.
- **Fix:**
  - **Area A, primary.** In `admin_save_race` UPDATE: when entries exist, reject a team_size change ("Não é possível alterar o tamanho da equipe com inscrições"). When the leg count changes and team_size = 1, rewrite `entry_members.legs` to `0..N−1` for the race's entries in the same statement. When the leg count changes and team_size > 1, reject it ("reatribua as pernas") unless entries are absent.
  - **B1, defensive.** `legAthleteId` falls back to the only member when `entry.members.length === 1`. `suggestLeg` filters `candidateLegs` to `< race.legs.length`.

### Minor

- **M1. A year-only birth date imports as 1905** (src/lib/importMapping.ts:51-60). "1990" in a "Nascimento" column fails `parseDateInput`, matches `/^\d+$/`, and is read as Excel serial 1990, which is 1905-06-12. The age becomes 121 and the athlete is placed in "60+", which corrupts age-group podiums. The import preview does show the date, but it is easy to miss in a long list. Fix: accept serials only in a plausible birth range (for example 3653..60000, that is ≥ 1910), or return "Data de nascimento incompleta: informe dia/mês/ano" for 4-digit values 1900..2100. It is a one-line change, so do it before production.
- **M2. Sheet names are de-duplicated case-sensitively, and Excel's other name rules are not applied** (src/lib/xlsx/writer.ts:32-45).
  - Excel requires sheet names to be unique ignoring case, and forbids a leading or trailing apostrophe. Two races named "Corrida 5k" and "Corrida 5K" produce a workbook Excel has to "repair".
  - Truncation to 31 characters also makes "Classificação – " plus 15 characters ambiguous: "Triathlon Sprint Masculino" and "… Feminino" become "Classificação – Triathlon Sprin" and "Classificação – Triathlon S (2)".
  - Fix: keep `used` lowercased and trim `'` at both ends. Use a shorter prefix ("Class. – ") or include the race position.
- **M3. Personal records can come from DSQ results or non-positive split times** (src/domain/stats.ts:20-29, 77-101). `ownLegs` takes every leg with a time, whatever the status. A DSQ performance, or a negative split from an `order` error that was finalized, becomes a "Recorde pessoal" and is added to km and pace. Fix: skip `r.status === 'dsq'` and `time_ms <= 0`.
- **M4. A finish with a total ≤ 0 is ranked, and ranked 1st** (src/domain/ranking.ts:20-22). This happens when the wave start was typed or recorded after the finish. The `order` error flags it and finalize warns, but the live and public classification lead with a nonsensical time. Fix: `isRanked` also requires `final_ms > 0`, so the row falls into Ruling 9's "finished without a usable time" group.
- **M5. suggestLeg ignores resolutions** (src/domain/suggestLeg.ts:23-34). Suppose a crossing exists only as a manual time, because every timekeeper missed it and the organizer typed it from the Súmula. The next mark for that bib is then filed on that same leg and silently absorbed by the manual resolution. The entry stays "Em prova" with only an info issue. Fix: let organizer-side callers (LiveBoard, ReviewTab, CrossingEditor) pass resolutions and treat `manual_ts` as a crossing time. In consolidation, raise a warning when a resolved crossing has a candidate more than one window away from the official time.
- **M6. The chosen-mark warning says "descartada" when the mark was moved** (src/domain/consolidation.ts:88-94, 205-207). If the organizer or timekeeper moves the chosen mark to another leg or entry, the issue reads "a marcação escolhida foi descartada". Fix: "…foi descartada ou movida".
- **M7. An entry set to DNS/DSQ/DNF that still gets crossings raises no issue** (src/domain/consolidation.ts:216-222). The timekeeper sees a DNS/DSQ warning (bib.ts:33-36), but the organizer's Review list says nothing. An athlete wrongly marked DNS before the start therefore disappears from the classification without a flag. Fix: add a warning, for example "Nº X está como DNS mas tem passagens".
- **M8. The Marcações sheet labels every non-duplicate candidate "usada"** (src/domain/workbook.ts:299), even when the crossing was decided by another chosen mark, a manual time or the reference timekeeper. Fix: use 'usada' only when the mark actually feeds `official_ms` (the median over candidates, the chosen mark, or the reference candidate), and 'não usada (decisão)' otherwise.
- **M9. formatPace shows 4:59.6 as "4:59" instead of "5:00"** (src/lib/format.ts:75). It clamps to :59 instead of carrying into the next minute. Fix: `const t = Math.round(sec); return `${Math.floor(t / 60)}:${pad(t % 60)}``.
- **M10. The app truncates tenths but Excel rounds them** (src/lib/format.ts:27, 37 against the writer's `hh:mm:ss.0` and `[h]:mm:ss.0`). A crossing at 10:00:05.960 reads "10:00:05.9" on screen and "10:00:06.0" in the conferência sheet, and splits can differ by 0.1 s. Fix: in workbook.ts, floor the milliseconds to 100 before calling `excelSerialBrasilia`/`excelDuration`. The formulas stay self-consistent because they only subtract floored passages.
- **M11. A device clock step can shift marks for about 200 s** (src/lib/clock.ts:36-50, 68-70). The clock's timebase is `Date.now()`. If the OS steps the clock (for example an NTP or NITZ correction), the previous minimum-RTT sample stays selected for up to 10 samples (about 200 s), and `now()` is off by the size of the step during that time. Fix: take t0, t1 and `now()` from `performance.timeOrigin + performance.now()` (monotonic), or drop the sample history when `Date.now()` and `performance.now()` deltas disagree by more than 1 s.
- **M12. The XLSX reader drops cells and rows without an `r` attribute** (src/lib/xlsx/reader.ts:66-76). ECMA-376 allows omitting `r`, and some generators do. The import then fails with "Coluna obrigatória não encontrada". Fix: track implicit row and column positions.
- **M13. A title row above the header breaks the import** (src/lib/importMapping.ts:70). The header is taken to be the first non-empty row, so a sheet that starts with "Inscritos – Desafio 2026" fails. Fix: among the first 10 rows, choose the one with the most synonym matches.

## Minors triage (final-review-minors.md, area B1)

- T1 "storage.ts fallback map is module-level; tests should use unique keys" → **defer**. It only affects test hygiene, and one fallback per page is the intended runtime behaviour.
- T9 "entryCategory silently ignores members missing from athletesById; indexEvent test covers one entry per race" → **defer**. Every payload includes all member athletes (admin_get_event; pub_event 0006:63-76 joins entry_members), so the path is data-corruption-only. I2's fallback covers the one-member case.
- T14 "one error per import row; boolean cells read back as '1'/'0'; python verify test leaves temp files" → **defer**. These are cosmetic or test-only; the import has no boolean fields.
- T13 "overlapping in-flight syncs could mis-ack; effective() recomputed per getter" → **defer**. The sync loop is single-flight (useTimekeeper.ts:195, 392-418), and at most 10 samples makes the recomputation negligible.
- T13 "outbox sanitize is one level deep" → **defer**. It is only reachable through corrupted storage, and the server validates every field (Ruling 28).
- T11 "no multi-leg snapshot mapping test; no dims:[] podium test; numeric bib tie-break untested" → **defer**. I checked the behaviour by reading: dims [] gives 'all'/'Geral', compareGroupOrder returns 0, and the collator is numeric. Add the tests together with the I2 fix if convenient.
- T12 "stats test gaps; record/evolution label from first/best leg" → **defer**. These are tie-break cosmetics. M3 is the real stats fix.
- T15 "Resumo counts raw TimingStatus; crossingSourceLabel 'reference' matches by ts equality; 'duplicada' untested; third collator copy" → **fix before production** for the first two, in the same batch as M8. Both are cheap and are about the conferência sheet agreeing with itself:
  - Concluintes should equal `cls.finishers`, with finished-without-start counted apart.
  - The reference label should use `config.reference_timekeeper_id`, not ts equality.
  - Defer the test gap and the collator copy.
- T22 "outbox never prunes synced items" (lib part) → **defer**. It costs about 300 B per mark, holds only this device's marks for one event, and stays well inside 5 MB.
- T26 "UNRANKED_STATUS_ORDER and bib collator copied from domain/ranking.ts" (area C, domain-adjacent) → **defer**. The copies are behaviourally identical today. C may import them from ranking.ts when convenient.
- T20 "ageToday duplicates athleteAge fallback" (area C) → **defer**. It is a display-only duplicate.

## Declined to judge

- **Times shown for DNF/DSQ rows** (total/final_ms stay non-null when a finish exists). The spec is silent, and the Tempos sheet is a conferência of the raw data. How screens display it belongs to B2/C.
- **Transition legs shorter than the 30 s window being merged into the previous crossing.** Ruling 10 accepted this explicitly, and the presets have no transition legs.
- **Late offline marks misfiled by suggestLeg**, for example a finish filed as leg 0 because the swim-exit mark had not synced yet. The one-shot suggestion is by design (spec §7.5), and the resulting spread raises a divergence issue.
- **Whether the persisted `initial` clock state should stay a candidate once fresh (possibly high-RTT) samples arrive.** The spec says to use the minimum RTT among the last 10 samples, and 5 startup samples make a bad-only set unlikely.
- **Safari parsing of microsecond timestamps** (`finalized_at` in workbook.ts:126). WebKit ignores digits beyond milliseconds as far as I know, but I could not verify it on a device. Every timing field (ts, start_at, manual_ts) has millisecond precision anyway.
- **mergeById comparing `updated_at` as strings.** Postgres emits a consistent offset per session and trims trailing zeros, which orders correctly. The merge itself is B2's.
- **"Sem faixa"/"Sem nível" groups receiving podiums.** Spec §9 orders "Sem faixa" last, which implies it is a real group.
- **Missing `docProps` and `bookViews` in the XLSX.** Both are optional, and openpyxl and Excel open the file.
- **CSV tolerance for quotes inside unquoted fields and for 1904-date-system workbooks.** Both are inputs that break the standard or are legacy, and neither occurs with Brazilian Excel, LibreOffice or Google exports.
- **Exact-only header synonyms beyond M13** (for example "Sexo (M/F)"). The preview shows which columns were found, and the error names the missing column.
- **Levels renamed after entries were assigned** (the entry then shows "Sem nível"). This is organizer data hygiene and is visible in Inscrições.
- **The `order` check skipping legs whose previous leg is missing.** `missing_crossing` already raises an error there.
- **Negative durations rendering as ##### in Excel.** They only occur together with an `order` error, and M4 covers the ranking side.
- **computeEventTiming running every tick for large events.** It is O(marks + entries × legs), which is fine at spec scale (300 × 3 × 4).
- **exportWorkbook.ts revoking the object URL synchronously after `a.click()`.** This is B2/C territory, and E2E exported successfully. Flagged for B2 only.

## Recommendations

1. Put I1 (drift helper, warning and copy) and I2 (SQL lock or rewrite, plus the two B1 defensive lines) in the single fix dispatch. They are small and touch official results.
2. Take the cheap Minors in the same batch: M1, M2, M3, M4, M6, M9, and T15's two conferência fixes. Each needs one to five lines and a unit test.
3. Defer M5, M7, M8, M10, M11, M12 and M13 to the post-launch backlog, unless the fixer has room for M7 (a single new issue type).
4. Add regression tests for:
   - an individual race whose leg count is edited after bulk registration (after the I2 fix);
   - a finalized race whose live classification drifts (I1);
   - import of a year-only birth date (M1);
   - two races whose names differ only by case in the workbook (M2).

## Assessment

**Ready for production: With fixes.**

The core engine is correct on every path I traced: median with 2, 3 or 4 timekeepers, reference timekeeper, chosen and manual resolutions, discarded and moved marks, relay handoffs, wave starts, penalties, status overrides, window and threshold edges, ranking ties, group order, and cumulative versus exclusive podiums. The libraries (writer, format, clock, outbox, storage) are sound.

Two integration gaps need fixing before real events:
- I1: after finalization, the organizer's results view and the conferência workbook can silently disagree with the published official results and the athlete stats.
- I2: editing a race's format after registering athletes leaves member legs stale, which silently degrades categories, the snapshot and statistics.

Both are small, contained fixes. No Critical issues.
