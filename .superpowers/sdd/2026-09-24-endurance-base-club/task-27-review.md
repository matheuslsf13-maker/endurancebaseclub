# Task 27 — task review (sonnet), diff 3d47624..33caf37 + merged head 5c97fe2 — verdict: Needs fixes
(saved by the controller from the reviewer's message)

## Spec: ✅ (no ❌)
Ruling 26 correctly implemented (registerType 'prompt', no skipWaiting/clientsClaim, onNeedRefresh no-ops on `#/c/`, UpdatePrompt via the kit toast with durationMs 0 and "Atualizar"); Ruling 30 correctly implemented (every routed page lazy + Suspense with the kit Spinner; routes/guards unchanged). Merged-head check at 5c97fe2: all 18 lazy imports resolve to real page modules with default exports; TimekeeperPage chunk statically imports only jsx-runtime; Layout/RequireOrganizer stay eager with no heavy deps.
Strengths: exact kit Toast API use; untestable wiring in main.tsx vs testable UpdatePrompt; per-tab Suspense boundaries; accessible fallback; surgical eventShell test edits.

## Important
1. Order-dependent test. src/features/events/eventShell.test.tsx:240-263 ("polls every 2 s only on the timing, review and results tabs") does a synchronous `screen.getByTestId('page-event-general')` (line 245) right after a 5 ms fake-timer advance. It passes in the full file (29/29) only because earlier tests warm the module-level lazy() cache; run alone (`npx vitest run src/features/events/eventShell.test.tsx -t "polls every 2 s"`) it FAILS at line 245. The report's rationale (advanceTimersByTimeAsync flushes the dynamic import) is wrong. Fix: `await screen.findByTestId('page-event-general')`, and check the file's other synchronous page lookups for the same dependency (each test must pass when run alone).
2. vercel.json adds a `/manifest.webmanifest` no-cache header beyond the literal grant ("vercel.json headers for sw.js") → controller Ruling 52: ACCEPTED as is (no change needed).
3. (promoted by Ruling 52 from the reviewer's Minor) The `#/c/` guard in src/main.tsx:16 — the single line that implements Ruling 26's "never interrupt the timekeeper" — has no test. Fix: move the decision into a small exported, pure predicate (e.g. in src/components/UpdatePrompt.tsx, or a tiny module next to it) used by main.tsx, with unit tests: `#/c/abc` → no prompt; `#/eventos`, `#/`, '' → prompt.

## Minor (deferred to the final review)
- UpdatePrompt.test.tsx:341-347 — test title says "ignores the event … (nothing to crash)" but asserts it throws outside a ToastProvider; rename.
- UpdatePrompt has no de-dup guard if onNeedRefresh fires more than once (stacked toasts).
