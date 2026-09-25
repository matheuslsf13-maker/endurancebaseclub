# Task 23 report: Timing tab — timekeeper link/QR, timekeepers, wave starts, live board

**Status: DONE**

Branch `task/23` in worktree `/home/user/ebc-wt/t23`, base `bae2379`.

## What was implemented, by file

- **`src/features/timing/TimingTab.tsx`** (modified, replaced the stub): renders `TimekeeperLinkCard` (local, private to this file) followed by `TimekeepersPanel`, `WavesPanel`, `LiveBoard`.
  - `TimekeeperLinkCard`: the link is exactly `` `${location.origin}${location.pathname}#/c/${event.tk_token}` `` (Ruling — verbatim, pinned by a test), shown read-only in the kit's `Input` (`data-testid="tk-link"`), with `tk-copy` (clipboard + toast, pt-BR error on failure), a "Compartilhar" button (`navigator.share` when available, else a `https://wa.me/?text=` fallback tab), the `QrCode` component at `tk-qr`, a "Link ativo" `Checkbox` (`saveEvent({ ...event, tk_enabled })`), and "Gerar novo link" (`useConfirm` → `rotateTkToken` → `patchAgg` + `refresh`).
- **`src/features/timing/TimekeepersPanel.tsx`** (new): table of `agg.timekeepers` — name (+ a "Referência · <prova>" `Badge` for any race whose `config.reference_timekeeper_id` names them), relative last-activity (`relativeAgo`, a local helper: "há N s/min/h/d" or "nunca"), mark count, and an "Ativo" `Checkbox` → `updateTimekeeper(id, { active })` → `patchAgg` + `refresh`.
  - Per the controller's mid-task note (Ruling 33: `admin_live` deltas don't carry timekeepers), the mark count is computed from `agg.marks` (non-discarded, grouped by `timekeeper_id`) rather than read from `timekeeper.marks_count`, which only refreshes on a full aggregate reload and can lag.
- **`src/features/timing/WavesPanel.tsx`** (new): one row per wave (races and, inside each, waves both sorted by `position`) — status (`formatClock(…, {tenths:true})` or "Não largou"), "Largar agora" (`wave-start`, `useConfirm`), a manual-correction form (`wave-time-input` + a "Salvar" submit button, `parseClockInput(text, event.date)`, inline `role="alert"` error on an unparseable time), and "Limpar" (confirm → `setWaveStart(id, null)`, disabled when the wave hasn't started).
  - Every successful `setWaveStart` (start, correction or clear) does `patchAgg` (replaces that wave) then `await refresh()` — required so a start recorded or corrected after marks already exist recomputes every entry's timing and drops any `no_start` issue (Review Focus 5).
  - **Clock-capture ruling**: `handleLargarAgora` awaits the confirmation first; the very next statement, before any further `await`, is `const nowMs = clock.now()`. Pinned by a test that advances a controllable fake clock between the "Largar agora" tap (dialog opens) and the `confirm-ok` tap, and asserts `setWaveStart` used the *later* value.
  - The manual-edit `<input>` is uncontrolled, keyed on `` `${wave.id}-${wave.start_at ?? ''}` ``: it remounts (picking up the new formatted time as its `defaultValue`) whenever the wave's own start changes, but not while the organizer is mid-edit of an unsaved value.
- **`src/features/timing/LiveBoard.tsx`** (new, `data-testid="live-board"`):
  - Counters — Em prova / Concluídos / Não largaram (from `timing.byEntry` statuses) and Pendências (`timing.issues` with `severity !== 'info'`, matching `EventLayout`'s own badge rule), the last as a `Link` to `/eventos/<eventId>/revisao`.
  - Per race with on-course entries: a table (`on-course-table-<raceId>`) of bib, team/athlete display name, current athlete (`legAthleteId` on `timing.current_leg`), leg label, and a running leg timer refreshed via `useNow(500)` plus the synced clock offset (`clock.offsetMs`), i.e. spec §7.2's `agoraOficial()`.
  - Últimas marcações (`recent-marks-table`): the 30 most recent marks — hora, cronometrista (`timekeeperLabel`: "Organização" for `timekeeper_id === null`, the roster's name, or "Cronometrista" for an id not in the roster — Ruling 33's graceful-unknown-id case), Nº, perna, situação (`markSituacao`: Descartada / Sem atleta / Duplicada / Usada).
  - Sem atleta: one row per unassigned, non-discarded mark (oldest first), each with its own bib `<input>` (`live-assign-bib`) and submit (`live-assign-submit`) that calls **`planBibAssignment`** (Ruling 2 — not a local `resolveBib`+`suggestLeg`), then on success `updateMark(id, { entry_id, leg_index })` → `refresh()`, with a success/warning toast (the plan's DNS/DSQ or already-finished warning, if any); on `{error}` an inline `role="alert"` message near the field and no API call. No `athleteId` is ever passed into `planBibAssignment` here (Ruling 10 is about the "Em prova" list, which this panel doesn't have a picker for — bib is always typed).
- **`src/features/timing/timing.test.tsx`** (new): 22 tests, described below.

## Decisions the brief didn't spell out

- **Share button**: no test id is listed in contracts for it, so it has none; it is a plain secondary button next to Copy/Rotate.
- **"Link ativo" / "Gerar novo link" / timekeeper "Ativo" toggle**: the brief only spells out the exact `patchAgg`+`refresh` sequence for wave starts, but I applied the same pattern (optimistic `patchAgg` then `await refresh()`) to every other mutation here too, for the same reason: a poll or another master's concurrent change should not be clobbered by a stale local patch, and `refresh()` is cheap (a single `admin_get_event`).
- **Mark "situação" in the feed**: reduced to the four values a busy master needs at a glance — Descartada / Sem atleta / Duplicada / Usada — rather than restating the bib (already its own column).
- **On-course / recent-marks table test ids** (`on-course-table-<raceId>`, `recent-marks-table`): not in contracts, added for stable scoping (a mark's row and its entry's on-course row legitimately share the same bib/name text) and left in since they don't collide with anything and make future Playwright/agent-browser scoping easier.
- **"Largar agora" stays enabled after a wave has started** (not just before): it doubles as a quick re-largada if the tap was mistaken, alongside the manual-correction field for precise fixes.

## Tests

**RED** (against the untouched stub `export default function TimingTab() { return <h1 className="p-6 brand-title">TimingTab</h1>; }`, with the three new panel files temporarily removed):

```
$ npx vitest run src/features/timing/timing.test.tsx
 Test Files  1 failed (1)
      Tests  22 failed (22)
```

All 22 failed for the expected reason (`tk-link`/`wave-start`/`live-board`/… not found, `Bia` text not found, etc.) — no crashes from unrelated causes.

**GREEN** (implementation restored):

```
$ npx vitest run src/features/timing/timing.test.tsx

 Test Files  1 passed (1)
      Tests  22 passed (22)
   Duration  3.86s
```

Repeated 3× (stable) and once under `TZ=Asia/Tokyo` (Review Focus 4) — all green, no act() warnings or console noise.

Coverage:
- **Link**: `tk-link` value equals the exact copied string and contains `#/c/<token>`; `tk-qr` renders an `<img>`; `tk-copy` writes to the clipboard and toasts; "Link ativo" calls `saveEvent` with the flipped flag and triggers `refresh`; "Gerar novo link" calls `rotateTkToken` only after `confirm-ok` (not after `confirm-cancel`).
- **Cronometristas**: relative activity ("há 12 s") and mark count computed from `agg.marks` even when `marks_count` is stale (999 vs. the real 2); "nunca" for a never-synced timekeeper; the reference badge per race; the active toggle calling `updateTimekeeper('tk1', { active: false })`.
- **Largadas**: the clock-capture-at-confirm-ok test (fake clock value changes between opening the dialog and confirming; asserts the *later* value is what's sent); cancel leaves `setWaveStart` uncalled; typing `08:00:05.3` for event date `2026-10-11` and saving sends exactly `2026-10-11T11:00:05.300Z` (the brief's literal acceptance value); an unparseable time shows the inline error and never calls the API; "Limpar" after `confirm-ok` sends `null` and is disabled while the wave hasn't started; multi-race/multi-wave ordering (race position, then wave position).
- **Painel ao vivo**: status counters (on_course/finished/not_started, with a `not_started` case built on its own not-yet-started wave, since a started wave makes every one of its entries at least on_course even with zero marks) and the Pendências → Revisão link with the right count; a running on-course leg timer (0:35.0 → 0:36.0 one second later, under fake timers); the recent-marks feed's hora/cronometrista/Nº/perna/situação including the unknown-timekeeper-id fallback and a "Sem atleta" row; assigning `101` to an unassigned mark calling `updateMark('m1', { entry_id: 'en1', leg_index: 0 })` (the brief's literal acceptance case) and then `refresh()`; an unknown bib (`999`) showing `Nº 999 não encontrado` inline and never calling `updateMark`.

### Gate outputs

```
$ npx vitest run
 Test Files  1 failed | 25 passed (26)
      Tests  1 failed | 309 passed (310)
```

The one failure is **pre-existing and out of my file ownership**: `src/features/events/eventShell.test.tsx`'s `it.each(['provas','inscricoes','cronometragem','revisao','resultados'])('renders the %s tab', …)` (a Task 17 test) asserts the literal stub text `"TimingTab"` for the `cronometragem` case. Replacing the stub with the real tab is exactly what this task does, so that one case necessarily breaks — the same will happen to the `provas`/`inscricoes`/`revisao`/`resultados` cases as their own owning tasks (19/21/24/25) land. `eventShell.test.tsx` is not in this task's Files block (nor in the shared-files list), so per the file-ownership rule I did not edit it; this is a known, expected cross-task collision for the controller to reconcile once all wave-2a tabs are in (e.g. updating that one assertion to look for a stable per-tab marker instead of literal stub text). I verified it is the *only* failure and that it is exactly that one parametrized case:

```
$ npx vitest run src/features/events/eventShell.test.tsx -t "renders the"
     × renders the cronometragem tab
```

```
$ npm run typecheck
(exit 0, no diagnostics)

$ npm run build
✓ 263 modules transformed.
dist/assets/index-*.js   647.86 kB │ gzip: 190.77 kB
✓ built in 990ms
```//(the pre-existing >500kB chunk warning is unrelated to this task, per Task 17's own report)

## Files changed

- Modified: `src/features/timing/TimingTab.tsx`
- New: `src/features/timing/TimekeepersPanel.tsx`, `src/features/timing/WavesPanel.tsx`, `src/features/timing/LiveBoard.tsx`, `src/features/timing/timing.test.tsx`

No other file was touched (confirmed via `git status --porcelain` / `git diff --stat`).

## Self-review findings

- Every `data-testid` from contracts' Timing (master) list is present exactly: `tk-link`, `tk-copy`, `tk-qr`, `wave-start` (one per wave, race/wave order), `wave-time-input`, `confirm-ok`/`confirm-cancel` (from the shared `Confirm`), `live-board`.
- All displayed times go through `lib/format.ts` (`formatClock`, `formatDuration`) or `parseClockInput`; nothing uses `toLocaleTimeString` directly. Every time value's cell carries the `tabular` class.
- Leg indices: internal 0-based throughout (`current_leg`, `leg_index`), UI always adds 1 ("Perna N").
- No `athleteId` derived from an on-course/"Em prova" row is ever passed into `suggestLeg`/`planBibAssignment` (Ruling 10) — the only assignment path here is the typed-bib "Sem atleta" flow, which never has one to derive.
- `planBibAssignment` (Ruling 2) is the only bib-resolution entry point used; no local `resolveBib`/`suggestLeg` copy exists in this feature.
- Server errors: every `api.admin.*` call here is wrapped in try/catch with the result routed to `toast.show({ tone: 'danger' })` using `ApiError.message` (never swallowed) or a pt-BR fallback for a non-`ApiError` throw.
- Mobile/a11y basics: every custom `<input>`/`<button>` is ≥ 44px (`min-h-11`), tables scroll horizontally via the kit's `Table` wrapper, dialogs go through `useConfirm` only (no ad hoc modals), inline errors are `role="alert"` and wired via `aria-describedby`, and every input/checkbox has a `<label>` (visible or `sr-only`).
- No new dependencies; only existing kit/domain/lib code is used.

## Concerns

1. **The `eventShell.test.tsx` collision described above** — not blocking, not mine to fix, flagged for the controller.
2. **Minor a11y nicety, not fixed**: `TimekeepersPanel`'s "Ativo" checkbox label is the literal word "Ativo" in every row (not "Ativo — Bia"), since the shared `Checkbox` only takes one `label` used for both the visible text and the accessible name; row context is still available through the table structure, but a screen-reader user tabbing through several rows' checkboxes in isolation only hears "Ativo" each time. Fixing this nicely would mean either changing the shared `Checkbox` (out of my Files block) or showing a redundant per-row name next to the checkbox. Left as-is; flagging for awareness.
