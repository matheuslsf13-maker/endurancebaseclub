# Task 20 report — Athletes: list, form, import, profile with statistics

Branch `task/20` on worktree `/home/user/ebc-wt/t20`, base `bae2379`. Commit `1b8f0fd`
(`feat(athletes): athlete management, import and statistics profile`).

## What was implemented

- **`src/features/athletes/AthleteForm.tsx`** (new). `AthleteForm({ initial?, onSaved, onCancel })`
  exactly per brief. Owns its own save: calls `api.admin.saveAthlete` itself and reports the saved
  `AthleteRow` back through `onSaved`, so it can be dropped in unmodified by the Task 21 entries
  form to create an athlete inline without that caller knowing about the mutation. Fields: `athlete-name`
  (required), `athlete-sex` (M/F select), `athlete-birth` (free text `dd/mm/aaaa`, converted with
  `parseDateInput`; empty is allowed → `birth_date: null`, a non-empty unparsable value blocks
  submit with a local error and never calls `saveAthlete`), e-mail, telefone, cidade, equipe/assessoria,
  observações, and a "Perfil público" checkbox (defaults to `true`, matching the fixtures'
  default and the "opt-out" reading of spec §14). `athlete-save` is the submit button; a
  `formError` banner (`role="alert"`) shows `ApiError.message` on failure without calling `onSaved`.
- **`src/features/athletes/StatsView.tsx`** (new). `StatsView({ athlete, results, publicMode? })`
  exactly per brief. Empty state ("Sem resultados oficiais ainda — as estatísticas aparecem quando
  a organização finaliza as provas.") when `results.length === 0`. Otherwise: 7 KPI tiles
  (Participações, Conclusões, Vitórias gerais, Vitórias na categoria, Pódios, Melhor colocação,
  Top X% médio) built as the `dataviz` skill's stat-tile contract (sentence-case label, semibold
  proportional-figure value — no `tabular-nums` on the big standalone numbers, reserved for table
  columns instead); "Recordes pessoais" table; "Ritmo por modalidade" (run/swim/bike only, per
  Ruling 20 — `pace_by_modality` never carries `'other'`, and an `'other'` record row shows its
  time with an empty pace cell since `formatPace` returns `''` for it); "Km em prova" as badges;
  "Evolução" using the existing `LineChart` (no new chart component, no new colors — the existing
  `--fg`/`--muted`/`--border` tokens only; a single series needs no legend per the skill, so none
  was added); "Histórico" table; "Parceiros de equipe" list, linking to `/atletas/:id` normally and
  to `/atleta/:id` when `publicMode` is set (the one behavior difference the brief asks for — hiding
  edit affordances without hiding any data, since `StatsView` never had an edit control to begin with).
- **`src/features/athletes/ImportDialog.tsx`** (new). `ImportDialog({ open, onClose, onImported })`.
  File input (`import-file`, `accept=".csv,.xlsx"`) → `.xlsx` goes through `readXlsxFirstSheet`;
  anything else is read as CSV, decoded UTF-8 first and re-decoded with
  `new TextDecoder('windows-1252')` when the UTF-8 pass leaves `�` behind (controller ruling) →
  `parseCsv` → `mapImportRows`. Preview: first 20 valid rows in a table, a "N atleta(s) válido(s), M
  erro(s)" summary line, and the error list by row number. Optional event `<Select>` ("Inscrever na
  prova da coluna Prova do evento…") built from `api.admin.listEvents()`, loaded only while the
  dialog is open (`enabled: open`). `import-confirm` calls
  `importAthletes(eventId || null, mapped.rows)`; success replaces the preview with the
  "X novos, Y atualizados, Z inscrições" summary (+ server-side row errors); failure shows
  `ApiError.message` in a banner and keeps the preview so the person can retry. "Baixar modelo" is a
  plain `data:` URI anchor (no `Blob`/`ObjectURL`, so it needs no browser API jsdom might not
  implement) with the header `Nome;Sexo;Data de nascimento;E-mail;Telefone;Cidade;Equipe;Prova`.
- **`src/features/athletes/AthletesPage.tsx`** (replaces the Task 1 stub). `athlete-search`
  (accent-insensitive via NFD + combining-mark strip, matches name/city/team_club) and a sex
  filter; table (name → `Link` to `/atletas/:id`, sexo, idade hoje, cidade, equipe, participações,
  vitórias, pódios — the last three straight from `admin_list_athletes`'s own fields, no extra
  calls); `new-athlete` opens the modal with an empty `AthleteForm`; each row's "Editar" opens the
  same modal with `initial` set; "Excluir" goes through `useConfirm()` then
  `api.admin.deleteAthlete`, showing `ApiError.message` in a toast on failure (list stays
  untouched); `import-athletes` opens `ImportDialog`. All list-mutating actions
  (`onSaved`/delete/`onImported`) invalidate the `['athletes']` query.
- **`src/features/athletes/AthleteProfilePage.tsx`** (replaces the Task 1 stub). Header: name, sex,
  "idade hoje" (computed with `domain/categories.ageOn(birth_date, todayBrasília, 'event_date')` —
  "today" taken in `America/Sao_Paulo`, per the app-wide date/time rule, even though this isn't an
  event date), city, team, and — only when `public_profile` is true — a "Perfil público" badge plus
  a `Link` to `/atleta/:id`. "Editar"/"Excluir" reuse `AthleteForm`/the same confirm+toast pattern as
  the list page; delete navigates back to `/atletas` on success. Body is `<StatsView athlete={...}
  results={...} />` fed directly from `api.admin.athleteProfile(id)`.

## Decisions the brief didn't spell out

- `AthleteForm` and `ImportDialog` perform their own API calls (rather than the parent doing it and
  handing them a `saving`/`onSubmit` callback) — this is what lets `AthleteForm` be dropped into the
  Task 21 entries form unmodified, per the brief's own "reused inline" requirement.
- "Idade hoje" (both the list column and the profile header) is computed from `birth_date` with the
  existing `domain/categories.ageOn(birthDate, eventDate, rule)`, passing today's Brasília date as
  the `eventDate` and `'event_date'` as the rule (completed years as of that date) — no new age
  function was added to a shared file. A null `birth_date` renders as `—`.
- `public_profile` defaults to `true` for a newly created athlete (spec §14 reads as opt-out, and
  this matches `domain/testing/fixtures.ts`'s `makeAthlete` default).
- `StatsView`'s `publicMode` only changes the partner-list link target (`/atleta/:id` vs
  `/atletas/:id`); there was nothing else in the section to gate, since all figures already come
  from `computeAthleteStats`, which itself only ever sees `ResultRow`s (already-finalized, already
  public-safe data).
- Template download uses a `data:` URI anchor instead of `URL.createObjectURL`, so it needs no
  browser API that might behave inconsistently across environments and is trivially testable
  (`decodeURIComponent(href)`).
- `mapImportRows` errors and the post-import server errors are rendered with the identical
  "Linha N: mensagem" phrasing in both places.

## Tests (TDD)

**RED** — before any component existed:
```
$ npx vitest run src/features/athletes/athletes.test.tsx
 FAIL  src/features/athletes/athletes.test.tsx [ src/features/athletes/athletes.test.tsx ]
Error: Failed to resolve import "./AthleteForm" from "src/features/athletes/athletes.test.tsx". Does the file exist?
 Test Files  1 failed (1)
      Tests  no tests
```

**GREEN** — after implementing `AthleteForm`, `StatsView`, `ImportDialog`, `AthletesPage`,
`AthleteProfilePage` (two small test fixes along the way: a `getByText` collision where the swim
record and the swim ritmo-por-modalidade cell happen to render the identical `'1:40 /100m'` string
— resolved with `getAllByText(...).toHaveLength(2)`; and the "other"-leg row lookup, since records
show the modality label, not the leg's own free-text label):
```
$ npx vitest run src/features/athletes/athletes.test.tsx
 Test Files  1 passed (1)
      Tests  24 passed (24)
```

Coverage in `athletes.test.tsx` (24 tests), including every behavior the brief's Step 1 names
verbatim:
- **AthleteForm**: creates with the dd/mm/aaaa birth date converted to `birth_date: '1990-06-15'`
  and calls `onSaved` with the server's row; prefills from `initial` and sends its `id` back;
  surfaces the server error and does not call `onSaved` on failure; rejects an invalid date locally
  without calling `saveAthlete`; `onCancel`.
- **ImportDialog**: the Review-Focus-3 CSV (Task 14's `importMapping.test.ts` table, serialized as
  the same `;`-delimited text a Brazilian export would produce) previews exactly 2 valid rows and 3
  row-numbered errors, and confirming with no event selected calls
  `importAthletes(null, rows)` with the exact expected rows; importing into a selected event calls
  `importAthletes('ev1', ...)`; a Windows-1252-encoded CSV (bytes built directly, since
  `TextEncoder` is UTF-8-only by spec) is re-decoded correctly after the UTF-8 pass shows `�`;
  a failed `importAthletes` call shows the server message and keeps the preview; the template link.
- **StatsView**: KPI tiles, personal records (including an `'other'`-modality record showing its
  time with an empty pace cell), the pace table excluding `'other'`, the evolution `LineChart`
  (asserted via its accessible `role="img"` name); the empty state with no results; partner links
  routed by `publicMode`.
- **AthletesPage**: list + name-to-profile link; accent-insensitive search; create-through-modal
  refreshes the list; delete-after-confirm; server error message on delete failure; opening the
  import dialog.
- **AthleteProfilePage**: header + public-profile link (and its absence when opted out) + empty
  `StatsView`; edit-modal round trip refreshing the profile; delete-after-confirm with the server
  error surfaced on failure.

## Gate outputs

Typecheck (clean):
```
$ npm run typecheck
> tsc --noEmit -p tsconfig.json
```

Full suite:
```
$ npx vitest run
 Test Files  1 failed | 25 passed (26)
      Tests  2 failed | 310 passed (312)
```
The 2 failures are **both** in `src/features/events/eventShell.test.tsx` (owned by Task 17, not in
this task's Files block), in the `it.each` smoke test that asserts the literal placeholder text
`'AthletesPage'` / `'AthleteProfilePage'` the Task-1 stubs used to render for `/atletas` and
`/atletas/a1`. Once this task's brief-mandated replacement of those two stub files lands, the real
pages no longer render that literal string, so those two assertions fail — this is exactly the "small
fixes to the shell may arrive later" case wave2-context.md calls out, and every other wave-2a task
that replaces one of the same stub pages will hit the identical conflict for its own route(s). I did
not touch `eventShell.test.tsx` (file-ownership rule). All 310 other tests, including all 24 new
ones, pass; no other test regressed. Full output saved in-session; the failing block:
```
 FAIL  src/features/events/eventShell.test.tsx > routes > /atletas renders AthletesPage for organizers, inside the layout
 FAIL  src/features/events/eventShell.test.tsx > routes > /atletas/a1 renders AthleteProfilePage for organizers, inside the layout
```

Build:
```
$ npm run build
✓ 239 modules transformed.
✓ built in 1.06s
```
(Only a pre-existing "chunk larger than 500 kB" advisory, unrelated to this task.)

## Files changed

- `src/features/athletes/AthleteForm.tsx` (new)
- `src/features/athletes/ImportDialog.tsx` (new)
- `src/features/athletes/StatsView.tsx` (new)
- `src/features/athletes/AthletesPage.tsx` (replaced stub)
- `src/features/athletes/AthleteProfilePage.tsx` (replaced stub)
- `src/features/athletes/athletes.test.tsx` (new)

## Self-review findings

- All required `data-testid`s present and exact: `new-athlete`, `athlete-name`, `athlete-sex`,
  `athlete-birth`, `athlete-save`, `athlete-search`, `import-athletes`, `import-file`,
  `import-confirm`.
- Every displayed date/duration goes through `src/lib/format.ts` (`formatDateBR`, `formatDuration`,
  `formatPace` via `computeAthleteStats`, `parseDateInput`); no raw `toLocaleTimeString`/`Date.now()`
  time formatting was introduced.
- No new dependencies, no new colors (chart and badges reuse existing tokens/`LineChart`), no web
  fonts.
- Touch targets: all actions are the shared `Button`/`Input`/`Select`/`Checkbox` kit components,
  which already enforce `min-h-11`.
- `dataviz` skill loaded before building the KPI tiles and the evolution chart usage; followed its
  stat-tile contract and its "single series needs no legend" rule; no new palette was introduced, so
  the palette validator did not apply.
- Ruling 20 and the CSV/Windows-1252 controller ruling are both implemented and covered by tests.

## Concerns

- The two `eventShell.test.tsx` failures described above are expected and out of this task's file
  ownership; flagging for the controller rather than silently accepting a red full-suite run.
- The `.xlsx` import branch in `ImportDialog` delegates directly to the already-unit-tested
  `readXlsxFirstSheet` (Task 14) with no added logic, but I did not add a dedicated `.xlsx`-file
  test in `athletes.test.tsx` (constructing a valid binary workbook in this test would mostly
  re-exercise Task 14's own reader tests); the CSV path — the one Review Focus 3 and the controller
  ruling actually call out — is fully covered, including the Windows-1252 fallback.
- I noticed the repo's real `CLAUDE.md` (read from this worktree) differs from the CLAUDE.md content
  shown to me in the session's system reminder (an older, differently-architected description of a
  similarly-named project). I followed the worktree's actual `CLAUDE.md`/`wave2-context.md`/
  `contracts.md`/brief, which are internally consistent with the code already in this repo; noting
  the discrepancy in case it's a session-setup artifact worth the controller's attention.

Status: **DONE_WITH_CONCERNS** (both concerns above are informational/expected, not blocking; the
worktree is otherwise fully green: focused tests, typecheck and build all pass).
