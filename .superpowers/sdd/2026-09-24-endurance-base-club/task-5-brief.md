## Task 5: Admin RPCs — athletes, import, profile, entries

**Files:**
- Create: `supabase/migrations/0004_admin_athletes_entries.sql`, `supabase/tests/30_admin_athletes_entries.sql`

**Interfaces:**
- Produces: `admin_list_athletes()`, `admin_save_athlete(p_athlete jsonb)`, `admin_delete_athlete(p_athlete_id uuid)`, `admin_import_athletes(p_event_id uuid, p_rows jsonb)`, `admin_athlete_profile(p_athlete_id uuid)`, `admin_save_entry(p_entry jsonb)`, `admin_bulk_create_entries(p_race_id uuid, p_athlete_ids uuid[])`, `admin_update_entry_status(p_entry_id uuid, p_status text, p_penalty_ms int, p_notes text)`, `admin_delete_entry(p_entry_id uuid)`, internal `next_bib(p_event_id uuid) returns text`.

Behavior details:
- Athletes: trim strings, empty → null (`email` lowercased), `sex` M/F, `birth_date` not in the future and ≥ 1900. `admin_list_athletes` adds `participations` (results with status not in ('dns','not_started')), `wins` (`overall_pos = 1`), `podiums` (results with any `data->'podiums'` item `podium_pos <= 3`). Order by name. `admin_delete_athlete` with entries → `Atleta tem inscrições; remova-as antes de excluir` (P0001).
- `next_bib(event)`: `(max(bib::int) filter (where bib ~ '^\d+$'), 0) + 1` as text.
- `admin_save_entry(p_entry)` — keys `id?, race_id, wave_id?, bib?, team_name?, level?, notes?, members[{athlete_id, legs[]}]`:
  1. race must exist; `event_id` taken from race; if updating and `race_id` changed while the entry has marks → `Não é possível trocar a prova de uma inscrição com marcações`.
  2. `bib` = trim(bib) or `next_bib`; duplicate → `Nº de peito <bib> já está em uso neste evento`.
  3. members: exactly `team_size` distinct athletes that exist (`A prova exige N atleta(s)`); individual → member legs = all `0..N-1` (ignore payload legs); team → every leg index `0..N-1` assigned to exactly one member (`Cada perna precisa de exatamente um atleta`), indices in range; members' `position` = array order.
  4. no athlete may already be in another entry of the same race (`<nome> já está inscrito nesta prova`).
  5. `level` must be null or one of `events.levels` (`Nível inválido`); `team_name` required when `team_size > 1` (`Informe o nome da equipe`).
  6. `wave_id` must belong to the race; default = first wave by position.
  7. Replace `entry_members` rows; return `entry_json(id, true)`.
- `admin_bulk_create_entries`: only `team_size = 1` races (`Inscrição em lote só para provas individuais`); skips athletes already in the race; sequential bibs from `next_bib`; returns created entries (`entry_json(...,true)` array).
- `admin_update_entry_status`: validate status and `penalty_ms >= 0`; return `entry_json`.
- `admin_delete_entry`: delete (marks become unassigned via FK).
- `admin_import_athletes(p_event_id, p_rows)`: for each row (1-based index `i`): validate name/sex (collect `{row:i, message}` and continue); match existing athlete by `lower(email)` when email present, else by `lower(btrim(name))` + `birth_date` (both null-safe); update non-null incoming fields or insert; if `p_event_id` and `race_name` present: race = event race with `lower(btrim(name)) = lower(btrim(race_name))`; not found → error row `Prova "<x>" não encontrada`; team race → error row `Prova "<x>" é por equipes; inscreva pela tela de inscrições`; otherwise create the entry with `next_bib` unless already entered. Returns `{inserted, updated, entries_created, errors}`.
- `admin_athlete_profile`: `{athlete (full row), results: results where athlete_id = any(athlete_ids) order by data->'event'->>'date' desc}`.

- [ ] **Step 1: Write failing `supabase/tests/30_admin_athletes_entries.sql`** with at least these assertions (bootstrap owner + event with `levels ["Elite","Base"]` + individual race "Corrida 5K" + team race "Revezamento" (team_size 2, legs swim/run) via Task 4 RPCs, then):
  - `admin_save_athlete` trims and lowercases email; future birth date → P0001.
  - `admin_save_entry` individual without bib → bib `'1'`; next one → `'2'`; members legs = `{0}` for a 1-leg race; duplicate bib → P0001 with message like `Nº de peito % já está em uso%`.
  - team entry with legs `[0]` and `[1]` succeeds; legs `[0]` and `[0]` → P0001; missing team name → P0001; wrong member count → P0001; athlete already in the same race → P0001; level `Pro` → P0001.
  - `admin_bulk_create_entries` on the team race → P0001; on the individual race with 3 athletes (one already entered) → 2 entries created.
  - `admin_import_athletes` with rows `[{name:'Ana Souza', sex:'F', birth_date:'1990-06-15', race_name:'corrida 5k'}, {name:'', sex:'F'}, {name:'Beto', sex:'M', race_name:'Revezamento'}, {name:'ana souza', sex:'F', birth_date:'1990-06-15'}]` → `inserted 2` (Ana, Beto), `updated 1` (row 4 matches Ana), `entries_created 1`, errors for rows 2 and 3.
  - `admin_delete_athlete` on an entered athlete → P0001.

- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS. **Step 5: Commit** (`feat(db): athlete, import and entry RPCs`).

---

