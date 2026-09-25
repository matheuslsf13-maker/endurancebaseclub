# Shared context for every task (extracted from the plan — read with your task brief)

Spec (binding authority, read sections your task cites): docs/superpowers/specs/2026-09-24-endurance-base-club-design.md

## Global Constraints

- Repo root: `/home/claude/endurance-base-club`. Node 22, npm. Run everything as the current user (root) unless a step says otherwise.
- UI copy in **Brazilian Portuguese**; code, identifiers, commits and comments in English.
- DTO/JSON field names are **snake_case**, mirroring DB columns (see `src/lib/types.ts`). Do not introduce camelCase copies of DB fields.
- All times stored in UTC (`timestamptz` / epoch ms); **every displayed time uses `America/Sao_Paulo`** via `src/lib/format.ts`. Never use `toLocaleTimeString()` without `timeZone`.
- Leg indices are **0-based** internally; UI shows "Perna 1..N".
- Only RPC access to Supabase (`supabase.rpc(...)` via `src/lib/api.ts`). Never `supabase.from(...)`.
- SQL functions: `security definer`, `set search_path = public, extensions, pg_temp`, params prefixed `p_`, validation errors `raise exception '<pt-BR message>' using errcode = 'P0001'`, permission errors errcode `42501`.
- Production Supabase: URL `https://wlishmznbhhcqzncdxnq.supabase.co`, publishable key `sb_publishable_Py0jUHGMNAjCM8C488RvZg_qviJupEk`. Local: URL `http://127.0.0.1:54321`, key `sb_publishable_local_dev`.
- Local ports: Postgres 54322 (`EBC_PG_PORT`), shim 54321 (`SHIM_PORT`), vite dev 5173, vite preview 4173. Local DB name from `EBC_DB` (default `ebc`) so parallel agents can use separate databases.
- Brand tokens: ink `#191513`, paper `#F4F1EC`, neutrals `#241F1C #2E2825 #3A332F #6F665E #A39D93 #D9D3C9`, success `#3F8F5B`, warning `#C8922E`, danger `#C2413B`, info `#5B7C99`. System font stack only (no web fonts). Tabular numbers for every time display.
- Timing defaults: `same_crossing_window_s = 30`, `divergence_threshold_s = 3`, `time_source = 'median'`, unassigned-mark issue after 60 s, sync poll 2 s (backoff to 10 s), public poll 10 s, fetch overlap 10 s.
- Every E2E-critical control carries the `data-testid` listed in "Test IDs" below.
- Commits: conventional style (`feat:`, `test:`, `fix:`, `chore:`), each ending with the two trailer lines:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01HRbqvfPgjYxeUrwitUvfv4`.

## Review Focus

1. **Offline timekeeper who missed a crossing** marks the *next* crossing and the app suggests the wrong (earlier) leg → consolidation must flag the divergence and attach `suggested_leg_index` pointing to the leg whose median is within the window; Review tab offers "Mover para a perna N". Tests: Task 10 `consolidation.test.ts` "outlier near the next crossing suggests moving it"; Task 24 `review.test.tsx` suggested-move button.
2. **Bib input variations** (`" 101 "`, `"7"` vs `"007"`, `"12a"`, unknown bib, DNS/DSQ entry) → trimmed + numeric-equivalent matching, clear pt-BR error for unknown bib, warning (not block) for DNS/DSQ. Test: Task 9 `bib.test.ts`.
3. **Brazilian spreadsheets on import** (`;` delimiter, UTF-8 BOM, quoted fields, `dd/mm/aaaa`, Excel serial dates, "Masculino/Feminino/masc/fem", Windows-1252 CSV) → rows parsed and normalized, bad rows reported with row numbers. Tests: Task 14 `importMapping.test.ts`, `csv.test.ts`; Task 20 import dialog test.
4. **Device in another time zone or with a wrong clock** → displays and XLSX always in Brasília time; marks use the synced offset. Tests: Task 1 `format.test.ts` (also run with `TZ=Asia/Tokyo`) and Task 13 `clock.test.ts`.
5. **Wave start recorded or corrected after marks already exist** ("esqueceram de apertar Largar") → all leg/total times recompute, `no_start` issues disappear. Tests: Task 10 `consolidation.test.ts` "late wave start recomputes everything"; Task 23 manual start-time entry test.

---

## Execution Map (parallel waves)

Each task runs in its own git worktree/branch (Agent tool `isolation: "worktree"`). The controller merges each approved branch into `main` in the order below. **Before running anything in a worktree:** `ln -s /home/claude/endurance-base-club/node_modules node_modules` (dependencies are installed once in Task 1; if a task must add a dependency it says so explicitly and runs `npm install <pkg>` in the main repo too).

| Wave | Tasks (tracks run in parallel; arrows are sequential inside a track) | Depends on |
|---|---|---|
| 0 | T1 scaffold + shared contracts | — |
| 1 | DB track: T2 → T3 → T4 → T5 → T6 → T7 → T8 · Domain track: T9 → T10 → T11 → T12 · Libs track: T13 ∥ T14 · UI track: T16 | T1 |
| 1b | T15 workbook model (needs T11, T14) · T17 app shell (needs T9–T11, T13, T16) | wave 1 parts |
| 2a | T18 events/settings/help · T19 races · T20 athletes · T22 timekeeper app · T23 timing tab · T24 review · T25 results | T17 (+ T12/T14/T15 where consumed) |
| 2b | T21 entries (needs T20) · T26 public (needs T20, T25) · T27 PWA | wave 2a |
| 3 | T28 E2E (agent-browser) | all + DB track |
| 4 | T29 production deploy + smoke (controller) | T28 |

File ownership rule for parallel work: a task may only create/modify files listed in its **Files** block. Shared files (`package.json`, `src/App.tsx`, `src/lib/types.ts`, `src/lib/api.ts`) are finalized by T1/T16; later tasks must not edit them unless their Files block lists it.

## File Structure

```
package.json · tsconfig.json · vite.config.ts · vitest.integration.config.ts · index.html
.env.production · .env.development · .env.e2e · .gitignore · vercel.json
public/logo.png · public/favicon.png
src/main.tsx · src/App.tsx (routes) · src/index.css (tokens)
src/lib/        types.ts · format.ts · storage.ts · supabase.ts · api.ts · clock.ts · outbox.ts · csv.ts · importMapping.ts
src/lib/xlsx/   writer.ts · reader.ts
src/domain/     presets.ts · categories.ts · eventModel.ts · bib.ts · consolidation.ts · suggestLeg.ts · ranking.ts · snapshot.ts · stats.ts · labels.ts · workbook.ts
src/domain/testing/fixtures.ts
src/components/ ui/*.tsx · Layout.tsx · Logo.tsx · ThemeToggle.tsx · QrCode.tsx · LineChart.tsx
src/hooks/      useNow.ts · useEventData.ts · useClock.ts
src/test/       setup.ts · renderWithProviders.tsx
src/features/NotFound.tsx
src/features/auth/        LoginPage.tsx · ChangePasswordPage.tsx · RequireOrganizer.tsx · session.tsx
src/features/events/      EventsPage.tsx · EventLayout.tsx · EventContext.tsx · EventGeneralTab.tsx
src/features/settings/    SettingsPage.tsx
src/features/help/        HelpPage.tsx
src/features/races/       RacesTab.tsx · RaceEditor.tsx · LegsEditor.tsx · RankingsEditor.tsx · AgeGroupsEditor.tsx · raceForm.ts
src/features/athletes/    AthletesPage.tsx · AthleteForm.tsx · ImportDialog.tsx · AthleteProfilePage.tsx · StatsView.tsx
src/features/entries/     EntriesTab.tsx · EntryForm.tsx · BulkEntryDialog.tsx · entryForm.ts
src/features/timekeeper/  TimekeeperPage.tsx · useTimekeeper.ts · tkStore.ts
src/features/timing/      TimingTab.tsx · WavesPanel.tsx · LiveBoard.tsx · TimekeepersPanel.tsx
src/features/review/      ReviewTab.tsx · CrossingEditor.tsx
src/features/results/     ResultsTab.tsx · ClassificationTable.tsx · PodiumView.tsx · exportWorkbook.ts
src/features/public/      PublicHome.tsx · PublicEventPage.tsx · PublicAthletePage.tsx
supabase/migrations/      0001_schema.sql · 0002_internal.sql · 0003_admin_events.sql · 0004_admin_athletes_entries.sql · 0005_timing.sql · 0006_public_grants.sql
supabase/tests/           00_helpers.sql · 10_schema.sql · 20_admin_events.sql · 30_admin_athletes_entries.sql · 40_timing.sql · 50_public.sql · 60_security.sql
dev/db/bootstrap.sql · dev/shim/server.mjs · dev/shim/jwt.mjs
scripts/db-local.sh · scripts/test-sql.sh · scripts/dev-stack.sh · scripts/verify-xlsx.py · scripts/deploy-files.mjs
tests/integration/        helpers.ts · shim.test.ts · flow.test.ts
tests/e2e/                run.sh · lib.sh · 01_master_setup.sh · 02_timing.sh · 03_review_results.sh · 04_public_offline.sh · artifacts/
```

## Test IDs (exact `data-testid` values)

Auth: `login-email`, `login-password`, `login-submit`, `newpass-1`, `newpass-2`, `newpass-submit`, `logout`.
Events: `new-event`, `event-name`, `event-date`, `event-location`, `event-levels`, `event-public`, `event-save`, tabs `tab-geral`, `tab-provas`, `tab-inscricoes`, `tab-cronometragem`, `tab-revisao`, `tab-resultados`.
Races: `new-race`, `race-preset`, `race-name`, `race-team-size`, `race-save`, `leg-add`, `wave-add`.
Athletes: `new-athlete`, `athlete-name`, `athlete-sex`, `athlete-birth`, `athlete-save`, `athlete-search`, `import-athletes`, `import-file`, `import-confirm`.
Entries: `new-entry`, `entry-race`, `entry-team-name`, `entry-member-<i>` (athlete picker i = 0..n-1), `entry-leg-<k>` (member select for leg k), `entry-bib`, `entry-save`, `bulk-entries`, `bulk-confirm`.
Timing (master): `tk-link`, `tk-copy`, `tk-qr`, `wave-start` (one per wave, in race/wave order), `wave-time-input`, `confirm-ok`, `confirm-cancel`, `live-board`.
Timekeeper: `tk-name`, `tk-register`, `tk-clock`, `tk-sync-status`, `mark-button`, `bib-input`, `bib-submit`, `unassigned-list`, `oncourse-list`, `assign-toast`, `toast-undo`, `my-marks`.
Review: `issues-list`, `crossing-row`, `resolution-system`, `resolution-mark-<markId>`, `resolution-manual`, `resolution-manual-input`, `resolution-save`, `move-mark-suggested`.
Results: `race-select`, `classification-table`, `podiums`, `export-xlsx`, `finalize-race`, `unfinalize-race`, `print`.
Public: `public-events`, `public-results`, `public-athlete`.

## Shared Contracts

### `src/lib/types.ts` (created verbatim in Task 1)

```ts
export type Modality = 'swim' | 'bike' | 'run' | 'other';
export type Sex = 'M' | 'F';
export type EntrySex = 'M' | 'F' | 'MISTO';
export type EntryStatus = 'ok' | 'dns' | 'dnf' | 'dsq';
export type EventStatus = 'planejado' | 'ao_vivo' | 'encerrado';
export type RankingDim = 'sex' | 'age' | 'level';
export type AgeRule = 'year_end' | 'event_date';
export type TeamAgeRule = 'sum' | 'oldest' | 'youngest';
export type TimeSource = 'median' | 'reference';
export type ResolutionMode = 'system' | 'mark' | 'manual';
export type OrganizerRole = 'owner' | 'admin';

export interface Leg { modality: Modality; label: string; distance_m: number | null }
export interface AgeGroup { label: string; min: number; max: number | null }
export interface RankingDef { id: string; name: string; dims: RankingDim[]; size: number }
export interface RaceConfig {
  age_rule: AgeRule;
  team_age_rule: TeamAgeRule;
  age_groups: AgeGroup[];
  rankings: RankingDef[];
  cumulative: boolean;
  same_crossing_window_s: number;
  divergence_threshold_s: number;
  time_source: TimeSource;
  reference_timekeeper_id: string | null;
}

export interface EventRow {
  id: string; name: string; date: string; location: string; description: string;
  levels: string[]; status: EventStatus; is_public: boolean; public_slug: string | null;
  tk_token?: string; tk_enabled?: boolean; version: number;
  created_at?: string; updated_at?: string;
}
export interface RaceRow {
  id: string; event_id: string; name: string; position: number; team_size: number;
  legs: Leg[]; config: RaceConfig; finalized_at: string | null;
}
export interface WaveRow { id: string; race_id: string; name: string; position: number; start_at: string | null }
export interface EntryMember { athlete_id: string; position: number; legs: number[]; name?: string }
export interface EntryRow {
  id: string; event_id: string; race_id: string; wave_id: string | null; bib: string;
  team_name: string | null; level: string | null; status: EntryStatus; penalty_ms: number;
  notes: string; members: EntryMember[];
}
export interface AthleteRow {
  id: string; name: string; sex: Sex; birth_date: string | null;
  email?: string | null; phone?: string | null; city: string | null; team_club: string | null;
  notes?: string; public_profile: boolean;
  age_event?: number | null; age_year_end?: number | null;       // public payloads only
  participations?: number; wins?: number; podiums?: number;      // admin_list_athletes only
}
export interface TimekeeperRow {
  id: string; name: string; event_id?: string; device_label?: string; active?: boolean;
  last_seen_at?: string | null; created_at?: string; marks_count?: number;
}
export interface MarkRow {
  id: string; event_id: string; timekeeper_id: string | null; ts: string;
  device_ts: string | null; clock_offset_ms: number | null; clock_rtt_ms: number | null;
  entry_id: string | null; leg_index: number | null; athlete_id: string | null;
  discarded: boolean; discarded_by: 'timekeeper' | 'organizer' | null;
  created_at: string; updated_at: string;
}
export interface ResolutionRow {
  entry_id: string; leg_index: number; event_id: string; mode: ResolutionMode;
  mark_id: string | null; manual_ts: string | null; note: string; updated_at: string;
}
export type SnapshotStatus = 'finished' | 'on_course' | 'not_started' | 'dnf' | 'dns' | 'dsq';
export interface ResultSnapshot {
  event: { id: string; name: string; date: string };
  race: { id: string; name: string; team_size: number };
  bib: string; team_name: string | null;
  members: { athlete_id: string; name: string; legs: number[] }[];
  legs: { leg_index: number; modality: Modality; label: string; distance_m: number | null; athlete_id: string | null; time_ms: number | null }[];
  category: { sex: EntrySex; age: number | null; age_group: string | null; level: string | null };
  status: SnapshotStatus;
  total_ms: number | null; penalty_ms: number; final_ms: number | null;
  positions: { overall: number | null; sex: number | null; finishers: number };
  podiums: { ranking_id: string; ranking_name: string; group_label: string; podium_pos: number }[];
}
export interface ResultRow {
  race_id: string; entry_id: string; event_id: string; athlete_ids: string[];
  status: SnapshotStatus; final_ms: number | null; overall_pos: number | null;
  data: ResultSnapshot; finalized_at: string;
}
export interface FinalizeRowInput {
  entry_id: string; athlete_ids: string[]; status: SnapshotStatus;
  final_ms: number | null; overall_pos: number | null; data: ResultSnapshot;
}

export interface EventAggregate {
  event: EventRow; races: RaceRow[]; waves: WaveRow[]; entries: EntryRow[];
  athletes: AthleteRow[]; timekeepers: TimekeeperRow[]; marks: MarkRow[];
  resolutions: ResolutionRow[]; results: ResultRow[]; version: number; server_now: string;
}
export interface LiveDelta { server_now: string; version: number; marks: MarkRow[]; resolutions: ResolutionRow[]; waves: WaveRow[] }
export interface EventSummary extends EventRow { races_count: number; entries_count: number }
export interface AdminMe { user_id: string; email: string; name: string; role: OrganizerRole; must_change_password: boolean }
export interface OrganizerRow { user_id: string; email: string; name: string; role: OrganizerRole; created_at: string }
export interface ImportRowInput {
  name: string; sex: Sex; birth_date: string | null; email: string | null; phone: string | null;
  city: string | null; team_club: string | null; race_name: string | null;
}
export interface ImportResult { inserted: number; updated: number; entries_created: number; errors: { row: number; message: string }[] }
export interface AthleteProfile { athlete: AthleteRow; results: ResultRow[] }

export interface TkSession {
  event: Pick<EventRow, 'id' | 'name' | 'date' | 'location'>;
  races: RaceRow[]; waves: WaveRow[]; entries: EntryRow[];
  timekeepers: TimekeeperRow[]; version: number; server_now: string;
}
export interface TkRegistration { timekeeper_id: string; secret: string }
export interface TkMarkInput {
  id: string; ts: string; device_ts: string | null; clock_offset_ms: number | null; clock_rtt_ms: number | null;
  entry_id: string | null; leg_index: number | null; athlete_id: string | null; discarded: boolean;
}
export interface TkSyncResult {
  accepted: string[]; rejected: { id: string; reason: string }[];
  server_now: string; version: number; marks: MarkRow[]; waves: Pick<WaveRow, 'id' | 'start_at'>[];
}
export interface PubEventListItem { id: string; public_slug: string; name: string; date: string; location: string; status: EventStatus }
export interface PubEventPayload {
  event: EventRow; races: RaceRow[]; waves: WaveRow[]; entries: EntryRow[]; athletes: AthleteRow[];
  timekeepers: TimekeeperRow[]; marks: MarkRow[]; resolutions: ResolutionRow[]; results: ResultRow[];
  version: number; server_now: string;
}
```

### Domain signatures (implemented in Tasks 9–12, 15)

```ts
// src/domain/presets.ts
export const MODALITY_LABEL: Record<Modality, string>;            // swim 'Natação', bike 'Ciclismo', run 'Corrida', other 'Outro'
export function defaultRaceConfig(teamSize: number): RaceConfig;
export function generateAgeGroups(start: number, step: number, last: number): AgeGroup[];
export interface RacePreset { id: string; name: string; team_size: number; legs: Leg[] }
export const RACE_PRESETS: RacePreset[];
export function normalizeRaceConfig(partial: Partial<RaceConfig> | null | undefined, teamSize: number): RaceConfig;

// src/domain/categories.ts
export interface EntryCategory { sex: EntrySex; age: number | null; age_group: string | null; level: string | null }
export function ageOn(birthDate: string, eventDate: string, rule: AgeRule): number;
export function athleteAge(a: AthleteRow, eventDate: string, rule: AgeRule): number | null;
export function entryCategory(entry: EntryRow, athletesById: Map<string, AthleteRow>, race: RaceRow, event: { date: string; levels: string[] }): EntryCategory;
export function sexLabel(s: EntrySex): string;                     // 'Masculino' | 'Feminino' | 'Misto'
export function groupKey(dims: RankingDim[], cat: EntryCategory): string;
export function groupLabel(dims: RankingDim[], cat: EntryCategory): string; // [] → 'Geral'; parts joined ' · '; missing age group → 'Sem faixa'
export function validateAgeGroups(groups: AgeGroup[]): string[];  // pt-BR error messages, [] if ok

// src/domain/eventModel.ts
export interface EventIndex {
  racesById: Map<string, RaceRow>; wavesById: Map<string, WaveRow>; wavesByRace: Map<string, WaveRow[]>;
  entriesById: Map<string, EntryRow>; entriesByRace: Map<string, EntryRow[]>; athletesById: Map<string, AthleteRow>;
  timekeepersById: Map<string, TimekeeperRow>;
}
export function indexEvent(a: Pick<EventAggregate, 'races' | 'waves' | 'entries' | 'athletes' | 'timekeepers'>): EventIndex;
export function entryWave(entry: EntryRow, idx: EventIndex): WaveRow | null;  // entry.wave_id or first wave of race by position
export function entryDisplayName(entry: EntryRow, idx: EventIndex): string;    // team_name or athlete name(s) joined ' / '
export function legAthleteId(entry: EntryRow, legIndex: number): string | null;
export function mergeById<T extends { id: string; updated_at?: string }>(current: T[], incoming: T[]): T[];

// src/domain/bib.ts
export type BibResolution = { entry: EntryRow; warning: string | null } | { error: string };
export function normalizeBib(input: string): string;
export function resolveBib(entries: EntryRow[], input: string): BibResolution;

// src/domain/consolidation.ts
export interface Candidate { mark_id: string; timekeeper_id: string | null; ts_ms: number }
export interface Crossing {
  leg_index: number; candidates: Candidate[]; duplicates: string[];
  median_ms: number | null; spread_ms: number | null;
  system_ms: number | null; system_source: 'median' | 'reference' | null;
  official_ms: number | null; official_source: 'median' | 'reference' | 'mark' | 'manual' | null;
  resolution: ResolutionRow | null; divergent: boolean; chosen_mark_discarded: boolean;
}
export type TimingStatus = 'not_started' | 'on_course' | 'finished' | 'dnf' | 'dns' | 'dsq';
export interface LegTiming { leg_index: number; athlete_id: string | null; crossing: Crossing; start_ms: number | null; leg_ms: number | null }
export interface EntryTiming {
  entry_id: string; race_id: string; start_ms: number | null; legs: LegTiming[];
  total_ms: number | null; final_ms: number | null; status: TimingStatus;
  current_leg: number | null; current_leg_start_ms: number | null;
}
export type IssueType = 'divergence' | 'missing_crossing' | 'order' | 'duplicate' | 'no_start' | 'unassigned' | 'chosen_mark_discarded' | 'not_finished';
export interface Issue {
  type: IssueType; severity: 'error' | 'warning' | 'info'; message: string;
  entry_id?: string; race_id?: string; leg_index?: number; mark_ids?: string[]; suggested_leg_index?: number;
}
export interface EventTiming { byEntry: Map<string, EntryTiming>; issues: Issue[] }
export function median(values: number[]): number | null;
export function computeCrossing(args: { legIndex: number; marks: MarkRow[]; resolution: ResolutionRow | null; config: RaceConfig }): Crossing;
export function computeEntryTiming(entry: EntryRow, race: RaceRow, wave: WaveRow | null, marks: MarkRow[], resolutions: ResolutionRow[]): EntryTiming;
export function computeEventTiming(agg: Pick<EventAggregate, 'races' | 'waves' | 'entries' | 'athletes' | 'timekeepers' | 'marks' | 'resolutions'>, nowMs: number): EventTiming;

// src/domain/suggestLeg.ts
export interface LegSuggestion { leg_index: number; athlete_id: string | null; reason: 'same_crossing' | 'next'; warning: 'already_finished' | null }
export function suggestLeg(args: { entry: EntryRow; race: RaceRow; marks: MarkRow[]; tsMs: number; athleteId?: string | null }): LegSuggestion;

// src/domain/ranking.ts
export interface RankedEntry {
  entry: EntryRow; timing: EntryTiming; category: EntryCategory;
  overall_pos: number | null; sex_pos: number | null;
  ranking_pos: Record<string, number | null>; gap_ms: number | null;
}
export interface PodiumPlace { podium_pos: number; ranked: RankedEntry }
export interface PodiumGroup { ranking: RankingDef; group_key: string; group_label: string; places: PodiumPlace[] }
export interface RaceClassification { race: RaceRow; rows: RankedEntry[]; finishers: number; podiums: PodiumGroup[] }
export function classifyRace(race: RaceRow, entries: EntryRow[], timings: Map<string, EntryTiming>, athletesById: Map<string, AthleteRow>, event: { date: string; levels: string[] }): RaceClassification;

// src/domain/snapshot.ts
export function buildFinalizeRows(event: EventRow, cls: RaceClassification, athletesById: Map<string, AthleteRow>): FinalizeRowInput[];

// src/domain/stats.ts
export interface AthleteStats {
  participations: number; finishes: number; dnf: number; dsq: number; dns: number; completion_rate: number | null;
  wins_overall: number; wins_category: number; podiums: number; best_overall_pos: number | null; avg_percentile: number | null;
  records: { modality: Modality; distance_m: number; label: string; time_ms: number; pace: string; event_name: string; event_date: string }[];
  pace_by_modality: { modality: Modality; distance_m: number; time_ms: number; pace: string }[];
  km_by_modality: Partial<Record<Modality, number>>;
  history: { event_name: string; event_date: string; race_name: string; bib: string; team_name: string | null; category: string; status: SnapshotStatus; final_ms: number | null; overall_pos: number | null; finishers: number; podiums: string[]; my_legs: { label: string; time_ms: number | null }[] }[];
  evolution: { modality: Modality; distance_m: number; label: string; points: { date: string; time_ms: number; event_name: string }[] } | null;
  partners: { athlete_id: string; name: string; count: number }[];
}
export function computeAthleteStats(athleteId: string, results: ResultRow[]): AthleteStats;

// src/domain/workbook.ts  (uses src/lib/xlsx/writer.ts types)
export function buildEventWorkbook(agg: EventAggregate, timing: EventTiming, classifications: RaceClassification[], generatedAtMs: number): WorkbookModel;
export function workbookFileName(event: EventRow): string; // EBC_<slug>_<YYYY-MM-DD>.xlsx
```

### Libs signatures (Tasks 1, 13, 14, 17)

```ts
// src/lib/format.ts (Task 1)
export const TZ = 'America/Sao_Paulo';
export function formatClock(ms: number, opts?: { tenths?: boolean; millis?: boolean }): string; // '08:00:05.3'
export function formatDuration(ms: number | null, opts?: { tenths?: boolean }): string;         // '1:02:03', '42:07', '—' for null
export function formatGap(ms: number | null): string;                                            // '+1:05' ; '' for 0/null
export function formatDateBR(isoDate: string): string;                                           // '11/10/2026'
export function formatDateTimeBR(ms: number): string;                                           // '11/10/2026 08:00:05'
export function parseClockInput(text: string, eventDate: string): number | null;               // 'hh:mm[:ss[.d]]' Brasília → epoch ms
export function brasiliaOffsetMinutes(ms: number): number;                                     // e.g. -180
export function excelSerialBrasilia(ms: number): number;                                       // days since 1899-12-30 in Brasília local time
export function excelDuration(ms: number): number;                                             // ms / 86_400_000
export function formatPace(timeMs: number, distanceM: number, modality: Modality): string;      // run '4:30 /km', swim '1:40 /100m', bike '32,4 km/h', other ''
export function parseDateInput(text: string): string | null;                                   // 'dd/mm/aaaa' | 'aaaa-mm-dd' → 'aaaa-mm-dd'

// src/lib/storage.ts (Task 1)
export interface KeyValueStorage { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
export function safeLocalStorage(): KeyValueStorage;   // try/catch wrapper; falls back to in-memory Map
export function memoryStorage(): KeyValueStorage;
export function readJSON<T>(s: KeyValueStorage, key: string, fallback: T): T;
export function writeJSON(s: KeyValueStorage, key: string, value: unknown): void;

// src/lib/clock.ts (Task 13)
export interface ClockSample { t0: number; t1: number; server: number }
export interface ClockState { offset_ms: number; rtt_ms: number; synced_at: number }
export class ClockSync {
  constructor(opts?: { maxSamples?: number; now?: () => number; initial?: ClockState | null });
  addSample(s: ClockSample): void;
  readonly offsetMs: number | null; readonly rttMs: number | null; readonly synced: boolean; readonly syncedAt: number | null;
  now(): number;
  state(): ClockState | null;
}
export async function takeSample(serverTime: () => Promise<number>, now?: () => number): Promise<ClockSample>;

// src/lib/outbox.ts (Task 13)
export interface LocalMark extends TkMarkInput { local_updated_at: number }
export type OutboxState = 'pending' | 'synced' | 'rejected';
export interface OutboxItem { mark: LocalMark; state: OutboxState; reason?: string; sent_at_version?: number }
export class Outbox {
  constructor(storage: KeyValueStorage, key: string, now?: () => number);
  all(): OutboxItem[];                   // sorted by mark.ts ascending
  get(id: string): OutboxItem | undefined;
  upsert(mark: Omit<LocalMark, 'local_updated_at'>): LocalMark;  // stamps local_updated_at, state 'pending'
  pending(limit?: number): LocalMark[];
  markSent(marks: LocalMark[]): void;    // remembers local_updated_at that was sent
  applyResult(accepted: string[], rejected: { id: string; reason: string }[]): void; // accepted → 'synced' only if unchanged since sent
  pendingCount(): number;
}

// src/lib/xlsx/writer.ts (Task 14)
export type StyleName = 'default' | 'header' | 'title' | 'bold' | 'time' | 'duration' | 'int' | 'decimal1';
export type CellValue = string | number | boolean | null | { formula: string; result?: number | string | null };
export type Cell = CellValue | { v: CellValue; s: StyleName };
export interface ColumnDef { header: string; width?: number; style?: StyleName }
export interface SheetModel { name: string; columns: ColumnDef[]; rows: Cell[][]; freezeHeader?: boolean; headerless?: boolean }
export interface WorkbookModel { sheets: SheetModel[] }
export function sanitizeSheetName(name: string, used: Set<string>): string;
export function colLetter(index0: number): string;       // 0 → 'A', 26 → 'AA'
export function writeXlsx(model: WorkbookModel): Uint8Array;
// src/lib/xlsx/reader.ts
export function readXlsxFirstSheet(data: Uint8Array): string[][];
// src/lib/csv.ts
export function parseCsv(text: string): string[][];   // auto-detects ';' vs ',' vs '\t'; strips BOM; RFC4180 quotes
// src/lib/importMapping.ts
export interface MappedImport { rows: ImportRowInput[]; errors: { row: number; message: string }[]; columns: Record<string, number> }
export function mapImportRows(table: string[][]): MappedImport;

// src/lib/api.ts (Task 17) — every method throws ApiError on failure
export class ApiError extends Error { code: string | null }
export const api: {
  serverTime(): Promise<number>;
  admin: {
    me(): Promise<AdminMe>; passwordChanged(): Promise<void>;
    listOrganizers(): Promise<OrganizerRow[]>; createOrganizer(email: string, password: string, name: string): Promise<OrganizerRow>; deleteOrganizer(userId: string): Promise<void>;
    listEvents(): Promise<EventSummary[]>; getEvent(id: string): Promise<EventAggregate>;
    saveEvent(e: Partial<EventRow> & { name: string; date: string }): Promise<EventRow>; deleteEvent(id: string): Promise<void>;
    duplicateEvent(id: string, name: string, date: string): Promise<string>; rotateTkToken(eventId: string): Promise<string>;
    saveRace(r: Partial<RaceRow> & { event_id: string; name: string; legs: Leg[]; waves?: Partial<WaveRow>[] }): Promise<{ race: RaceRow; waves: WaveRow[] }>;
    deleteRace(id: string): Promise<void>; setWaveStart(waveId: string, startAt: string | null): Promise<WaveRow>;
    listAthletes(): Promise<AthleteRow[]>; saveAthlete(a: Partial<AthleteRow> & { name: string; sex: Sex }): Promise<AthleteRow>; deleteAthlete(id: string): Promise<void>;
    importAthletes(eventId: string | null, rows: ImportRowInput[]): Promise<ImportResult>; athleteProfile(id: string): Promise<AthleteProfile>;
    saveEntry(e: { id?: string; race_id: string; wave_id?: string | null; bib?: string | null; team_name?: string | null; level?: string | null; notes?: string; members: { athlete_id: string; legs: number[] }[] }): Promise<EntryRow>;
    bulkCreateEntries(raceId: string, athleteIds: string[]): Promise<EntryRow[]>;
    updateEntryStatus(id: string, status: EntryStatus, penaltyMs: number, notes: string): Promise<EntryRow>; deleteEntry(id: string): Promise<void>;
    live(eventId: string, since: string | null): Promise<LiveDelta>;
    updateMark(id: string, patch: { entry_id?: string | null; leg_index?: number | null; discarded?: boolean }): Promise<MarkRow>;
    setResolution(entryId: string, legIndex: number, mode: ResolutionMode, markId: string | null, manualTs: string | null, note: string): Promise<ResolutionRow>;
    clearResolution(entryId: string, legIndex: number): Promise<void>;
    updateTimekeeper(id: string, patch: { name?: string; active?: boolean }): Promise<TimekeeperRow>;
    finalizeRace(raceId: string, rows: FinalizeRowInput[]): Promise<{ finalized_at: string; count: number }>; unfinalizeRace(raceId: string): Promise<void>;
  };
  tk: {
    open(token: string): Promise<TkSession>; register(token: string, name: string, deviceLabel: string): Promise<TkRegistration>;
    sync(token: string, timekeeperId: string, secret: string, marks: TkMarkInput[], since: string | null): Promise<TkSyncResult>;
  };
  pub: {
    events(): Promise<PubEventListItem[]>; event(slug: string): Promise<PubEventPayload>;
    live(slug: string, since: string | null): Promise<LiveDelta>; athlete(id: string): Promise<AthleteProfile>;
  };
};
```

RPC parameter names used by `api.ts` (must match SQL exactly): `admin_save_event(p_event)`, `admin_get_event(p_event_id)`, `admin_delete_event(p_event_id)`, `admin_duplicate_event(p_event_id,p_name,p_date)`, `admin_rotate_tk_token(p_event_id)`, `admin_save_race(p_race)` (payload includes `waves`), `admin_delete_race(p_race_id)`, `admin_set_wave_start(p_wave_id,p_start_at)`, `admin_list_athletes()`, `admin_save_athlete(p_athlete)`, `admin_delete_athlete(p_athlete_id)`, `admin_import_athletes(p_event_id,p_rows)`, `admin_athlete_profile(p_athlete_id)`, `admin_save_entry(p_entry)`, `admin_bulk_create_entries(p_race_id,p_athlete_ids)`, `admin_update_entry_status(p_entry_id,p_status,p_penalty_ms,p_notes)`, `admin_delete_entry(p_entry_id)`, `admin_live(p_event_id,p_since)`, `admin_update_mark(p_mark_id,p_patch)`, `admin_set_resolution(p_entry_id,p_leg_index,p_mode,p_mark_id,p_manual_ts,p_note)`, `admin_clear_resolution(p_entry_id,p_leg_index)`, `admin_update_timekeeper(p_timekeeper_id,p_patch)`, `admin_finalize_race(p_race_id,p_rows)`, `admin_unfinalize_race(p_race_id)`, `admin_me()`, `admin_password_changed()`, `admin_list_organizers()`, `admin_create_organizer(p_email,p_password,p_name)`, `admin_delete_organizer(p_user_id)`, `admin_list_events()`, `tk_open(p_token)`, `tk_register(p_token,p_name,p_device_label)`, `tk_sync(p_token,p_timekeeper_id,p_secret,p_marks,p_since)`, `pub_events()`, `pub_event(p_slug)`, `pub_live(p_slug,p_since)`, `pub_athlete(p_athlete_id)`, `server_time()`.

Live endpoints (`admin_live`, `pub_live`) return **marks as deltas** (`updated_at >= p_since`; clients pass `since = previous server_now − 10 s`) but **all** resolutions and **all** waves of the event every time (small lists; this also propagates deleted resolutions). `tk_sync` returns mark deltas and all waves.

---

