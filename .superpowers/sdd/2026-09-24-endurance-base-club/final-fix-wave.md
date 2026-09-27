# Final fix wave (Ruling 58) — the complete list, split by file ownership

Source reports (same folder): final-review-A-report.md, final-review-B1-report.md, final-review-B2-report.md, final-review-C-report.md. Each item names its report and id; read the item there for the full "where / why / fix" text. Every item: failing test first (TDD), then the fix. The production database is still EMPTY, so SQL fixes edit the existing migration files 0001–0006 directly (no 0007), with assertions added to supabase/tests/*.sql (no psql meta-commands).

## Fixer 1 — server, domain, libraries, auth (runs first)
Owns: supabase/migrations/**, supabase/tests/**, dev/** (only if the shim must follow a change), src/lib/api.ts(+test), src/features/auth/session.tsx(+auth.test), src/domain/**, src/lib/{format,clock,importMapping,csv}.ts(+tests), src/lib/xlsx/**, src/hooks/useClock.ts(+test), and in src/features/public/PublicEventPage.tsx ONLY the import/call-site change for item F1.5.
1. A-I1 — admin_duplicate_event copies a foreign reference_timekeeper_id → null it (and time_source reference→median) in the copy; validate reference_timekeeper_id only when time_source = 'reference'. Test in 20_admin_events.
2. A-I2 — offline "Sair" with an expired token keeps ebc.auth → remove the stored session after signOut whatever it returns, and a signed-out guard so TOKEN_REFRESHED/SIGNED_IN cannot restore until the next explicit signIn. Test per the report.
3. B1-I2 — legs/team size editable after entries: in admin_save_race UPDATE, when entries exist reject a team_size change ("Não é possível alterar o tamanho da equipe com inscrições"); when the leg count changes and team_size = 1 rewrite entry_members.legs to 0..N−1 for the race's entries; when team_size > 1 reject a leg-count change while entries exist. Domain defence: legAthleteId falls back to the only member when members.length === 1; suggestLeg filters candidate legs to < race.legs.length.
4. C-I3 (server part) — admin_save_race refuses to delete a wave that has start_at or entries (P0001 pt-BR naming the wave).
5. B1-I1 / B2-I2 (domain part) — move the finalized-race reconstruction (`classificationFromResults` + podium reconstruction) out of PublicEventPage into a shared domain module, add a pure `snapshotDrift(live, results)` helper (per entry: status, final_ms, overall_pos, podium membership → list/count), and make the workbook build Classificação/Pódios of FINALIZED races from the snapshot, with the Resumo "Finalizada" cell saying when the live data differs ("Sim — difere do ao vivo"). Keep Tempos/Marcações live (raw conference data). PublicEventPage switches to the shared helper (import only). Export the helper names/signatures in your report — Fixer 2 consumes them.
6. A-M2 — api.ts maps non-P0001/42501 codes to pt-BR (57014, 23505/23503, 22P02, 23502, PGRST202/PGRST002, 40P01, status ≥ 500 → network-class "servidor indisponível", generic fallback). P0001/42501 messages stay verbatim.
7. A-M3 — admin_get_event must not return timekeepers' `secret` (+ assert in 40_timing).
8. A-M4 — `select … for update` in tk_sync (first select and the re-select after the lost insert race) and admin_update_mark.
9. A-M5 — long event names: cap the slug base (~60 chars, trim trailing '-') before appending the date; cap in next_unique_public_slug.
10. A-M6 — 60_security: full EXECUTE-matrix assertions for anon and authenticated (queries in the report).
11. A-M7 — athlete tallies use `r.athlete_ids @> array[a.id]` (0004 and 0006 sites).
12. A-M8 — admin_save_race: the wave upsert never re-parents another race's wave; an UPDATE never changes event_id.
13. B2-m7 (server part) — admin_update_mark sets athlete_id to the moved-to leg's athlete (or null when unassigned) whenever entry_id/leg_index changes.
14. C-Minor-2 (server part) — empty/invalid event date → P0001 "Informe a data do evento" instead of a raw cast error.
15. B1-M1 — year-only birth date in import: reject 4-digit 1900..2100 with "Data de nascimento incompleta: informe dia/mês/ano" and accept Excel serials only in a plausible range.
16. B1-M2 — sheet names unique case-insensitively, no leading/trailing apostrophe, a shorter "Class. – " style prefix so truncation stays distinguishable.
17. B1-M3 — stats skip DSQ results and non-positive leg times for records/pace/km.
18. B1-M4 — a total ≤ 0 is not ranked (Ruling 9 group).
19. B1-M6 — chosen-mark warning: "foi descartada ou movida".
20. B1-M7 — new warning issue when a DNS/DSQ/DNF entry has crossings ("Nº X está como <status> mas tem passagens").
21. B1-M8 — Marcações sheet: 'usada' only when the mark feeds official_ms; otherwise 'não usada (decisão)'.
22. B1-M9 — formatPace rounds to the nearest second with carry (4:59.6 → 5:00).
23. B1-M10 — workbook floors milliseconds to tenths before the Excel serial/duration conversion, matching the screen.
24. T15 (B1 triage) — Resumo "Concluintes" equals the classification's finishers (finished-without-start counted apart); the reference-timekeeper source label uses config.reference_timekeeper_id, not ts equality.
25. B1-M11 + B2-m4 — clock: drop samples whose offset differs from the newest by > 1 s (device clock step); a saved clock state older than 12 h counts as not synchronized for the warning (useClock).

## Fixer 2 — timing screens (runs after Fixer 1 is merged; consumes item F1.5's helpers)
Owns: src/features/timekeeper/**, src/features/timing/**, src/features/review/**, src/features/results/**, src/hooks/useEventData.ts(+test), src/features/events/EventLayout.tsx (only the stale-data hint of item 10).
1. B2-I1 — ReviewTab stable per-issue keys; test that a typed bib stays with its mark when the list shifts.
2. B2-I2 (UI part) — for a finalized race ResultsTab renders table/podiums from the snapshot (shared helper), shows a drift banner ("Há N alterações depois da finalização — reabra e finalize de novo para oficializá-las"), the same hint on Revisão for finalized races; finalize rows are built from the latest context after the confirm resolves; confirm copy no longer promises "não mudam mais sozinhos"; export uses the updated workbook.
3. B2-I3 — LiveBoard: marks younger than UNASSIGNED_ISSUE_AFTER_MS show "com o cronometrista · há N s" without the assign form.
4. B2-I4 — link rotation/disable: (a) TimingTab confirm copy tells the truth; (b) the timekeeper's `invalid` phase with a registration polls tk_open (~10 s) and offers "Tentar novamente" (covers re-enable); (c) the device registration is keyed by EVENT so a new link of the same event keeps the same timekeeper_id/secret (migrate the old per-token key on read); (d) MARCAR stays available while the link is invalid (outbox only, with a clear banner) so crossings in the gap are kept and sync once a valid link is open.
5. B2-m1 — timekeeper toasts never swallow taps meant for "Em prova" rows or MARCAR (pointer-events pass through except on buttons; shorter duration or inline status).
6. B2-m2 — track row presses per pointerId (multi-touch).
7. B2-m3 — wake lock re-requested after refusal/release (first MARCAR/row press, visibility).
8. B2-m5 — prune other events' ebc.tk.* keys whose outboxes have nothing pending when a session opens.
9. B2-m7 (phone part) — a rejected item stops counting once the server copy exists (with Fixer 1's athlete_id refresh identical placements are no longer rejected).
10. B2-m8 — organizer live views: show "sem conexão · dados de hh:mm:ss" when the last successful poll is > ~10 s old (useEventData exposes it; EventLayout shows it).
11. B2-m9 — re-starting a started wave: copy names the previous start time and offers Desfazer with it.
12. B2-m10 — CrossingEditor "Mover" honours an explicitly chosen leg with a bib and toasts the destination.
13. B2-m11 — finalize offers "Marcar N como DNF" for entries still on course (spec §8).
14. B2-m12 — pt-BR decimals with comma ("3,5 s", "+0,3 s") and no "(s)" plurals in Review/CrossingEditor/ResultsTab.
15. B2-m13 — revoke the export blob URL after a delay (iOS Safari).
16. T28 minors (B2 triage) — bib field: no caret-looks-like-"+" (empty/other placeholder); CrossingEditor wide enough to reach "Mover para" without sideways scroll at 1280 px; no "Duda · Duda" subtitle for individual entries.

## Fixer 3 — organizer/public UI, kit, shell, delivery (runs in parallel with Fixer 1)
Owns: src/components/**, src/features/{athletes,entries,events (except EventLayout's stale hint),races,public,settings,help}/**, src/features/NotFound.tsx, src/App.tsx, src/main.tsx, index.html, vite.config.ts, vercel.json, package.json (+ package-lock.json if needed), tsconfig.json, tests/e2e/**. In PublicEventPage.tsx avoid the reconstruction functions (Fixer 1 moves them); edit only tabs/retry/title/refetch parts.
1. C-I1 — PWA: registerSW gets onNeedReload that never reloads `#/c/`; onNeedRefresh de-duplicated (one toast); options extracted into a small tested builder; fix the UpdatePrompt test title.
2. C-I2 — Modal stack: Escape and Tab act only on the top-most open modal; remove EntryForm's stopImmediatePropagation coupling; nested-modal tests (Escape closes only the inner; Tab stays inside the inner).
3. C-I3 (UI part) — RaceEditor: removing a wave that has a start or entries asks for confirmation naming the consequence and the entry count (the server now refuses — show its message).
4. C-I4 — failed saves in RaceEditor and EntryForm scroll the error banner into view and focus it.
5. B1-I2 / C-Minor-5 (UI part) — RaceEditor warns, with the entry count, before changing legs/team size when entries exist (the server now rejects/rewrites).
6. C-Minor-1 — athlete pickers and the bulk list show loading and error states (never "Nenhum atleta" while loading or after a failure).
7. C-Minor-2 (UI part) — client check "Informe a data do evento".
8. C-Minor-3 — import shortcut preselects the event (`?import=1&evento=<id>`); clearer select label.
9. C-Minor-4 — deletion confirm copy tells the truth (marks become "sem atleta"; results/histories are erased).
10. C-Minor-6 — unsaved edits: block navigation away from a dirty RaceEditor/EventGeneralTab with a confirm; form modals don't close on backdrop click.
11. C-Minor-7 — `#/` offers "Voltar à cronometragem" when this device has a timekeeper link (remember the last `#/c/` token).
12. C-Minor-8 — tab strips usable at 390 px (public race tabs and admin event tabs): wrap or scroll the active tab into view with a visible affordance.
13. C-Minor-9 — pt-BR error element ("Algo deu errado · Recarregar") on the router, incl. a failed lazy chunk.
14. C-Minor-10 — Inscrições "Categoria" shows only the dimensions that apply to the race/event.
15. C-Minor-11 — WCAG AA text contrast for status texts via brand-derived tints (no new brand colours).
16. C-Minor-12 — deploy: package-lock.json used and `npm ci` as installCommand, `"engines": {"node": "22.x"}`, `Cache-Control: public, max-age=31536000, immutable` for /assets/*, and nosniff / frame-ancestors (or X-Frame-Options DENY) / Referrer-Policy headers.
17. C-Minor-13 — deleting an event invalidates ['events'] and removes ['event', id].
18. C-Minor-14 — public pages: retry button on load errors, refetchOnWindowFocus off for the full payload, pub_live failures surfaced.
19. C-Minor-15 — document.title reset outside the public pages.
20. C-Minor-16 — chart tooltip stays inside 390 px; public partner links only to public profiles.
21. C-Minor-17 — pt-BR copy consistency (plurals without "(s)" incl. BulkEntryDialog and ImportDialog, punctuation, "organizadora" vocabulary, "Quem faz cada perna", Help "níveis" location, ThemeToggle label as action, "Endereço público").
22. C-Minor-18 — E2E asserts the classification ORDER and that public payloads/pages show no e-mail, phone or birth date.
23. C-Minor-19 (part) — theme-color follows the active theme (the timekeeper opens light). Icons deferred.
24. C-Minor-20 — package.json hygiene (license "UNLICENSED", drop npm-init boilerplate).

## Deferred (not in this wave; listed for the record)
A-M1 (disable public sign-ups — done in T29 as config), B1-M5 (suggestLeg vs manual resolutions), B1-M12/M13 (XLSX rows without `r`, title row above header), B2-m6 (server-side cap of the sync delta), B2-m14 (no_start → Largadas link), C-Minor-19 icons (512/maskable), E2E 390 px pass over the editor forms, and every ledger minor the reviewers marked "defer". Real-device smoke test (one Android, one iPhone) goes to the user's pre-event checklist.
