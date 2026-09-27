## Task 22: Timekeeper app (`#/c/:token`) — the critical screen

**Files:**
- Modify: `src/features/timekeeper/TimekeeperPage.tsx`
- Create: `src/features/timekeeper/tkStore.ts`, `src/features/timekeeper/tkStore.test.ts`, `src/features/timekeeper/useTimekeeper.ts`, `src/features/timekeeper/timekeeper.test.tsx`

**Interfaces:**
- Consumes: `api.tk.*`, `api.serverTime`, `ClockSync`/`takeSample`, `Outbox`, `safeLocalStorage`/`readJSON`/`writeJSON`, `suggestLeg`, `computeEntryTiming`, `resolveBib`, `indexEvent`, `entryDisplayName`, `mergeById`, `formatClock`, `formatDuration`, `MODALITY_LABEL`, UI kit (`useToast`).
- Produces (`tkStore.ts`, pure and unit-tested):
  - `localToMarkRow(m: LocalMark, eventId: string, timekeeperId: string): MarkRow` (`discarded_by` = `'timekeeper'` when discarded, `created_at` = ts, `updated_at` = ISO of `local_updated_at`).
  - `mergedMarks(server: MarkRow[], local: OutboxItem[], eventId, timekeeperId): MarkRow[]` — server marks plus local ones; a local item that is `pending` overrides the server copy.
  - `newMark(nowMs: number, deviceNowMs: number, clock: ClockState | null): TkMarkInput` (`id` via `crypto.randomUUID()`).
  - `assignMark(mark: TkMarkInput, entry: EntryRow, race: RaceRow, allMarks: MarkRow[], athleteId?: string | null): { mark: TkMarkInput; suggestion: LegSuggestion }` (uses `suggestLeg` with `allMarks` excluding the mark itself).
  - `onCourse(session: TkSession, marks: MarkRow[], nowMs: number): { entry: EntryRow; race: RaceRow; timing: EntryTiming; legLabel: string; athleteName: string; legElapsedMs: number }[]` — entries whose timing status is `on_course` (wave started), sorted by `legElapsedMs` desc.
  - `assignmentMessage(entry, race, suggestion, athleteName): string` → `✓ Nº 101 · Matheus · fim da Corrida (2/2)`; with `warning 'already_finished'` → `Nº 101 já concluiu — registrada como fim da Corrida (2/2)`.

`useTimekeeper(token)` responsibilities (spec §7): cached session `ebc.tk.session.<token>`; registration `ebc.tk.reg.<token>` = `{timekeeper_id, secret, name}`; server marks cache `ebc.tk.marks.<eventId>`; outbox key `ebc.tk.<eventId>.<timekeeperId>`; phases `loading | invalid | register | main | disabled`; `tk.open` failure with a non-network ApiError → `invalid`; network failure with cache → `main` offline; clock sync via `takeSample(api.serverTime)` (5 samples at start, every 20 s, on `visibilitychange`); sync loop every 2 s (backoff ×2 up to 10 s on network errors) sending `outbox.pending(200)` with `since = lastServerNow − 10 s`, applying `accepted/rejected`, merging returned marks, updating wave `start_at`s, re-opening the session when `version` changes; `Cronometrista não autorizado` → drop registration → `register`; `Seu acesso foi desativado…` → `disabled`. Actions: `mark(bibText?)`, `assign(markId, entryId, athleteId?)`, `changeLeg(markId, legIndex)`, `unassign(markId)`, `discard(markId)`; state: `online`, `pendingCount`, `clockQuality` (ms or null), `unassigned` (my non-discarded marks without entry, oldest first), `myMarks`, `onCourse`, `session`.

UI (`TimekeeperPage`, mobile-first, no admin `Layout`):
- `register`: logo, event name/date, name input `tk-name`, button `tk-register` "Começar a cronometrar".
- `main`: sticky header with event name, `tk-sync-status` ("Online · tudo sincronizado" / "Sincronizando N…" / "Sem internet · N marcações guardadas no aparelho"), theme toggle; big clock `tk-clock` (`formatClock(clock.now(), {tenths:true})`, refreshed every 100 ms) with quality `±0,05 s` or warning "Relógio não sincronizado"; bib input `bib-input` (`inputMode="numeric"`, large) + `bib-submit`; **MARCAR** button `mark-button` (≥ 35 vh tall, full width, vibrate 50 ms).
  - MARCAR with a bib typed → mark + assign (errors from `resolveBib` shown as toast; the mark stays in "Sem atleta"); without bib → unassigned mark, selected.
  - `bib-submit`: assigns the selected unassigned mark (or the oldest one) to the bib; with none → toast "Toque em MARCAR primeiro".
  - "Sem atleta" list `unassigned-list` (select on tap, discard ×).
  - "Em prova" list `oncourse-list`: search box, race filter chips, rows (`Nº`, name/team, current athlete and leg label, running leg timer); tapping a row assigns the selected mark, or — if none is selected — creates a mark now and assigns it (arrival tap).
  - Assignment toast `assign-toast` with actions `toast-undo` ("Desfazer" → unassign) and "Trocar perna" (sheet listing legs).
  - "Minhas marcações" `my-marks` (collapsible: time, Nº, leg, state icon, discard/reassign).
  - Wake lock: request `navigator.wakeLock.request('screen')` in `main` phase when visible; ignore failures.
- `invalid`: "Link de cronometragem inválido ou desativado. Peça um novo link à organização." `disabled`: "Seu acesso foi desativado pela organização."

- [ ] **Step 1: Failing `tkStore.test.ts`** using domain fixtures: `mergedMarks` prefers a pending local edit over the server copy and keeps synced server marks; `assignMark` on a relay entry with a `athleteId` of the second member returns `leg_index 1`; `onCourse` lists a relay whose leg 0 was marked, with `athleteName` of the second member and `legElapsedMs = now − leg0`; `assignmentMessage` produces both message forms; `newMark` stamps `ts = nowMs` ISO and `clock_offset_ms`.
- [ ] **Step 2: Failing `timekeeper.test.tsx`** (mock `api.tk.open` → session fixture, `api.tk.register`, `api.tk.sync` → `{accepted: ids, rejected: [], marks: [], waves: [], version: 1, server_now}`, `api.serverTime`): register flow shows the main screen; clicking `mark-button` adds a row to `unassigned-list`; typing `101` + `bib-submit` shows `assign-toast` containing `Nº 101`; clicking `toast-undo` returns the mark to `unassigned-list`; after the sync interval (fake timers) `tk-sync-status` shows "tudo sincronizado"; when `api.tk.sync` rejects with a network ApiError, status shows "Sem internet".
- [ ] **Step 3:** FAIL. **Step 4:** implement. **Step 5:** PASS + typecheck. **Step 6: Commit** (`feat(timekeeper): offline-first timekeeper app with synced clock`).

---

