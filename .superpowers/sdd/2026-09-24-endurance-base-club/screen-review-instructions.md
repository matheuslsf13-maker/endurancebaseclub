# Task review instructions (screen tasks) — read fully before reviewing

You are reviewing one task's implementation: first whether it matches its requirements, then whether it is well-built. This is a task-scoped gate, not a merge review — a broad whole-branch review happens separately after all tasks are complete.

Project: EnduranceBaseClub — React 19 SPA (organizer panel, timekeeper app `#/c/:token`, public pages) talking to Supabase only via RPC (`src/lib/api.ts`). Path mapping: `/home/claude/endurance-base-club` == /home/user/endurancebaseclub.

## Inputs (the controller's dispatch gives you the task number N, the checkout, BASE/HEAD and the diff file)
- Brief: `.superpowers/sdd/2026-09-24-endurance-base-club/task-<N>-brief.md`
- Global constraints: the "## Rules" section of `wave2-context.md` (same folder): pt-BR UI; every displayed time via src/lib/format.ts (America/Sao_Paulo) with tabular numbers; exact Test IDs; mobile-first at 390 px and 1280 px (≥ 44 px targets, tables scroll horizontally, no page-level horizontal scroll); a11y basics (labels, accessible names, kit Modal/Confirm, errors announced); server errors shown (ApiError.message), never swallowed; file ownership (only the brief's Files block + controller grants); tests mock `src/lib/api`, pristine output.
- contracts.md (same folder): types, api surface, domain signatures, Test IDs. Spec (binding): docs/superpowers/specs/2026-09-24-endurance-base-club-design.md.
- Controller rulings named in the dispatch: read them in progress.md (same folder) by number ("Ruling <n>:").
- Implementer's report: `task-<N>-report.md` (same folder).

## Method
Read the diff file once — it is your view of the change (commit list, stat, full diff with context). Do not Read changed files separately unless a hunk is cut off mid-function (say so). Inspect code outside the diff only to evaluate a concrete named risk — one focused check per risk, naming both (e.g. a domain helper's contract in src/domain, a UI kit component's props, the EventContext value). Read-only: never mutate the working tree, index, HEAD or branches. Never dispatch subagents.

Do not trust the report: verify its claims against the diff; rationales ("YAGNI", "kept simple") never downgrade a finding.
Tests: the implementer ran them. Do not re-run the suite; a focused `npx vitest run <file>` in the checkout only when reading raises a specific doubt. Warnings/noise in the reported output are findings.

## Part 1 — Spec compliance
Missing / Extra / Misunderstood, each with file:line. Requirements you cannot verify from the diff → ⚠️ items.
## Part 2 — Code quality
Correctness of data flow (what is sent to the api, exact payloads; state after save/refresh; stale data; loading/error/empty states), domain reuse (no ad-hoc re-implementation of domain rules), timers/effects cleanup, memoization where lists re-render on ticks, UX on phones, a11y of dynamic rows, test quality (tests assert behavior through the UI, not mock internals; brief's Step-1 cases present).

## Calibration
Important = the task cannot be trusted until fixed: incorrect or fragile behavior, a missed requirement, swallowed errors, tests asserting nothing, verbatim duplication of a logic block. If the brief/plan mandates something this rubric calls a defect, report it as Important labeled plan-mandated. "Coverage could be broader" and polish are Minor. Acknowledge what was done well.

## Output format — your final message is the report; begin directly with the spec verdict; cite file:line everywhere
### Spec Compliance (✅ | ❌ + items; ⚠️ Cannot verify from diff)
### Strengths
### Issues — #### Critical / #### Important / #### Minor (file:line, what, why, how to fix)
### Assessment — **Task quality:** Approved | Needs fixes; **Reasoning:** 1-2 sentences
