## Task 21: Entries tab — individual/team registration with leg assignment

**Files:**
- Modify: `src/features/entries/EntriesTab.tsx`
- Create: `src/features/entries/EntryForm.tsx`, `src/features/entries/BulkEntryDialog.tsx`, `src/features/entries/entryForm.ts`, `src/features/entries/entryForm.test.ts`, `src/features/entries/entries.test.tsx`

**Interfaces:**
- Consumes: `useEventContext`, `api.admin.saveEntry/bulkCreateEntries/updateEntryStatus/deleteEntry/listAthletes`, `entryCategory`, `groupLabel`, `entryDisplayName`, `AthleteForm` (Task 20 — if Task 20 is not merged yet, import path `../athletes/AthleteForm` is still valid because Task 17 created the folder; coordinate by merging Task 20 first), `ENTRY_STATUS_LABEL`.
- Produces: `entryForm.ts`: `emptyEntryForm(race: RaceRow): EntryFormState`, `setMember(state, i, athleteId)`, `setLegOwner(state, legIndex, memberIndex)`, `validateEntryForm(state, race): string[]`, `toSavePayload(state)` where `EntryFormState = { id?: string; race_id: string; wave_id: string | null; bib: string; team_name: string; level: string | null; notes: string; members: (string | null)[]; legOwner: number[] }` (legOwner[k] = member index doing leg k; individual → all 0).

Behavior:
- `EntriesTab`: filters by race and text; table: Nº, Prova, Equipe/Atleta, Pernas ("Ana – Natação · Beto – Corrida"), Categoria (`groupLabel(['sex','age','level'], entryCategory(...))`), Onda, Status (badge), Penalidade; row actions: editar, status/penalidade (modal: status select with `ENTRY_STATUS_LABEL`, penalty in `m:ss`, notes → `updateEntryStatus`), excluir (confirm).
- "Nova inscrição" (`new-entry`) → `EntryForm`: race select (`entry-race`); for teams `entry-team-name`; member pickers `entry-member-<i>` (searchable athlete combobox over `listAthletes`, with "+ Novo atleta" opening `AthleteForm` inline); for teams one select per leg `entry-leg-<k>` choosing which member does it (default: member k mod team_size); bib `entry-bib` (placeholder "automático"); level select when the event has levels; wave select when the race has >1 wave; save `entry-save` → `saveEntry` → `refresh()`; server errors in a banner.
- "Inscrever vários" (`bulk-entries`) for individual races: pick race + multi-select athletes (checkbox list with search) → `bulk-confirm` → `bulkCreateEntries`.
- Import shortcut button linking to `/atletas` import dialog with hint "a coluna Prova inscreve automaticamente em provas individuais".

- [ ] **Step 1: Failing tests.** `entryForm.test.ts`: `emptyEntryForm(teamRace2legs)` → `members [null,null]`, `legOwner [0,1]`; `validateEntryForm` → `Informe o nome da equipe`, `Escolha o atleta 2`, `O mesmo atleta foi escolhido duas vezes`, `Cada integrante precisa fazer pelo menos uma perna` (when `legOwner` is `[0,0]` for a 2-member team — the client requires every member to do at least one leg); `toSavePayload` → `members: [{athlete_id:'a1', legs:[0]},{athlete_id:'a2', legs:[1]}]`, empty bib → `null`. `entries.test.tsx` (mock api/context): saving a team entry calls `saveEntry` with the expected payload; bulk dialog calls `bulkCreateEntries(raceId, [ids])`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS + typecheck. **Step 5: Commit** (`feat(entries): registration with team leg assignment and bulk entry`).

---

