# Final review — area B2: timing screens + data hooks (e98799a..9cf9614)

Reviewer: final whole-branch review, area B2 (Ruling 57). Scope: `src/features/timekeeper/*`, `src/features/timing/*`,
`src/features/review/*`, `src/features/results/*`, `src/hooks/{useClock,useEventData,useNow}.ts`, and their interfaces
with A (tk_sync / admin_* SQL, api.ts), B1 (consolidation, suggestLeg, outbox, clock, workbook) and C (Toast, Modal,
EventLayout, PublicEventPage). Read-only; no suites re-run (evidence on HEAD: vitest 620, typecheck, E2E PASS).

## Strengths

- **Taps are durable first.** `mark()` reads the synced instant before anything else, writes the unassigned mark to the
  outbox synchronously, and only then tries the bib (useTimekeeper.ts:533-550). "Em prova" taps capture entry, target mark
  and instant on pointerdown and commit on pointerup with a slop check (TimekeeperPage.tsx:398-433) — list moves between
  press and release cannot misfile (Ruling 44 M1).
- **Pointer/click/keyboard dedupe is right.** Click-of-press is recognised by `detail > 0` and a 1 s timestamp window
  (not a sticky flag), long presses refresh the window on pointerup, keyboard repeat is suppressed, focus stays in
  `bib-input` (TimekeeperPage.tsx:91-100, 338-359).
- **Sync loop is correct.** Single-flight via a ref shared across effect runs; `markSent` + version-checked acks *and*
  rejections (edits made in flight stay pending); marks in neither list stay pending (Ruling 28c); 200-mark batches oldest
  first; ×2 backoff to 10 s; paused while hidden, resumed on `visibilitychange`/`online`; 10 s overlap; wave starts and
  version-driven `tk_open` reloads; unauthorized → re-register + adoption of pending marks (useTimekeeper.ts:374-471).
- **One tab per link** (Ruling 45) with a waiting takeover that re-reads every stored structure; set-aside ids persisted
  and pruned only once this tab holds the marks (useTimekeeper.ts:324-372, 651-661).
- **Ruling 26 honoured** — the timekeeper route never reloads for a new build.
- **Organizer data hook** (useEventData.ts) is careful: single-flight across tab switches, delta cursor bound to the
  aggregate's `server_now`, `refetched`/`patches` guards so an older poll never replaces fresher lists, full refetch
  every 30 s on live tabs (Ruling 33), unknown-timekeeper refetch; TanStack structural sharing avoids re-renders on
  empty deltas.
- **Ruling 40 in this area:** CrossingEditor seeds its form once; LiveBoard's quick-assign inputs are uncontrolled and
  keyed by mark id; WavesPanel's time form remounts only when that wave's start changes. (One exception: Important 1.)
- **"Largar agora"** stamps `clock.now()` right after the confirm resolves, before any await (WavesPanel.tsx:47-55).
- **CrossingEditor preview** goes through `computeEntryTiming` with a hypothetical resolution; a stale `mark` resolution
  is detected (`markMissing`) and the form starts from `system`; the server re-validates `mark` resolutions.
- pt-BR copy is consistent and every displayed time goes through `format.ts` (Brasília, tabular); no
  `toLocaleTimeString` anywhere in the area.

## Issues

### Critical

None found.

### Important

**I1. Review: a bib typed in an `unassigned` issue can be filed on a different mark when the issue list shifts.**
`src/features/review/ReviewTab.tsx:138-145` renders issues with `key={i}` and mounts `<UnassignedAssign markId=…/>`
inside; `UnassignedAssign` (235-284) keeps the typed bib in local state. React keeps that state at the *index*, while
the `markId` prop changes when the list moves. During a race the list moves constantly: unassigned issues sort first
in "Avisos" by time, and every time a timekeeper identifies an older mark (or a mark crosses 60 s) the rows shift. Trace:
issues for marks 10:01, 10:02, 10:03; the organizer types "102" in the 10:02 row; the timekeeper identifies 10:01 on
the phone; after the next poll the "102" field sits in the row that now belongs to 10:03 → Enter files 10:03 under 102
(wrong time), 10:02 stays unassigned. Silent misfile on the screen meant to fix misfiles.
Fix: a stable key per issue, e.g. `` `${issue.type}|${issue.entry_id ?? ''}|${issue.leg_index ?? ''}|${issue.mark_ids?.join(',') ?? ''}` ``
(unique per issue), plus a test that re-renders with the first unassigned issue removed and asserts the typed bib stays
with its mark.

**I2. A finalized race's "Oficial" view and the exported workbook are recomputed live; they drift from the frozen
snapshot the public page and athlete statistics use.**
`ResultsTab.tsx:159-161` (table/podiums) and `:97` (export) always use `classifications` computed from the current
marks/resolutions/entries, also when `race.finalized_at` is set and the badge says "Oficial · finalizada em …" (:126).
The public page renders the stored snapshot for finalized races (`PublicEventPage.tsx:237-245`), and stats read the
snapshot. Nothing stops inputs from changing after finalization: `tk_sync`, `admin_update_mark`, `admin_set_resolution`
have no finalized check, and nothing in Revisão/Cronometragem says the race is finalized. Realistic trigger: a phone
that was offline syncs its marks after the organizer finalized (medians move), or the organizer fixes a pendência in
Revisão without reopening. From then on the organizer's official table, the printed page and the XLSX show one result
while the public page and the athletes' profiles show another. The finalize confirm (:54) even promises "a
planilha/pódios não mudam mais sozinhos". Also, the snapshot rows are built from the `cls` captured before the confirm
opened (:63), so marks that arrive while the dialog is open are left out.
Fix: for a finalized race, render table/podiums and the Classificação/Pódios sheets from `agg.results` (move
`classificationFromResults` out of PublicEventPage into a shared module) and show a banner when the live computation
differs from the snapshot ("Há N alterações depois da finalização — reabra e finalize de novo para oficializá-las"). The
same hint belongs on Revisão for finalized races. Build the finalize rows from the latest context after the confirm
resolves (for example through a ref).

**I3. The live board offers one-tap assignment of marks the timekeeper is still identifying, which throws the phone's
first-in-first-out order off.**
`LiveBoard.tsx:172-174, 268-273` lists every unassigned mark with a bib form from second 0. On the phone, typed bibs go to
the oldest mark of the current burst (`tkStore.ts:160-171`, `TimekeeperPage.tsx:370`). Trace: the timekeeper made
marks M1, M2 and M3 for a pack and is typing bibs in order. The organizer sees M2 about 3 s later and assigns it 102.
The phone's next sync takes M2 out of "Sem atleta", so the "102" the timekeeper types next lands on M3. M2 and M3 then
both belong to that timekeeper on 102's crossing, and M3 becomes a *duplicate* (severity info). When the timekeeper
types 103 the phone answers "Toque em MARCAR primeiro". Result: 103 has no crossing (only the info-level
`not_finished`, which is not counted in the pendências badge and is a DNF candidate at finalize), and 103's real time sits
on 102 as a duplicate. The reverse race has a cost too: the timekeeper's own identification of M2 is rejected with
"Alterada pela organização" (the org copy has no `athlete_id`), and a ⚠ that never clears shows on the phone.
Fix (small): in LiveBoard, show marks younger than `UNASSIGNED_ISSUE_AFTER_MS` as "com o cronometrista · há N s"
without the form. That matches the 60 s threshold of the Review's `unassigned` issue and the phone's burst. Add a test.

**I4. Rotating the link (or unticking "Link ativo") during the race takes MARCAR away from every phone. The confirm
says registered timekeepers carry on.**
`TimingTab.tsx:62` says "Os cronometristas já cadastrados continuam ativos". On the phones, `tk_sync` with the old
token fails "Link … inválido" → `setPhase('invalid')` (useTimekeeper.ts:413; the same at open, :254). That phase is
terminal: no retry and no poll. Its screen (TimekeeperPage.tsx:121-136) has no MARCAR button, so crossings in the gap
are not recorded at all. Opening the new link does not keep the identity: the registration is keyed by token
(useTimekeeper.ts:33,176). The volunteer types their name again and becomes a new timekeeper. Pending marks are adopted,
but marks already synced and still unassigned are orphaned (they end up as pendências for the organizer), and their older
marks can no longer be edited from the phone. After "Link ativo" is ticked again, phones stay on "Link inválido" until
someone reloads them.
Fix: (a) correct the confirm copy, e.g. "Os aparelhos com o link atual param de marcar até abrirem o novo link"; (b) in
`invalid` with a registration, keep polling `tk_open` every ~10 s and add "Tentar novamente" (this also covers
re-enable); (c) preferably key the device registration by event id so that a new link of the same event keeps the same
`timekeeper_id`/`secret`. `tk_sync` already accepts the new token with the old identity, so nothing is adopted or
orphaned. Consider keeping MARCAR available (outbox only) while the link is invalid.

### Minor

- **m1. Assignment toasts cover the lower "Em prova" rows** (`TimekeeperPage.tsx:265-294`; kit container fixed at the
  bottom, 8 s). A tap there hits the toast instead of the row, and the arrival is lost with no vibration. It can also
  land on "Desfazer": the previous identification is undone and its mark selected as `user`, so the next row tap files
  that old instant on the new entry. On "Trocar perna" it opens a full-screen modal whose backdrop swallows the next
  MARCAR. Consider letting the toast body pass pointer events through (buttons only), a shorter duration, or an inline
  status line on this screen.
- **m2. Only one row press is tracked** (`TimekeeperPage.tsx:240, 406-433`). With two overlapping touches (two thumbs,
  two arrivals), the second pointerdown overwrites `rowPress`, so the first finger's pointerup is ignored and that tap
  is lost. Keep a `Map<pointerId, RowPress>`.
- **m3. The wake lock is never retried** after a refused request (no user activation yet, battery saver) or a system
  release (`TimekeeperPage.tsx:46-76`). Re-request on the first MARCAR/row press and on the sentinel's `release`
  event while visible.
- **m4. The clock trusts a saved offset of any age** (`useClock.ts:28-33`). Spec §7.2 says the offset is saved "com
  data", but `synced_at` is never used: a phone that synced days ago shows "±0,08 s" and no "Relógio não sincronizado".
  Also (B1 `lib/clock.ts`): after a device clock step, a pre-step min-RTT sample keeps winning for up to 10 samples
  (about 3 min). Suggest: treat a saved state older than ~12 h as unsynced for the warning, and drop samples whose
  offset differs from the newest by more than ~1 s.
- **m5. Timekeeper storage is never cleaned across events** (`useTimekeeper.ts:32-41`: session, marks cache at about
  0.5 KB per mark, outboxes, aside, registrations per token/event). After a few events on the same phone the quota
  fills and the *current* outbox falls back to memory. The header warns, but a reload then loses marks. Prune other
  events' `ebc.tk.*` keys whose outboxes have nothing pending when a session opens.
- **m6. Acks can stall on a slow link** (`useTimekeeper.ts:396-402` + `tk_sync` returns the whole delta since the last
  success). After a long offline gap on weak 4G, the 15 s timeout can keep cutting the response. The server has stored
  the marks, but the phone stays "Sincronizando N…", never learns other timekeepers' marks or wave starts, and keeps
  re-sending. Cap the delta server-side (limit + cursor) or push marks with a far-future `since` first.
- **m7. Rejections never clear** (`useTimekeeper.ts:645`, header :568-572). A mark rejected as "Alterada pela
  organização" stays counted forever, and "Reatribuir" is rejected again. Identical placements are rejected only
  because `admin_update_mark` leaves the old `athlete_id` in place (area A's deferred T6 minor). Suggest that A set
  `athlete_id` to the leg's athlete when entry or leg changes, and that the phone stop counting a rejected item once
  the server copy exists.
- **m8. Organizer live views go stale silently** (`useEventData.ts:125-127` swallows poll errors). Show "dados de
  hh:mm:ss — sem conexão" when the last successful poll is more than ~10 s old.
- **m9. "Largar agora" on a wave that already started overwrites its start with the same confirm copy**
  (`WavesPanel.tsx:47-55`) and leaves no trace of the old value. Say "Esta onda largou às 08:00:00.0 — substituir?"
  and offer Desfazer with the previous time.
- **m10. CrossingEditor "Mover" ignores the leg select when a bib is typed and never says where the mark went**
  (`CrossingEditor.tsx:99-129`). The tool meant to fix a misfile can create one. Honour an explicitly chosen leg and
  toast the destination.
- **m11. Finalize only informs about entries still on course** (`ResultsTab.tsx:44-49`). Spec §8 says "ao finalizar,
  sugerir DNF". Offer "Marcar N como DNF" in the confirm.
- **m12. Copy:** decimal point instead of comma in `ReviewTab.tsx:225` ("3.5 s") and `CrossingEditor.tsx:226`
  ("+0.3 s"), while the domain writes "3,5 s". Also "(s)" plurals in `ResultsTab.tsx:40-45,131` ("erro(s)",
  "atleta(s)", "pendência(s)").
- **m13. `exportWorkbook` revokes the blob URL right after `click()`** (`exportWorkbook.ts:22-30`). Some Safari/iOS
  versions then abort the download. Revoke in a `setTimeout` of a few seconds.
- **m14. Review issues without a leg** (`no_start`, `not_finished`) have no action (`ReviewTab.tsx:146-159`). Link
  `no_start` to Cronometragem › Largadas.

## Interfaces with other areas (for the combined fix dispatch)

- **A:** `admin_update_mark` should refresh `athlete_id` (m7). Unbounded `tk_sync`/`admin_live` deltas (m6). No
  finalized guard on mark and resolution edits: I2 prefers a UI fix, and rejecting late timekeeper marks would be
  worse. `admin_rotate_tk_token` keeps timekeeper rows valid, which enables I4(c).
- **B1:** `ClockSync` sample window vs device clock steps (m4). `Outbox` versions are `Date.now()` values, so two edits
  and a send in the same millisecond would collide (declined, below). The workbook Resumo "Concluintes" counts
  finished-without-start (T15 minor, B1's triage); the Results tab does not.
- **C:** kit Toast placement on the timekeeper screen (m1). `classificationFromResults` should move out of
  PublicEventPage for I2. The Modal backdrop swallowing the MARCAR tap is part of m1.

## Minors triage (entries of final-review-minors.md in area B2)

- T13 (l.65) "overlapping in-flight syncs could mis-ack": **resolved, no action**. The T22 loop is single-flight
  (useTimekeeper.ts:195, 392) and acks/rejections are version-checked. The `effective()` part is B1's.
- T17 (l.177) poll errors swallowed / EventLayout ignores error after first load: **fix before production**. It is cheap,
  and a frozen board on race day is invisible (m8). refetchOnWindowFocus refetch: **defer** (harmless). Password,
  "Revisão2" name, session tests: area C.
- T22 (l.253) see-through toasts: **resolved** (dac40ba, opaque tones). Two tabs overwriting outboxes: **resolved** by
  Ruling 45 (browsers without Web Locks keep the old risk → defer).
- T22 (l.259) per-second recompute/re-render + outbox rewritten on empty batches: **defer**. Bounded: about 300 rows/s
  plus two outbox writes every 2 s of about 200 KB. Nested role=alert in role=status: **defer**. Outbox never prunes:
  **defer** (bounded per event; see m5 for across events). Real-device pointer/VoiceOver/wake-lock checks: **fix before
  production as a process step**: a 10-minute smoke test on one real Android and one iPhone (MARCAR keeps the
  keyboard, row tap, VoiceOver double-tap marks once, screen stays on).
- T22 (l.304) Web Lock kept in `invalid`: **defer** (recoverable; revisit if I4(b) changes the invalid phase). Tappable
  "✓ marcada por você" row: **defer** (flagged duplicate, never in the median).
- T22 (l.318) Restaurar of a set-aside discard; `none` not persisted; `app` selection outside burst shown "Selecionada";
  no visible target in `none`: **defer all**. After a reload `auto` behaves like `none` because set-aside ids persist,
  and in `none` the bib submit falls back to the burst head, which is what FIFO would pick. These are display gaps under
  Rulings 53-55.
- T23 (l.233) re-starting a started wave has the same confirm copy: **fix before production** (m9). It is cheap, and it
  overwrites a running wave's start with no trace. Per-row "Ativo" names: **defer**. No empty state: **defer**.
- T24 (l.208) "Mover" leg ignored with a bib / empty "Mover" no-op: **fix before production** for the first (m10), a
  silent misfile by the correction tool. **Defer** the no-op.
- T25 (l.221) entryLabel vs MemberNames separators, print repeats, redundant null checks: **defer** (cosmetic).
- T28 (l.326) CrossingEditor needs sideways scroll at 1280 px: **defer** (works; a wider modal is cheap later). The bib
  caret over "—" reads "+": **defer** (cosmetic; an empty placeholder fixes it). "Duda · Duda" subtitle: **defer**
  (skip the athlete name when `team_size` is 1). The BulkEntryDialog copy and lib.sh workarounds are area C.

## Declined to judge

- The burst/selection rules (Rulings 53-55: FIFO burst, `user`/`app` origins, set-aside). Four scoped rounds settled
  them and they are binding. I only checked that other screens do not break their premise (→ I3).
- The list moving between aim and press. Ruling 22 pinning inserts rows on top at every crossing. The press-to-release
  window is covered (M1) and a misdirected tap is visible in the ✓ toast; this is the accepted Ruling 22 tradeoff.
- Real-device behaviour of `preventDefault` on pointerdown (focus/keyboard), iOS click synthesis, VoiceOver and
  TalkBack activation. Only jsdom and headless Chrome evidence exists; this is the process item in the triage.
- Outbox version collisions (two local edits and a send inside one millisecond, or a backwards device-clock step).
  Practically unreachable, and it is B1's API.
- Marks made before the clock ever synced keep device time and are not re-stamped. Spec §7.2 defines this behaviour.
- Server internals: `now()` as `server_now`, whether 10 s of overlap covers long transactions, and the org_edited
  comparisons. Area A; I only noted interfaces.
- Organizer-side performance: one 500 ms timer per LiveBoard row and about 900 CrossingRows re-rendered per changed
  poll. It runs on a laptop and is bounded.
- The "Link ativo" toggle re-saves the whole (possibly 2 s stale) event row. It is a lost-update race with the General
  tab within a sub-2-second window, and area C's form.
- Registering needs the network, so a device can't mark on its very first offline open. Spec §7.1 requires
  `tk_register`.
- Deactivating a timekeeper blocks their pending uploads. It is a deliberate organizer action, and the phone keeps the
  marks.
- A deploy that changes RPC signatures mid-event: deployment process, not code (Ruling 26 keeps old clients running
  the old build).
- bfcache with held Web Locks: Chrome makes such pages ineligible, and behaviour elsewhere is browser-specific.
- Infrastructure errors (for example an invalid API key) would show English server text in "Erro ao sincronizar".
  Not reachable in normal operation.
- Durations floor to the second in tables, so rows with different ms show the same second. This is standard, and it is
  B1's `format.ts`.
- The phone's "Em prova" uses medians and ignores organizer resolutions. `tk_sync` carries no resolutions by design
  (spec §6).

## Recommendations

1. Fix I1 (a one-line key plus a test) and I3 (a filter plus a test) first. Both are cheap and close misfile paths.
2. I4: fix the copy and add the invalid-phase retry now; key the registration by event if the fix round has room.
   Until then, the pre-event checklist should say "não gere novo link durante a prova".
3. I2: render finalized races from the snapshot and add a drift banner. This is the only moderately sized change.
4. Take the three "fix before production" triage items (m8 stale indicator, m9 re-start copy, m10 Mover) in the same
   dispatch. m1 and m2 are worth doing while TimekeeperPage is open.
5. Run the real-phone smoke test (Android and iPhone, 390 px class) before the first event.

## Assessment

**Ready for production: With fixes.**
The critical path is sound: the outbox, single-flight sync with version-checked acks, and tap capture on
pointer/keyboard. I found no path where a MARCAR tap on a working link is lost or duplicated. The four Important
issues are cross-screen integration gaps the per-task reviews could not see:
- two organizer actions can misfile crossings: I1 through index keys, I3 through fresh-mark quick-assign;
- the "official" results the organizer sees and exports can silently differ from what is published (I2);
- a link rotation that the UI calls safe stops every phone from marking (I4).

All four have small or moderate fixes and none needs a data-model change. After they are fixed, together with the
three triage items marked "fix before production", area B2 is ready.
