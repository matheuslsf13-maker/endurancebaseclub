## Task 15: Event workbook model (planilha de conferência) and labels

**Files:**
- Create: `src/domain/labels.ts`, `src/domain/workbook.ts`, `src/domain/workbook.test.ts`

**Interfaces:**
- Consumes: Tasks 9–11, 13–14, `format.ts`.
- Produces: `buildEventWorkbook`, `workbookFileName`; `labels.ts`: `STATUS_LABEL: Record<TimingStatus, string>` (`finished 'Concluiu'`, `on_course 'Em prova'`, `not_started 'Não largou'`, `dnf 'DNF'`, `dns 'DNS'`, `dsq 'DSQ'`), `ENTRY_STATUS_LABEL: Record<EntryStatus,string>` (`ok 'Normal'`, `dns 'DNS – não largou'`, `dnf 'DNF – abandonou'`, `dsq 'DSQ – desclassificado'`), `SEVERITY_LABEL` (`error 'Erro'`, `warning 'Aviso'`, `info 'Info'`), `ISSUE_LABEL: Record<IssueType,string>` (`divergence 'Divergência'`, `missing_crossing 'Passagem faltando'`, `order 'Ordem inválida'`, `duplicate 'Marcação duplicada'`, `no_start 'Sem largada'`, `unassigned 'Sem atleta'`, `chosen_mark_discarded 'Escolha descartada'`, `not_finished 'Em prova'`), `crossingSourceLabel(c: Crossing, tkById: Map<string, TimekeeperRow>, marks: MarkRow[]): string` → `'Sistema (mediana)'`, `'Cronometrista de referência (<nome>)'`, `'Marcação de <nome|Organização>'`, `'Manual'`, or `''`.

Sheets, in this order (spec §11): `Resumo`, `Inscritos`, `Tempos – <prova>` per race, `Classificação – <prova>` per race, `Pódios`, `Marcações`, `Pendências`, `Súmula manual`.
- `Resumo` (headerless): title row (`title` style) `EnduranceBaseClub — Planilha de conferência`; rows `Evento`, `Data` (dd/mm/aaaa), `Local`, `Gerada em` (`formatDateTimeBR(generatedAtMs) + ' (Brasília)'`); blank row; bold header row `Prova | Inscritos | Concluintes | Em prova | DNF | DNS | DSQ | Pendências | Finalizada`; one row per race (`Finalizada` = `Sim (dd/mm/aaaa hh:mm:ss)` or `Não`).
- `Inscritos`: `Nº | Prova | Onda | Equipe | Atleta(s) | Sexo | Idade | Faixa | Nível | Status | Penalidade (s)`; `Atleta(s)` = `Nome (Natação), Nome (Corrida)` for teams, the name for individuals.
- `Tempos – <prova>` (frozen header): `Nº | Atleta/Equipe | Largada` (`time`), then per leg k: `Passagem k (<label>)` (`time`), `Tempo k (<label>)` (`duration`, **formula** `<pass_k>-<prev>` with cached `excelDuration(leg_ms)` only when both cells have values, else empty), `Fonte k` (`crossingSourceLabel`); then `Total` (`duration`, formula `<last pass>-<start>` when both exist), `Penalidade` (`duration`, `excelDuration(penalty_ms)`), `Final` (`duration`, formula `<Total>+<Penalidade>` when Total exists), `Divergência máx. (s)` (`decimal1`, max spread over legs / 1000, empty if none), `Status` (`STATUS_LABEL`). Clock cells use `excelSerialBrasilia`. Row order = classification order.
- `Classificação – <prova>`: `Pos | Nº | Atleta/Equipe | Sexo | Faixa | Nível | Pos. sexo | Tempo final | Dif. p/ 1º | Status` (`Tempo final`, `Dif.` as `duration`).
- `Pódios` (headerless): per race a `title` row with the race name; per ranking a `bold` row with the ranking name; per group a row with the group label (bold) followed by rows `<podium_pos>º | Nº | Atleta/Equipe | Tempo final (duration)`; blank row between races.
- `Marcações`: `Hora (Brasília) | Cronometrista | Nº | Atleta/Equipe | Prova | Perna | Situação | Δ oficial (s) | ID` — hora as text `formatClock(ts, {millis: true})`; Situação: `descartada` (discarded), `sem atleta` (no entry), `duplicada` (in the crossing's `duplicates`), else `usada`; Δ = `(ts − official_ms)/1000` rounded to 0.1 (`decimal1`) or empty. Sorted by ts.
- `Pendências`: `Tipo | Severidade | Descrição` from `timing.issues`.
- `Súmula manual`: `Nº | Atleta/Equipe | Prova | Perna 1 | … | Perna M` (M = max legs among races) with empty leg cells, one row per entry ordered by race position then bib.
- `workbookFileName(event)`: `EBC_<public_slug or slugify(name)>_<date>.xlsx` (implement `slugify` locally: lowercase, strip accents, non-alphanumerics → `-`, trim `-`).

- [ ] **Step 1: Write failing `src/domain/workbook.test.ts`**: build an aggregate with `makeEvent({ name: 'Desafio EBC', public_slug: 'desafio-ebc' })`, an individual run race "Corrida 5K" (1 leg, position 0) with two individual entries, and a relay race "Revezamento" (team 2, swim/run, position 1) with one team entry; timekeepers tk1 "Ana"/tk2 "Bia"; marks (relay leg 0 by both with 4 s divergence, relay leg 1 by tk1, both individual finishes, one discarded mark, one unassigned mark older than 60 s); a `mark` resolution for relay leg 0 pointing to tk2's mark; compute `computeEventTiming` + `classifyRace` per race; then assert:
  - sheet names equal `['Resumo', 'Inscritos', 'Tempos – Corrida 5K', 'Tempos – Revezamento', 'Classificação – Corrida 5K', 'Classificação – Revezamento', 'Pódios', 'Marcações', 'Pendências', 'Súmula manual']`;
  - relay `Tempos` data row (row 2): column E (`Tempo 1`) is `{ formula: 'D2-C2', result: <excelDuration(leg_ms)> }` (A Nº, B Atleta/Equipe, C Largada, D Passagem 1, E Tempo 1, F Fonte 1) — build the expected string with `colLetter` (`${colLetter(3)}2-${colLetter(2)}2`) and `result: expect.any(Number)`; column F = `'Marcação de Bia'`;
  - `Marcações` has one row per mark and contains `descartada` and `sem atleta`;
  - `Pendências` includes the unassigned mark issue;
  - `workbookFileName(event)` = `'EBC_desafio-ebc_2026-10-11.xlsx'`;
  - `writeXlsx(model)` returns bytes; write them to a temp file and `python3 scripts/verify-xlsx.py` prints `OK 10 sheets`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS. **Step 5: Commit** (`feat(domain): conference workbook model and pt-BR labels`).

---

