## Task 25: Results tab — classification, podiums, finalize, XLSX export, print

**Files:**
- Modify: `src/features/results/ResultsTab.tsx`
- Create: `src/features/results/ClassificationTable.tsx`, `src/features/results/PodiumView.tsx`, `src/features/results/exportWorkbook.ts`, `src/features/results/results.test.tsx`

**Interfaces:**
- Consumes: `useEventContext`, `buildFinalizeRows`, `buildEventWorkbook`, `workbookFileName`, `writeXlsx`, `api.admin.finalizeRace/unfinalizeRace`, `STATUS_LABEL`, `groupLabel`, `formatDuration`, `formatGap`.
- Produces: `ClassificationTable({ race: RaceRow; cls: RaceClassification; showLegs?: boolean; linkAthletes?: 'admin'|'public'|false })` and `PodiumView({ cls: RaceClassification })` — both reused by the public event page (Task 26); `exportWorkbook(agg, timing, classifications): void` (builds, writes and downloads the Blob via a temporary `<a download>`).

Behavior:
- Race selector `race-select`; header badge "Oficial · finalizada em dd/mm/aaaa hh:mm:ss" or "Parcial (ao vivo)"; count of pending issues for the race with a link to Revisão.
- `ClassificationTable` (`classification-table`): Pos, Nº, Atleta/Equipe (team shows members "Ana (Natação) · Beto (Corrida)"), Categoria, per-leg times (when `showLegs`), Total, Penal., Final, Dif. 1º, Status; podium positions highlighted; horizontally scrollable on mobile.
- `PodiumView` (`podiums`): per ranking → group cards with 1º/2º/3º (name, Nº, time).
- Actions: `export-xlsx` "Exportar planilha" (all races, whole event); `finalize-race` → confirm showing the number of open errors/warnings/on-course entries for that race ("Ainda há N atletas em prova — eles ficarão como Em prova/DNF…") → `finalizeRace(race.id, buildFinalizeRows(event, cls, athletesById))` → toast + refresh; `unfinalize-race` (confirm); `print` → `window.print()` (print CSS: hide nav/buttons with `no-print`, show event title).

- [ ] **Step 1: Failing `results.test.tsx`** (context fixture: individual race with 3 finishers + 1 DNF): table rows in order with positions and gaps; `finalize-race` + `confirm-ok` calls `finalizeRace(raceId, rows)` where `rows.length === 4` and the winner has `overall_pos 1`; `export-xlsx` calls `URL.createObjectURL` with a Blob of type `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (mock it) and the anchor `download` equals `workbookFileName(event)`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS + typecheck. **Step 5: Commit** (`feat(results): classification, podiums, finalize and XLSX export`).

---

