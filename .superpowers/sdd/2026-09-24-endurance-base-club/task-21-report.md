# Task 21 — report (written by the controller)

The T21 implementer (sonnet, cloud) was stopped by the account usage limit (ledger "INTERRUPTION 2") before writing this report. Its work was found uncommitted in the worktree with the gates green and committed by the cloud controller as c5a9434 on task/21 (base 221d2db). No TDD evidence or implementer self-review survives; review the diff on its own merits against the brief.

Gates recorded by the cloud controller at c5a9434 (Linux): `npx vitest run` → 36 files / 475 tests green; `npm run typecheck` clean; `npm run build` ok.

Files (git diff --stat 221d2db..c5a9434): EntriesTab.tsx (modified), EntryForm.tsx, BulkEntryDialog.tsx, entryForm.ts, entryForm.test.ts, entries.test.tsx (new) — 1408 insertions, 1 deletion.

Known controller finding (Ruling 49, local Windows): `EntryForm.tsx` and `entryForm.ts` collide on case-insensitive filesystems; on Windows `npm run build` fails with "EntryForm is not exported by src/features/entries/EntryForm.ts" and the entries tests that render the form fail. It will be fixed in the T21 fix round (rename to entryFormState.ts).
