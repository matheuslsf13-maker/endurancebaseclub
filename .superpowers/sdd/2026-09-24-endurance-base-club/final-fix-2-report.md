# Final fix wave — Fixer 2 report (timing screens)

Worktree `C:\ENDURANCE\ebc-wt\ff2`, branch `fix/final-2`, base `07adbc1` (feat + Fixer 1). Not pushed, not merged
(feat/ebc-app's 2173dd5 with Fixer 1's round-2 commits is for the controller to merge first).
All 17 items of "## Fixer 2" plus the coordinator's item 18 are fixed; none skipped. Every item was driven by a failing
test first (RED below), then the fix (GREEN). Only files of my ownership were touched, plus one new test file
`src/features/events/eventLayoutStale.test.tsx` for the EventLayout stale hint (item 10).

## Items

| # | Item | Status | Where (files:lines at HEAD) | Covering tests |
|---|------|--------|-----------------------------|----------------|
| 1 | B2-I1 stable issue keys | fixed | review/ReviewTab.tsx:39-53 (`issueKeys`: type\|entry\|leg\|mark ids, `#n` suffix if ever equal), :184 (`key={keys[i]}`) | review.test "a bib typed in an unassigned issue stays with its mark when the list shifts" (3 marks, 101 typed in the 2nd row, a poll removes the 1st issue → the typed field is still in the 2nd mark's row and Atribuir files `u2`) |
| 2 | B2-I2 UI: finalized = snapshot, drift banner, Revisão hint, rows after confirm, copy, export | fixed | results/ResultsTab.tsx:51-54 (latest-render ref), :63-68 (`classificationFromResults` + `snapshotDrift`), :74-75 + officialResults.ts:25-36 (snapshot names for deleted athletes), :97-160 (finalize reads `latest.current` after the confirm; new copy), :248-252 (drift banner); officialResults.ts:9-13 (`driftMessage`); review/ReviewTab.tsx:108-136 (per finalized race: drift warning or "está finalizada — correções… só entram no resultado oficial depois de reabrir e finalizar de novo"). Export: unchanged call, Fixer 1's `buildEventWorkbook` builds finalized races from `agg.results` (comment at ResultsTab.tsx:185) | results.test "renders the stored classification, not the live one, and says how many entries changed since"; "shows no drift banner while the live data still matches"; "names members from the snapshot when the athlete is no longer registered"; "finalize: the rows come from the data current when the organizer confirms"; "finalize: the confirm … no longer promises the results never change"; review.test "says how many entries changed since the race was finalized", "reminds that a finalized race only changes officially when finalized again" |
| 3 | B2-I3 LiveBoard young marks | fixed | timing/LiveBoard.tsx:74-97 (timekeeper mark ≤ `UNASSIGNED_ISSUE_AFTER_MS` old → "com o cronometrista · há N s", no form; own 1 s tick + clock offset; organization marks keep the form), :99+ (`UnassignedAssignForm`) | timing.test "leaves a mark younger than a minute with its timekeeper: no assign form until it is 60 s old"; the two existing assign tests (one now uses a 2-min-old mark) |
| 4a | B2-I4 (a) truthful copy | fixed | timing/TimingTab.tsx:59-68 (rotation confirm), :107-110 ("Link ativo" hint) | timing.test "the rotation confirm tells the truth…" |
| 4b | B2-I4 (b) poll tk_open + "Tentar novamente" | fixed | timekeeper/useTimekeeper.ts:31-32 (`LINK_RECHECK_MS` 10 s), :421-446 (`checkLink`, interval while `invalid`/`linkInvalid`), :793-797 (`retry`); TimekeeperPage.tsx:149-157 (invalid screen: text + button), :607-613 (banner button) | timekeeper.test "a link turned off mid-race keeps MARCAR … resumes when it works again", "\"Tentar novamente\" on a refused link checks it at once", "without a registration, the invalid-link screen checks again by itself and on \"Tentar novamente\"" |
| 4c | B2-I4 (c) registration per event | fixed | useTimekeeper.ts:34-39 (`legacyRegKey`, `deviceKey` = `ebc.tk.device.<eventId>`), :141-158 (`readDevice` + migration of the per-link key on read), :297-303 (initial state), :370-379 (`adoptDevice` after tk_open), :493-500 (drop), lock takeover re-reads by event, register writes the event key | timekeeper.test "a new link of the same event keeps this device's timekeeper and sends its pending marks" (same id/secret with `newtok`, pending mark sent, no re-register; old key migrated); registration test now checks `ebc.tk.device.e1` |
| 4d | B2-I4 (d) MARCAR while invalid | fixed | useTimekeeper.ts:380-385 (`onInvalid`: with session + registration → `linkInvalid`, else phase `invalid`), used by tk_open (:405), reopen (:455) and tk_sync (:598); sync loop paused while `linkInvalid` (:560-562); TimekeeperPage.tsx:575-577 (status "Link inválido · N marcações guardadas no aparelho"), :606-614 (banner `tk-link-invalid`) | same as 4b (2nd mark recorded while invalid, no tk_sync, both sent after re-enable) |
| 5 | B2-m1 notices never swallow taps | fixed | timekeeper/TkNotices.tsx (new: own bottom layer, `pointer-events-none` on container and card, `pointer-events-auto` only on the action buttons and "Fechar"; max 3; errors 5 s); TimekeeperPage.tsx:259-261 (`useTkNotices` instead of the kit toast), :297-323 (assign notice with actions `toast-undo`/`toast-change-leg`, 8 s kept — see concern 2), :565 (layer) | timekeeper.test "assignment and error notices let taps through to the rows and MARCAR, except on their buttons" (classes, button list, 5 s/8 s lifetimes) + every existing assign/discard/Desfazer/Trocar perna test |
| 6 | B2-m2 presses per pointerId | fixed | TimekeeperPage.tsx:271-272 (`Map<pointerId, RowPress>`), :437-452 (window up/cancel), :462 | timekeeper.test "two overlapping touches on two \"Em prova\" rows record both arrivals" |
| 7 | B2-m3 wake lock re-request | fixed | TimekeeperPage.tsx:46-104 (`useWakeLock` returns `keepAwake`; re-request on the sentinel's `release` while visible and on the next tap after a refusal), :348/:419/:424 (called after the tap instant is taken) | timekeeper.test "asks for the wake lock again after a refusal or a release, on the next tap"; existing "keeps the screen awake and ignores wake-lock failures" |
| 8 | B2-m5 prune other events | fixed | useTimekeeper.ts:159-246 (`pruneOtherEvents`: known key shapes only, UUID event ids, sessions by content; keeps events with a pending outbox item or a held Web Lock `ebc.tk.<eventId>`), :507-511 (on session open) | timekeeper.test "drops other events' timekeeper data with nothing pending when a session opens, and keeps the rest" (E2 pruned incl. legacy reg; E3 with a pending mark kept; `ebc.tk.lastLink`, `ebc.clock` and the current event untouched) |
| 9 | B2-m7 phone part | fixed | useTimekeeper.ts:810-837 (a rejected item whose mark is on the server → shown `synced` with `note`, not counted in `rejectedCount`); TimekeeperPage.tsx:854 ("Sua alteração foi recusada (…) — vale a versão registrada.") | timekeeper.test Ruling 27 test extended (no ⚠, no header count, note shown); M7 test extended (never-stored rejection still counted "1 marcação recusada") |
| 10 | B2-m8 stale organizer views | fixed | hooks/useEventData.ts:15-18 (10 s, 1 s check), :26-28 (`staleSince`), :162-188 (from the query's `dataUpdatedAt`; live tabs only; 10 s grace after the page becomes visible); events/EventLayout.tsx:30, :46, :55, :81-88 ("Sem conexão · dados de hh:mm:ss", role=status) | useEventData.test "reports when the data it shows is more than 10 s old…", "keeps quiet while the polls succeed, and on idle tabs", "gives the polls a moment after the page becomes visible again"; eventLayoutStale.test "says the live view has no connection and how old its data is…" |
| 11 | B2-m9 re-start copy + Desfazer | fixed | timing/WavesPanel.tsx:30-46 (`applyStart` returns success), :48-71 (confirm "Esta onda largou às hh:mm:ss.d — substituir pelo horário de agora?", danger "Substituir largada"; toast 15 s with Desfazer → previous start) | timing.test "re-starting a started wave names its current start and offers Desfazer back to it", "a first start keeps the plain confirm" |
| 12 | B2-m10 Mover honours the leg | fixed | review/CrossingEditor.tsx:105-155 (explicit leg + bib → that leg of that entry; leg missing in the bib's race → "A prova do Nº X não tem a perna N"; toast "Marcação movida para Nº X · perna k/n (rótulo)" in every case) | review.test CrossingEditor ×4 (explicit leg + bib; bib only → suggestion; leg only; impossible leg refused) |
| 13 | B2-m11 DNF at finalize | fixed | results/ResultsTab.tsx:21-33 (`DnfOption` checkbox "Marcar N como DNF"), :101-118 (confirm copy), :131-146 (after the confirm: only entries listed AND still on course now → `updateEntryStatus(id,'dnf',penalty,notes)`, local patch, classification recomputed with them) | results.test "finalize: offers to mark the entries still on course as DNF", "finalize: without ticking the DNF option, entries on course stay as they are" |
| 14 | B2-m12 pt-BR decimals and plurals | fixed | review/reviewFormat.ts (new: `formatSecondsBR`, `formatSignedSecondsBR` via Intl pt-BR); ReviewTab.tsx:270 ("3,5 s"); CrossingEditor.tsx:254 ("+0,3 s"/"-0,3 s"); ResultsTab.tsx:107, :111, :224 + officialResults.ts:15-18 (`plural`) | review.test "shows the spread with a decimal comma", "shows each mark's distance to the median with a sign and a decimal comma"; results.test "1 pendência — ver Revisão", confirm "0 erros e 0 avisos" without "(s)" |
| 15 | B2-m13 revoke later | fixed | results/exportWorkbook.ts:8-9, :33 (`setTimeout(revoke, 10 s)`) | results.test "downloads a Blob … and revokes the URL only later" (fake timers: not revoked at once, revoked after 10 s) |
| 16 | T28 minors | fixed | TimekeeperPage.tsx bib input without the "—" placeholder; CrossingEditor.tsx:212-214 (`size="xl"`), :234-292 (actions on their own row, `colSpan={4}` at :264), :201-203 (no athlete repeat for individual entries) | timekeeper.test "the bib field has no placeholder…"; review.test "does not repeat the athlete of an individual entry in the subtitle, and is wide enough for the move controls" (xl class; "Mover para" not in the time's row) |
| 17 | Server error vs no internet; `crossingSourceLabel(…, race.config)` | fixed | useTimekeeper.ts:57-60 (`OfflineReason`), :267-279 (`classify`: ApiError 'network' with an HTTP status > 0 → `server`, else `internet`), state `offline` replaces `online` (derived); TimekeeperPage.tsx:578-581 ("Sem conexão com o servidor · N …" vs "Sem internet · N …", same backoff); review/ReviewTab.tsx:253 (4th argument). The only other call site (workbook) already passes it (Fixer 1) | timekeeper.test "tells a server failure from a lost internet connection, with the same retry"; review.test "names the configured reference timekeeper even when another one marked the same instant" |
| 18 | (Fixer 1 re-review) total ≤ 0 shown as "Concluiu" with a negative time | fixed | results/ClassificationTable.tsx:77-93 (`statusText`: "Concluiu (sem tempo válido)" for `final_ms ≤ 0`; `resultDuration` shows "—" for a zero/negative leg, total or final), :150-155 | results.test ClassificationTable "a finish whose total is zero or negative is unranked, says \"sem tempo válido\" and shows no time" (wave start 10 min after the finish: Pos "—", no "-10:00") |

Also: CrossingEditor's copy "A marcação escolhida foi descartada ou movida — escolha outra decisão." (Fixer 1 concern 3),
test updated.

Rulings 53–55 (burst, `user`/`app` selection, set-aside) are untouched: `tkStore.ts` is unchanged, the selection code
in TimekeeperPage only gained `keepAwake()` calls after the tap instant is taken, and every Ruling 53–55 test still
passes unchanged.

## RED → GREEN evidence

RED (each block run before its fix, in WSL, `npx vitest run <files>`):

- Review (items 1, 2-Revisão, 12, 14, 16, 17, copy): `src/features/review` → **12 failed | 13 passed (25)**.
  I1: `expect(row).toHaveTextContent(<time of the 2nd mark>)` failed (the typed 101 sat in another mark's row);
  m12: crossing row "3.5 s", dialog "-0.3 s"/"+0.3 s" (`Received: …Ana08:10:00.000-0.3 sDescartar…`);
  reference: row without "Cronometrista de referência (Bia)"; m10: `expected "vi.fn()" to be called with arguments:
  [ 'mv1', …(1) ]` (sent the suggested leg 0) and the impossible-leg test `expected "vi.fn()" to not be called at all,
  but actually been called 1 times`; T28: `expected document not to contain element, found <p` ("Ana Souza · Ana
  Souza"); I2: `Unable to find … /Há 1 alteração depois da finalização…/`; copy "descartada ou movida" not found.
  → GREEN `25 passed (25)`.
- Results (items 2, 13, 14, 15, 18): `src/features/results` → **8 failed | 16 passed (24)**.
  18: `Unable to find … "Concluiu (sem tempo válido)"`; m13: `expected "vi.fn()" to not be called at all, but actually
  been called 1 times`; m12: `Unable to find … "1 pendência — ver Revisão"`, confirm without "Pendências em Revisão:
  0 erros e 0 avisos."; I2 rows: `expected { entry_id: 'en3', …(5) } to match object { status: 'finished', …(2) }`
  (built from the classification captured when the dialog opened); m11: confirm without "Ainda há 1 inscrição em
  prova"; I2 view: `Unable to find … 101` in row 0 (live order shown) and `Received: 1101?Misto…` (deleted athlete
  "?"). → GREEN `33 passed (33)` together with src/features/public.
- Timing (items 3, 4a, 11): `src/features/timing` → **3 failed | 24 passed (27)**.
  4a: `Received: …Os cronometristas já cadastrados continuam ativos.`; m9: `Received: Largar Aquathlon – Largada geral
  agora?×CancelarLargar agora`; I3: `Unable to find an element by: [data-testid="unassigned-mark"]` (the form showed
  from second 0). → GREEN `27 passed (27)`.
- Stale data (item 10): `src/hooks/useEventData.test.tsx src/features/events/eventLayoutStale.test.tsx` → **4 failed |
  15 passed (19)**: `AssertionError: expected undefined to be null` ×3 (no `staleSince`), `Unable to find an accessible
  element with the role "status"`. → GREEN `73 passed` (hook + all src/features/events).
- Timekeeper (items 4b/c/d, 5, 6, 7, 8, 9, 16-bib, 17): `src/features/timekeeper/timekeeper.test.tsx` → **12 failed |
  75 passed (87)**: 4c `expected null to deeply equal { timekeeper_id: 'tk-me', …(2) }` (no `ebc.tk.device.e1`) ×2;
  4b/4d `Unable to find an element by: [data-testid="tk-link-invalid"]` ×2 (the phone fell to the terminal "Link
  inválido" screen without MARCAR); invalid screen `Unable to find … button … "Tentar novamente"`; 17 status said "Sem
  internet" for a 503; 9 the row still showed ⚠; m1 `Expected the element to have class: pointer-events-none` (kit
  toast); m2 `expected [ 'en1' ] to deeply equal [ 'en1', 'en3' ]`; m3 `expected "vi.fn()" to be called 2 times, but
  got 1 times`; m5 `ebc.tk.session.tokE2: expected '{"event":{"id":"22222222-…' to be null`; bib `expected '—' to be
  ''`. → GREEN `116 passed (116)` (whole src/features/timekeeper).

## Final gates (WSL, ff2, HEAD 54c2510)

Command (one run, exit 0):
`wsl.exe -d Ubuntu-24.04 -u root -e bash -lc 'cd /mnt/c/ENDURANCE/ebc-wt/ff2 && npm run typecheck && npx vitest run && npm run build; echo GATES_EXIT=$?'`

```
> endurance-base-club@1.0.0 typecheck
> tsc --noEmit -p tsconfig.json
(clean — re-run standalone at the same HEAD: TYPECHECK_EXIT=0)

vitest run
 Test Files  41 passed (41)
      Tests  703 passed (703)
   Duration  173.77s
(stderr only from src/components/ui/ui.test.tsx "not configured to support act(...)", pre-existing — none from
 the files of this wave)

> endurance-base-club@1.0.0 build
> vite build
✓ built in 3.54s
PWA v1.3.0  mode generateSW  precache 50 entries (898.12 KiB)
GATES_EXIT=0
```

Vitest went from 667 (Fixer 1's HEAD) to 703 tests; files 40 → 41 (the new eventLayoutStale.test.tsx). Earlier runs
of the same chain under a load average of ~13 (other agents) failed only with vitest's pool error "Failed to start
forks worker … Timeout waiting for worker to respond" for 1–5 unrelated files, every test that ran passing; the run
above was taken after the load dropped (load average ~2).

## Commits (07adbc1..HEAD)

```
54c2510 fix(timekeeper): keep the assignment notice 8 s, errors 5 s                             (item 5 duration, see concern 2)
ba2e961 fix(timekeeper): keep marking through a refused link, one identity per event, safer taps  (items 4b, 4c, 4d, 5, 6, 7, 8, 9, 16-bib, 17-header)
c747fec fix(live): say when the organizer's live view stopped refreshing                     (item 10)
3f7e8a7 fix(timing): leave fresh marks to their timekeeper, truthful link copy, undoable re-start (items 3, 4a, 11)
3ae6440 fix(results): official snapshot for finalized races, drift banner, DNF at finalize    (items 2, 13, 14-results, 15, 18)
42a4c55 fix(review): stable issue rows, honest "Mover", pt-BR numbers, finalized-race hint     (items 1, 2-Revisão, 12, 14-review, 16-CrossingEditor, 17-label)
```
Each commit ends with the single trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Working tree
clean; not pushed.

## Concerns

1. **Web Lock after a rotation.** With (d) the tab of the refused link keeps timing, so it keeps the event's Web Lock
   (Ruling 45 must hold: that tab still writes the outbox). A new link opened in a *new tab* of the same phone
   therefore shows "Este link já está aberto em outra aba deste aparelho — use aquela aba" until the old tab is closed
   (then it takes over with the same registration and outbox and sends everything). Opening the new link in the same
   tab works at once. The old tab cannot know the new token. Worth one line in the pre-event checklist ("abra o novo
   link na mesma aba ou feche a antiga").
2. **Assignment notice duration kept at 8 s** (errors 5 s). B2-m1 allows "shorter duration *or* …"; the pass-through is
   the fix, and `tests/e2e/02_timing.sh` reads tk1's assign toast about 4.5 s after the Duda divergence mark (plus
   agent-browser latency), which 5 s would break. E2E selectors are preserved: `assign-toast`, `toast-undo`,
   `toast-change-leg`, `discard-toast`, `discard-undo` and `[data-testid=assign-toast] button[aria-label=Fechar]`.
3. **Pruning scope (B2-m5).** Only key shapes the timekeeper writes, with UUID event ids, are touched; an event is kept
   when any of its outboxes has a pending item or its Web Lock is held (another tab timing it); if `locks.query()`
   fails nothing is pruned. Registrations of other events go too — reopening an old event's link on the same phone
   asks the name again (a new timekeeper id; its synced marks stay on the server). Fixer 3's "remember the last `#/c/`
   token" key is left alone whatever its name, as long as it is not `ebc.tk.<uuid>.<uuid>` or one of the shapes above.
4. **Legacy registration migration** is per current token only (`ebc.tk.reg.<token>` → `ebc.tk.device.<eventId>` when
   that token's session is read). Nothing is deployed yet, so no real phone has the old key.
5. **Finalize with "Marcar N como DNF"**: statuses are set one by one before the snapshot; if one fails, finalizing is
   aborted with the server message and the aggregate is refreshed (earlier ones stay DNF — visible, reversible in
   Inscrições). Only entries that were listed in the dialog AND are still on course when the organizer confirms are
   changed.
6. **Stale hint** uses TanStack's `dataUpdatedAt`, which a local `patchAgg` also moves (after a successful mutation, so
   the server was reachable); shown on live tabs only (idle tabs poll every 15 s by design).
7. `src/features/events/eventLayoutStale.test.tsx` is a new file in Fixer 3's folder (only tests my EventLayout hint);
   no Fixer 3 file was edited.
8. **Gates environment:** full runs under a machine load average of ~13 (other agents) hit vitest's pool error
   "Failed to start forks worker … Timeout waiting for worker to respond" for 1–5 unrelated files (every test that ran
   passed); the reported gate run was taken with the load back to normal. Not a code issue, but the controller may
   see it if it runs the suite while other agents are busy.
9. **Not re-run here:** the E2E (Fixer 3 owns tests/e2e and ports 54321/4173) and the SQL/integration suites (no SQL
   or api.ts change in this wave). Recommend the controller's post-merge E2E pass, which covers the new timekeeper
   notice layer through `assign-toast`/`Fechar`.
