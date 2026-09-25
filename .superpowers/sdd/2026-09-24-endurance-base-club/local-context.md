# Local environment (Windows) — read together with wave2-context.md

The project moved from the cloud container to the user's Windows 11 machine (Ruling 47). Where this file and wave2-context.md disagree, this file wins.

## Paths
- `/home/claude/endurance-base-club` and `/home/user/endurancebaseclub` in any document = the main checkout `C:\ENDURANCE\endurance-base-club` (Git Bash: `/c/ENDURANCE/endurance-base-club`), branch `feat/ebc-app`. Do not work there.
- `/home/claude/ebc-wt/tN` and `/home/user/ebc-wt/tN` = `C:\ENDURANCE\ebc-wt\tN` (Git Bash: `/c/ENDURANCE/ebc-wt/tN`), branch `task/N`.
- SDD docs (briefs, reports, reviews, ledger, contracts, this file) live ONLY in the main checkout: `C:\ENDURANCE\endurance-base-club\.superpowers\sdd\2026-09-24-endurance-base-club\`. Your worktree also has a tracked `.superpowers/` folder — it is an older copy: never read requirements from it and never write reports there.
- Spec: `C:\ENDURANCE\endurance-base-club\docs\superpowers\specs\2026-09-24-endurance-base-club-design.md`.

## Shell and tools
- The Bash tool is Git Bash on Windows (PowerShell also exists). Use forward slashes and `/c/...` paths in Bash.
- Each worktree has its OWN `node_modules` (already installed with `npm ci`). Never run `npm install`/`npm ci`; if you truly need a new dependency, report NEEDS_CONTEXT.
- `python3` + openpyxl work (the xlsx tests call `scripts/verify-xlsx.py`).
- NOT available here: Postgres/WSL. `scripts/test-sql.sh`, `npm run test:integration`, `npm run dev:stack` and the E2E cannot run on this machine — screen tasks do not need them. Gates for screen tasks: focused test file(s), full `npx vitest run`, `npm run typecheck`, `npm run build`.
- Other agents may be running vitest at the same time. If the ONLY failures of a full run are the two openpyxl tests (`src/lib/xlsx/writer.test.ts`, `src/domain/workbook.test.ts`) with a timeout, re-run those two files alone and report both outputs.

## Windows-specific rules
- The filesystem is case-insensitive: never create two modules in one folder whose names differ only by letter case (e.g. `EntryForm.tsx` next to `entryForm.ts` — `./EntryForm` then resolves to the wrong file on Windows/macOS; see Ruling 49).
- Line endings are LF (`.gitattributes`); keep them.

## Commits
- Conventional message, ending with exactly ONE trailer line (Ruling 50):
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  (no `Claude-Session` line — that link belonged to the cloud session).
- Do not push. Do not dispatch subagents.
