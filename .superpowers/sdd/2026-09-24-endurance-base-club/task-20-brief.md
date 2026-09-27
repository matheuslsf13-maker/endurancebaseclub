## Task 20: Athletes — list, form, import, profile with statistics

**Files:**
- Modify: `src/features/athletes/AthletesPage.tsx`, `src/features/athletes/AthleteProfilePage.tsx`
- Create: `src/features/athletes/AthleteForm.tsx`, `src/features/athletes/ImportDialog.tsx`, `src/features/athletes/StatsView.tsx`, `src/features/athletes/athletes.test.tsx`

**Interfaces:**
- Consumes: `api.admin.listAthletes/saveAthlete/deleteAthlete/importAthletes/athleteProfile/listEvents`, `computeAthleteStats`, `readXlsxFirstSheet`, `parseCsv`, `mapImportRows`, `formatDuration`, `formatDateBR`, `LineChart`.
- Produces: `StatsView({ athlete: AthleteRow; results: ResultRow[]; publicMode?: boolean })` (reused by the public athlete page in Task 26); `AthleteForm({ initial?: AthleteRow; onSaved(a: AthleteRow): void; onCancel(): void })` (reused inline by the entries form in Task 21).

Behavior:
- `AthletesPage`: search (`athlete-search`, accent-insensitive on name/city/team), filter by sex; table (name → link to profile, sexo, idade hoje, cidade, equipe, participações, vitórias, pódios); "Novo atleta" (`new-athlete`) modal with `AthleteForm` (`athlete-name`, `athlete-sex` select M/F, `athlete-birth` accepting `dd/mm/aaaa` via `parseDateInput`, email, phone, city, team_club, notes, checkbox "Perfil público", save `athlete-save`); edit and delete (confirm; show server message on failure).
- `ImportDialog` (`import-athletes`): file input (`import-file`, accept `.csv,.xlsx`) → `readXlsxFirstSheet` or `parseCsv` (decode CSV as UTF-8; if it contains `�`, retry with `windows-1252` via `TextDecoder`) → `mapImportRows` → preview table (first 20 rows) + error list (row numbers) + optional event select "Inscrever na prova da coluna Prova do evento…" → confirm (`import-confirm`) → `importAthletes(eventId|null, rows)` → summary "X novos, Y atualizados, Z inscrições" + server errors. Include a "Baixar modelo" link that generates a CSV with the header `Nome;Sexo;Data de nascimento;E-mail;Telefone;Cidade;Equipe;Prova`.
- `AthleteProfilePage`: header (name, sex, age, city, team, public profile badge + link `#/atleta/:id` when public) + `StatsView`.
- `StatsView`: KPI tiles (Participações, Conclusões, Vitórias gerais, Vitórias na categoria, Pódios, Melhor colocação, Top X% médio), "Recordes pessoais" table (modalidade, distância, tempo, ritmo, evento/data), "Ritmo por modalidade", "Km em prova", "Evolução" (`LineChart` of the evolution series, values formatted with `formatDuration`), "Histórico" table, "Parceiros de equipe". Empty state when no finalized results: "Sem resultados oficiais ainda — as estatísticas aparecem quando a organização finaliza as provas." `publicMode` hides nothing sensitive (stats only use public data) but hides edit links.

- [ ] **Step 1: Failing `athletes.test.tsx`** (mock api): creating an athlete with birth `15/06/1990` calls `saveAthlete` with `birth_date '1990-06-15'`; importing a CSV `File` with the Review-Focus-3 content shows 2 valid rows and 3 errors, and confirming calls `importAthletes(null, rows)`; `StatsView` renders "Recordes pessoais" and the evolution chart for the Task 12 fixture results (copy the fixture into the test).
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS + typecheck. **Step 5: Commit** (`feat(athletes): athlete management, import and statistics profile`).

---

