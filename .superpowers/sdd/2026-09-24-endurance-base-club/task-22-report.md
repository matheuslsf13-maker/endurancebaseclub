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

## Fix round 1

**Status: DONE_WITH_CONCERNS.** All gates are green. The concerns are design trade-offs and pre-existing library behaviour, listed at the end.

- **Worktree:** `C:\ENDURANCE\ebc-wt\t22`, branch `task/22`, base `e70ed55`.
- **Commit:** `5342738` fix(timekeeper): burst-scoped auto-selection, robust taps, per-tab lock
- **Scope:** the review's Important 1, the Ruling 44 minors (★1 M1, ★2 M2, ★3 M3, ★5 M5, ★6 M6, ★7 M7, ★8 M8, ★10 M10), Ruling 45 (★4), and the matching test gaps from review item 12.
- **Not done, as instructed:** M9 (performance), M11 (nested live regions), outbox pruning.
- **Files changed:** only the brief's Files block plus the granted `outbox.ts`/`outbox.test.ts` and `storage.ts`/`storage.test.ts`.

```
src/features/timekeeper/TimekeeperPage.tsx  | 211 ++++++++++-----
src/features/timekeeper/timekeeper.test.tsx | 309 ++++++++++++++++++++-
src/features/timekeeper/tkStore.test.ts     |  58 +++-
src/features/timekeeper/tkStore.ts          |  48 +++-
src/features/timekeeper/useTimekeeper.ts    | 121 ++++++--
src/lib/outbox.test.ts                      |  18 ++
src/lib/outbox.ts                           |   3 +
src/lib/storage.test.ts                     |  14 +-
src/lib/storage.ts                          |   6 +
9 files changed, 711 insertions(+), 77 deletions(-)
```

Line numbers below refer to `5342738`.

### Important 1: one stale unidentified mark took over every later identification

**What changed**

- `tkStore.ts:147-183` adds the selection logic as pure, unit-tested functions:
  - `STALE_UNASSIGNED_MS = 60_000`. This mirrors `UNASSIGNED_ISSUE_AFTER_MS` in consolidation, which is not exported, and `consolidation.ts` is outside my files.
  - `isStale(mark, nowMs)` is true when `now − ts > 60 s`, the same condition that raises the `unassigned` issue.
  - `Selection` is `auto | none | { id, chosen }`.
  - `burstHead(unassigned, nowMs)` returns the oldest mark that is **not** stale.
  - `selectedMarkId(sel, unassigned, nowMs)`:
    - `auto` returns `burstHead`.
    - A `chosen` id (picked by the timekeeper) is kept however old it gets.
    - A non-chosen id (selected by the app) is kept only while it is fresh, then falls back to `burstHead`.
    - `none` returns null.
- `TimekeeperPage.tsx` uses these:
  - **Selection (:245):** computed from `tk.nowMs`.
  - **bib-submit fallback (:361):** `selectedId ?? burstHead(...)`. It never falls back to a stale mark. With only stale marks waiting, the toast reads `Toque em MARCAR primeiro, ou selecione a marcação em "Sem atleta"`. With none waiting, it keeps the brief's exact text.
  - **MARCAR without a bib (:323-327):** selects the new mark when nothing is selected, or when the current selection is stale at the new mark's `ts`. This applies whether the stale mark was picked automatically or chosen. Within a burst of fresh marks, the oldest stays selected, as before.
  - **Explicit selections are `chosen: true`:** tapping a mark in "Sem atleta" (:430), Desfazer (:272), and Reatribuir (:445).
  - **App selections are `chosen: false`:** the new mark after MARCAR, the mark after a failed bib, and a failed row assignment. They leave the selection once stale, so a forgotten mark cannot capture a later "Em prova" arrival tap.
  - **"Sem atleta" rows (:600):** a stale mark reads "Mais de 1 min · tocar para selecionar".
- "Em prova" arrival taps use the same `selectedId`. With only stale marks around, a row tap now records a **new** mark and assigns it.

**Covering tests**

- `timekeeper.test.tsx`:
  - "a mark left without athlete for 2 min does not take the next identification (review Important 1)". This is the review's regression test: a mark 2 min old, then MARCAR, then `101` + bib-submit; the **new** mark gets `en1`.
  - "a bib with only stale marks waiting asks for MARCAR or an explicit pick, and the picked stale mark takes it".
  - "MARCAR selects the new mark when the chosen one is older than the unassigned threshold".
  - "an arrival tap marks now instead of using a mark left without athlete for 2 min".
  - The 4-tap burst test ("stays responsive under rapid taps…") is unchanged and still passes.
- `tkStore.test.ts`:
  - "burstHead is the oldest mark younger than the 60 s unassigned threshold". It includes the exactly-60 s and 60 s + 1 ms edges.
  - "auto picks the burst head; a stale mark is only used when it was chosen explicitly".

**RED** (before the fix). This is the review's trace exactly: the stale mark took `en1`.

```
FAIL timekeeper.test.tsx > marking > a mark left without athlete for 2 min does not take the next identification (review Important 1)
  [ "2026-10-11T11:10:01.500Z",  - null  + "en1" ],
  [ "2026-10-11T11:12:01.500Z",  - "en1" + null  ]
FAIL "Em prova" list > an arrival tap marks now instead of using a mark left without athlete for 2 min
  expected [ Array(1) ] … Received: [ ["2026-10-11T11:10:01.500Z", "en3"] ]   (the stale mark was assigned, no new mark)
FAIL … a bib with only stale marks waiting … → Unable to find an element with the text: Toque em MARCAR primeiro, ou selecione a marcação em "Sem atleta"
FAIL … MARCAR selects the new mark when the chosen one is older … → Unable to find an accessible element with the role "button" (pressed: true)
FAIL tkStore.test.ts > burst selection … → TypeError: burstHead is not a function / selectedMarkId is not a function
```

**Mutation checks** (applied, run, restored):
- `burstHead` without the staleness check: 5 tests fail.
- MARCAR keeping a stale selection (`if (!current)` only): "MARCAR selects the new mark…" fails.

### ★1 (M1): "Em prova" rows move under the finger

**What changed** in `TimekeeperPage.tsx`:

- **On pointerdown (`onRowPointerDown`, :416):** the press captures the entry, the target mark (`selectedId` at that moment), the synced instant (`tk.stamp()`, taken first), the `pointerId` and the coordinates.
- **Window listeners (:392-414):**
  - `pointerup` with the same `pointerId` commits the captured tap (`commitRowTap`, :375) if the finger moved ≤ 16 px (`TAP_SLOP_PX`). It commits wherever the finger is by then, even over another row or none.
  - `pointercancel` drops the press. On touch, a scroll cancels it.
- **A captured target mark that got an athlete meanwhile:** the tap becomes an arrival tap at the captured instant.
- **Row `click` (`onRowClick`, :422):**
  - The click belonging to the press is ignored (`isClickOfPress`, :98: `detail ≥ 1` and within 1 s of the last row pointer event).
  - Keyboard and screen-reader activations (no pointer press) still tap, stamped at the click.
- **Arrival marks are stamped at pointerdown:** `useTimekeeper.ts:499-509` adds `stamp(): TapStamp` (the synced clock is read first) and `mark(bibText?, at?: TapStamp)`, which records at a given stamp. `mark` also returns `ts`.

**Covering tests** (`timekeeper.test.tsx`):
- "an arrival tap is stamped when the finger lands and recorded when it lifts (Ruling 44 M1)": pointerdown, then 120 ms, then pointerup + click. One mark, with `ts` = the pointerdown instant.
- "a row that moves under the finger still gets the tap it was pressed for (Ruling 44 M1)":
  - The finger presses 202 at 1.9 s.
  - The sync at 2.0 s pins 202 on top, so 101 is now under the finger.
  - pointerup lands on 101, and the click goes to the `ul`.
  - One mark, for `en2` leg 0, at the pointerdown instant.
- "a press that turns into a scroll or is cancelled records nothing": a mouse moved 60 px, then a touch `pointercancel`.

**RED**

```
FAIL … an arrival tap is stamped when the finger lands … → - "ts": "2026-10-11T11:10:01.500Z"  + "ts": "2026-10-11T11:10:01.620Z"   (stamped at the click, 120 ms late)
FAIL … a row that moves under the finger … → AssertionError: expected [] to deeply equal [ ObjectContaining{…} ]   (tap dropped)
FAIL … a press that turns into a scroll or is cancelled records nothing → expected [ { …(10) } ] to deeply equal []
```

**Mutation check:** committing with a fresh stamp on pointerup instead of the captured one makes both M1 timestamp tests fail.

### ★2 (M2): MARCAR click dedupe by time; Space; key auto-repeat

**What changed** in `TimekeeperPage.tsx`. The sticky `pointerMarked` flag is gone.

- `onMarkPointerDown` (:334) marks, then records `e.timeStamp`.
- `onMarkPointerUp` (:341) refreshes the timestamp, so a long press's late click is still recognised as its own.
- `onMarkClick` ignores only `isClickOfPress` (`detail ≥ 1` and within 1 s).
- A click with `detail 0` (keyboard) always marks. A pointer press's own click always has `detail ≥ 1`.
- `onMarkKeyDown` (:348) calls `preventDefault()` on repeated Enter/Space keydowns, so holding Enter marks once.

**Covering tests** (`timekeeper.test.tsx`):
- "a press that slid off MARCAR does not swallow a later screen-reader activation (Ruling 44 M2)": pointerdown with no click, then 2 s later a click with `detail 1`. Two marks.
- "Space marks once and holding Enter does not repeat marks (Ruling 44 M2)": user-event `' '`, then `{Enter>4/}`.
- "a long press on MARCAR records one mark": passed already with the flag; it now guards the pointerup refresh.
- The existing "records one mark per real click and per keyboard press" also caught my first cut: without the `detail > 0` condition, an Enter pressed less than 1 s after a click was swallowed.

**RED**

```
FAIL … a press that slid off MARCAR … → AssertionError: expected [ { …(10) } ] to have a length of 2 but got 1
FAIL … Space marks once and holding Enter … → AssertionError: expected [ …(5) ] to have a length of 2 but got 5   (held Enter → 4 marks)
```

### ★3 (M3): rejections apply only to the version that was sent

**What changed:** `outbox.ts:108-111`. `applyResult` skips a rejection when `mark.local_updated_at !== sent_at_version`, the same guard accepted acks already had. An edit made while the request was in flight stays `pending` and goes on the next sync.

I also checked same-millisecond edits. `upsert` replaces the item and so drops `sent_at_version`. An edit therefore never matches the version in flight, even with the same `local_updated_at`, and no versioning change was needed. A characterization test documents this.

**Covering tests**
- `outbox.test.ts`:
  - "ignores the rejection of a version edited while it was in flight: the edit goes next"
  - "keeps an edit made in the same millisecond as the version in flight pending" (passes before and after)
- `timekeeper.test.tsx`: `it.each` "an edit made while its mark is in flight stays pending when the old version is accepted|rejected (Ruling 44 M3)". This is the screen-level gap from review item 12:
  1. A slow sync carries the unassigned version.
  2. `101` is assigned while it is in flight.
  3. The answer arrives.
  4. The mark stays ⏳ with no "Alterada".
  5. The next sync sends `entry_id: 'en1'`.
  6. The mark ends ✓.

  The `accepted` case passed already; the `rejected` case is the RED one.

**RED**

```
FAIL outbox.test.ts > Outbox > ignores the rejection of a version edited while it was in flight → expected 'rejected' to be 'pending'
FAIL timekeeper.test.tsx > sync loop > an edit made while its mark is in flight stays pending when the old version is rejected → expected { mark: { …(10) }, …(2) } to match object { state: 'pending', … }
```

### ★5 (M5): visible warning when the outbox cannot persist

**What changed**

- `storage.ts:66-70` adds `isMemoryOnly(k)`: the key could not be kept in `window.localStorage` and now lives only in the in-memory fallback. The signal has to come from here, because `safeLocalStorage` swallows the failure.
- `useTimekeeper.ts:601` exposes `storageFailed = isMemoryOnly(outboxKey)`.
- `TimekeeperPage.tsx:540` adds a header `role="alert"`: "⚠ Não foi possível guardar as marcações neste aparelho (memória cheia ou bloqueada) — não feche nem recarregue esta página até tudo sincronizar."
- Marking continues in memory.

**Covering tests**
- `storage.test.ts`: "tells which keys only live in memory after localStorage refused them".
- `timekeeper.test.tsx`: "warns in the header when the marks cannot be kept on the device (Ruling 44 M5)".
  - `setItem` throws `QuotaExceededError` for the outbox key only.
  - There is no alert before; it appears after MARCAR, and the row is still listed.
  - The test removes the key's in-memory fallback in `finally`, so later tests are unaffected.

**RED**

```
FAIL storage.test.ts > … → TypeError: isMemoryOnly is not a function
FAIL timekeeper.test.tsx > … warns in the header … → Unable to find an accessible element with the role "alert"
```

### ★6 (M6): the invalid screen says local marks are kept

**What changed:** `TimekeeperPage.tsx:121-133`. When this device has marks for the link, the invalid screen adds a line.
- With marks not yet sent: "Suas marcações continuam guardadas neste aparelho (N ainda não enviada[s]). Abra o novo link neste mesmo aparelho para enviá-las."
  - This advice is accurate: a new registration of the same event adopts pending marks through `ebc.tk.outboxes.<eventId>`.
- Otherwise: "Suas marcações continuam guardadas neste aparelho."
- The brief's sentence is unchanged, and nothing is shown when the device has no marks (for example a mistyped link on first open).

**Covering test:** "the invalid-link screen says the marks stay on the device (Ruling 44 M6)". After a mark, a sync answers "Link de cronometragem inválido…" (P0001). The screen shows both texts, and the outbox still has the mark.

**RED:** `Unable to find an element with the text: /Suas marcações continuam guardadas neste aparelho/`

### ★7 (M7): "Reatribuir" on every rejected mark

**What changed**
- `TimekeeperPage.tsx:754`: `canReassign` is true for any `rejected` mark except one discarded by the organization, which the timekeeper cannot undo. Non-rejected marks keep the old rule (not discarded, with an entry).
- `onReassign` (:442-446) unassigns the mark, restores it if it was discarded locally, and **chooses** it. It then appears in "Sem atleta" as `pending` (`mergedMarks` includes pending local marks), selected even when old.

**Covering test:** "offers Reatribuir on a rejected mark whose entry is gone (Ruling 44 M7)".
1. A pending mark from 5 min ago with `entry_id: 'gone'` is rejected with "Inscrição não encontrada".
2. Reatribuir moves it to "Sem atleta", selected.
3. `303` + Atribuir files it pending on `en3` leg 0.

**RED:** `Unable to find an accessible element with the role "button" and name /Reatribuir/`

### ★8 (M8): "✓ marcada por você" on a crossing this device already marked

**What changed**
- `tkStore.ts:192,248` adds `ConfirmInfo.mine`. `onCourse` takes an optional `timekeeperId` and flags a pinned crossing whose consolidation `candidates` include this timekeeper. Each timekeeper's earliest non-discarded mark of a crossing is a candidate (spec §8), so a discarded mark of mine does not count.
- `useTimekeeper.ts:608` passes the registration id.
- `TimekeeperPage.tsx:700-707` renders `✓ marcada por você · <perna> <tempo>` instead of `— toque para confirmar (Ns)`. The row stays pinned until the window closes, so it does not jump away.

**Covering tests**
- `tkStore.test.ts`:
  - "flags a pinned crossing that has a mark of this timekeeper"
  - "does not flag a crossing only other timekeepers (or discarded marks of mine) marked"
- `timekeeper.test.tsx`: "a crossing this device already marked says so instead of inviting a confirmation (Ruling 44 M8)".
- Updated for the new behaviour:
  - The two existing `onCourse` `toEqual(confirm)` expectations now include `mine: false`.
  - The tail of the relay-handoff test ("pins a fresh relay handoff…") now checks the same window extension through the new text: still pinned 37 s after the first mark, gone at 38 s.

**RED**

```
FAIL tkStore.test.ts > … flags a pinned crossing … → expected { leg_index: +0, …(4) } to match object { leg_index: +0, mine: true }
FAIL timekeeper.test.tsx > … already marked says so … → expected element to have text content "✓ marcada por você" (received "… toque para confirmar (30s)")
```

**Mutation check:** forcing `mine: false` makes 3 tests fail.

### ★10 (M10): MARCAR keeps the focus in bib-input

**What changed:** `TimekeeperPage.tsx:339,483`.
- `onMarkPointerDown` calls `e.preventDefault()` after marking. The click still fires.
- `onMouseDown={e => e.preventDefault()}` is added on the button. On mobile Safari, the compatibility `mousedown` after a tap is what moves the focus.

**Covering test:** "MARCAR keeps the focus (and the phone keyboard) in the bib field (Ruling 44 M10)", with user-event.
1. Focus the bib field and click MARCAR: the bib field is still focused.
2. Type `303` and click MARCAR: the mark is assigned to `en3`, and the field is still focused.

**RED:** `expect(element).toHaveFocus()`; the element with focus was the MARCAR button.

### Ruling 45 (★4): one active tab per timekeeper link and device

**What changed** in `useTimekeeper.ts`:

- **Lock request (:304-351):** `navigator.locks.request('ebc.tk.<eventId>', { ifAvailable: true }, …)`, as the ruling specifies.
  - If the lock is held elsewhere, the hook reports phase `other_tab`.
  - `TimekeeperPage.tsx:137-145` shows "Este link já está aberto em outra aba deste aparelho — use aquela aba", with no marking, no outbox load and no sync.
- **Waiting and takeover:** the hook then queues a waiting request with an `AbortSignal`.
  - When the other tab closes, this tab takes the lock and re-reads the outbox, the marks cache and the registration from storage before timing.
  - This also stops React StrictMode's dev double-mount from leaving the tab stuck on the message (the first mount's release is asynchronous).
- **Pending lock:** until the lock is granted (a few ms), `main`/`register` show the loading screen, and the tab never loads the outbox without the lock (`derived`, :576).
- **No Web Locks support** (insecure origin such as the LAN dev server, older browsers), or the API throwing/rejecting: the app runs as before.
- **Release:** the lock is released on unmount.

**Covering tests** ("one active tab per link and device (Ruling 45)"). They use a fake lock manager with exclusive names, `ifAvailable`, ordered waiting and `signal` abort.
- "holds the Web Lock while open and lets it go when closed": the exact call, held while mounted, released on unmount.
- "does not mark in a second tab, and takes over with what the first one saved when it closes":
  - The message is shown, with no mark button and zero `tk_sync` calls in 10 s.
  - The other tab writes a mark to the outbox and closes.
  - This tab becomes active, lists that mark and sends it.
- Existing tests cover the unsupported case: jsdom has no `navigator.locks`.

**RED**

```
FAIL … holds the Web Lock while open … → expected "vi.fn()" to be called with arguments: [ 'ebc.tk.e1', …(2) ]
FAIL … does not mark in a second tab … → Unable to find an element with the text: Este link já está aberto em outra aba deste aparelho — use aquela aba
```

### TDD evidence (commands)

- **RED:** `npx vitest run src/lib/outbox.test.ts src/lib/storage.test.ts src/features/timekeeper`, run with the new tests and before any implementation:

```
 Test Files  4 failed (4)
      Tests  25 failed | 69 passed (94)
```

  - All 25 failures are the new or updated tests quoted above.
  - The ones that passed at RED, as expected: the in-flight edit whose old version is *accepted*, the long press, and the same-millisecond outbox test.
  - One failure at RED came from a bug in my test (a bib regex that ran into the leg timer). After fixing it, the test failed for the right reason (`expected [] to deeply equal [ ObjectContaining{…} ]`).
- **GREEN** (same command, after the fix):

```
 Test Files  4 passed (4)
      Tests  94 passed (94)      (timekeeper.test.tsx 60 · tkStore.test.ts 23 · outbox.test.ts 8 · storage.test.ts 3)
```

  No act() warnings, no console noise, no unhandled rejections.

### Gates (on `5342738`'s tree, before committing)

```
npx vitest run     →  Test Files  36 passed (36)
                      Tests  529 passed (529)        (baseline 503 + 26 new)
                      no warnings / act() / unhandled rejections in the output
npm run typecheck  →  tsc --noEmit -p tsconfig.json   (exit 0, clean)
npm run build      →  dist/assets/index-BPZzDUV5.js 814.28 kB │ gzip: 238.68 kB · ✓ built in 597ms
                      (only the existing >500 kB chunk warning)
```

### Decisions and concerns

1. **The 60 s rule is the literal fix, and it has a trade-off.**
   - The automatic pick considers only marks younger than 60 s. So in a burst that straddles the threshold, once the oldest mark turns 60 s the pick moves on to the next fresh mark.
   - I considered defining a burst as a chain of marks with gaps under 60 s. That would keep the oldest mark selected, but it would let a forgotten mark ride along with a dense chain of arrivals. Neither rule dominates, so I kept the review's rule.
   - Mitigations:
     - The selected row says "Selecionada".
     - The "Em prova" header names the target mark's time.
     - Stale rows say "Mais de 1 min".
     - Any mark can be picked explicitly.
   - A mark forgotten less than 60 s before the next arrival still takes that arrival's bib. This is inherent to the 60 s window.
2. **Chosen versus app selections.**
   - Only the timekeeper's explicit choices stick past 60 s: a tap in "Sem atleta", Desfazer and Reatribuir. A chosen stale mark still receives an "Em prova" tap; that is the explicit choice.
   - MARCAR replaces any stale selection, including a chosen one, so it never captures the new arrival's bib.
   - The failed-bib selection is an app selection (`chosen: false`). It holds while fresh, so the corrected bib goes to it, as the existing test checks.
3. **Web Lock takeover goes beyond the ruling's single call.**
   - The ruling specifies the `ifAvailable` request. I added a waiting request so that closing the first tab hands over automatically. It also makes the dev StrictMode remount recover.
   - Web Locks exist only in secure contexts. On the LAN `http://` dev server the app runs unlocked, as before.
4. **The storage fallback, pre-existing `storage.ts` behaviour.**
   - Once a key falls back to memory, `safeLocalStorage` never retries `localStorage`, and the older persisted copy stays there.
   - After a reload, the outbox read from `localStorage` is that older copy, and its pending items could re-send outdated versions.
   - The new header warning tells the timekeeper not to reload. Retrying or pruning is deferred with outbox pruning.
5. **The self-marked pinned row (M8) is still tappable.** A deliberate tap would create this device's own duplicate, which consolidation files as a `duplicate` issue. The ruling asks only for the text.
6. **Not checked on real devices this round.**
   - jsdom and user-event cover the pointer and focus behaviour: pointerdown `preventDefault` keeping focus, implicit pointer capture, `pointercancel` on scroll.
   - I recommend checking on iOS Safari and Android Chrome in the Task 28 E2E or browser pass:
     - MARCAR keeps the keyboard open.
     - An "Em prova" tap during a sync lands on the pressed entry.
