# SDD ledger — plan: docs/superpowers/plans/2026-09-24-endurance-base-club.md

Spec: docs/superpowers/specs/2026-09-24-endurance-base-club-design.md (binding authority)
Branch: feat/ebc-app (from main @ e98799a). Parallel tasks run in worktrees under /home/claude/ebc-wt/<task>, branches task/<N>, merged into feat/ebc-app after review.
SDD scripts: /root/.claude/skills/synced/2ebdf0d8-d909-42d1-8307-ca3013d32b91_b96114c5-37a1-45ab-b399-e3afa270a4ea/subagent-driven-development/scripts

## Pre-flight scan

| Pair / task | Produces → consumes | Finding |
|---|---|---|
| T1 → all | types.ts, format.ts, storage.ts, deps, tokens | consistent |
| T2 → T3–T8, T28 | db-local.sh, test-sql.sh, tests.* helpers, shim | consistent; tests avoid psql meta-commands so they also run via MCP |
| T3 ↔ T9 | SQL default_race_config ↔ TS defaultRaceConfig | same values specified in both tasks — OK |
| T3 → T4–T7 | assert_organizer/owner, internal_create_auth_user, random_token, slugify | consistent |
| T4 → T5/T6/T7 | entry_json, admin fns | T7 grant DO block covers every admin_/tk_/pub_ fn — OK |
| T4–T7 → T17 | RPC names/params | api.ts param list in Shared Contracts matches T4–T7 — OK |
| T6/T7 → T17/T22/T26 | live endpoints return all resolutions + waves, mark deltas | consistent with useEventData / tk sync |
| T7 → T26 | pub marks omit device_ts/clock_* | MarkRow marks them required-nullable; see Ruling 4 |
| T9 → T10/T11/T15/T17/T19/T21/T22 | presets, categories, eventModel, bib, fixtures | consistent |
| T10 → T11/T15/T17/T22/T23/T24 | Crossing/EntryTiming/Issue, suggestLeg | T22/T23/T24 each need "bib → entry → suggested leg" → duplication risk; see Ruling 2 |
| T11 → T15/T17/T25 | classifyRace, buildFinalizeRows | T15 takes RaceClassification[]; context holds Map → T25 converts — OK |
| T12 → T20 | computeAthleteStats | OK |
| T13 → T17/T22 | ClockSync/takeSample/Outbox | OK |
| T14 → T15/T20 | writer/reader/csv/importMapping | reader.test imports sampleModel from writer.test → re-registers writer tests; see Ruling 3 |
| T15 → T21/T24/T25 | labels, buildEventWorkbook | T15 in wave 1b, before consumers — OK |
| T16 → all UI | kit, Layout, renderWithProviders | OK |
| T17 → T18–T26 | stubs, EventContext, api, session, routes | stubs listed for every page a later task replaces — OK |
| T20 → T21/T26 | AthleteForm, StatsView | ordered in wave 2b — OK |
| T25 → T26 | ClassificationTable, PodiumView | ordered in wave 2b — OK |
| T27 ↔ T1/T17 | modifies vite.config.ts, main.tsx | only T27 edits them after T17 — OK |
| T28 ↔ all UI | data-testids | Test IDs section is the contract — OK |
| Self-consistency T1–T29 | tests vs code/specs in each task | T10 test "issues sorted" fixed during planning; T15 formula column fixed during planning; no other contradictions found |

## Rulings

- Ruling 1: Implementers run in parallel (one worktree + branch per task, disjoint file ownership) although the skill says never parallel — the user explicitly asked for parallel agents; worktrees remove the shared-checkout conflict the rule guards against — cost if wrong: merge conflicts/rework on shared files, caught at merge time.
- Ruling 2: Add to Task 10 a shared pure helper `planBibAssignment` in `src/domain/suggestLeg.ts` (resolveBib + suggestLeg, excluding the mark itself) used by T22/T23/T24 instead of three copies — cost if wrong: one extra small function to maintain.
- Ruling 3: Task 14 puts `sampleModel` in `src/lib/xlsx/testModel.ts` (non-test module) imported by both xlsx tests, instead of importing writer.test from reader.test — cost if wrong: none (test organization only).
- Ruling 4: Public mark payloads omit audit fields (device_ts, clock_offset_ms, clock_rtt_ms); client code must not rely on them for public data; types stay as planned — cost if wrong: a public view showing blank audit info (none planned).
- Ruling 5: Work on branch feat/ebc-app, merge to main at the end (user pre-authorized full execution) — cost if wrong: none; main keeps only docs until then.

## Progress
Task 1: dispatched (base d73b198) -> 495ab7b; review pending
Wave 1 dispatch: T2,T9,T13,T14,T16 from base 495ab7b in worktrees /home/claude/ebc-wt/t<N> (branches task/<N>)
Task 1: complete (commits d73b198..495ab7b, review clean)
Task 1: minor (deferred): package.json keeps npm-init boilerplate (version/description/directories/keywords/author/license)
Task 1: minor (deferred): storage.ts fallback map is module-level; tests forcing fallback should use unique keys
Task 2: implemented dd92d5e (task/2, base 495ab7b) — review dispatched
Task 9: implemented f7c9c74 (task/9, base 495ab7b) — review dispatched
Task 13: implemented 59761d1 (task/13, base 495ab7b) — review dispatched
Task 14: implemented 63cce2a (task/14, base 495ab7b) — review dispatched
Task 16: implemented a4456b6 (task/16, base 495ab7b) — review dispatched
- Ruling 6: Dependent tasks start from their predecessor's branch while its review runs (T3 from task/2, T10 from task/9); predecessor fixes are merged before the dependent merge — saves wall-clock; cost if wrong: merge conflicts in files both touched.
- Ruling 7: RTL auto-cleanup is not registered (no test.globals); T17 adds `afterEach(cleanup)` to src/test/setup.ts so every later UI test gets it — cost if wrong: none.
Task 3: dispatched (worktree t3, branch task/3 from task/2 dd92d5e)
Task 10: dispatched (worktree t10, branch task/10 from task/9 f7c9c74)
Task 2: complete (commits 495ab7b..dd92d5e, review clean) — merged into feat/ebc-app as 8832b17
Task 2: minor (deferred): shim caches not-found fn signatures; unknown body keys silently dropped; unparseable JSON body → {}; shim.test hardcodes DB/port
Task 9: complete (commits 495ab7b..f7c9c74, review clean) — merged as a9247ca
Task 9: minor (deferred): entryCategory silently ignores members missing from athletesById; indexEvent test covers one entry per race
Task 14: complete (commits 495ab7b..63cce2a, review clean) — merged as 3174e35
Task 14: minor (deferred): one error per import row; boolean cells read back as '1'/'0'; python verify test leaves temp files
After merges: npx vitest run → 10 files / 49 tests green (feat/ebc-app 3174e35)
Task 13: review Needs fixes — Important: Outbox constructor/all() throw on valid-JSON-wrong-shape storage ('{}', 'null') — fix round 1 pending (implementer ac0ffe2785f5a3dd3)
Task 13: minor (deferred): overlapping in-flight syncs could mis-ack (T22 sync loop must be single-flight); effective() recomputed per getter
Task 16: review Needs fixes — Important: (1) Modal lacks focus management (initial focus, trap, restore); (2) Toast auto-dismiss never pauses on hover/focus; (3) LineChart touch tap tooltip vanishes on pointerleave; (4) LineChart viewBox width 640 + preserveAspectRatio none + fixed px height → non-uniform stretch on phones — fix round 1 pending (implementer a519d9d349a9f6e54)
Task 16: minor (deferred): QrCode no placeholder while generating; LineChart role=img with tabIndex; Field shows error OR hint; Button sm same height as md; Logo alt text without spaces
Task 3: implementer a845106b8fcc64e41 cut off by account usage limit (HTTP 429 "session limit, resets 00:10 -03") — partial staged work in /home/claude/ebc-wt/t3 (0001, 0002, 10_schema.sql uncommitted)
Task 10: implementer aa9756ca03ac49a1b cut off by the same limit — /home/claude/ebc-wt/t10 has only the two test files (untracked)
Task 13: fix round 1/5 applied (commits 59761d1..e848e34) — re-review dispatched
Task 13: fix round 1/5 (1 addressed, 0 open; commits 59761d1..e848e34)
Task 13: complete (commits 495ab7b..e848e34, review clean) — merged into feat/ebc-app
Task 13: minor (deferred): outbox sanitize is one level deep (mark fields not validated)
Task 16: fix round 1/5 applied (commits a4456b6..668e10d) — re-review dispatched
Task 3: implemented 11c9660 (task/3, base dd92d5e) — review dispatched
Task 10: implemented fb6c7d7 (task/10, base f7c9c74) — review dispatched
- Ruling 8: Portuguese grammar — "fim da <label>" is wrong for masculine labels ("fim da Ciclismo"); all assignment texts use "fim da perna <k+1>/<N> (<label>)" (T10 planBibAssignment warning → "Nº <bib> já concluiu — registrada como fim da perna <k+1>/<N> (<label>)"; T22 assignmentMessage → "✓ Nº 101 · Matheus · fim da perna 2/2 (Corrida)") — cost if wrong: wording only.
- Ruling 9: An entry with a finish crossing but no wave start is status 'finished' with null total/final (T10 behavior, pinned by test). T11 treats it as unranked and lists it first among unranked rows (before on_course) so the organizer sees it next to the finishers; the no_start issue already flags it — cost if wrong: display order only.
Task 4: dispatched (worktree t4, branch task/4 from task/3 11c9660)
Task 11: dispatched (worktree t11, branch task/11 from task/10 fb6c7d7)
Task 3: complete (commits dd92d5e..11c9660, review clean) — merged into feat/ebc-app
Task 3: minor (deferred): cascading race delete bumps events.version fewer times (still changes); slugify param not p_-prefixed (plan-mandated); permission matrix/version-delta checks not committed as SQL assertions
Task 10: review Approved (no Critical/Important) — minors: divergence issue may have empty mark_ids; "descartada" wording also used for moved marks; suggestLeg polish
Task 16: fix round 1/5 (4 addressed incl. partial; 1 new Important: LineChart ResizeObserver effect deps [] never attaches when first render has points=[] → stuck at 640 fallback; commits a4456b6..668e10d)
Task 11: implemented b8eb0df (task/11, base fb6c7d7) — review dispatched
Task 4: implemented b9cb55e (task/4, base 11c9660) — review dispatched (implementer fixed plan-test bug: direct selects under role authenticated hit RLS)
- Ruling 10: suggestLeg `same_crossing` must consider ALL legs of the entry (closest median within the window), and only the 'next' step is restricted to the selected athlete's legs — otherwise a second timekeeper confirming a relay handoff with the next athlete shown as "current" gets the wrong leg (T10 reviewer probe). T22/T23 also never pass athleteId from the "Em prova" row — cost if wrong: a solo athlete with a < window-length leg could be merged into the previous crossing (unrealistic; legs ≫ 30 s).
- Ruling 11: a divergence issue always carries at least one mark id — when no candidate exceeds the threshold from the median (3+ candidates spread evenly), use the candidate farthest from the median — cost if wrong: Review tab highlights one extra mark.
- Ruling 12: admin_save_race — `waves` key ABSENT on update leaves existing waves untouched (never wipe start_at); present array → upsert by id + delete missing; if the race ends with zero waves → create "Largada geral" (insert with no waves → default wave) — cost if wrong: none; prevents losing recorded start times.
Task 10: ruling-driven fix round 1/5 dispatched (Rulings 8, 10, 11)
Task 16: fix round 2/5 dispatched
Task 5: dispatched (worktree t5, branch task/5 from task/4 b9cb55e)
Task 12: dispatched (worktree t12, branch task/12 from feat/ebc-app)
Restart: the 21:22 dispatches (T10 fix round 1, T11/T4 reviews, T5, T12 implementers, T16 re-review) never ran (safety-classifier outage, then worker restart) — re-dispatched now; local Postgres restarted (scripts/db-local.sh start)
Task 16: fix round 2/5 applied (commits 668e10d..8e8b7c4) — re-review dispatched
- Ruling 13: T15 and T17 start now from integration branches (task/15 = feat/ebc-app + merge task/11; task/17 = feat/ebc-app + merge task/11 + merge task/16; base verified 151 tests green + typecheck clean) while T10/T11/T16 finish review — extends Ruling 6; T15/T17 own no T10/T11/T16 files so later merges are conflict-free — cost if wrong: a follow-up fix if a T11 review fix changes a signature T15/T17 consume.
Task 15: dispatched (worktree t15, branch task/15 base 61ead91)
Task 17: dispatched (worktree t17, branch task/17 base 7e293bd, opus; Ruling 7 setup.ts cleanup included)
Task 16: fix round 2/5 (1 addressed, 0 open; commits 668e10d..8e8b7c4) — re-review clean → ready to merge task/16
Task 16: minor (deferred): LineChart first paint at 640 fallback before ResizeObserver reports real width (layout snap)
Task 10: fix round 1/5 applied (Rulings 8, 10, 11; commits fb6c7d7..bc8513e; 93/93 tests, typecheck clean) — scoped re-review pending
Task 11: review Approved (commits fb6c7d7..b8eb0df, no Critical/Important) — merge after task/10 merges
Task 11: minor (deferred): no multi-leg snapshot mapping test; no dims:[] podium test; numeric bib tie-break untested
Task 4: review Needs fixes — Important: (1) Ruling 12 violated: admin_save_race wipes waves (and start_at) when `waves` absent on update (0003:553-571) and test 20_admin_events.sql:84-93 pins the wrong behavior; also explicit JSON null `waves` must behave like absent; (2) plan-mandated: config reset to defaults when `config` absent on update (0003:523-524) → Ruling 14 — fix round 1 pending (implementer from the 21:22 dispatch no longer resumable → new implementer)
Task 4: minor (deferred): NULL bypass in validate_race_config enum/range checks (0003:40-55,84); public_slug TOCTOU → raw 23505 instead of P0001
Task 4: ⚠️ grants: internal helpers (entry_json, bootstrap_owner, internal_create_auth_user, validate_race_config, next_unique_public_slug…) are EXECUTE-able by PUBLIC until Task 7 — see Ruling 15
Task 5: implemented d415c39 (task/5, base b9cb55e; SQL suite 4/4 PASS) — review pending
Task 12: implemented 3741efa (task/12, base 4df3f5f; 67 tests, typecheck clean) — review pending
Task 15: implementer cut off by account usage limit (HTTP 429, resets 06:20 -03) — partial work saved as WIP commit on task/15 (see HANDOFF)
Task 17: implementer (opus) cut off by the same limit — partial work saved as WIP commit on task/17 (see HANDOFF)
- Ruling 14: admin_save_race on UPDATE merges config as default_race_config(new team_size) || existing.config || coalesce(payload.config,'{}') — an absent `config` key keeps the organizer's customizations (same hazard class as Ruling 12) — cost if wrong: none (insert path unchanged).
- Ruling 15: Task 7's grants migration must first `revoke execute on all functions in schema public from public, anon, authenticated` (plus `alter default privileges in schema public revoke execute on functions from public`) and only then grant admin_* to authenticated, tk_*/pub_* to anon+authenticated — so internal helpers are never callable through PostgREST; 60_security.sql asserts anon/authenticated cannot call entry_json/bootstrap_owner/internal_create_auth_user — cost if wrong: none.
HANDOFF (user request): stop all activity after the usage limit; transfer to Claude Code. Package + CLAUDE.md + docs/HANDOFF.md + .claude/skills + .mcp.json prepared; no further dispatches from this session.
- Ruling 16: admin_save_race never changes `start_at` of an existing wave — the upsert's `on conflict do update` sets only name/position (and race_id); start times change exclusively through admin_set_wave_start (Cronometragem). A new wave inserted via admin_save_race starts with start_at null. Found by the controller at handoff (0003:555-563 sets start_at = excluded.start_at): a race editor (Task 19) holding a stale form would otherwise overwrite a start recorded meanwhile with null — cost if wrong: none (start times already have their own RPC). Apply in the Task 4 fix round together with Rulings 12 and 14.
RESUME (Claude Code web, 2026-09-25): package restored into the GitHub repo matheuslsf13-maker/endurancebaseclub (the session's only repo). Paths: /home/claude/endurance-base-club -> /home/user/endurancebaseclub (symlink), /home/claude/ebc-wt -> /home/user/ebc-wt (symlink). Local PG16 + openpyxl installed; SQL 2/2 PASS, vitest + typecheck green on feat/ebc-app b067807.
- Ruling 17: the session repo's `main` already holds a different, older app (gh-pages build, other Supabase project). Work continues on `feat/ebc-app` (pushed to origin for safekeeping, per HANDOFF §2 option B); at the end, `feat/ebc-app` lands on `main` via a merge with --allow-unrelated-histories (no force-push; the old app stays in main's history at 0a2464e) — cost if wrong: one revert/branch reset on main; nothing is lost.
- Ruling 18: commit trailers use this session's attribution (Co-Authored-By: Claude Opus 5.5 / Claude-Session session_01ADKgA2m5eCMfx9tMCxbPmq) instead of the plan's old session link — cost if wrong: none.
Task 16: complete (commits 495ab7b..8e8b7c4, review clean) — merged into feat/ebc-app as b707fd4
Task 10: scoped re-review of fix round 1 dispatched (fb6c7d7..bc8513e, sonnet)
Task 4: fix round 1/5 dispatched — NEW implementer (sonnet) in /home/user/ebc-wt/t4 (Rulings 12 incl. JSON null, 14, 16 + NULL-bypass minor; optional TOCTOU)
Task 5: review dispatched (b9cb55e..d415c39, sonnet)
Task 12: review dispatched (4df3f5f..3741efa, sonnet)
- Ruling 19: Task 6 starts now from task/5 (d415c39) while T4's fix round and T5's review run (extends Ruling 6); T6 owns only 0005_timing.sql + 40_timing.sql, so later merges of T4/T5 fixes are conflict-free — cost if wrong: a follow-up fix if a T4/T5 fix changes entry_json or a helper T6 calls.
Task 6: dispatched (worktree /home/user/ebc-wt/t6, branch task/6, base d415c39, sonnet)
Task 10: fix round 1/5 (3 addressed, 0 open — Rulings 8, 10, 11; commits fb6c7d7..bc8513e) — scoped re-review clean
Task 10: complete (commits f7c9c74..bc8513e, review clean) — merged into feat/ebc-app as 1db1227
Task 11: complete (commits fb6c7d7..b8eb0df, review clean) — merged into feat/ebc-app as d648fac
Task 15: feat/ebc-app (d648fac) merged into task/15 (9f0f4c1); completion implementer dispatched (sonnet) — review BASE = d648fac
Task 17: feat/ebc-app (d648fac) merged into task/17 (8066ba6); completion implementer dispatched (opus) — review BASE = d648fac
Task 12: review Approved (4df3f5f..3741efa, no Critical/Important)
- Ruling 20: pace_by_modality omits 'other' (brief) — spec §10 "other só tempo" is honored by records/history showing the time with an empty pace; a per-modality pace row for 'other' has no meaning — cost if wrong: StatsView lacks an "Outro" row in "Ritmo por modalidade".
Task 12: minor (deferred): no test for leg with time but null distance; tie-breaks untested (record ties, evolution group ties follow input order, same-date history rows, partner count ties); record/evolution label taken from first/best leg
Task 12: complete (commits 4df3f5f..3741efa, review clean) — merged into feat/ebc-app as 3bd3b4d
Task 5: review — spec ✅, 1 Important (duplicated individual-entry creation block in admin_import_athletes and admin_bulk_create_entries) — fix round 1/5 dispatched (new implementer, sonnet; FIX_BASE d415c39)
Task 5: minor (deferred): admin_bulk_create_entries surfaces raw FK error for unknown athlete id; malformed birth_date / non-numeric leg index → raw cast error; check-then-insert bib race → raw 23505; dead `en` variable in admin_save_entry
Task 4: fix round 1 applied (commits b9cb55e..a322dee; SQL 3/3 PASS) — scoped re-review dispatched
Task 4: minor (deferred): explicit whole-payload "config": null on UPDATE makes the jsonb merge an array → generic P0001 (no data loss)
Task 15: completion implementer DONE (198d6e8 WIP + 928844e; 13/13 workbook tests, 166 total, typecheck clean) — review dispatched (d648fac..928844e, sonnet)
USER (2026-09-25): "o app antigo é inútil; reutilize o que precisar dele ou delete-o para usar o novo — com os mesmos parâmetros de conferência e qualidade". Inventory of the old app (main @ 0a2464e: src/ 30 files, supabase/schema.sql, docs/PLANO.md, DECISOES.md, public/manifest+sw, .github/workflows/deploy.yml → gh-pages; remote branches gh-pages, claude/event-timing-system-e6oups):
  - code/schema/assets: nothing reusable — different data model (append-only marcacoes/ajuste vs spec marks+resolutions), emoji favicon and navy #0b1a2b branding vs the logo palette, own sw.js vs vite-plugin-pwa; every capability already exists in the new app (clock sync, outbox, xlsx writer, stats, median).
  - field lessons in DECISOES.md (real failed event + trackside testing) → Rulings 21-25 below.
- Ruling 21: the timekeeper route (#/c/:token) opens in the LIGHT theme when the device has no saved theme choice (old lesson: dark screen in the sun becomes a mirror → wrong taps); the admin panel keeps the spec's dark default; the toggle still works and is saved. T22 may edit the theme bootstrap line of index.html for this (only T22 touches index.html) — cost if wrong: timekeepers who like dark tap the toggle once.
- Ruling 22: T22 "Em prova" list — an entry whose latest crossing median is within same_crossing_window_s of now (a relay handoff OR a finish) is pinned to the TOP and stays listed (even when finished) until the window closes, with the line "✓ <perna> <tempo> — toque para confirmar (Ns)"; tapping it records a confirmation mark (suggestLeg → same_crossing). Old lesson: without it the card just tapped jumps away under the finger, other timekeepers can't find it to confirm, and a finished entry vanishes before the 2nd/3rd timekeeper confirms — cost if wrong: a few extra rows pinned for 30 s.
- Ruling 23: NOT ported — old "a timekeeper who already voted is not held by the confirmation window". In the new model a repeat tap by the same timekeeper within the window is a `duplicate` of the same crossing (spec §8 step 2), which is safer against accidental double taps; the assignment toast offers Desfazer/Trocar perna — cost if wrong: a sub-30 s leg needs one "Trocar perna" tap.
- Ruling 24: XLSX keeps typed durations/clock serials with explicit number formats (spec §11 needs numeric cells for the leg-time formulas); the old "tempo como TEXTO" lesson came from a writer that emitted no number formats. Guard: T28 must assert with openpyxl that duration cells carry `[h]:mm:ss.0` and clock cells `hh:mm:ss.0` — cost if wrong: a reader ignoring number formats shows day fractions.
- Ruling 25: finishing replaces the old app on `main` (supersedes the "keep old tree" part of Ruling 17): after T28/T29 and the final review, `main` gets a merge commit whose tree is exactly feat/ebc-app's (old files removed; old commits stay reachable as the first parent — no force-push); then the remote branches `gh-pages` (old compiled site) and `claude/event-timing-system-e6oups` (= old main 0a2464e, still reachable) are deleted, as the user authorized. The old Supabase project (ljwcqnrjsmcgqqxsgfaf) is outside this session's MCP scope → reported to the user, not touched. A README.md for the new app replaces the old one — cost if wrong: restore gh-pages from 397f5ba.
- Note (L6/L7 from DECISOES, no action): the new project is us-east-1 (user decision) — clock uncertainty stays ~±60–130 ms (spec §16), far below the 3 s divergence threshold; T29's get_advisors will flag security-definer tk_*/pub_* callable by anon — expected by design (token/secret checked inside), not a finding.
Task 4: fix round 1/5 (5 addressed, 0 open — Rulings 12 incl. JSON null, 14, 16, NULL bypass, slug TOCTOU; commits b9cb55e..a322dee) — scoped re-review clean
Task 4: minor (deferred): admin_save_event insert catches any unique_violation (tk_token/id collision would read "Endereço público já em uso"); Ruling 14 merge keeps old age_groups/rankings when team_size crosses solo/team without resending config (T19 always sends full config)
Task 4: complete (commits 11c9660..a322dee, review clean) — merged into feat/ebc-app as c34c6e0
CHECK (user request): connectors and skills verified live — Supabase MCP: project wlishmznbhhcqzncdxnq "ENDURANCE BASE CLUB", us-east-1, PG 17.6, ACTIVE_HEALTHY, 0 migrations, 0 public tables (clean, as expected before T29); Vercel MCP: team "Matheus Proj" (team_5RKNbN1EiWlEpXuYzgVp3yy9, slug matheus-proj) reachable; web search OK; skills writing-plans / subagent-driven-development / test-driven-development / brainstorming installed at account level and byte-identical to the project copies in .claude/skills; dataviz available (built-in) → T20 implementer loads it for the StatsView KPI tiles/chart.
- Ruling 26: PWA update must never reload an open timekeeper page mid-race. Found while checking web search: vite-plugin-pwa `autoUpdate` reloads every open tab when a new deploy activates (a MARCAR tap during the reload is lost; a half-typed bib too). T27 uses `registerType: 'prompt'` (no skipWaiting/clientsClaim auto-activation): admin/public pages show a small "Nova versão disponível · Atualizar" toast; the timekeeper page never prompts — the new version applies on the next launch. Deviates from spec §7.4's literal "autoUpdate" but serves its goal (offline shell) without the reload hazard — cost if wrong: devices keep the previous build until reopened.
Task 5: fix round 1 applied (commits d415c39..d0ae28b; SQL 4/4 PASS; shared public.create_individual_entry) — scoped re-review dispatched
Task 6: implemented 2bfd23f (task/6, base d415c39; SQL 5/5 PASS) — review dispatched
Task 5: fix round 1/5 (1 addressed, 0 open — shared create_individual_entry; commits d415c39..d0ae28b) — scoped re-review clean
Task 5: minor (deferred): create_individual_entry re-reads first wave + legs per athlete inside admin_bulk_create_entries (was hoisted before the loop) — N extra lookups, admin-only
Task 5: complete (commits b9cb55e..d0ae28b, review clean; feat merged into task/5, SQL 4/4 PASS) — merged into feat/ebc-app as 9769dca
Task 15: review Approved (d648fac..928844e, no Critical/Important)
Task 15: minor (deferred): Resumo counts use raw TimingStatus (finished-without-start counted as Concluinte, unlike cls.finishers); crossingSourceLabel 'reference' matches by ts equality, untested; 'duplicada' situação untested; third copy of the pt-BR numeric bib Collator
Task 15: complete (commits 61ead91..928844e, review clean) — merged into feat/ebc-app as 835235e
Task 6: review Needs fixes (opus; saved in task-6-review.md) — 1 spec gap/Important (non-discriminating leg-mismatch test), 2 plan-mandated Important (tk_sync replay reverts organizer moves; catch-all turns concurrent duplicate/bad optional field into permanent raw-English rejection)
- Ruling 27: organizer edits win over timekeeper replays. 0005 adds `marks.org_edited boolean not null default false`; admin_update_mark sets it whenever it changes entry_id/leg_index (or unassigns); in tk_sync an update to an org_edited mark whose payload differs from the stored state (entry_id, leg_index, athlete_id, discarded) is rejected with reason 'Alterada pela organização' (mirrors 'Descartada pela organização'); an identical re-send is accepted (idempotent). T22 shows the rejection and the server copy wins in the merged view — cost if wrong: a timekeeper cannot re-edit a mark the organizer already moved (they ask the organizer).
- Ruling 28: tk_sync robustness — (a) insert uses `on conflict (id) do nothing` and a lost race falls through to the existing-row path (ownership/idempotent update); (b) optional audit/hint fields never reject a mark: device_ts invalid → null, clock_offset_ms/clock_rtt_ms rounded to int or null when not numeric, athlete_id unknown or not a member of the entry → null; ts stays strictly validated; (c) the per-mark handler rejects only P0001 validation errors (pt-BR reason); any other error leaves the mark out of both accepted and rejected so the device retries it on the next cycle (stays ⏳ pending) — deviates from the brief's verbatim tk_sync — cost if wrong: a mark with a persistent server bug retries every sync (bounded by the 200-mark batch).
- Ruling 29: entries exposed to the timekeeper link and to public pages omit the organizer-only `notes` (tk_open now; T7's pub_event/pub_live the same); level, status and penalty_ms stay (public classification needs them) — cost if wrong: none.
- Ruling 30: bundle size (T17 build: 605 kB > 500 kB warning) — T27 also owns route-level code splitting in src/App.tsx (React.lazy per page + Suspense with Spinner) so #/c/:token does not download admin screens, XLSX writer, QR or charts; T27's verification includes the chunk list — cost if wrong: one extra loading spinner per first visit of a page.
Task 6: fix round 1/5 dispatched (resume original implementer) — Important 1-3 + Rulings 27-29 + cheap minors (non-P0001 escapes, admin_update_mark athlete_id staleness, tk_open as anon)
Correction: the Task 6 fix round carries Important 1-3 + Rulings 27-29 only (no minors; they stay deferred per SDD).
Task 17: completion implementer DONE_WITH_CONCERNS (3cd4f76 on WIP 3311334 + merge 8066ba6; 23 files / 268 tests, typecheck clean, build ok; concerns: tests importing lib/supabase throw without env; bundle 605 kB) — review dispatched (d648fac..3cd4f76, opus)
- Ruling 31: wave 2a starts now from `base/2a` = bae2379 (feat/ebc-app b7e0774 + merge task/17) while T17's review runs (extends Rulings 6/13); screen tasks own no T17 files, so T17 fixes merge in cleanly; each task/N merges feat/ebc-app before its own merge — cost if wrong: a follow-up fix if a T17 fix changes a consumed contract.
Wave 2a dispatched from bae2379 (worktrees /home/user/ebc-wt/t<N>): T18 (sonnet), T19 (sonnet, Rulings 12/14/16), T20 (sonnet, Ruling 20 + dataviz skill), T22 (opus, Rulings 2/8/10/21/22/27/28 + single-flight sync), T23 (sonnet, Rulings 2/10 + RF5), T24 (sonnet, Rulings 2/11 + RF1), T25 (sonnet, Ruling 9); shared context in wave2-context.md
Task 7: dispatched (worktree /home/user/ebc-wt/t7, branch task/7 from task/6 2bfd23f, sonnet; Rulings 15, 29, public marks also drop org_edited)
Task 17: review Needs fixes (opus; saved in task-17-review.md) — Important: session restore drops/revokes sessions on transient errors (global signOut); controller items: .env.test, stale timekeepers
- Ruling 32: tests get a committed `.env.test` with the LOCAL values (VITE_SUPABASE_URL=http://127.0.0.1:54321 + the local publishable key `sb_publishable_local_dev`, same variable names as .env.development) so importing src/lib/supabase in Vitest never throws; added by the T17 fix round; screen tests still mock `api` — cost if wrong: none (local, non-secret values).
- Ruling 33: timekeepers stay fresh client-side (no server/type change): useEventData calls refresh() when a delta brings a mark whose timekeeper_id is not in agg.timekeepers, and on live tabs refetches the full aggregate every 30 s; T23 computes per-timekeeper mark counts from agg.marks and shows "última atividade" from last_seen_at (≤ 30 s stale) — cost if wrong: timekeeper activity lags ≤ 30 s.
- Ruling 34 (promotes T17 Minor 1, load-bearing for T22's single-flight sync and the clock): api.ts gives every RPC a timeout (AbortSignal.timeout, 15 s; `server_time` 5 s) mapped to ApiError('Sem conexão com o servidor','network') — otherwise one request hung on bad 4G freezes the timekeeper's sync loop and clock resync — cost if wrong: a very slow response is retried instead of awaited.
Task 17: fix round 1/5 dispatched (resume implementer) — Important 1 + Rulings 32, 33, 34 (other minors deferred)
Task 17: minor (deferred): permanent poll errors swallowed / EventLayout ignores error after first load; refetchOnWindowFocus refetches aggregate; changePassword partial-success retry; "Revisão2" accessible name; test gaps (agg stability, SIGNED_OUT clears cache)
Task 6: fix round 1 applied (commits 2bfd23f..45a2f9e; SQL 5/5 PASS) — scoped re-review dispatched
Task 7: implemented 4f48716 (task/7, base 2bfd23f; SQL 7/7 PASS; shim test 5/5) — touched supabase/tests/10_schema.sql (one stale assertion: anon table read now 42501) → accepted, file granted to T7
- Ruling 35: 0006 also runs the role-global `alter default privileges revoke execute on functions from public` (the schema-scoped form cannot remove Postgres's built-in PUBLIC execute default — found by the T7 implementer), and 60_security proves a function created after the migration is not executable by anon/authenticated — cost if wrong: none.
Task 7: amendment (Ruling 35) sent to the implementer before review
Task 19: implemented 12747ed (task/19, base bae2379; 33 focused tests, full 320/321 — the 1 failure is T17's eventShell test asserting stub text "RacesTab") — review dispatched
- Ruling 36: T17's shell/route tests must mock the page modules with marker components instead of asserting stub text (fixed in T17's fix round) — every screen task replaces a stub, so stub-text assertions are guaranteed collisions; screen branches merge after T17's fix — cost if wrong: none.
Task 6: fix round 1/5 (4 addressed, 0 open — discriminating tests, Ruling 27 org_edited, Ruling 28 robustness, Ruling 29 no notes; commits 2bfd23f..45a2f9e) — scoped re-review clean (opus, probes incl. two-session race)
Task 6: minor (deferred): malformed required fields (unparseable ts, entry_id, leg_index, discarded, id) are non-P0001 → silently retried forever instead of rejected (fix: nested cast block raising P0001 'Horário inválido'/'Marcação inválida'); identical re-send rejected after the organizer moved a mark carrying a stale athlete_id (fix: admin_update_mark clears athlete_id when entry_id changes); tests don't discriminate on-conflict race path, 28(c) handler, athlete membership vs existence, org check's athlete_id/discarded comparisons; MarkRow type lacks org_edited?
Task 6: minor (deferred, from review): untested security branches (tk_enabled=false, cross-event entry, foreign token, last_seen_at, timekeeper discard, organizer-discard re-send); non-P0001 escapes (p_mode null, discarded/active null, finalize missing status/bad uuid/duplicate rows); admin_update_mark ignores leg_index when unassigned, keeps resolutions pinned to moved marks; timekeeper name cap only in tk_register; device_label unbounded; leg-range check ×3 and waves query ×2 duplicated
Task 6: complete (commits d415c39..45a2f9e, review clean; feat merged into task/6, SQL 5/5 PASS) — merged into feat/ebc-app as 7daab1d
