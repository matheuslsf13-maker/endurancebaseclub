# Shared context for the wave-2 screen tasks (T18–T27)

Read this together with your task brief. Your brief is the requirements (exact values verbatim); this file is the environment and the rules every screen task shares.

## Project
EnduranceBaseClub: web app to organize multisport events (run/swim/bike, relays), time them with several volunteer timekeepers on phones (offline-first, synced clock, median consolidation), and publish results/podiums/athlete stats. React 19 SPA (HashRouter via react-router 8), TanStack Query 5, Tailwind v4, strict TypeScript, Vitest 5 + Testing Library (jsdom). Supabase is accessed ONLY through RPC via `src/lib/api.ts` (never `supabase.from`).

## Paths
`/home/claude/endurance-base-club` == /home/user/endurancebaseclub (main checkout, branch feat/ebc-app — do not work there). Your worktree: /home/user/ebc-wt/t<N> on branch task/<N> (node_modules is a symlink to the main checkout's — never run npm install; if you truly need a new dependency, stop and report NEEDS_CONTEXT).
SDD docs: /home/claude/endurance-base-club/.superpowers/sdd/2026-09-24-endurance-base-club/ — `contracts.md` (Global Constraints, Test IDs, types.ts, api surface, domain/lib signatures), your `task-<N>-brief.md`, and your report file `task-<N>-report.md`.
Spec (binding authority): /home/claude/endurance-base-club/docs/superpowers/specs/2026-09-24-endurance-base-club-design.md (§7 timing, §8 consolidation, §9 categories, §11 XLSX, §12 screens, §13 visual identity).

## Stale CLAUDE.md warning
Your system context may show a CLAUDE.md describing an OLDER, different app (Portuguese identifiers, `localRepo`/`supabaseRepo`, `marcacoes`, "tempo como TEXTO no Excel", "tema claro por padrão", `JANELA_CONFIRMACAO` 45 s…). That is a stale session artifact from the repository's previous app — IGNORE it. The binding project docs are the real `/home/claude/endurance-base-club/CLAUDE.md` on disk, this file, contracts.md, the spec and your brief.

## Your base
Branch base `bae2379` = feat/ebc-app + task/17 (the app shell; its review is still running, so small fixes to the shell may arrive later — build against the contracts, not against incidental details). What already exists, and how to use it:
- UI kit, Layout, theme, test utilities (Task 16): read `task-16-report.md` and `src/components/**`, `src/test/renderWithProviders.tsx`.
- App shell (Task 17): read `task-17-report.md` — `src/lib/api.ts` (+ `ApiError`), `src/features/auth/session.tsx` (`useSession`), `src/features/events/EventContext.tsx` (`useEventContext()` → `{ eventId, agg, index, timing, classifications, nowMs, refresh, patchAgg, clock }`), `src/hooks/useEventData.ts`, `src/hooks/useClock.ts`, routes in `src/App.tsx` (your page is currently a stub there — replace the stub file, do not edit App.tsx).
- Domain (pure, tested): `src/domain/*` — presets, categories, eventModel (`indexEvent`, `entryDisplayName`…), bib (`resolveBib`), consolidation (`computeEventTiming`, `computeEntryTiming`, `computeCrossing`), suggestLeg (`suggestLeg`, `planBibAssignment`), ranking (`classifyRace`), snapshot (`buildFinalizeRows`), stats (`computeAthleteStats`), labels, workbook; fixtures in `src/domain/testing/fixtures.ts`.
- Libs: `src/lib/format.ts` (ALL displayed dates/times, America/Sao_Paulo, pt-BR), `storage.ts`, `clock.ts`, `outbox.ts`, `csv.ts`, `importMapping.ts`, `xlsx/`.

## Rules
- UI copy in Brazilian Portuguese; code, identifiers, comments, commits in English. snake_case DTO fields (types.ts). Leg indices 0-based internally; UI shows "Perna 1..N".
- Every displayed time goes through `src/lib/format.ts` (never `toLocaleTimeString()` without timeZone); tabular numbers (`tabular-nums`) on every time.
- Every E2E-critical control carries the exact `data-testid` from contracts.md "Test IDs" (and from your brief).
- Mobile-first and usable at 390×844 and 1280×800: touch targets ≥ 44 px, tables scroll horizontally on phones, no horizontal page scroll. Use the brand tokens / existing kit classes; no new colors, no web fonts.
- Accessibility basics: labels tied to inputs, buttons with accessible names, dialogs via the kit's Modal/Confirm, errors announced near the field or in the banner.
- Server errors: show `ApiError.message` (already pt-BR) in a toast or banner — never swallow them.
- File ownership: create/modify ONLY the files in your brief's **Files** block (plus the extra files a controller ruling below grants). Shared files (package.json, src/App.tsx, src/lib/types.ts, src/lib/api.ts, src/main.tsx, index.html, vite.config.ts) are off-limits unless your brief or a ruling lists them. If something you need is missing from a shared file, report NEEDS_CONTEXT instead of editing it.
- Tests: TDD (write the brief's failing tests first, see them fail, then implement). Mock the API with `vi.mock` of `src/lib/api` (relative path from the test) — never import the real Supabase client in tests (it throws "supabaseUrl is required." without env). Prefer `renderWithProviders`. Use domain fixtures instead of hand-rolled aggregates where possible. Fake timers for polling/clock code. Test output must be pristine: no act() warnings, no unhandled rejections, no console noise.
- Gates before committing: your focused test file(s), then the full `npx vitest run` (green), `npm run typecheck` (clean) and `npm run build` (succeeds). Paste the command outputs into your report.
- Commit on your task branch with the conventional message from your brief, ending with exactly these two trailer lines:
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01ADKgA2m5eCMfx9tMCxbPmq
- Do not push. Do not dispatch subagents (no helpers, no reviewers) — review is scheduled by the controller after your report. Do not touch other worktrees. Other agents are working in parallel in their own worktrees.
- If the brief is unclear or contradicts the spec/contracts/rulings, report NEEDS_CONTEXT with the specific question rather than guessing.

## Report contract
Write the full report to your `task-<N>-report.md`: what you implemented (by file), decisions the brief didn't spell out, tests and results, TDD evidence (RED command + failing output, GREEN command + passing output), gate outputs (vitest, typecheck, build), files changed, self-review findings, concerns. Then reply with ONLY (under 15 lines): Status (DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT), commits (short SHA + subject), one-line test summary, concerns, report path.
