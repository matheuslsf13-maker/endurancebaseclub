# Task 21 — task review (sonnet), diff 221d2db..c5a9434 — verdict: Needs fixes
(saved by the controller from the reviewer's message)

## Spec: ✅ (all brief behaviours and Test IDs present); ⚠️ import shortcut — resolved by the controller as a real gap (Ruling 51)
Verified: exactly the 6 brief files; entryForm exports per brief; EntriesTab filters/columns/legs format/category/row actions; EntryForm test-ids, AthleteForm inline, leg default k mod team_size, bib placeholder, level/wave gating, save → refresh, error banner; BulkEntryDialog restricted to team_size 1; all Step-1 test cases present.
Strengths: Ruling 40 handled (EntryForm seeds state once; EntryStatusModal captures its entry); no outer <form>, so AthleteForm's nested submit cannot bubble; MemberPicker avoids stale display text; domain reuse; tests drive real UI flows.

## Important
1. `MemberPicker` (the `entry-member-<i>` combobox) is not keyboard-operable. EntryForm.tsx:68-109: the input has onChange/onFocus/onBlur only — no onKeyDown for Arrow/Enter selection — and the suggestion list has no ARIA (role="combobox"/aria-expanded/listbox/option). Selecting a suggestion or reaching "+ Novo atleta" only works via onMouseDown-guarded mouse clicks; Tab away fires onBlur and removes the list, with no keyboard path. It is the primary, testid-critical control for every entry and a newly hand-rolled widget (no kit Combobox exists). Fix: keyboard handling (Arrow Up/Down move a highlighted option, Enter picks it, Escape closes) and standard combobox ARIA (role=combobox, aria-expanded, aria-controls, aria-activedescendant; listbox/option with aria-selected).
2. `formatPenaltyMs` duplicates `formatDuration` from src/lib/format.ts. entryForm.ts:176-181 produces the same output as `formatDuration(ms)` (src/lib/format.ts:31-38) for the whole penalty domain (e.g. 90_000 → '1:30', 5_000 → '0:05'), violating "every displayed time goes through src/lib/format.ts" and adding a latent inconsistency (Math.round vs Math.floor). Fix: display via `formatDuration`; keep `parsePenaltyMs` (no counterpart exists).
3. (controller finding, Ruling 49) Case-only filename collision EntryForm.tsx / entryForm.ts breaks the Windows build and entries tests → rename the pure module to `entryFormState.ts` and its test to `entryFormState.test.ts`, update imports.
4. (controller, Ruling 51 — from the reviewer's ⚠️) The brief's "Import shortcut button linking to /atletas import dialog" lands on the athletes page without opening the dialog (AthletesPage opens ImportDialog only from local state). Fix: the shortcut navigates to /atletas asking for the import dialog (e.g. router `state: { openImport: true }`), AthletesPage opens ImportDialog on arrival when asked; render the shortcut with the kit's button look; keep the hint text verbatim. Test: clicking the shortcut from the Entries tab shows the import dialog.

## Minor (deferred to the final review)
- EntriesTab.tsx:238-249 per-row Editar/Status-penalidade/Excluir lack item-specific accessible names.
- EntryForm member pickers and BulkEntryDialog show no loading state while listAthletes() is in flight (briefly "Nenhum atleta encontrado").
- entryForm.ts:183 ENTRY_STATUS_OPTIONS hand-written literal mirrors ENTRY_STATUS_LABEL keys.
- AthleteForm.tsx:40-45 comment says the Task 21 entries form renders it inside its own <form> — stale (T21 uses a div).
