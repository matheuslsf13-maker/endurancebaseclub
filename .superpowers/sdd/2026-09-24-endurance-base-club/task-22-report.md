# Task 22 report: Timekeeper app (`#/c/:token`)

**Status: DONE_WITH_CONCERNS** (all gates green; the concerns are outside my files, see the end)

- Branch `task/22` in `/home/user/ebc-wt/t22`, base `bae2379`.
- Commits:
  - `d7250c4` feat(timekeeper): offline-first timekeeper app with synced clock
  - `61ed433` Merge branch 'feat/ebc-app' into task/22. The controller asked for this merge; it was clean, with no conflicts.
  - `e0882f9` fix(timekeeper): readable status and toasts on a 390 px phone. These fixes came from the browser check on the merged tree.
- Files changed (`git diff bae2379..HEAD`, my files only): `index.html` (theme bootstrap only), `src/features/timekeeper/TimekeeperPage.tsx` (replaces the stub), and 4 new files: `tkStore.ts`, `tkStore.test.ts`, `useTimekeeper.ts`, `timekeeper.test.tsx`. Total: 2423 insertions, 3 deletions.

## What was implemented

### `src/features/timekeeper/tkStore.ts` (pure, 19 unit tests)

**The brief's functions**

- **`localToMarkRow`**: `discarded_by` is `'timekeeper'` when discarded, `created_at` is `ts`, and `updated_at` is the ISO time of `local_updated_at`.
- **`mergedMarks`**: the server copies, where only a **pending** local item overrides the server copy (Ruling 27), plus local marks the server has not returned yet.
  - A **rejected new mark that the server never stored is left out.** It does not exist for the event, so it must not create crossings or suggestions. It stays listed with ⚠ and its reason in "Minhas marcações".
- **`newMark`**: `ts` is `nowMs`, `device_ts` is the device time, and `clock_offset_ms`/`clock_rtt_ms` come from `ClockState` (null when the clock never synced). The id comes from `crypto.randomUUID()`, with a v4 fallback built from `getRandomValues`. This matters because `randomUUID` exists only on https or localhost, and a phone opening the dev server over the LAN must still be able to mark.
- **`assignMark`**: calls `suggestLeg` with the marks **excluding the mark itself**.
- **`assignmentMessage`**: uses Ruling 8 wording exactly:
  - `✓ Nº 101 · Matheus · fim da perna 2/2 (Corrida)`
  - `Nº 101 já concluiu — registrada como fim da perna 2/2 (Corrida)`

**Ruling 22: `onCourse(session, marks, nowMs)`**

- Lists entries that are `on_course` (their wave started, or a crossing is already known), sorted by leg time, longest first.
- An entry whose **latest crossing median** is inside `same_crossing_window_s` is **pinned on top**, most recent first. It stays listed even when finished, until the window closes.
- Each item has `confirm: { leg_index, leg_label, leg_ms, crossing_ms, remaining_s } | null`. `remaining_s` is `ceil` of the time left, at most the window length.
- Other item fields: `displayName`, `legIndex` (null when finished), `legLabel`, `athleteName` (the current leg's member, taken from the names `tk_open` embeds), `legElapsedMs`.
- DNS/DNF/DSQ entries and entries whose wave has not started are left out.

**Extra helpers**

- `markToInput`, `withSuggestion`, `legText`, `memberName`.
- `sessionIndex`: `indexEvent` over the session, with minimal athlete rows built from the member names, because `tk_open` has no athletes list.
- `applyWaveStarts`: returns the same object when nothing changed.

### `src/features/timekeeper/useTimekeeper.ts`

**Storage keys**

- Session: `ebc.tk.session.<token>`
- Registration: `ebc.tk.reg.<token>` = `{timekeeper_id, secret, name}`
- Server marks cache: `ebc.tk.marks.<eventId>` = `{server_now, marks}`
- Outbox: `ebc.tk.<eventId>.<timekeeperId>`
- Stored values are shape-validated when read, so corrupted storage cannot crash the page.

**Phases** (`loading | invalid | register | main | disabled`)

- With a cached session the page opens **immediately** (`main`, or `register` if not registered yet), and `tk_open` refreshes it in the background. A phone reloading without signal never sits on a spinner.
- Without a cache: `loading`, retried every 5 s, with a "Tentar agora" button.

**Clock**

- Uses the app-wide `useClock()` singleton from Task 17. It already does exactly the brief's `takeSample(api.serverTime)` schedule (5 samples, then every 20 s, and again when the page becomes visible) and saves to `ebc.clock`.
- A second clock implementation would duplicate that code and could disagree with the admin screens.

**Sync loop**

- Single-flight across effect runs: an `inFlight` ref, and ticks triggered by the `online` or visibility events while a request is out only reschedule.
- Runs every 2 s. After a failure the delay doubles, up to 10 s, and resets on success.
- Sends `outbox.pending(200)` (oldest first) with `since` = last `server_now` − 10 s, or null the first time.
- Applies `accepted`/`rejected`. Marks in neither list stay pending and are sent again (Ruling 28).
- Merges the returned marks with `mergeById`, and saves the cache only when a mark actually changed.
- Applies the wave `start_at`s, and re-opens the session (single-flight) when `version` changes.
- Pauses while the page is hidden and resumes immediately when it is visible. The browser's `offline` event sets offline at once; `online` syncs at once.
- The first tick runs immediately on entering `main`.

**Errors**

- `Cronometrista não autorizado`: drops the registration and goes to `register`.
- `Seu acesso foi desativado…`: goes to `disabled`, with a "Tentar novamente" button.
- `Link de cronometragem inválido…`: goes to `invalid`.
- `code === 'network'`: offline, with backoff. This includes Ruling 34's timeout error.
- Any other error: shown in a banner ("Erro ao sincronizar: … — tentando de novo"), with backoff.

**Actions** (all synchronous, reading and writing the outbox directly)

- `mark(bibText?)` reads `clock.now()` **as its first statement**, stores the unassigned mark, then assigns it by bib with **`planBibAssignment` (Ruling 2)**. The mark is stored before assigning, so a tap survives any failure in the assignment step.
- The other actions: `assign(markId, entryId, athleteId?)` (via `assignMark`), `assignBib`, `changeLeg`, `unassign`, `discard`, `restore`, `register`, `retry`.
- Returned state:
  - status: `phase`, `session`, `index`, `registration`, `clock`, `online`, `synced`, `syncError`, `loadError`, `pendingCount`, `rejectedCount`, `clockQuality` (rtt/2 in ms, or null), `nowMs` (1 s tick)
  - lists: `marks`, `unassigned` (mine, not discarded, no entry, oldest first), `myMarks` (the outbox state for each mark, newest first), `onCourse`

**Keeping marks across registrations (not in the brief)**

- The device keeps a list of its outboxes per event (`ebc.tk.outboxes.<eventId>`). On a new registration, marks still pending under an earlier registration of the same event are copied into the new outbox and sent.
- This covers "Cronometrista não autorizado" and a rotated link. Without it, offline marks would be stranded under a dead key.
- Adopted outboxes leave the list, so their marks are never picked up twice.

### `src/features/timekeeper/TimekeeperPage.tsx`

**Screens**

- Keyed by token. The `register`, `invalid`, `disabled` and `loading` screens show the brief's pt-BR texts.
- `main` layout:
  - A sticky header with the event name, `tk-sync-status` and the theme toggle. The status texts are the brief's: "Online · tudo sincronizado" / "Sincronizando N…" / "Sem internet · N marcações guardadas no aparelho" (singular for 1), and "Conectando…" before the first sync.
  - `tk-clock` with tenths, refreshed every 100 ms in its own component so the rest of the page does not re-render. Below it, "Horário de Brasília · ±0,05 s" or "Relógio não sincronizado".
  - `bib-input` (`inputMode="numeric"`, large) and `bib-submit`.
  - `mark-button`: at least 35vh tall, full width, vibrates 50 ms.
  - The `unassigned-list`, `oncourse-list` and `my-marks` lists described below, plus the "Trocar perna" sheet (the kit's Modal).
- Wake lock is requested in `main` while the page is visible and re-requested when it becomes visible again; failures are ignored.

**MARCAR records on `pointerdown`**

- This records the instant the finger lands, and a tap that turns into a slight drag still counts.
- The click from the same press is ignored. Keyboard presses (`detail 0`) and clicks without a pointerdown still mark.
- The button has `touch-action: none`, so it can never start a scroll that cancels the tap.

**Ruling 21**

- `index.html`: the bootstrap chooses light when nothing is saved and the hash starts with `#/c/`.
- The page also sets light when nothing is saved, which covers arriving by in-app navigation, and restores dark on unmount if still nothing is saved. A saved choice always wins, and the toggle saves.

**Lists**

- **`unassigned-list`**: tap to select or deselect (`aria-pressed`), × to discard with a Desfazer toast.
- **`oncourse-list`**:
  - A search box (bib or name, accent-insensitive, member names included) and race filter chips (shown when there is more than one race).
  - Each row shows the Nº, the name or team (plus the race when there are several), the current athlete with "Perna k/N · rótulo", and the running leg timer.
  - A pinned row shows `✓ <rótulo> <tempo da perna> — toque para confirmar (Ns)`.
  - A header line says what a tap will do.
- **`my-marks`** (`<details>`): time, Nº with leg or "Sem atleta" / "Descartada", and the state (⏳ pendente / ✓ sincronizada / ⚠ rejeitada with the reason). Buttons: Perna, Reatribuir, Descartar, and Restaurar (only for marks discarded by the timekeeper).

**Assignment toast** (`assign-toast`)

- Shows the message, the bib warning (DNS/DSQ) when there is one, and "Marcação das hh:mm:ss.d".
- `toast-undo` "Desfazer" unassigns the mark and selects it; `toast-change-leg` "Trocar perna" opens the leg sheet.
- A new assignment toast replaces the previous one.

## Decisions the brief doesn't spell out

1. **Which mark is selected.**
   - The selection follows the user's explicit tap when there is one. Otherwise it is the **oldest** mark in "Sem atleta".
   - MARCAR without a bib selects the new mark only when nothing is selected, so a burst keeps the oldest selected.
   - Why: after 4 arrivals, bibs typed in arrival order (or 4 row taps) must go to marks 1, 2, 3, 4. The spec's literal "the new mark becomes selected" would send the first bib to the 4th mark, which is the wrong time.
   - After a MARCAR whose bib failed, that mark is selected explicitly, so the corrected bib goes to it and not to an older waiting mark.
   - Deselecting (tapping the selected mark) makes "Em prova" taps mark new arrivals again. The Em prova header always says which mark a tap will use.
   - Tested, including a check that the bib-failure selection test fails without the fix.
2. **Tapping a pinned confirm row while a mark is selected assigns the selected mark.** That mark has the accurate crossing time; a new mark "now" would be late. With no selection, the tap records a new mark now. Either way `suggestLeg` returns `same_crossing` on the same leg.
3. **Ruling 10:** rows never pass `athleteId`. The pinned relay handoff test shows Beto running leg 2, yet the confirmation is filed on leg 0 for Ana.
4. **`tk_open` → `invalid` only for the link error** (P0001, or the "Link de cronometragem inválido" message). The brief says "non-network ApiError → invalid". I narrowed it so that a transient server failure (5xx, a paused Supabase project) does not tell volunteers their link is dead. Such failures are retried; with a cache the page stays usable and shows the error.
5. **Shown in the main screen when there is more than one:** the race name in each Em prova row and the race filter chips.

## Tests

**`tkStore.test.ts`: 19 tests, all passing.** They cover:

- **The brief's Step 1 cases:**
  - `mergedMarks` prefers a pending edit over the server copy and keeps synced server marks.
  - `assignMark` on the relay with the second member returns leg 1.
  - `onCourse` lists the relay with the second member and `legElapsedMs = now − leg0`.
  - Both message forms.
  - `newMark` stamps `ts` and `clock_offset_ms`.
- **Ruling 27:** the server copy wins over a rejected local edit.
- Local marks the server has not returned yet are merged in, and rejected new ones are left out.
- The uuid fallback.
- The mark itself is excluded from its own suggestion.
- A confirming mark from a second timekeeper lands on the same leg.
- **Ruling 22 (the required unit tests):**
  - pinned ordering;
  - a finished entry is kept during the window and dropped after;
  - remaining seconds (20 at 10.2 s, 1 at 29.999 s, gone at 30 s);
  - started entries only.
- `sessionIndex` and `applyWaveStarts`.

**`timekeeper.test.tsx`: 41 tests, all passing.** API mocked with `vi.mock`, a per-test fake-timer clock replaces `useClock`. They cover:

- **The brief's Step 2 cases:**
  - Registering shows the main screen.
  - `mark-button` adds a row to "Sem atleta".
  - `101` plus `bib-submit` shows `assign-toast` with `Nº 101`, and `toast-undo` sends the mark back.
  - After the sync interval the status reads "tudo sincronizado".
  - A network error shows "Sem internet".
- **Sync loop:**
  - The `ts` equals the fake clock at the moment of the click while the sync request is slow.
  - Never two requests in flight, even when `online`/visibility events fire mid-request.
  - At most 200 marks per request.
  - Backoff after 4 s, 8 s and 10 s, then a return to 2 s after success.
  - `since` with the 10 s overlap.
- **Rapid taps:** 4 taps give 4 rows, oldest first and selected, and the bib goes to the oldest.
- **One mark per press:** a real `userEvent` click (pointerdown plus click) and a keyboard Enter each record exactly one mark.
- **Rulings 22 and 10:** the pinned handoff counts down 25s → 15s → 1s → gone, and tapping it files the mark on leg 0 with athlete a2. A finished entry stays pinned, then is dropped.
- **Ruling 27:** the rejected mark shows ⚠ with "Alterada pela organização" and the server's Nº 303.
- **Ruling 28:** a mark the server neither accepted nor rejected stays ⏳ and is sent again.
- **Phases and session:**
  - The hidden page pauses and resumes.
  - A version change re-opens the session and wave starts are applied.
  - The disabled screen.
  - "Não autorizado" drops the registration, and the new registration re-sends the pending mark.
  - The invalid link screen; retrying without a cache; offline with a cache.
- **Screen features:** vibrate 50 ms; wake lock (request, failure ignored); the clock with ±0,05 s and the "not synced" warning.
- **Other UI:** search and race chips; Trocar perna; discard and Desfazer; the DNS warning; asking for a mark first.
- **Ruling 21:** the page is light by default and a saved dark theme is kept. The real `index.html` script is run for `#/c/…`, `#/eventos` and saved choices.

**Mutation checks.** I applied each mutation to the finished code, ran the tests, and restored the file.

- Caught: the mark stamped with the device clock (10 tests fail), a rejected edit overriding the server copy, no backoff, no batch cap, no `since` overlap, the pinned rows not first, the bib-failure selection fix removed.
- The single-flight guard mutant was missed at first: nothing re-triggered a tick during a slow request. I strengthened the test and it is caught now.
- "Pass the row's athlete (Ruling 10)" survives and is **equivalent**: since Task 10's fix, `suggestLeg`'s same-crossing step ignores `athleteId`, and in the next-leg step the row's current athlete owns the next leg. The code never passes it anyway.

## TDD evidence

- **RED 1:** `npx vitest run src/features/timekeeper/tkStore.test.ts` gave `Error: Failed to resolve import "./tkStore" … Does the file exist?`
- **GREEN 1:** `Tests 18 passed (18)`. `applyWaveStarts` was then added test-first: RED `1 failed | 18 passed (19)`, GREEN `19 passed (19)`.
- **RED 2:** `npx vitest run src/features/timekeeper/timekeeper.test.tsx` gave `Tests 37 failed | 1 passed (38)`. The one pass was "always honors a saved choice", which the old `index.html` already did.
- **GREEN 2:** `Test Files 2 passed (2) · Tests 57 passed (57)`. After the 3 added tests: `60 passed (60)`.
- **Bug fix (bib failure → selection):** the new test fails without the fix (`× after a mistyped bib…`) and passes with it.

## Gates

**On base `bae2379`, before committing**

```
npx vitest run     → Test Files 1 failed | 26 passed (27) · Tests 1 failed | 347 passed (348)
                     the only failure: eventShell.test.tsx "/c/tok123 renders TimekeeperPage" looks for the
                     stub text "TimekeeperPage", which this task replaces. It is the Task 17 test, not my file;
                     feat/ebc-app replaces every page with a marker there, so the merge resolves it.
npm run typecheck  → clean
npm run build      → ✓ built (index-*.js 638 kB)
```

**On the merged tree (`61ed433` + `e0882f9`)**

```
npx vitest run     → Test Files 32 passed (32) · Tests 431 passed (431)   (no act() warnings, no console noise, no unhandled rejections)
npm run typecheck  → tsc --noEmit -p tsconfig.json, clean
npm run build      → dist/assets/index-BW7dRHAd.js 711.65 kB │ gzip 208.61 kB · ✓ built in 547ms
                     (only the >500 kB chunk warning, as before)
```

**Browser check**

- `agent-browser` against the dev server on a private port, with a cached session and no backend, so this also exercised "opens offline from cache".
- At 390×844 in light and dark themes, and at 1280×800: no horizontal page scroll; MARCAR is about 35vh; the pinned handoff row and the next athlete render correctly.
- It found three problems, fixed in `e0882f9`:
  - The offline status was truncated ("Sem internet · 2 marcações …"). It now wraps.
  - The kit's tinted toast tones are see-through: page text showed through in dark mode.
  - Two kit actions squeezed the assignment message into a column about 110 px wide.
- For the toasts, the assignment and error toasts now use the opaque neutral tone, with the actions as buttons under the message (same test ids). Errors keep `role="alert"` on their content.

## Self-review

- Every Test ID in my scope is present: `tk-name`, `tk-register`, `tk-clock`, `tk-sync-status`, `mark-button`, `bib-input`, `bib-submit`, `unassigned-list`, `oncourse-list`, `assign-toast`, `toast-undo`, `my-marks`.
- I walked through the T28 E2E flow. The handoff toast contains "Natação", and "Em prova" then shows the team on "Corrida". Offline gives "Sem internet" at once through the `offline` event, and back online gives "sincronizado" through `online`. A reload while offline goes straight to `mark-button` from the cache.
- Every displayed time goes through `formatClock`/`formatDuration`, with tabular numbers. The UI is pt-BR; code and comments are English. There are no new dependencies and no `Date.now()` race times (`device_ts` is audit data only).
- I edited only the Files block and the one `index.html` line group.

## Concerns (none blocking)

1. **Kit toasts (Task 16, `src/components/ui/Toast.tsx`, not my file).**
   - `TONE_CLASSES` for success, warning and danger are only translucent tints (`bg-success/15` and so on), with no opaque base, so content shows through every tinted toast on every screen, badly in dark mode.
   - The action row (`shrink-0`) squeezes the message on phones.
   - Suggested fix: an opaque `bg-surface` base under the tint, and wrapping the actions below the message on small screens. I worked around both inside my page only.
2. **Two tabs of the same timekeeper link on one device** would each keep their own in-memory `Outbox` and overwrite each other's localStorage. Each tab still sends its own marks, but after a reload only the last writer's list remains. Detecting a second tab (a storage event or BroadcastChannel) is out of scope and worth a follow-up.
3. **Bundle:** the merged build is still a single 711 kB chunk. The Ruling 30 route splitting did not show up in this build output. Worth checking that Task 27's `React.lazy` is in `App.tsx`, since the timekeeper page is the one phones load at the trackside.
4. **Rejected marks stay counted** in the header warning until edited. This is deliberate: the timekeeper should see that the organization changed or refused them.
