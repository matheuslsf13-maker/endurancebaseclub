# Task 21 — report (written by the controller)

The T21 implementer (sonnet, cloud) was stopped by the account usage limit (ledger "INTERRUPTION 2") before writing this report. Its work was found uncommitted in the worktree with the gates green and committed by the cloud controller as c5a9434 on task/21 (base 221d2db). No TDD evidence or implementer self-review survives; review the diff on its own merits against the brief.

Gates recorded by the cloud controller at c5a9434 (Linux): `npx vitest run` → 36 files / 475 tests green; `npm run typecheck` clean; `npm run build` ok.

Files (git diff --stat 221d2db..c5a9434): EntriesTab.tsx (modified), EntryForm.tsx, BulkEntryDialog.tsx, entryForm.ts, entryForm.test.ts, entries.test.tsx (new) — 1408 insertions, 1 deletion.

Known controller finding (Ruling 49, local Windows): `EntryForm.tsx` and `entryForm.ts` collide on case-insensitive filesystems; on Windows `npm run build` fails with "EntryForm is not exported by src/features/entries/EntryForm.ts" and the entries tests that render the form fail. It will be fixed in the T21 fix round (rename to entryFormState.ts).

## Fix round 1

Fresh implementer (this session cannot resume the cut-off cloud implementer), worktree `C:\ENDURANCE\ebc-wt\t21`, branch `task/21`, FIX_BASE `e416211`. Addressed all four review findings: Ruling 49 (case collision), Important 1 (MemberPicker keyboard/ARIA), Important 2 (formatPenaltyMs duplication), Ruling 51 (import shortcut). Minor items were left untouched per instructions (deferred to the final review).

### Ruling 49 — case-only filename collision (`EntryForm.tsx` / `entryForm.ts`)

`git mv src/features/entries/entryForm.ts src/features/entries/entryFormState.ts` and same for the test file. Updated every `from './entryForm'` import to `./entryFormState` in `EntryForm.tsx`, `EntriesTab.tsx`, `BulkEntryDialog.tsx`, `entryFormState.test.ts`.

RED (baseline, before the rename — captured first per the dispatch instructions):
- `npm run typecheck` → `TS2724: '"./EntryForm"' has no exported member named 'EntryForm'` + `TS1149: File name '.../EntryForm.ts' differs from already included file name '.../entryForm.ts' only in casing.`
- `npx vitest run src/features/entries` → 5 failed / 27 passed (32) — every test that renders `EntriesTab`/`EntryForm` crashed with "Element type is invalid... you might have mixed up default and named imports" (the bundler resolved `./EntryForm` to `entryForm.ts` on this case-insensitive filesystem).

GREEN: `npm run typecheck` clean; `npx vitest run src/features/entries` → 2 files / 32 tests passed.

### Important 2 — `formatPenaltyMs` duplicated `formatDuration`

Removed `formatPenaltyMs` from `entryFormState.ts` (kept `parsePenaltyMs`, no counterpart exists for it). `EntriesTab.tsx`: `EntryStatusModal`'s initial `penaltyText` and the table's penalty cell now call `formatDuration(entry.penalty_ms)` from `src/lib/format.ts` (import added) instead of the local function. `entryFormState.test.ts`: replaced the `formats milliseconds back to m:ss` case (which asserted `formatPenaltyMs`) with an equivalent assertion against the shared `formatDuration` (imported from `../../lib/format`), so the test still documents the exact values (`90_000 → '1:30'`, `5_000 → '0:05'`, `0 → '0:00'`) without re-testing a lib the entries feature doesn't own.

No new RED/GREEN cycle needed beyond Ruling 49's (the rename and this fix were combined in one edit pass since they touch the same files); the full `npx vitest run src/features/entries` GREEN above already covers it. No other file references `formatPenaltyMs` (confirmed via `grep -rn formatPenaltyMs src`).

### Important 1 — `MemberPicker` combobox not keyboard-operable / no ARIA

`src/features/entries/EntryForm.tsx` (`MemberPicker`, ~lines 49-225): rewrote it to follow the WAI-ARIA "combobox with listbox popup" pattern.
- Input: `role="combobox"`, `aria-expanded`, `aria-controls` (→ the listbox id), `aria-autocomplete="list"`, `aria-activedescendant` (→ the highlighted option's id, or `undefined` when nothing is highlighted).
- Popup: `role="listbox"` with an `aria-label` (the field's own label), containing `role="option"` buttons (`aria-selected` on the highlighted one) — the athlete matches plus a trailing "+ Novo atleta" option, so keyboard nav can always reach it.
- Keyboard on the input: `ArrowDown`/`ArrowUp` move (and wrap) a highlighted index, opening the popup first if it was closed; `Enter` activates whatever is highlighted (picks the athlete, or opens `AthleteForm` via `onCreateNew` for the trailing option); `Escape` closes the popup.
- Mouse selection (the pre-existing `onMouseDown`-guarded buttons) is unchanged and still works.

RED: added three tests to `src/features/entries/entries.test.tsx` (in `describe('creating a team entry')`) before touching `EntryForm.tsx`:
- `selects a member with the keyboard (ArrowDown + Enter) and exposes combobox ARIA`
- `closes the suggestion list on Escape without picking anything`
- `reaches "+ Novo atleta" by keyboard and opens the inline athlete form`

`npx vitest run src/features/entries/entries.test.tsx -t "combobox|Escape|Novo atleta by keyboard|keyboard"` → 3 failed (no `role="combobox"`/`listbox` attributes existed yet, `ArrowDown`/`Enter`/`Escape` did nothing).

Implemented the rewrite above. Second RED (still red) on the Escape test only, after the ARIA/keyboard code was otherwise working: `aria-expanded` stayed `"true"` and the whole "Nova inscrição" dialog had actually closed. Root cause (found via targeted debug logging, since it looked like a state-update timing bug at first but wasn't): the kit's `Modal` (`src/components/ui/Modal.tsx`) registers its own `document.addEventListener('keydown', ...)` that calls `onClose()` on any `Escape`, independent of React's synthetic event system. Calling `e.preventDefault()` in `MemberPicker`'s handler does not stop that separate listener — both listeners sit on `document`, and only `stopImmediatePropagation()` on the *native* event blocks a second listener on the same node (`stopPropagation()` alone does not). This was a real, user-facing bug beyond the review's ask (pressing Escape to close the suggestion list would also have silently closed the whole "Nova inscrição"/"Editar inscrição" dialog and discarded the in-progress form). Fixed by calling `e.nativeEvent.stopImmediatePropagation()` alongside `e.preventDefault()` in the `Escape` branch — `Modal.tsx` itself was not touched (not in the file grant).

GREEN: `npx vitest run src/features/entries/entries.test.tsx` → 16/16 passed (all pre-existing tests plus the 3 new ones).

### Ruling 51 — import shortcut lands on `/atletas` without opening the dialog

`src/features/entries/EntriesTab.tsx`: replaced the plain underlined `<Link to="/atletas">Importe atletas</Link>` inline in a sentence with a real kit `<Button variant="secondary">` ("Importar atletas") that calls `navigate('/atletas?import=1')` (via `useNavigate`, replacing the now-unused `Link` import). The informational paragraph keeps the brief's hint text verbatim: "a coluna Prova inscreve automaticamente em provas individuais".

`src/features/athletes/AthletesPage.tsx` (Ruling 51 grant): reads `?import=1` via `useSearchParams` and seeds `importOpen` from it with a lazy `useState` initializer (opens the existing `ImportDialog` on arrival without an extra click); a one-time `useEffect` (`[]` deps) then strips the `import` param from the URL via `setSearchParams(..., { replace: true })` so a later reload/back-navigation doesn't force it open again.

RED: added `entries.test.tsx > describe('import shortcut (Ruling 51)')` test asserting the hint text is present and that clicking the "Importar atletas" button drives the router to `pathname '/atletas'`, `search '?import=1'` (using the `router` now returned by the local `renderTab` helper, which previously discarded `renderWithProviders`'s return value). `npx vitest run src/features/entries/entries.test.tsx -t "import shortcut"` → 1 failed (`getByRole('button', { name: 'Importar atletas' })` not found; the old code only rendered an `<a>`).
Added `athletes.test.tsx > opens the import dialog on arrival when asked via ?import=1 (Ruling 51)`: renders `<AthletesPage />` with `route: '/atletas?import=1'` and asserts `import-file` (inside `ImportDialog`) is present without any click. `npx vitest run src/features/athletes/athletes.test.tsx -t "Ruling 51"` → 1 failed (dialog stayed closed).

Implemented both changes above. GREEN: `npx vitest run src/features/athletes/athletes.test.tsx src/features/entries` → 3 files / 62 tests passed.

### Full gates (final, before commit)

- `npx vitest run` → **36 files / 480 tests passed** (480 = the 475 the cloud controller recorded at c5a9434, +2 renamed-file test-count wash, +3 new keyboard/ARIA tests in entries.test.tsx, +1 import-shortcut test in entries.test.tsx, +1 import-shortcut-arrival test in athletes.test.tsx = net +5, consistent with the diff).
- `npm run typecheck` → clean, no output.
- `npm run build` → succeeds (`vite build`, `dist/assets/index-*.js` 796.34 kB, the pre-existing >500kB chunk-size warning is unrelated to this change and out of scope).

### Files changed

- `src/features/entries/entryForm.ts` → renamed to `src/features/entries/entryFormState.ts` (Ruling 49); also dropped `formatPenaltyMs` (Important 2).
- `src/features/entries/entryForm.test.ts` → renamed to `src/features/entries/entryFormState.test.ts` (Ruling 49); import path updated; `formatPenaltyMs` test case replaced with a `formatDuration` equivalent (Important 2).
- `src/features/entries/EntryForm.tsx` — `MemberPicker` rewritten for WAI-ARIA combobox + keyboard support (Important 1); import path updated (Ruling 49).
- `src/features/entries/EntriesTab.tsx` — import path updated (Ruling 49); penalty display now uses `formatDuration` (Important 2); import shortcut is now a `Button` navigating with `?import=1` (Ruling 51).
- `src/features/entries/BulkEntryDialog.tsx` — import path updated (Ruling 49) only.
- `src/features/entries/entries.test.tsx` — `renderTab` now returns `router`; added 3 keyboard/ARIA tests (Important 1) and 1 import-shortcut navigation test (Ruling 51).
- `src/features/athletes/AthletesPage.tsx` (Ruling 51 grant) — opens `ImportDialog` on arrival when `?import=1` is present, then strips the param.
- `src/features/athletes/athletes.test.tsx` (Ruling 51 grant) — added 1 test for the arrival behavior.

### Concerns

- None blocking. One judgment call worth flagging for the next reviewer: the Escape-key fix required `stopImmediatePropagation()` on the native event because `Modal.tsx`'s own Escape handling lives outside React's synthetic event system (a raw `document.addEventListener`). This is a real bug fix (Escape in the combobox was closing the whole dialog before this round), not scope creep, but it means `MemberPicker`'s Escape handling is now coupled to that implementation detail of `Modal.tsx`; if `Modal.tsx` ever changes how it listens for Escape, this coupling is easy to miss. `Modal.tsx` was not modified (outside the file grant).
- The import-shortcut hint sentence now reads "Prefere importar de uma planilha? — a coluna Prova inscreve automaticamente em provas individuais." (kept the original's dash-joined, lower-case-after-dash phrasing so the brief's hint text stays verbatim); flagging in case the reviewer wants smoother pt-BR copy — not changed since the brief pins the phrase verbatim.
- Minor items from the review (per-row action button names, no loading state in pickers, `ENTRY_STATUS_OPTIONS` literal, stale `AthleteForm.tsx` comment) were left untouched, per the dispatch instructions (deferred to the final review).
