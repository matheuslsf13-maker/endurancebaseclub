# Task 28 report — E2E validation with agent-browser (local stack)

Worktree `C:\ENDURANCE\ebc-wt\t28`, branch `task/28`, BASE `928c428`, HEAD `b343eca`.
Environment per Ruling 56: every node/npm/npx/bash command inside WSL (`Ubuntu-24.04`, root) on
`/mnt/c/ENDURANCE/ebc-wt/t28`; git from Windows Git Bash; agent-browser 0.27 with its own Chrome 154
(no hardcoded executable path).

## Status: DONE_WITH_CONCERNS

The whole event day passes end to end (`E2E PASS`) after 8 source fixes, each with a failing test
first. Concerns are small UX/copy observations that need a design call (listed at the end), none
blocks an event.

## Commits (928c428..b343eca)

| SHA | Subject |
|---|---|
| e269d95 | fix(results): name relay teams in the classification and podiums |
| f7a3085 | fix(races): pluralize "inscrições" in the races list |
| ede8971 | fix(ui): keep positioned cells inside the table scroller |
| dac40ba | fix(ui): make tinted toasts opaque |
| abb5892 | fix(theme): declare color-scheme per theme |
| 09fbd3a | fix(layout): give the main nav its own row on phones |
| 8f787fe | fix(timing): align the Cronometragem tab with the other tabs |
| 5b15dad | fix(theme): brand accent for native radios and checkboxes |
| b343eca | test(e2e): agent-browser scenarios for setup, timing, review, results and public pages |

All with the single trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Not pushed.

## What I built (tests/e2e)

- `run.sh` — `set -euo pipefail`; `EBC_DB=ebc_e2e SHIM_PORT=54321`; empties `artifacts/` (keeps
  `.gitkeep`); `scripts/db-local.sh reset`; seeds `bootstrap_owner('master@ebc.local','ebc-dev-12345','Master E2E')`
  (`must_change_password` stays true); shim in background → `artifacts/shim.log`, waits for
  `/rest/v1/` to answer; `npx vite build --mode e2e` (→ `build.log`) and `npx vite preview --mode e2e
  --port 4173 --strictPort &` (→ `preview.log`), waits; runs 01..04 with `bash`; `trap` closes all
  agent-browser sessions, kills the jobs (plus a `pkill -f 'vite[ ]preview --mode e2e'` fallback for
  npx's child — the `[ ]` keeps pkill from matching its own shell), prints `E2E PASS` or
  `E2E FAIL in <script>`. ~3.5 min.
- `lib.sh` — the brief's essentials (`ab`, `tid`, `wait_tid`, `expect_text` with fail screenshot,
  `snap`, `step`) plus: `tap`/`tap_tid` (scrollintoview + click — **agent-browser 0.27 clicks a CSS
  selector at its current box without scrolling it into view**; a below-the-fold "Salvar" got the
  click on `<html>`), `wait_text` (poll), `js`/`js_str` (`eval --stdin`), `set_value` (native setter +
  input/change — `<input type=date>` typing is locale-dependent, `fill` left it empty),
  `select_label`, `pick_member` (EntryForm combobox), `click_with_text`/`tap_nth` (mark the element,
  then `tap` it), `no_hscroll` (fails naming the elements that stick out, positioned ones included),
  `snap_pages` (viewport shots top→bottom: `screenshot --full` re-lays out without the scrollbar but
  crops to the old width, so right edges looked clipped at 390 px), `save_state`/`load_state`
  (`artifacts/state.env`: EVENT_URL, SLUG, TK_LINK, bibs). `AGENT_BROWSER_EXECUTABLE_PATH` is only
  passed through when the caller set it (Ruling 56 c).
- `01_master_setup.sh` (1280×800) — login, forced change to `ebc-dev-67890` (`newpass-*`), event
  "Desafio EBC E2E" (today in Brasília, levels `Elite, Base`), Geral `event-public` + `event-save`
  (reads the slug), presets "Revezamento em dupla (natação + corrida)" and "Corrida 5 km" (asserts the
  preset filled the name), athletes Ana F 15/06/1990, Beto M 20/01/1988, Caio M 03/03/1995, Duda F
  09/09/1999, team "Tubarões" (Ana → Natação, Beto → Corrida via `entry-leg-*`), bulk Caio + Duda on
  Corrida 5 km; asserts the table lists three distinct numeric bibs and "Ana – Natação · Beto – Corrida".
- `02_timing.sh` — master reads `TK_LINK` (`tk-link`, `get value`); `tk1`/`tk2` at 390×844 open it
  (asserts the light theme, Ruling 21) and register "Ana TK"/"Bia TK"; **Ruling 45**: a second tab of
  `TK_LINK` in `tk1` shows "Este link já está aberto em outra aba deste aparelho — use aquela aba" and
  no MARCAR, then is closed; master starts both waves (`wave-start` ×2 + `confirm-ok`); relay handoff:
  tk1 bib + MARCAR → `assign-toast` "fim da perna 1/2 (Natação)", tk2 MARCAR within ~1 s (same
  crossing, no divergence) and assigns later via `bib-input` + `bib-submit` → "Natação";
  `oncourse-list` shows Tubarões with "Beto · Perna 2/2 · Corrida"; waits ≥ 33 s after the handoff
  (same-crossing window 30 s) then tk1 `set offline on`, marks the team finish → "fim da perna 2/2
  (Corrida)", `tk-sync-status` "Sem internet · 1 marcação guardada…", `set offline off` → "sincronizado";
  Caio: tk1 bib + MARCAR, tk2 taps Caio's "Em prova" row (arrival tap); Duda: tk1 MARCAR,
  `wait 4500`, tk2 MARCAR (≥ 4 s divergence); both "tudo sincronizado"; tk1's list shows the pinned
  "✓ marcada por você" rows (Ruling 44 M8); **focus** (`document.activeElement`) stays in `bib-input`
  after MARCAR (tk1) and after the "Em prova" row tap (tk2) — Ruling 44 M10/Ruling 53; no sideways
  scroll at 390; screenshots light and dark (theme toggle, then back).
- `03_review_results.sh` — Revisão: `issues-list` has "divergência" for Duda's bib; Resolver → picks the
  `resolution-mark-*` whose label is Ana TK, `resolution-save`; the divergence leaves the list.
  Resultados: `race-select` Corrida 5 km → `classification-table` ranks Caio and Duda 1º/2º;
  `podiums` visible; `ab master download export-xlsx planilha.xlsx`; `verify-xlsx.py` prints `OK 10
  sheets`; **Ruling 24** python/openpyxl check: in both `Tempos – *` sheets every Largada/Passagem cell is
  `hh:mm:ss.0` and every Tempo k/Total/Penalidade/Final cell `[h]:mm:ss.0` (and Classificação's Tempo
  final/Dif. p/ 1º), each a number/date/formula, never text (7 clock + 19 duration cells);
  finalizes Corrida 5 km and the relay (`finalize-race` + `confirm-ok` → "Oficial"); Atletas → Ana →
  "Pódios"/"Participações"; then Cronometragem/Revisão/Resultados, the review editor and Eventos at
  390×844 with `no_hscroll`.
- `04_public_offline.sh` — `pub` at 1280: `#/p/<slug>` → `public-results` has "Tubarões" and "Resultado
  oficial"; Ana's public link → `public-athlete` "Participações"; same page and `#/` at 390×844 (no
  sideways scroll); tk1: `navigator.serviceWorker.ready` active, `set offline on`, `reload` → MARCAR
  renders, "Sem internet", `navigator.serviceWorker.controller` non-null; `set offline off` →
  "sincronizado".
- `README.md` — how to run, scenario table, requirements, helper conventions.
- `artifacts/.gitkeep` (artifacts git-ignored, verified with `git check-ignore`).

## Defects found (each: repro → failing test → fix)

1. **Relay team name shown nowhere on results** (admin + public). Repro: E2E 03 "finalize both
   races" failed — `'Tubarões' not in classification-table: … Ana (Natação) · Beto (Corrida) …`;
   scenario 04 requires `public-results` to contain "Tubarões". ClassificationTable/PodiumView named a
   team only by its members, while the XLSX "Atleta/Equipe" uses the team name.
   Tests (results.test.tsx): "names a team entry by its team name, above its members (admin and public
   links)" and PodiumView "names a team by its team name, with its members". RED: `2 failed | 14
   skipped` — `Unable to find an element with the text: Tubarões`. Fix: team name (bold) with the
   members line under it (T25's "Ana (Natação) · Beto (Corrida)" kept). GREEN: results + public 25/25.
   → e269d95
2. **"0 inscriçãos"** in the Provas list (`inscrição` + English "s"). Test (races.test.tsx) "counts
   inscriptions in Portuguese". RED: `Unable to find … 2 inscrições` (rendered `2 inscriçãos`). GREEN
   races 37/37. → f7a3085
3. **Cronometragem scrolls sideways at 390 px** (document 752 px). Repro: E2E 03 mobile step
   `cronometragem scrolls horizontally`; probe found `label.sr-only pos=absolute L=751` — the wave
   time label in a table column scrolled off to the right is positioned against the page because the
   kit Table's `overflow-x-auto` scroller is not positioned. Test (ui.test.tsx) "its horizontal
   scroller is the containing block of positioned cells". RED: `toHaveClass("relative")` failed. Fix:
   `relative` on the kit Table scroller (all tables benefit). GREEN 29/29. → ede8971
4. **See-through toasts** (deferred T22 concern, Ruling 56 d). Screenshot: at 390×844 "Prova
   finalizada." sat over the timekeeper QR code and was unreadable; at 1280 card borders showed
   through. Kit tones were `bg-success/15` etc. Test: "a %s toast is opaque" (4 tones). RED: success,
   warning, danger failed. Fix: tint mixed into the surface —
   `bg-[color-mix(in_srgb,var(--color-success)_15%,var(--color-surface))]` (same look, opaque;
   verified the CSS and variables in the build). GREEN 33/33. → dac40ba
5. **No `color-scheme`**: the dark admin kept light native widgets — white scrollbars (page, tabs,
   table scrollers) and a dark calendar icon lost on the dark date field (01-new-event/01-general).
   Test: "each theme declares its color-scheme" (reads `src/index.css`; jsdom applies no stylesheet).
   RED: `expected ':root, [data-theme="dark"] {…' to match /color-scheme:\s*dark;/`. Fix: `color-scheme:
   dark|light` per theme block. GREEN 34/34. → abb5892
6. **Admin nav squeezed on phones**: at 390 px the nav sat beside "Modo noite/Sair" showing only
   "Eventos Atletas"; "Ajuda"/"Configurações" off-screen. Cause: unprefixed `flex-1` (flex-basis 0)
   overrode the intended `w-full` third row. Test: "on phones the main nav gets a full-width row of its
   own". RED: `toHaveClass("w-full order-3 sm:flex-1")`. Fix: `flex-1` → `sm:flex-1`. GREEN 35/35;
   confirmed in 03-mobile-events.png. → 09fbd3a
7. **Cronometragem inset from the other tabs**: TimingTab added `p-4 sm:p-6` inside EventLayout's
   padding — cards 24 px inside the tab bar at 1280, and 16 px narrower on a phone. Test (timing.test.tsx)
   "adds no padding of its own". RED: received `["p-4","sm:p-6"]`. GREEN 23/23. → 8f787fe
8. **Browser-blue radios** in the Revisão decision (CrossingEditor); only the kit Checkbox set
   `accent-color`. Test: "native radios and checkboxes use the brand accent". RED as expected. Fix:
   `accent-color: var(--accent)` on the root (inherits, follows the theme). GREEN 36/36. → 5b15dad

Test/script mistakes found while iterating (not app defects): the tk2 focus check after a bare
MARCAR (tk2 never had the bib field focused — MARCAR keeps focus where it was, so the check is only
on tk1 and after the row tap where tk2 focuses the field first); openpyxl turns numeric cells with
time formats into datetime/timedelta (the check uses `cell.data_type in n/d/f`); the relay finish
must be ≥ 30 s after the handoff median or it is (correctly) the same crossing.

## Screenshot review (all PNGs read)

1280×800 (master, dark): 01-login, 01-change-password, 01-new-event (calendar icon visible after fix
5), 01-general (opaque toasts after fix 4), 01-races ("0 inscrições" after fix 2), 01-athletes,
01-entry-form, 01-bulk-entries, 01-entries (table scrolls sideways for the row actions — by design),
02-master-waves, 02-master-live, 03-review-issues, 03-review-editor, 03-review-resolved,
03-results-5k, 03-results-official, 03-athlete-ana, 04-public-results (team name after fix 1),
04-public-athlete.
390×844: timekeeper 02-tk-registered, 02-tk-second-tab, 02-tk-assign-toast (neutral opaque toast,
readable), 02-tk-offline (header wraps the offline count, intended), 02-tk2-row-tap, 02-tk-light-1/2,
02-tk-dark-1/2 (MARCAR ≥ 35 % height, tabular clock, pinned rows), 04-tk-offline-reload; admin
03-mobile-cronometragem-1..3 (overflow fix 3, alignment fix 7, readable toast fix 4, nav fix 6),
03-mobile-revisao-1/2, 03-mobile-resultados-1/2, 03-mobile-review-editor, 03-mobile-events; public
04-public-results-mobile-1, 04-public-home-mobile.
Checked: no sideways page scroll (asserted), touch targets, toast readability, native widgets in the
dark theme, alignment with the tab bar, truncation, both themes on the timekeeper.
Screenshot artifacts ignored as non-defects: agent-browser's `scrollintoview` centers elements (the
clock half under the sticky header in some tk shots; a table scrolled sideways after tapping a
button in it); classic headless scrollbars (phones use overlay ones); `--full` crop (replaced).

## Final gate (WSL, t28, commit tree = HEAD)

```
> endurance-base-club@1.0.0 typecheck
> tsc --noEmit -p tsconfig.json
(clean)

 Test Files  40 passed (40)
      Tests  620 passed (620)
   Duration  149.82s

> vitest run -c vitest.integration.config.ts
 ✓ tests/integration/flow.test.ts (11 tests)
 ✓ tests/integration/shim.test.ts (5 tests)
 Test Files  2 passed (2)
      Tests  16 passed (16)

PASS supabase/tests/00_helpers.sql
PASS supabase/tests/10_schema.sql
PASS supabase/tests/20_admin_events.sql
PASS supabase/tests/30_admin_athletes_entries.sql
PASS supabase/tests/40_timing.sql
PASS supabase/tests/50_public.sql
PASS supabase/tests/60_security.sql

=== 03_review_results
classification: ["1 1 2 Caio Masculino · 30-39 0:37 0:37 Concluiu","2 2 3 Duda Feminino · 20-29 0:39 0:39 +0:02 Concluiu"]
--- export the workbook (verify-xlsx + Ruling 24 number formats)
number formats OK {'hh:mm:ss.0': 7, '[h]:mm:ss.0': 19}
--- finalize both races
--- Atletas: Ana's profile shows her stats
--- master screens at 390×844
=== 04_public_offline
--- public results
--- public athlete page
--- public pages at 390×844
--- timekeeper reloads the link offline (service worker)
E2E PASS
GATE EXIT 0
```
(vitest 608 → 620: +12 tests from the fixes.) The E2E also passed in the three runs before the gate.

## Files changed

- New: `tests/e2e/run.sh`, `lib.sh`, `01_master_setup.sh`, `02_timing.sh`, `03_review_results.sh`,
  `04_public_offline.sh`, `README.md`, `artifacts/.gitkeep` (scripts committed +x).
- Fixes: `src/features/results/ClassificationTable.tsx`, `PodiumView.tsx`, `results.test.tsx`;
  `src/features/races/RacesTab.tsx`, `races.test.tsx`; `src/components/ui/Table.tsx`, `Toast.tsx`,
  `ui.test.tsx`; `src/components/Layout.tsx`; `src/index.css`; `src/features/timing/TimingTab.tsx`,
  `timing.test.tsx`.

## Concerns (not changed — need a design call or are cosmetic)

1. Review editor (CrossingEditor, modal `lg`): the marks table needs sideways scrolling even at 1280
   to reach "Mover para / Nº / Mover" (03-review-editor.png); usable, but a wider modal or stacked
   per-mark actions is a layout decision.
2. Timekeeper bib field: the centered "—" placeholder with the caret on top reads as "+" while the
   field is focused (its normal state after MARCAR). Cosmetic; hiding the placeholder on focus is an
   option.
3. Copy nits: bulk toast "2 inscrição(ões) criada(s)." (BulkEntryDialog); CrossingEditor subtitle
   repeats the name for individuals ("Duda · Duda").
4. Admin header at 390 px uses three rows (brand / theme+Sair / nav) — Layout's design, now with the
   nav visible; the public header similarly wraps its buttons.
5. Tooling notes for T29/final review: agent-browser 0.27 needs `scrollintoview` before CSS-selector
   clicks and `--full` screenshots crop at 390 px (both handled in lib.sh). XLSX sheet names are cut at
   Excel's 31 chars ("Tempos – Revezamento em dupla (") — expected.
