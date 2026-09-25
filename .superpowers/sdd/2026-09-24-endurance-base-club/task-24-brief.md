## Task 24: Review tab — pending issues and crossing decisions

**Files:**
- Modify: `src/features/review/ReviewTab.tsx`
- Create: `src/features/review/CrossingEditor.tsx`, `src/features/review/review.test.tsx`

**Interfaces:**
- Consumes: `useEventContext`, `api.admin.setResolution/clearResolution/updateMark`, `ISSUE_LABEL`, `SEVERITY_LABEL`, `crossingSourceLabel`, `formatClock`, `parseClockInput`.

Behavior:
- Issue list `issues-list` grouped by severity (Erros, Avisos, Info collapsed by default), filter by race and type; each issue shows its message and actions: "Resolver" (opens `CrossingEditor` for its entry/leg), and for divergence issues with `suggested_leg_index` a button `move-mark-suggested` "Mover marcação para a perna N (<label>)" → `updateMark(mark_ids[0], { leg_index: suggested })`; unassigned issues get an inline bib assignment (same helper as Task 23).
- "Todas as passagens" list: search by bib/name; per entry, per leg a `crossing-row` showing official time, source label, candidates count, spread, status badge; click → `CrossingEditor`.
- `CrossingEditor` (modal): header (Nº, name, leg, athlete); candidates table (cronometrista, hora `formatClock(ts,{millis:true})`, Δ para a mediana in seconds with sign, duplicate/discarded badges; per-mark actions: descartar/restaurar → `updateMark({discarded})`, mover para outra perna/inscrição → small form → `updateMark`); decision radio: `resolution-system` "Tempo do sistema (mediana): hh:mm:ss.000" (or reference label), `resolution-mark-<markId>` per candidate, `resolution-manual` with `resolution-manual-input` (hh:mm:ss.d, parsed with `parseClockInput(event.date)`), note input; save `resolution-save` → `setResolution` → `refresh()`; "Remover decisão" → `clearResolution`. Show the resulting leg time and total preview before saving (recompute locally with `computeCrossing`).

- [ ] **Step 1: Failing `review.test.tsx`** (context fixture from domain tests with a 14 s divergence): the issue list shows "divergência de 14,0 s"; choosing `resolution-mark-<id>` + `resolution-save` calls `setResolution('en1', 0, 'mark', id, null, '')`; manual `08:10:02.5` calls `setResolution(..., 'manual', null, '2026-10-11T11:10:02.500Z', ...)`; the suggested-move button calls `updateMark(id, { leg_index: 1 })`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS + typecheck. **Step 5: Commit** (`feat(review): pending issues and official time decisions`).

---

