# EnduranceBaseClub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and ship the EnduranceBaseClub web app: event/race configuration, athlete database with stats, offline-first multi-timekeeper timing with median consolidation, results/podiums, XLSX conference workbook, public results — on Supabase + Vercel.

**Architecture:** React SPA (HashRouter) talking to Supabase exclusively through Postgres RPC functions (RLS denies direct table access). All business rules for timing/results live in a pure TypeScript domain module shared by every screen. Timekeepers use a token link, a synced clock and a localStorage outbox. Local testing uses a real Postgres 16 plus a small Node shim that emulates Supabase Auth and PostgREST RPC.

**Tech Stack:** Vite, React 19, TypeScript (strict), Tailwind CSS v4, React Router 7, TanStack Query 5, @supabase/supabase-js 2, fflate, qrcode, vite-plugin-pwa, Vitest (+ jsdom, Testing Library), PostgreSQL 16 (local) / 17 (Supabase), Node 22, agent-browser 0.27 (E2E).

**Spec:** `docs/superpowers/specs/2026-09-24-endurance-base-club-design.md` — read it; this plan implements it. Section numbers below (§N) refer to the spec.

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

## Task 1: Project scaffold, shared contracts, time formatting, storage

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`, `.env.production`, `.env.development`, `.env.e2e`, `vercel.json`, `public/logo.png`, `public/favicon.png`, `public/icon-192.png`, `src/main.tsx`, `src/App.tsx`, `src/index.css`, `src/vite-env.d.ts`, `src/lib/types.ts`, `src/lib/format.ts`, `src/lib/format.test.ts`, `src/lib/storage.ts`, `src/lib/storage.test.ts`, `src/test/setup.ts`

**Interfaces:**
- Produces: `src/lib/types.ts` (verbatim from "Shared Contracts"), `src/lib/format.ts`, `src/lib/storage.ts` (signatures in "Libs signatures"), npm scripts, installed dependencies, CSS tokens, brand assets.

- [ ] **Step 1: Create the Vite project files and install dependencies**

```bash
cd /home/claude/endurance-base-club
npm init -y >/dev/null
npm install --save-exact react react-dom react-router @tanstack/react-query @supabase/supabase-js fflate qrcode
npm install --save-exact -D vite @vitejs/plugin-react typescript @types/react @types/react-dom @types/qrcode tailwindcss @tailwindcss/vite vite-plugin-pwa vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom pg @types/pg @types/node
```

Edit `package.json`: set `"name": "endurance-base-club"`, `"private": true`, `"type": "module"`, remove `main`, and set scripts:

```json
{
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview --port 4173 --strictPort",
  "typecheck": "tsc --noEmit -p tsconfig.json",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:integration": "vitest run -c vitest.integration.config.ts",
  "test:sql": "bash scripts/test-sql.sh",
  "db": "bash scripts/db-local.sh",
  "shim": "node dev/shim/server.mjs",
  "dev:stack": "bash scripts/dev-stack.sh",
  "e2e": "bash tests/e2e/run.sh"
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022", "lib": ["ES2022", "DOM", "DOM.Iterable"], "module": "ESNext",
    "moduleResolution": "bundler", "jsx": "react-jsx", "strict": true, "noEmit": true,
    "skipLibCheck": true, "resolveJsonModule": true, "isolatedModules": true,
    "types": ["vite/client", "node"], "allowImportingTsExtensions": false
  },
  "include": ["src", "tests", "vite.config.ts", "vitest.integration.config.ts"]
}
```

`vite.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
```

`src/test/setup.ts`: `import '@testing-library/jest-dom/vitest';`

`.env.production`:
```
VITE_SUPABASE_URL=https://wlishmznbhhcqzncdxnq.supabase.co
VITE_SUPABASE_KEY=sb_publishable_Py0jUHGMNAjCM8C488RvZg_qviJupEk
```
`.env.development` and `.env.e2e` (identical):
```
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_KEY=sb_publishable_local_dev
```
`.gitignore`: `node_modules`, `dist`, `.env.local`, `tests/e2e/artifacts/*` (keep `.gitkeep`), `*.log`, `.vercel`.

`vercel.json`:
```json
{
  "framework": "vite",
  "installCommand": "npm install --no-audit --no-fund",
  "buildCommand": "vite build",
  "outputDirectory": "dist",
  "headers": [
    { "source": "/sw.js", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] },
    { "source": "/index.html", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] }
  ]
}
```

`index.html` (`lang="pt-BR"`, `<meta charset="utf-8">`, viewport `width=device-width, initial-scale=1, viewport-fit=cover`, `theme-color` `#191513`, title `EnduranceBaseClub`, `<link rel="icon" href="/favicon.png">`, `<link rel="apple-touch-icon" href="/icon-192.png">`, `<div id="root">`, `<script type="module" src="/src/main.tsx">`) plus this inline script in `<head>` so the theme applies before paint:

```html
<script>
  try { var t = localStorage.getItem('ebc.theme'); document.documentElement.dataset.theme = (t === 'light' || t === 'dark') ? t : 'dark'; }
  catch (e) { document.documentElement.dataset.theme = 'dark'; }
</script>
```

`src/index.css`:

```css
@import "tailwindcss";

:root, [data-theme="dark"] {
  --bg: #191513; --fg: #F4F1EC; --surface: #241F1C; --surface-2: #2E2825;
  --border: #3A332F; --muted: #A39D93; --accent: #F4F1EC; --accent-fg: #191513;
}
[data-theme="light"] {
  --bg: #F4F1EC; --fg: #191513; --surface: #FFFFFF; --surface-2: #ECE7DF;
  --border: #D9D3C9; --muted: #6F665E; --accent: #191513; --accent-fg: #F4F1EC;
}
@theme inline {
  --color-bg: var(--bg); --color-fg: var(--fg); --color-surface: var(--surface); --color-surface-2: var(--surface-2);
  --color-border: var(--border); --color-muted: var(--muted); --color-accent: var(--accent); --color-accent-fg: var(--accent-fg);
  --color-ink: #191513; --color-paper: #F4F1EC;
  --color-success: #3F8F5B; --color-warning: #C8922E; --color-danger: #C2413B; --color-info: #5B7C99;
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
html, body, #root { height: 100%; }
body { background: var(--bg); color: var(--fg); font-family: var(--font-sans); -webkit-tap-highlight-color: transparent; }
.tabular { font-variant-numeric: tabular-nums; }
.brand-title { text-transform: uppercase; letter-spacing: 0.18em; }
@media print { .no-print { display: none !important; } body { background: #fff; color: #000; } }
```

`src/main.tsx` renders `<App />` inside `<StrictMode>` and imports `./index.css`. Temporary `src/App.tsx`: `export default function App() { return <main className="p-6 brand-title">EnduranceBaseClub</main>; }` (Task 17 replaces it).

- [ ] **Step 2: Create brand assets from the user's logo**

```bash
python3 - <<'EOF'
from PIL import Image, ImageDraw
src = Image.open('/root/.claude/uploads/1de2ea02-75bd-5c83-8fd8-9d71141a0d63/45b4c3fa-image.jpg').convert('RGBA')
w, h = src.size
mask = Image.new('L', (w * 4, h * 4), 0)
ImageDraw.Draw(mask).ellipse((2, 2, w * 4 - 3, h * 4 - 3), fill=255)
mask = mask.resize((w, h), Image.LANCZOS)
src.putalpha(mask)
def save(img, path, size):
    img.resize((size, size), Image.LANCZOS).quantize(colors=32, method=Image.Quantize.FASTOCTREE).save(path, optimize=True)
save(src, 'public/logo.png', 150)
save(src, 'public/favicon.png', 48)
save(src, 'public/icon-192.png', 192)
EOF
ls -la public
```
Expected: three PNGs, each < 25 KB, transparent corners.

- [ ] **Step 3: Write `src/lib/types.ts`** — copy the block from "Shared Contracts → `src/lib/types.ts`" verbatim.

- [ ] **Step 4: Write the failing tests `src/lib/format.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import {
  formatClock, formatDuration, formatGap, formatDateBR, formatDateTimeBR, parseClockInput,
  brasiliaOffsetMinutes, excelSerialBrasilia, excelDuration, formatPace, parseDateInput,
} from './format';

const T = Date.parse('2026-10-11T11:00:05.345Z'); // 08:00:05.345 in Brasília (UTC-3)

describe('format (independent of device time zone)', () => {
  it('formats the clock in Brasília', () => {
    expect(formatClock(T)).toBe('08:00:05');
    expect(formatClock(T, { tenths: true })).toBe('08:00:05.3');
    expect(formatClock(T, { millis: true })).toBe('08:00:05.345');
  });
  it('Brasília offset is -180 minutes in 2026', () => {
    expect(brasiliaOffsetMinutes(T)).toBe(-180);
  });
  it('formats durations (truncating)', () => {
    expect(formatDuration(3_723_456)).toBe('1:02:03');
    expect(formatDuration(3_723_456, { tenths: true })).toBe('1:02:03.4');
    expect(formatDuration(2_527_000)).toBe('42:07');
    expect(formatDuration(59_999)).toBe('0:59');
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(-65_000)).toBe('-1:05');
  });
  it('formats gaps', () => {
    expect(formatGap(0)).toBe('');
    expect(formatGap(null)).toBe('');
    expect(formatGap(65_000)).toBe('+1:05');
  });
  it('formats dates', () => {
    expect(formatDateBR('2026-10-11')).toBe('11/10/2026');
    expect(formatDateTimeBR(T)).toBe('11/10/2026 08:00:05');
  });
  it('parses clock input as Brasília wall time on the event date', () => {
    expect(parseClockInput('08:00:05.3', '2026-10-11')).toBe(Date.parse('2026-10-11T11:00:05.300Z'));
    expect(parseClockInput('8:00', '2026-10-11')).toBe(Date.parse('2026-10-11T11:00:00.000Z'));
    expect(parseClockInput('08:00:05,25', '2026-10-11')).toBe(Date.parse('2026-10-11T11:00:05.250Z'));
    expect(parseClockInput('25:00', '2026-10-11')).toBeNull();
    expect(parseClockInput('08:61', '2026-10-11')).toBeNull();
    expect(parseClockInput('abc', '2026-10-11')).toBeNull();
  });
  it('produces Excel serials in Brasília local time', () => {
    const expected = Date.UTC(2026, 9, 11, 8, 0, 5, 345) / 86_400_000 + 25569;
    expect(excelSerialBrasilia(T)).toBeCloseTo(expected, 9);
    expect(excelDuration(86_400_000)).toBe(1);
  });
  it('formats pace per modality', () => {
    expect(formatPace(22 * 60_000 + 30_000, 5000, 'run')).toBe('4:30 /km');
    expect(formatPace(12 * 60_000 + 30_000, 750, 'swim')).toBe('1:40 /100m');
    expect(formatPace(37 * 60_000, 20_000, 'bike')).toBe('32,4 km/h');
    expect(formatPace(60_000, 0, 'run')).toBe('');
    expect(formatPace(60_000, 100, 'other')).toBe('');
  });
  it('parses dates typed in Brazilian or ISO format', () => {
    expect(parseDateInput('15/06/1990')).toBe('1990-06-15');
    expect(parseDateInput('5/6/1990')).toBe('1990-06-05');
    expect(parseDateInput('1990-06-15')).toBe('1990-06-15');
    expect(parseDateInput('31/02/1990')).toBeNull();
    expect(parseDateInput('')).toBeNull();
  });
});
```

- [ ] **Step 5: Run to verify failure** — `npx vitest run src/lib/format.test.ts` → FAIL (module not found).

- [ ] **Step 6: Implement `src/lib/format.ts`**

```ts
import type { Modality } from './types';

export const TZ = 'America/Sao_Paulo';
const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const msPart = (ms: number) => ((ms % 1000) + 1000) % 1000;

function brParts(ms: number) {
  const p: Record<string, string> = {};
  for (const x of partsFmt.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

export function brasiliaOffsetMinutes(ms: number): number {
  const whole = Math.floor(ms / 1000) * 1000;
  const p = brParts(whole);
  return Math.round((Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - whole) / 60_000);
}

export function formatClock(ms: number, opts: { tenths?: boolean; millis?: boolean } = {}): string {
  const p = brParts(ms);
  const base = `${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`;
  if (opts.millis) return `${base}.${pad(msPart(ms), 3)}`;
  if (opts.tenths) return `${base}.${Math.floor(msPart(ms) / 100)}`;
  return base;
}

export function formatDuration(ms: number | null, opts: { tenths?: boolean } = {}): string {
  if (ms === null || Number.isNaN(ms)) return '—';
  if (ms < 0) return `-${formatDuration(-ms, opts)}`;
  const totalS = Math.floor(ms / 1000);
  const h = Math.floor(totalS / 3600), m = Math.floor((totalS % 3600) / 60), s = totalS % 60;
  const base = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  return opts.tenths ? `${base}.${Math.floor((ms % 1000) / 100)}` : base;
}

export function formatGap(ms: number | null): string {
  return !ms ? '' : `+${formatDuration(ms)}`;
}

export function formatDateBR(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function formatDateTimeBR(ms: number): string {
  const p = brParts(ms);
  return `${pad(p.d)}/${pad(p.mo)}/${p.y} ${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`;
}

export function parseClockInput(text: string, eventDate: string): number | null {
  const m = /^\s*(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,3}))?)?\s*$/.exec(text);
  if (!m) return null;
  const h = +m[1], mi = +m[2], s = m[3] ? +m[3] : 0, frac = m[4] ? +m[4].padEnd(3, '0') : 0;
  if (h > 23 || mi > 59 || s > 59) return null;
  const [y, mo, d] = eventDate.split('-').map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi, s, frac);
  let t = wall - brasiliaOffsetMinutes(wall) * 60_000;
  const off2 = brasiliaOffsetMinutes(t);
  t = wall - off2 * 60_000;
  return t;
}

export function excelSerialBrasilia(ms: number): number {
  return (ms + brasiliaOffsetMinutes(ms) * 60_000) / 86_400_000 + 25569;
}
export function excelDuration(ms: number): number { return ms / 86_400_000; }

const nf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export function formatPace(timeMs: number, distanceM: number, modality: Modality): string {
  if (!distanceM || distanceM <= 0 || !timeMs || timeMs <= 0) return '';
  const minSec = (sec: number) => `${Math.floor(sec / 60)}:${pad(Math.round(sec % 60) === 60 ? 59 : Math.round(sec % 60))}`;
  if (modality === 'run') return `${minSec(timeMs / 1000 / (distanceM / 1000))} /km`;
  if (modality === 'swim') return `${minSec(timeMs / 1000 / (distanceM / 100))} /100m`;
  if (modality === 'bike') return `${nf1.format(distanceM / 1000 / (timeMs / 3_600_000))} km/h`;
  return '';
}

export function parseDateInput(text: string): string | null {
  const t = text.trim();
  let y: number, m: number, d: number;
  let r = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (r) { d = +r[1]; m = +r[2]; y = +r[3]; }
  else if ((r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t))) { y = +r[1]; m = +r[2]; d = +r[3]; }
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}
```

- [ ] **Step 7: Run** `npx vitest run src/lib/format.test.ts` → PASS. Also run `TZ=Asia/Tokyo npx vitest run src/lib/format.test.ts` → PASS (proves device time zone is irrelevant).

- [ ] **Step 8: Storage — write failing test `src/lib/storage.test.ts`, then implement `src/lib/storage.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { memoryStorage, readJSON, writeJSON, safeLocalStorage } from './storage';

describe('storage', () => {
  it('memory roundtrip and JSON helpers', () => {
    const s = memoryStorage();
    writeJSON(s, 'k', { a: 1 });
    expect(readJSON(s, 'k', null)).toEqual({ a: 1 });
    s.setItem('bad', '{not json');
    expect(readJSON(s, 'bad', 'fallback')).toBe('fallback');
    expect(readJSON(s, 'missing', 7)).toBe(7);
  });
  it('safeLocalStorage works and survives a throwing localStorage', () => {
    const s = safeLocalStorage();
    s.setItem('x', '1');
    expect(s.getItem('x')).toBe('1');
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const s2 = safeLocalStorage();
    expect(() => s2.setItem('y', '2')).not.toThrow();
    expect(s2.getItem('y')).toBe('2'); // served from the in-memory fallback
    spy.mockRestore();
  });
});
```

Implementation: `memoryStorage()` wraps a `Map`. `safeLocalStorage()` returns an object that tries `window.localStorage` for each call and, on any exception, uses (and keeps using for that key) a module-level memory fallback; `getItem` checks the memory fallback first when the key was written there. `readJSON` parses with try/catch; `writeJSON` stringifies and calls `setItem` inside try/catch.

- [ ] **Step 9: Verify** — `npx vitest run` (all pass), `npm run typecheck` (no errors), `npm run build` (dist created).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite React app, shared types, time formatting and storage

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HRbqvfPgjYxeUrwitUvfv4"
```

---

## Task 2: Local Supabase emulation (Postgres bootstrap, scripts, auth/RPC shim)

**Files:**
- Create: `dev/db/bootstrap.sql`, `scripts/db-local.sh`, `scripts/test-sql.sh`, `scripts/dev-stack.sh`, `dev/shim/jwt.mjs`, `dev/shim/server.mjs`, `supabase/tests/00_helpers.sql`, `vitest.integration.config.ts`, `tests/integration/shim.test.ts`, `supabase/migrations/.gitkeep`

**Interfaces:**
- Produces: `bash scripts/db-local.sh start|stop|reset|apply|psql|url` (honors `EBC_DB`, `EBC_PG_PORT`); `bash scripts/test-sql.sh` (resets `EBC_DB` default `ebc_test`, applies migrations, runs `supabase/tests/*.sql` in name order, exits non-zero on failure); shim `node dev/shim/server.mjs` (env `SHIM_PORT` default 54321, `EBC_DB` default `ebc`, `EBC_PG_PORT`, `SHIM_JWT_SECRET` default `ebc-local-dev-jwt-secret-0123456789abcdef`); SQL test helpers in schema `tests`: `tests.as_user(uuid)`, `tests.as_anon()`, `tests.assert_raises(p_sql text, p_errcode text, p_msg_like text default null)`, `tests.set(k text, v text)`, `tests.get(k text) returns text`.

- [ ] **Step 1: `dev/db/bootstrap.sql`** — emulates what our SQL relies on in Supabase:

```sql
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
create table if not exists auth.users (
  instance_id uuid, id uuid not null primary key, aud varchar(255), role varchar(255), email varchar(255),
  encrypted_password varchar(255), email_confirmed_at timestamptz, invited_at timestamptz,
  confirmation_token varchar(255), confirmation_sent_at timestamptz, recovery_token varchar(255),
  recovery_sent_at timestamptz, email_change_token_new varchar(255), email_change varchar(255),
  email_change_sent_at timestamptz, last_sign_in_at timestamptz, raw_app_meta_data jsonb,
  raw_user_meta_data jsonb, is_super_admin boolean, created_at timestamptz, updated_at timestamptz,
  phone text default null, phone_confirmed_at timestamptz, phone_change text default '',
  phone_change_token varchar(255) default '', phone_change_sent_at timestamptz,
  confirmed_at timestamptz generated always as (least(email_confirmed_at, phone_confirmed_at)) stored,
  email_change_token_current varchar(255) default '', email_change_confirm_status smallint default 0,
  banned_until timestamptz, reauthentication_token varchar(255) default '', reauthentication_sent_at timestamptz,
  is_sso_user boolean not null default false, deleted_at timestamptz, is_anonymous boolean not null default false
);
create unique index if not exists users_email_partial_key on auth.users (email) where is_sso_user = false;
create table if not exists auth.identities (
  provider_id text not null, user_id uuid not null references auth.users(id) on delete cascade,
  identity_data jsonb not null, provider text not null, last_sign_in_at timestamptz,
  created_at timestamptz, updated_at timestamptz,
  email text generated always as (lower(identity_data ->> 'email')) stored,
  id uuid not null default gen_random_uuid() primary key,
  unique (provider_id, provider)
);
create or replace function auth.jwt() returns jsonb language sql stable as
$$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
create or replace function auth.role() returns text language sql stable as
$$ select nullif(auth.jwt() ->> 'role', '') $$;
grant execute on function auth.jwt(), auth.uid(), auth.role() to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
```

- [ ] **Step 2: `scripts/db-local.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN=/usr/lib/postgresql/16/bin
BASE=/var/tmp/ebc-pg
PGDATA=$BASE/data
PORT=${EBC_PG_PORT:-54322}
DB=${EBC_DB:-ebc}
URL_BASE="postgresql://postgres@127.0.0.1:$PORT"
as_pg() { runuser -u postgres -- "$@"; }
psql_db() { "$PGBIN/psql" "$URL_BASE/$1" -v ON_ERROR_STOP=1 -q "${@:2}"; }

start() {
  if [ ! -s "$PGDATA/PG_VERSION" ]; then
    mkdir -p "$BASE" && chown postgres:postgres "$BASE"
    as_pg "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
  fi
  if ! as_pg "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
    as_pg "$PGBIN/pg_ctl" -D "$PGDATA" -o "-p $PORT -k $BASE -c listen_addresses=127.0.0.1" -l "$BASE/server.log" -w start >/dev/null
  fi
}
apply() {
  for f in supabase/migrations/*.sql; do [ -e "$f" ] || continue; psql_db "$DB" -f "$f"; done
}
reset() {
  start
  psql_db postgres -c "drop database if exists \"$DB\" with (force)" -c "create database \"$DB\""
  psql_db "$DB" -f dev/db/bootstrap.sql
  apply
}
case "${1:-}" in
  start) start ;;
  stop) as_pg "$PGBIN/pg_ctl" -D "$PGDATA" -m fast stop ;;
  reset) reset ;;
  apply) start; apply ;;
  psql) start; "$PGBIN/psql" "$URL_BASE/$DB" ;;
  url) echo "$URL_BASE/$DB" ;;
  *) echo "usage: db-local.sh start|stop|reset|apply|psql|url" >&2; exit 2 ;;
esac
```

- [ ] **Step 3: `scripts/test-sql.sh` and `supabase/tests/00_helpers.sql`**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export EBC_DB=${EBC_DB:-ebc_test}
bash scripts/db-local.sh reset
URL=$(bash scripts/db-local.sh url)
fail=0
for f in supabase/tests/*.sql; do
  if /usr/lib/postgresql/16/bin/psql "$URL" -v ON_ERROR_STOP=1 -q -f "$f" >/tmp/ebc-sqltest.log 2>&1; then
    echo "PASS $f"
  else
    echo "FAIL $f"; cat /tmp/ebc-sqltest.log; fail=1
  fi
done
exit $fail
```

`supabase/tests/00_helpers.sql` (not wrapped in a transaction; later test files each run `begin; … rollback;`):

```sql
create schema if not exists tests;
grant usage on schema tests to anon, authenticated;
create table if not exists tests.ctx (k text primary key, v text);
grant all on tests.ctx to anon, authenticated;
create or replace function tests.set(p_k text, p_v text) returns void language sql as
$$ insert into tests.ctx(k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v $$;
create or replace function tests.get(p_k text) returns text language sql stable as
$$ select v from tests.ctx where k = p_k $$;
create or replace function tests.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function tests.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end $$;
create or replace function tests.assert_raises(p_sql text, p_errcode text, p_msg_like text default null)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate <> p_errcode then
      raise exception 'expected errcode % but got % (%) for: %', p_errcode, sqlstate, sqlerrm, p_sql;
    end if;
    if p_msg_like is not null and sqlerrm not like p_msg_like then
      raise exception 'expected message like "%" but got "%"', p_msg_like, sqlerrm;
    end if;
    return;
  end;
  raise exception 'expected error % but statement succeeded: %', p_errcode, p_sql;
end $$;
grant execute on all functions in schema tests to anon, authenticated;
```

Test files switch roles with `select tests.as_user(tests.get('owner')::uuid);` and return to the superuser with `reset role;`. Keep test files free of psql meta-commands (they must also run through the Supabase MCP `execute_sql`).

- [ ] **Step 4: Shim — `dev/shim/jwt.mjs`**

```js
import { createHmac, timingSafeEqual } from 'node:crypto';
const b64u = (buf) => Buffer.from(buf).toString('base64url');
export function sign(payload, secret) {
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
export function verify(token, secret) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const expected = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  const got = Buffer.from(parts[2], 'base64url');
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  if (payload.exp && payload.exp * 1000 < Date.now()) return null;
  return payload;
}
```

- [ ] **Step 5: Shim — `dev/shim/server.mjs`** (Node `http` + `pg`; ~250 lines). Required behavior:
  - CORS on every response: `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Headers: apikey, authorization, content-type, x-client-info, prefer, accept-profile, content-profile, x-supabase-api-version`, `Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS`; `OPTIONS` → 204.
  - `pg.types.setTypeParser(20, Number)` and `setTypeParser(1700, Number)` so bigint/numeric are JSON numbers (PostgREST behavior).
  - Role resolution per request from `Authorization: Bearer <t>`: missing, or starting with `sb_publishable_` → `{role:'anon'}`; else `verify(t, secret)` → claims (role from claims); invalid → 401 `{"code":"PGRST301","message":"JWT invalid","details":null,"hint":null}`.
  - `POST /rest/v1/rpc/:fn` → load signature once per fn: `select p.proargnames, array(select format_type(t, null) from unnest(p.proargtypes) t) as types, format_type(p.prorettype, null) as rettype, p.pronargdefaults from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`. Not found → 404 `{"code":"PGRST202","message":"Could not find the function public.<fn> in the schema cache",...}`. Build `select public."<fn>"(<name> => $1::<type>, ...) as result` only for keys present in the body (missing keys fall back to SQL defaults); jsonb/json params get `JSON.stringify(value)`; array params pass the JS array; other params pass `value === null ? null : String(value)`. Execute in a transaction on a pooled client: `begin; select set_config('request.jwt.claims', $1, true); set local role <anon|authenticated|service_role>; <call>; commit;` (role name validated against that list before interpolation). Response: rettype `void` → 204; else 200 with `JSON.stringify(result)`.
  - PG errors → rollback, status 400 (401 if code `42501` and role anon, 403 if `42501` and authenticated), body `{ code, message, details: err.detail ?? null, hint: err.hint ?? null }`.
  - `POST /auth/v1/token?grant_type=password` body `{email,password}` → `select id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, encrypted_password = extensions.crypt($2, encrypted_password) as ok from auth.users where lower(email) = lower($1) and deleted_at is null`; not ok → 400 `{"code":400,"error_code":"invalid_credentials","msg":"Invalid login credentials"}`; ok → update `last_sign_in_at`, respond GoTrue session: `{access_token, token_type:'bearer', expires_in:3600, expires_at, refresh_token, user}` where access token claims are `{aud:'authenticated', role:'authenticated', sub:id, email, exp, iat, session_id, app_metadata, user_metadata, is_anonymous:false}` and `user = {id, aud:'authenticated', role:'authenticated', email, email_confirmed_at, confirmed_at: email_confirmed_at, phone:'', last_sign_in_at, app_metadata, user_metadata, identities:[], created_at, updated_at, is_anonymous:false}`. Refresh tokens: random hex kept in an in-memory `Map(token → userId)`.
  - `POST /auth/v1/token?grant_type=refresh_token` body `{refresh_token}` → new session or 400 `{"code":400,"error_code":"refresh_token_not_found","msg":"Invalid Refresh Token: Refresh Token Not Found"}`.
  - `GET /auth/v1/user` (valid user JWT) → user object; `PUT /auth/v1/user` body `{password}` (≥ 8 chars) → `update auth.users set encrypted_password = extensions.crypt($1, extensions.gen_salt('bf', 10)), updated_at = now()` → user object; `POST /auth/v1/logout` → 204.
  - Connection: `postgresql://postgres@127.0.0.1:${EBC_PG_PORT||54322}/${EBC_DB||'ebc'}`. Log one line per request to stdout.

- [ ] **Step 6: `vitest.integration.config.ts` and failing test `tests/integration/shim.test.ts`**

```ts
// vitest.integration.config.ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['tests/integration/**/*.test.ts'], environment: 'node', testTimeout: 30_000, hookTimeout: 120_000, fileParallelism: false },
});
```

```ts
// tests/integration/shim.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const DB = 'ebc_shim';
const PORT = 54391;
let shim: ChildProcess;
const url = `http://127.0.0.1:${PORT}`;
const pgUrl = () => execSync('bash scripts/db-local.sh url', { env: { ...process.env, EBC_DB: DB } }).toString().trim();

beforeAll(async () => {
  execSync('bash scripts/db-local.sh reset', { env: { ...process.env, EBC_DB: DB }, stdio: 'inherit' });
  const c = new pg.Client({ connectionString: pgUrl() });
  await c.connect();
  await c.query(`
    create function public.shim_echo(p_value jsonb, p_n int default 1) returns jsonb language sql as
      $$ select jsonb_build_object('value', p_value, 'n', p_n, 'role', current_user, 'uid', auth.uid()) $$;
    create function public.shim_fail() returns void language plpgsql as
      $$ begin raise exception 'Falhou' using errcode = 'P0001'; end $$;
    create function public.shim_bigint() returns bigint language sql as $$ select 1790000000000::bigint $$;
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated',
            'tester@ebc.test', extensions.crypt('senha-123', extensions.gen_salt('bf')), now(), '{}', '{}', now(), now());
  `);
  await c.end();
  shim = spawn('node', ['dev/shim/server.mjs'], { env: { ...process.env, EBC_DB: DB, SHIM_PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${url}/rest/v1/`); break; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
});
afterAll(() => { shim?.kill(); });

const client = () => createClient(url, 'sb_publishable_local_dev', { auth: { persistSession: false, autoRefreshToken: false } });

describe('local Supabase shim', () => {
  it('calls RPC as anon with defaults', async () => {
    const { data, error } = await client().rpc('shim_echo', { p_value: { a: 1 } });
    expect(error).toBeNull();
    expect(data).toEqual({ value: { a: 1 }, n: 1, role: 'anon', uid: null });
  });
  it('logs in with password and calls RPC as authenticated', async () => {
    const sb = client();
    const { error: e1 } = await sb.auth.signInWithPassword({ email: 'tester@ebc.test', password: 'senha-123' });
    expect(e1).toBeNull();
    const { data } = await sb.rpc('shim_echo', { p_value: null, p_n: 5 });
    expect(data).toMatchObject({ n: 5, role: 'authenticated', uid: '11111111-1111-1111-1111-111111111111' });
  });
  it('rejects wrong passwords', async () => {
    const { error } = await client().auth.signInWithPassword({ email: 'tester@ebc.test', password: 'errada' });
    expect(error?.message).toBe('Invalid login credentials');
  });
  it('maps SQL errors and bigint results like PostgREST', async () => {
    const { error } = await client().rpc('shim_fail');
    expect(error?.message).toBe('Falhou');
    expect(error?.code).toBe('P0001');
    const { data } = await client().rpc('shim_bigint');
    expect(data).toBe(1790000000000);
    const { error: e404 } = await client().rpc('nao_existe');
    expect(e404?.code).toBe('PGRST202');
  });
  it('updates the password', async () => {
    const sb = client();
    await sb.auth.signInWithPassword({ email: 'tester@ebc.test', password: 'senha-123' });
    const { error } = await sb.auth.updateUser({ password: 'nova-senha-456' });
    expect(error).toBeNull();
    const { error: e2 } = await client().auth.signInWithPassword({ email: 'tester@ebc.test', password: 'nova-senha-456' });
    expect(e2).toBeNull();
  });
});
```

- [ ] **Step 7: Run** `npm run test:integration -- tests/integration/shim.test.ts` → FAIL before the shim exists, PASS after Steps 4–5. Also `bash scripts/test-sql.sh` → prints `PASS supabase/tests/00_helpers.sql`.

- [ ] **Step 8: `scripts/dev-stack.sh`** — for manual/E2E use: `EBC_DB=${EBC_DB:-ebc}`; `bash scripts/db-local.sh reset`; seed the dev owner with `psql -c "select public.bootstrap_owner('master@ebc.local','ebc-dev-12345','Master Local'); update public.organizers set must_change_password=false;"` **only if** the function exists (guard with `select to_regproc('public.bootstrap_owner') is not null`); then `exec node dev/shim/server.mjs`.

- [ ] **Step 9: Commit** (`feat: local Supabase emulation for tests (bootstrap, scripts, auth/rpc shim)`).

---

## Task 3: Schema migration and internal functions

**Files:**
- Create: `supabase/migrations/0001_schema.sql`, `supabase/migrations/0002_internal.sql`, `supabase/tests/10_schema.sql`

**Interfaces:**
- Consumes: Task 2 scripts and `tests.*` helpers.
- Produces: all tables (spec §5); `public.random_token(int)`, `public.slugify(text)`, `public.server_time()`, `public.assert_organizer() returns public.organizers`, `public.assert_owner() returns public.organizers`, `public.internal_create_auth_user(text,text) returns uuid`, `public.bootstrap_owner(text,text,text) returns uuid`, `public.default_race_config(int) returns jsonb`; triggers maintaining `updated_at` and `events.version`.

- [ ] **Step 1: Write the failing SQL test `supabase/tests/10_schema.sql`**

```sql
begin;
-- owner bootstrap
select tests.set('owner', public.bootstrap_owner('Owner@EBC.test', 'senha-forte-1', 'Owner')::text);
do $$ declare u auth.users; o public.organizers; begin
  select * into u from auth.users where id = tests.get('owner')::uuid;
  assert u.email = 'owner@ebc.test', 'email lowercased';
  assert u.encrypted_password = extensions.crypt('senha-forte-1', u.encrypted_password), 'password hash verifies';
  assert u.email_confirmed_at is not null and u.aud = 'authenticated' and u.role = 'authenticated';
  assert u.confirmation_token = '' and u.recovery_token = '' and u.email_change = '' and u.reauthentication_token = '';
  assert (select count(*) from auth.identities where user_id = u.id and provider = 'email' and provider_id = u.id::text) = 1;
  select * into o from public.organizers where user_id = u.id;
  assert o.role = 'owner' and o.must_change_password and o.name = 'Owner';
end $$;
select tests.assert_raises($$select public.bootstrap_owner('owner@ebc.test','outra-senha-1','X')$$, 'P0001', 'Já existe%');
select tests.assert_raises($$select public.internal_create_auth_user('curta@ebc.test','1234567')$$, 'P0001', '%8 caracteres%');
select tests.assert_raises($$select public.internal_create_auth_user('sem-arroba','12345678')$$, 'P0001', 'E-mail inválido');
-- utilities
do $$ begin
  assert length(public.random_token(24)) = 24 and public.random_token(24) ~ '^[A-Za-z0-9]{24}$';
  assert public.slugify('Triathlon Águas Claras 2026!') = 'triathlon-aguas-claras-2026';
  assert public.server_time() between (extract(epoch from now()) * 1000)::bigint - 60000 and (extract(epoch from now()) * 1000)::bigint + 60000;
  assert (public.default_race_config(1) -> 'rankings' -> 1 ->> 'id') = 'faixa';
  assert jsonb_array_length(public.default_race_config(2) -> 'age_groups') = 0;
end $$;
-- events: token default, version bump through child tables, updated_at
insert into public.events (id, name, date) values ('00000000-0000-0000-0000-0000000000e1', 'Evento', '2026-10-11');
do $$ declare v bigint; begin
  assert (select length(tk_token) from public.events where id = '00000000-0000-0000-0000-0000000000e1') = 24;
  select version into v from public.events where id = '00000000-0000-0000-0000-0000000000e1';
  insert into public.races (id, event_id, name, legs, config) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', 'Corrida', '[{"modality":"run","label":"Corrida","distance_m":5000}]', public.default_race_config(1));
  assert (select version from public.events where id = '00000000-0000-0000-0000-0000000000e1') > v, 'race insert bumps version';
end $$;
-- constraints
insert into public.entries (event_id, race_id, bib) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', '10');
select tests.assert_raises($$insert into public.entries (event_id, race_id, bib) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', '10')$$, '23505');
select tests.assert_raises($$insert into public.marks (id, event_id, ts, entry_id) select gen_random_uuid(), '00000000-0000-0000-0000-0000000000e1', now(), id from public.entries limit 1$$, '23514');
-- RLS denies direct reads for anon (grants are revoked later in 0006; here RLS alone returns no rows)
select tests.as_anon();
do $$ begin assert (select count(*) from public.events) = 0; end $$;
reset role;
rollback;
```

- [ ] **Step 2: Run** `bash scripts/test-sql.sh` → `FAIL supabase/tests/10_schema.sql` (functions/tables missing).

- [ ] **Step 3: Write `supabase/migrations/0001_schema.sql`**

```sql
create or replace function public.random_token(p_len int) returns text
language plpgsql volatile set search_path = public, extensions, pg_temp as $$
declare chars constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        b bytea := extensions.gen_random_bytes(p_len); out text := ''; i int;
begin
  for i in 0 .. p_len - 1 loop out := out || substr(chars, (get_byte(b, i) % 62) + 1, 1); end loop;
  return out;
end $$;

create table public.organizers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null, name text not null default '',
  role text not null default 'admin' check (role in ('owner','admin')),
  must_change_password boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.athletes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  sex text not null check (sex in ('M','F')),
  birth_date date, email text, phone text, city text, team_club text,
  notes text not null default '', public_profile boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index athletes_name_idx on public.athletes (lower(name));
create index athletes_email_idx on public.athletes (lower(email));
create table public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0), date date not null,
  location text not null default '', description text not null default '',
  levels text[] not null default '{}',
  status text not null default 'planejado' check (status in ('planejado','ao_vivo','encerrado')),
  is_public boolean not null default false, public_slug text unique,
  tk_token text not null unique default public.random_token(24), tk_enabled boolean not null default true,
  version bigint not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.races (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0), position int not null default 0,
  team_size int not null default 1 check (team_size between 1 and 10),
  legs jsonb not null check (jsonb_typeof(legs) = 'array' and jsonb_array_length(legs) >= 1),
  config jsonb not null, finalized_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index races_event_idx on public.races (event_id);
create table public.waves (
  id uuid primary key default gen_random_uuid(),
  race_id uuid not null references public.races(id) on delete cascade,
  name text not null default 'Largada geral', position int not null default 0, start_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index waves_race_idx on public.waves (race_id);
create table public.entries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  race_id uuid not null references public.races(id) on delete cascade,
  wave_id uuid references public.waves(id) on delete set null,
  bib text not null check (length(btrim(bib)) > 0), team_name text, level text,
  status text not null default 'ok' check (status in ('ok','dns','dnf','dsq')),
  penalty_ms int not null default 0 check (penalty_ms >= 0), notes text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (event_id, bib)
);
create index entries_race_idx on public.entries (race_id);
create table public.entry_members (
  entry_id uuid not null references public.entries(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete restrict,
  position int not null default 0, legs int[] not null default '{}',
  primary key (entry_id, athlete_id)
);
create index entry_members_athlete_idx on public.entry_members (athlete_id);
create table public.timekeepers (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0), secret text not null,
  device_label text not null default '', active boolean not null default true,
  created_at timestamptz not null default now(), last_seen_at timestamptz
);
create table public.marks (
  id uuid primary key,
  event_id uuid not null references public.events(id) on delete cascade,
  timekeeper_id uuid references public.timekeepers(id) on delete set null,
  ts timestamptz not null, device_ts timestamptz, clock_offset_ms int, clock_rtt_ms int,
  entry_id uuid references public.entries(id) on delete set null, leg_index int,
  athlete_id uuid references public.athletes(id) on delete set null,
  discarded boolean not null default false,
  discarded_by text check (discarded_by in ('timekeeper','organizer')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint marks_leg_when_assigned check (entry_id is null or leg_index is not null)
);
create index marks_event_updated_idx on public.marks (event_id, updated_at);
create index marks_entry_idx on public.marks (entry_id);
create table public.resolutions (
  entry_id uuid not null references public.entries(id) on delete cascade,
  leg_index int not null,
  event_id uuid not null references public.events(id) on delete cascade,
  mode text not null check (mode in ('system','mark','manual')),
  mark_id uuid references public.marks(id) on delete cascade,
  manual_ts timestamptz, note text not null default '', decided_by uuid,
  updated_at timestamptz not null default now(),
  primary key (entry_id, leg_index),
  check ((mode = 'mark') = (mark_id is not null)),
  check ((mode = 'manual') = (manual_ts is not null))
);
create index resolutions_event_idx on public.resolutions (event_id, updated_at);
create table public.results (
  race_id uuid not null references public.races(id) on delete cascade,
  entry_id uuid not null references public.entries(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  athlete_ids uuid[] not null, status text not null, final_ms bigint, overall_pos int,
  data jsonb not null, finalized_at timestamptz not null default now(),
  primary key (race_id, entry_id)
);
create index results_athletes_idx on public.results using gin (athlete_ids);

alter table public.organizers enable row level security;
alter table public.athletes enable row level security;
alter table public.events enable row level security;
alter table public.races enable row level security;
alter table public.waves enable row level security;
alter table public.entries enable row level security;
alter table public.entry_members enable row level security;
alter table public.timekeepers enable row level security;
alter table public.marks enable row level security;
alter table public.resolutions enable row level security;
alter table public.results enable row level security;
```

- [ ] **Step 4: Write `supabase/migrations/0002_internal.sql`**

Contents (all functions `set search_path = public, extensions, pg_temp`):
1. `tg_set_updated_at()` trigger function (`new.updated_at := now()`), attached `before update` on `athletes, races, waves, entries, marks, resolutions`.
2. `tg_events_before_update()`: `new.updated_at := now(); if new.version = old.version then new.version := old.version + 1; end if;` attached `before update on events`.
3. `bump_event_version(p_event_id uuid)`: `update public.events set version = version + 1 where id = p_event_id`.
4. Row triggers (`after insert or update or delete`) calling `bump_event_version`: on `races` (event_id), `waves` (event of the race), `entries` (event_id), `entry_members` (event of the entry; use `coalesce(new.entry_id, old.entry_id)`); `after update on athletes`: bump every event where the athlete has an entry.
5. `slugify(p text) returns text language sql immutable`: lower + `translate` of Portuguese accents (`áàâãäéèêëíìîïóòôõöúùûüçñ` and uppercase → ascii) + `regexp_replace('[^a-z0-9]+','-','g')` + trim `-`.
6. `server_time() returns bigint language sql volatile`: `select (extract(epoch from clock_timestamp()) * 1000)::bigint`.
7. `assert_organizer()` / `assert_owner()`:

```sql
create or replace function public.assert_organizer() returns public.organizers
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare o public.organizers;
begin
  select * into o from public.organizers where user_id = auth.uid();
  if not found then raise exception 'Acesso restrito à organização' using errcode = '42501'; end if;
  return o;
end $$;
create or replace function public.assert_owner() returns public.organizers
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare o public.organizers := public.assert_organizer();
begin
  if o.role <> 'owner' then raise exception 'Apenas a organizadora master pode fazer isso' using errcode = '42501'; end if;
  return o;
end $$;
```

8. `internal_create_auth_user`:

```sql
create or replace function public.internal_create_auth_user(p_email text, p_password text) returns uuid
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_id uuid := gen_random_uuid(); v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido' using errcode = 'P0001'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'A senha precisa ter pelo menos 8 caracteres' using errcode = 'P0001'; end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'Já existe uma conta com este e-mail' using errcode = 'P0001';
  end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token,
    reauthentication_token, is_sso_user, is_anonymous)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_password, extensions.gen_salt('bf', 10)), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', '', false, false);
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (v_id::text, v_id, jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
          'email', now(), now(), now());
  return v_id;
end $$;
```

9. `bootstrap_owner(p_email, p_password, p_name) returns uuid`: `v := internal_create_auth_user(...)`; insert organizer `(v, lower(btrim(p_email)), coalesce(p_name,''), 'owner', true)`; return v.
10. `default_race_config(p_team_size int) returns jsonb language sql immutable` returning exactly the TS `defaultRaceConfig` (see Task 9): individual → rankings `geral` (dims `["sex"]`, size 3) and `faixa` (name `Faixa etária`, dims `["sex","age"]`, size 3), age groups `até 19 (0-19), 20-29, 30-39, 40-49, 50-59, 60+ (max null)`; team → only `geral`, `age_groups: []`; plus `age_rule 'year_end'`, `team_age_rule 'sum'`, `cumulative false`, `same_crossing_window_s 30`, `divergence_threshold_s 3`, `time_source 'median'`, `reference_timekeeper_id null`.

- [ ] **Step 5: Run** `bash scripts/test-sql.sh` → all PASS.
- [ ] **Step 6: Commit** (`feat(db): schema, internal helpers and auth user bootstrap`).

---

## Task 4: Admin RPCs — organizers, events, races, waves

**Files:**
- Create: `supabase/migrations/0003_admin_events.sql`, `supabase/tests/20_admin_events.sql`

**Interfaces:**
- Consumes: Task 3 functions.
- Produces (spec §6): `admin_me()`, `admin_password_changed()`, `admin_list_organizers()`, `admin_create_organizer(p_email text, p_password text, p_name text)`, `admin_delete_organizer(p_user_id uuid)`, `admin_list_events()`, `admin_get_event(p_event_id uuid)`, `admin_save_event(p_event jsonb)`, `admin_delete_event(p_event_id uuid)`, `admin_duplicate_event(p_event_id uuid, p_name text, p_date date) returns uuid`, `admin_rotate_tk_token(p_event_id uuid) returns text`, `admin_save_race(p_race jsonb)`, `admin_delete_race(p_race_id uuid)`, `admin_set_wave_start(p_wave_id uuid, p_start_at timestamptz)`, plus internal helpers `entry_json(p_entry_id uuid, p_with_names boolean default false) returns jsonb` and `validate_race_payload(...)` as you see fit. All return shapes exactly as the TS types (`AdminMe`, `OrganizerRow[]`, `EventSummary[]`, `EventAggregate`, `EventRow`, `{race, waves}`, `WaveRow`).

Pattern every admin function follows:

```sql
create or replace function public.admin_me() returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare o public.organizers := public.assert_organizer();
begin
  return jsonb_build_object('user_id', o.user_id, 'email', o.email, 'name', o.name, 'role', o.role,
                            'must_change_password', o.must_change_password);
end $$;

create or replace function public.entry_json(p_entry_id uuid, p_with_names boolean default false) returns jsonb
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select to_jsonb(e) || jsonb_build_object('members', coalesce((
    select jsonb_agg(jsonb_build_object('athlete_id', m.athlete_id, 'position', m.position, 'legs', to_jsonb(m.legs))
                     || case when p_with_names then jsonb_build_object('name', a.name) else '{}'::jsonb end
                     order by m.position)
    from public.entry_members m join public.athletes a on a.id = m.athlete_id
    where m.entry_id = e.id), '[]'::jsonb))
  from public.entries e where e.id = p_entry_id
$$;
```

Behavior details:
- `admin_save_event(p_event)`: keys `id?, name, date, location, description, levels (text[]), status, is_public, public_slug, tk_enabled`. Insert when `id` is null: `public_slug` = `slugify(name || '-' || date)` with `-2`, `-3`… suffix until unique (also when `is_public` turns true and slug is null). Validate `name` non-empty, `levels` trimmed/non-empty/unique, `status` valid, slug `^[a-z0-9-]{3,80}$` and unique (error `Endereço público já em uso`). Returns the event row (`to_jsonb(ev)`, including `tk_token`).
- `admin_get_event`: `{event, races (order by position, name), waves (order by race, position), entries (entry_json, order by bib numeric-aware: lpad when numeric), athletes (distinct athletes of entries: id,name,sex,birth_date,team_club,city,public_profile), timekeepers (with marks_count), marks (all, order by ts), resolutions, results, version, server_now: now()}`. Unknown id → `Evento não encontrado` (P0001).
- `admin_list_events`: all events (`order by date desc`) + `races_count`, `entries_count`.
- `admin_delete_event`: deletes (cascades).
- `admin_duplicate_event`: new event with same levels/description/location, new token, `status 'planejado'`, `is_public false`; copies races (same legs/config/team_size/position, `finalized_at null`) and their waves (same names/positions, `start_at null`). Returns new id.
- `admin_rotate_tk_token`: sets a new `random_token(24)`; returns it.
- `admin_save_race(p_race)`: keys `id?, event_id, name, position?, team_size, legs[], config{}, waves[] ({id?, name, position, start_at?})`. Validate: event exists; name non-empty; `team_size` 1..10; legs array ≥ 1, each `modality` in (swim,bike,run,other), `label` non-empty, `distance_m` null or > 0 (null only allowed for `other`); config = `default_race_config(team_size) || coalesce(config,'{}')` then validate `age_rule`, `team_age_rule`, `time_source`, `cumulative` boolean, `same_crossing_window_s` 1..600, `divergence_threshold_s` 0.1..600, each ranking `{id non-empty unique, name non-empty, dims ⊆ {sex,age,level} unique, size 1..10}`, age groups `min >= 0`, `max null or >= min`, non-overlapping; `reference_timekeeper_id` null or a timekeeper of the event. If the race exists and has non-discarded marks on its entries: reject changes to `jsonb_array_length(legs)`, the modality order, or `team_size` (`Não é possível alterar pernas ou tamanho da equipe depois que há marcações`). Waves: upsert by id; delete waves of the race not in the payload; if the payload has no waves, ensure one `Largada geral` exists. Returns `{race, waves}`.
- `admin_set_wave_start(p_wave_id, p_start_at)`: sets/clears `start_at`; returns the wave row.
- Organizers: `admin_list_organizers` (any organizer); `admin_create_organizer` (owner) → `internal_create_auth_user` + organizers row `role 'admin'`, `must_change_password true` → returns `OrganizerRow`; `admin_delete_organizer` (owner; `Você não pode remover a si mesma` if self) → `delete from auth.users where id = p_user_id` (cascades organizer); `admin_password_changed` → `must_change_password = false` for `auth.uid()`.

- [ ] **Step 1: Write failing `supabase/tests/20_admin_events.sql`** covering, at minimum:

```sql
begin;
select tests.set('owner', public.bootstrap_owner('owner@ebc.test','senha-forte-1','Owner')::text);
select tests.set('stranger', public.internal_create_auth_user('x@ebc.test','senha-forte-1')::text);
-- non-organizer is rejected
select tests.as_user(tests.get('stranger')::uuid);
select tests.assert_raises($$select public.admin_list_events()$$, '42501');
reset role;
-- owner flow
select tests.as_user(tests.get('owner')::uuid);
do $$ declare ev jsonb; r jsonb; agg jsonb; dup uuid; begin
  assert (public.admin_me() ->> 'role') = 'owner';
  ev := public.admin_save_event('{"name":"Desafio EBC","date":"2026-10-11","levels":["Elite","Base"]}');
  perform tests.set('ev', ev ->> 'id');
  assert ev ->> 'public_slug' = 'desafio-ebc-2026-10-11' and length(ev ->> 'tk_token') = 24;
  r := public.admin_save_race(jsonb_build_object('event_id', ev ->> 'id', 'name', 'Revezamento', 'team_size', 2,
        'legs', '[{"modality":"swim","label":"Natação","distance_m":750},{"modality":"run","label":"Corrida","distance_m":5000}]'::jsonb));
  perform tests.set('race', r -> 'race' ->> 'id');
  assert jsonb_array_length(r -> 'waves') = 1 and (r -> 'waves' -> 0 ->> 'name') = 'Largada geral';
  assert (r -> 'race' -> 'config' ->> 'divergence_threshold_s')::numeric = 3;
  agg := public.admin_get_event((ev ->> 'id')::uuid);
  assert jsonb_array_length(agg -> 'races') = 1 and agg ? 'server_now' and agg ? 'marks';
  perform public.admin_set_wave_start((r -> 'waves' -> 0 ->> 'id')::uuid, '2026-10-11T11:00:00Z');
  assert (select start_at from public.waves where id = (r -> 'waves' -> 0 ->> 'id')::uuid) = '2026-10-11T11:00:00Z';
  dup := public.admin_duplicate_event((ev ->> 'id')::uuid, 'Desafio EBC 2027', '2027-10-10');
  assert (select count(*) from public.races where event_id = dup) = 1;
  assert (select count(*) from public.waves w join public.races x on x.id = w.race_id where x.event_id = dup and w.start_at is null) = 1;
  assert public.admin_rotate_tk_token((ev ->> 'id')::uuid) <> ev ->> 'tk_token';
end $$;
select tests.assert_raises($$select public.admin_save_race(jsonb_build_object('event_id', tests.get('ev'), 'name', 'X', 'legs', '[]'::jsonb))$$, 'P0001');
select tests.assert_raises($$select public.admin_save_race(jsonb_build_object('event_id', tests.get('ev'), 'name', 'X', 'legs', '[{"modality":"fly","label":"?","distance_m":1}]'::jsonb))$$, 'P0001');
select tests.assert_raises($$select public.admin_save_race(jsonb_build_object('event_id', tests.get('ev'), 'name', 'X', 'legs', '[{"modality":"run","label":"C","distance_m":1000}]'::jsonb, 'config', '{"age_groups":[{"label":"a","min":20,"max":29},{"label":"b","min":25,"max":34}]}'::jsonb))$$, 'P0001');
-- organizers
do $$ declare o jsonb; begin
  o := public.admin_create_organizer('Ajudante@EBC.test', 'senha-forte-2', 'Ajudante');
  assert o ->> 'role' = 'admin' and o ->> 'email' = 'ajudante@ebc.test';
  assert jsonb_array_length(public.admin_list_organizers()) = 2;
end $$;
select tests.assert_raises($$select public.admin_delete_organizer(tests.get('owner')::uuid)$$, 'P0001');
reset role;
rollback;
```

Also add assertions (same file) for: changing `legs` length of a race after a non-discarded mark exists → `P0001`; `admin_create_organizer` called by an `admin` (not owner) → `42501`; `admin_password_changed` clears the flag; slug collision produces `-2`.

- [ ] **Step 2: Run** `bash scripts/test-sql.sh` → FAIL. **Step 3:** implement `0003_admin_events.sql`. **Step 4:** run → PASS. **Step 5: Commit** (`feat(db): admin RPCs for organizers, events, races and waves`).

---

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

## Task 6: Timing RPCs (organizer live tools + timekeeper link)

**Files:**
- Create: `supabase/migrations/0005_timing.sql`, `supabase/tests/40_timing.sql`

**Interfaces:**
- Produces: `admin_live(p_event_id uuid, p_since timestamptz)`, `admin_update_mark(p_mark_id uuid, p_patch jsonb)`, `admin_set_resolution(p_entry_id uuid, p_leg_index int, p_mode text, p_mark_id uuid, p_manual_ts timestamptz, p_note text)`, `admin_clear_resolution(p_entry_id uuid, p_leg_index int)`, `admin_update_timekeeper(p_timekeeper_id uuid, p_patch jsonb)`, `admin_finalize_race(p_race_id uuid, p_rows jsonb)`, `admin_unfinalize_race(p_race_id uuid)`, `tk_open(p_token text)`, `tk_register(p_token text, p_name text, p_device_label text)`, `tk_sync(p_token text, p_timekeeper_id uuid, p_secret text, p_marks jsonb, p_since timestamptz)`; internal `tk_event(p_token text) returns public.events` (raises `Link de cronometragem inválido ou desativado`).

Behavior details:
- `admin_live`: `{server_now: now(), version, marks: marks of event with p_since is null or updated_at >= p_since (order by ts), resolutions: all of event, waves: all of event}`.
- `admin_update_mark(p_mark_id, p_patch)`: keys may be absent. `entry_id` present & null → unassign (`leg_index` null). `entry_id` non-null → entry of the same event, `leg_index` required (patch or keep existing if same entry) and `0 <= leg_index < legs length` (`Perna inválida`). `discarded` true → `discarded_by 'organizer'`; false → `discarded=false, discarded_by=null`. Returns the mark row.
- `admin_set_resolution`: leg index valid for the entry's race; `system` → no mark/manual; `mark` → mark must be non-discarded with that `entry_id` and `leg_index` (`Marcação não pertence a esta passagem`); `manual` → `p_manual_ts` not null. Upsert on `(entry_id, leg_index)`, `decided_by = auth.uid()`, `event_id` from entry. Returns the row.
- `admin_update_timekeeper`: `name` (non-empty) and/or `active` (bool). Returns row without `secret`.
- `admin_finalize_race(p_race_id, p_rows)`: delete existing results of the race; insert each row (`entry_id` must belong to the race, `athlete_ids` from the row, `status`, `final_ms`, `overall_pos`, `data`); `races.finalized_at = now()`; return `{finalized_at, count}`. `admin_unfinalize_race`: delete results, `finalized_at = null`.
- `tk_open(p_token)`: `TkSession` — event `{id,name,date,location}`, races, waves, `entries` via `entry_json(id, true)`, timekeepers `{id,name}` (all of the event), `version`, `server_now`.
- `tk_register(p_token, p_name, p_device_label)`: name trimmed 1..60 chars (`Informe seu nome`); insert timekeeper with `secret = random_token(32)`; return `{timekeeper_id, secret}`.
- `tk_sync` (critical — implement exactly):

```sql
create or replace function public.tk_sync(p_token text, p_timekeeper_id uuid, p_secret text, p_marks jsonb, p_since timestamptz)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare ev public.events := public.tk_event(p_token);
        tk public.timekeepers; m jsonb; v_id uuid; ex public.marks; v_entry public.entries; v_legs int;
        v_entry_id uuid; v_leg int; v_discarded boolean; v_ts timestamptz;
        accepted jsonb := '[]'; rejected jsonb := '[]';
begin
  select * into tk from public.timekeepers where id = p_timekeeper_id and event_id = ev.id and secret = p_secret;
  if not found then raise exception 'Cronometrista não autorizado' using errcode = 'P0001'; end if;
  if not tk.active then raise exception 'Seu acesso foi desativado pela organização' using errcode = 'P0001'; end if;
  for m in select * from jsonb_array_elements(coalesce(p_marks, '[]'::jsonb)) loop
    begin
      v_id := (m ->> 'id')::uuid;
      v_entry_id := nullif(m ->> 'entry_id', '')::uuid;
      v_leg := (m ->> 'leg_index')::int;
      v_discarded := coalesce((m ->> 'discarded')::boolean, false);
      if v_entry_id is null then v_leg := null;
      else
        select * into v_entry from public.entries where id = v_entry_id and event_id = ev.id;
        if not found then raise exception 'Atleta não encontrado neste evento'; end if;
        select jsonb_array_length(legs) into v_legs from public.races where id = v_entry.race_id;
        if v_leg is null or v_leg < 0 or v_leg >= v_legs then raise exception 'Perna inválida'; end if;
      end if;
      select * into ex from public.marks where id = v_id;
      if not found then
        v_ts := (m ->> 'ts')::timestamptz;
        if v_ts is null or abs(extract(epoch from v_ts - now())) > 172800 then raise exception 'Horário inválido'; end if;
        insert into public.marks (id, event_id, timekeeper_id, ts, device_ts, clock_offset_ms, clock_rtt_ms,
                                  entry_id, leg_index, athlete_id, discarded, discarded_by)
        values (v_id, ev.id, tk.id, v_ts, (m ->> 'device_ts')::timestamptz, (m ->> 'clock_offset_ms')::int,
                (m ->> 'clock_rtt_ms')::int, v_entry_id, v_leg, nullif(m ->> 'athlete_id', '')::uuid,
                v_discarded, case when v_discarded then 'timekeeper' end);
      else
        if ex.timekeeper_id is distinct from tk.id then raise exception 'Marcação pertence a outro cronometrista'; end if;
        if ex.discarded_by = 'organizer' and not v_discarded then raise exception 'Descartada pela organização'; end if;
        update public.marks set entry_id = v_entry_id, leg_index = v_leg,
               athlete_id = nullif(m ->> 'athlete_id', '')::uuid, discarded = v_discarded,
               discarded_by = case when v_discarded then coalesce(ex.discarded_by, 'timekeeper') end
         where id = v_id;
      end if;
      accepted := accepted || to_jsonb(v_id::text);
    exception when others then
      rejected := rejected || jsonb_build_object('id', m ->> 'id', 'reason', sqlerrm);
    end;
  end loop;
  update public.timekeepers set last_seen_at = now() where id = tk.id;
  return jsonb_build_object(
    'accepted', accepted, 'rejected', rejected, 'server_now', now(), 'version', ev.version,
    'marks', coalesce((select jsonb_agg(to_jsonb(k) order by k.ts) from public.marks k
                       where k.event_id = ev.id and (p_since is null or k.updated_at >= p_since)), '[]'::jsonb),
    'waves', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'start_at', w.start_at))
                       from public.waves w join public.races r on r.id = w.race_id where r.event_id = ev.id), '[]'::jsonb));
end $$;
```

- [ ] **Step 1: Write failing `supabase/tests/40_timing.sql`**: setup (owner, event, relay race team 2 swim/run, athletes A (M) and B (F), team entry bib 101 with A leg 0, B leg 1, wave start set), then:
  - as anon: `tk_open('errado')` → P0001 like `Link de cronometragem%`; `tk_open(<token>)` returns 1 race, 1 entry whose members include `name`.
  - `tk_register(<token>, '  ', '')` → P0001; `tk_register(<token>, 'Ana', 'iPhone')` → returns id + 32-char secret (store both in ctx).
  - `tk_sync` with wrong secret → P0001 `Cronometrista não autorizado`.
  - `tk_sync` with two marks: one assigned (entry 101, leg 0, ts = start + 10 min) and one unassigned → `accepted` has 2 ids; `marks` returns both.
  - re-send the first mark with `leg_index` 1 → accepted and updated; re-send with a different `ts` → `ts` unchanged.
  - mark with `leg_index` 2 → rejected with reason `Perna inválida`; mark with `ts` 3 days away → rejected `Horário inválido`.
  - second timekeeper cannot modify the first one's mark (rejected `Marcação pertence a outro cronometrista`).
  - as owner: `admin_update_mark(<id>, '{"discarded":true}')` → `discarded_by='organizer'`; then timekeeper re-sends it with `discarded:false` → rejected `Descartada pela organização`.
  - `admin_update_timekeeper(<tk>, '{"active":false}')` then `tk_sync` → P0001 `Seu acesso foi desativado%`.
  - `admin_set_resolution(entry, 0, 'mark', <a mark of leg 1>, null, '')` → P0001; with a valid mark → row; `manual` without ts → P0001; `admin_clear_resolution` removes it.
  - `admin_live(event, null)` returns all marks, resolutions, waves; `admin_live(event, now() + interval '1 hour')` returns 0 marks but still all waves.
  - `admin_finalize_race(race, '[{"entry_id":"<id>","athlete_ids":["<A>","<B>"],"status":"finished","final_ms":1800000,"overall_pos":1,"data":{}}]')` → count 1, `races.finalized_at` set; `admin_unfinalize_race` clears both.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS. **Step 5: Commit** (`feat(db): timing RPCs for organizers and timekeeper links`).

---

## Task 7: Public RPCs, grants and security tests

**Files:**
- Create: `supabase/migrations/0006_public_grants.sql`, `supabase/tests/50_public.sql`, `supabase/tests/60_security.sql`

**Interfaces:**
- Produces: `pub_events()`, `pub_event(p_slug text)`, `pub_live(p_slug text, p_since timestamptz)`, `pub_athlete(p_athlete_id uuid)`, and the final grant model.

Behavior details:
- `pub_events()`: public events `{id, public_slug, name, date, location, status}` order by date desc.
- `pub_event(p_slug)`: only `is_public`; else `Evento não encontrado` (P0001). Returns `PubEventPayload`: `event` = `to_jsonb(ev) - 'tk_token' - 'tk_enabled'`; races; waves; entries (`entry_json(id,true)`); `athletes` of the event with only `{id, name, sex, team_club, city, public_profile, age_event, age_year_end}` where `age_event = date_part('year', age(ev.date, birth_date))` and `age_year_end = extract(year from ev.date) - extract(year from birth_date)` (nulls when no birth date); timekeepers `{id, name}`; marks (all, including discarded so clients can drop them) without `device_ts`, `clock_offset_ms`, `clock_rtt_ms`; resolutions; results; version; server_now.
- `pub_live(p_slug, p_since)`: like `admin_live` with the same mark projection as `pub_event`.
- `pub_athlete(p_athlete_id)`: athlete must exist and `public_profile` (`Perfil não encontrado`); returns `{athlete: {id,name,sex,city,team_club}, results}` restricted to results whose event `is_public`.
- Grants (end of this migration):

```sql
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' loop
    if f.proname like 'admin\_%' then
      execute format('grant execute on function %s to authenticated', f.sig);
    elsif f.proname like 'tk\_%' and f.proname <> 'tk_event' or f.proname like 'pub\_%' or f.proname = 'server_time' then
      execute format('grant execute on function %s to anon, authenticated', f.sig);
    end if;
  end loop;
end $$;
```

(Every later migration that adds an RPC must repeat the same DO block at its end.)

- [ ] **Step 1: Write failing tests.** `50_public.sql`: private event → `pub_event` raises; after `admin_save_event` with `is_public true`, `pub_event(slug)` as anon returns entries with member names, athletes without `email`/`phone`/`birth_date` keys (`assert not (x ? 'email')`), `age_year_end` computed, event without `tk_token`; `pub_live` returns discarded marks too; `pub_athlete` for `public_profile=false` raises; `pub_athlete` omits results of private events. `60_security.sql`:

```sql
begin;
select tests.set('owner', public.bootstrap_owner('owner@ebc.test','senha-forte-1','Owner')::text);
select tests.set('stranger', public.internal_create_auth_user('x@ebc.test','senha-forte-1')::text);
select tests.as_anon();
select tests.assert_raises($$select * from public.events$$, '42501');
select tests.assert_raises($$select * from public.marks$$, '42501');
select tests.assert_raises($$select public.admin_list_events()$$, '42501');
select tests.assert_raises($$select public.internal_create_auth_user('a@b.co','12345678')$$, '42501');
select tests.assert_raises($$select public.bootstrap_owner('a@b.co','12345678','x')$$, '42501');
select tests.assert_raises($$select public.tk_event('x')$$, '42501');
do $$ begin assert public.server_time() > 0; assert jsonb_typeof(public.pub_events()) = 'array'; end $$;
reset role;
select tests.as_user(tests.get('stranger')::uuid);
select tests.assert_raises($$select public.admin_list_events()$$, '42501');
select tests.assert_raises($$select * from public.athletes$$, '42501');
reset role;
rollback;
```

- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `bash scripts/test-sql.sh` → every file PASS. **Step 5: Commit** (`feat(db): public RPCs and least-privilege grants`).

---

## Task 8: Integration test — full flow through supabase-js and the shim

**Files:**
- Create: `tests/integration/helpers.ts`, `tests/integration/flow.test.ts`

**Interfaces:**
- Consumes: Tasks 2–7 (migrations, shim), `src/lib/types.ts`.
- Produces: `startStack(db: string, port: number): Promise<{ url: string; stop(): void; sql(q: string, params?: unknown[]): Promise<any[]> }>` in `helpers.ts` (reset DB, seed nothing, spawn shim, wait until ready).

- [ ] **Step 1: Write the failing test `tests/integration/flow.test.ts`** (one `describe`, sequential `it`s sharing state):
  1. `sql("select public.bootstrap_owner('owner@ebc.test','senha-forte-1','Owner')")`; client A signs in; `rpc('admin_me')` → role owner, `must_change_password` true; `auth.updateUser({password:'senha-nova-123'})` + `rpc('admin_password_changed')` → `admin_me().must_change_password` false.
  2. `admin_save_event` (`is_public: true`, levels `["Elite","Base"]`) → event; `admin_save_race` relay (team 2, swim 750 / run 5000) and individual run 5K.
  3. `admin_save_athlete` × 3 (Ana F 1990-06-15, Beto M 1988-01-20, Caio M 1995-03-03); `admin_save_entry` team "Tubarões" (Ana leg 0, Beto leg 1, level Elite) and `admin_bulk_create_entries(run race, [Caio])`.
  4. anon client B: `tk_open(token)`; `tk_register` twice (tk1 "Ana", tk2 "Bia").
  5. A: `admin_set_wave_start(relay wave, T0)`.
  6. tk1 `tk_sync` marks: relay leg 0 at T0+10:00.000, relay leg 1 at T0+30:00.000; tk2: relay leg 0 at T0+10:04.000 (4 s divergence), leg 1 at T0+30:00.500 → all accepted.
  7. A: `admin_live(event, null)` → 4 marks; `admin_set_resolution(entry, 0, 'mark', <tk1 leg0 id>, null, 'foto')` → row mode `mark`.
  8. anon: `pub_event(slug)` → athletes lack `email`, entries include member names, 4 marks; `pub_live(slug, <server_now>)` → 0 marks.
  9. A: `admin_finalize_race(relay, [row])` with a hand-built row (`status 'finished'`, `final_ms 1_800_000`, `overall_pos 1`, `athlete_ids [Ana, Beto]`, `data` minimal object) → count 1; `admin_athlete_profile(Ana)` → 1 result; `admin_list_athletes()` → Ana `wins` 1.
  10. anon cannot call `admin_list_events` (error code `42501` or HTTP 401 surfaced as error).
- [ ] **Step 2:** run `npm run test:integration` → FAIL until helpers exist, then PASS. **Step 3: Commit** (`test: end-to-end RPC flow through supabase-js`).

---

## Task 9: Domain foundations — presets, categories, event index, bib resolution, fixtures

**Files:**
- Create: `src/domain/presets.ts`, `src/domain/presets.test.ts`, `src/domain/categories.ts`, `src/domain/categories.test.ts`, `src/domain/eventModel.ts`, `src/domain/eventModel.test.ts`, `src/domain/bib.ts`, `src/domain/bib.test.ts`, `src/domain/testing/fixtures.ts`

**Interfaces:**
- Consumes: `src/lib/types.ts`.
- Produces: signatures in "Domain signatures" for presets, categories, eventModel, bib; fixtures below (used by Tasks 10–12, 15).

- [ ] **Step 1: Write `src/domain/testing/fixtures.ts`**

```ts
import type { AthleteRow, EntryRow, EventRow, MarkRow, RaceConfig, RaceRow, ResolutionRow, TimekeeperRow, WaveRow } from '../../lib/types';
import { defaultRaceConfig } from '../presets';

export const T0 = Date.parse('2026-10-11T11:00:00.000Z'); // 08:00:00 in Brasília
export const SEC = 1000;
export const MIN = 60_000;
export const iso = (ms: number) => new Date(ms).toISOString();
let seq = 0;
export const nextId = (p: string) => `${p}${++seq}`;

export function makeEvent(p: Partial<EventRow> = {}): EventRow {
  return { id: 'e1', name: 'Evento Teste', date: '2026-10-11', location: 'Vila Velha', description: '', levels: [], status: 'ao_vivo', is_public: true, public_slug: 'evento-teste', version: 1, ...p };
}
export function makeRace(p: Partial<RaceRow> & { configPatch?: Partial<RaceConfig> } = {}): RaceRow {
  const { configPatch, ...rest } = p;
  const team_size = rest.team_size ?? 1;
  return {
    id: 'r1', event_id: 'e1', name: 'Aquathlon', position: 0, team_size,
    legs: [{ modality: 'swim', label: 'Natação', distance_m: 750 }, { modality: 'run', label: 'Corrida', distance_m: 5000 }],
    config: { ...defaultRaceConfig(team_size), ...(configPatch ?? {}) }, finalized_at: null, ...rest,
  };
}
export function makeWave(p: Partial<WaveRow> = {}): WaveRow {
  return { id: 'w1', race_id: 'r1', name: 'Largada geral', position: 0, start_at: iso(T0), ...p };
}
export function makeAthlete(p: Partial<AthleteRow> = {}): AthleteRow {
  return { id: 'a1', name: 'Ana Souza', sex: 'F', birth_date: '1990-06-15', city: null, team_club: null, public_profile: true, ...p };
}
export function makeEntry(p: Partial<EntryRow> = {}): EntryRow {
  return { id: 'en1', event_id: 'e1', race_id: 'r1', wave_id: 'w1', bib: '101', team_name: null, level: null, status: 'ok', penalty_ms: 0, notes: '', members: [{ athlete_id: 'a1', position: 0, legs: [0, 1] }], ...p };
}
export function makeMark(p: Partial<MarkRow> & { at: number }): MarkRow {
  const { at, ...rest } = p;
  return { id: nextId('m'), event_id: 'e1', timekeeper_id: 'tk1', ts: iso(at), device_ts: iso(at), clock_offset_ms: 0, clock_rtt_ms: 80, entry_id: 'en1', leg_index: 0, athlete_id: null, discarded: false, discarded_by: null, created_at: iso(at), updated_at: iso(at), ...rest };
}
export function makeResolution(p: Partial<ResolutionRow> & Pick<ResolutionRow, 'entry_id' | 'leg_index' | 'mode'>): ResolutionRow {
  return { event_id: 'e1', mark_id: null, manual_ts: null, note: '', updated_at: iso(T0), ...p };
}
export function makeTimekeeper(p: Partial<TimekeeperRow> = {}): TimekeeperRow {
  return { id: 'tk1', name: 'Ana', active: true, ...p };
}
```

- [ ] **Step 2: Write failing tests**

`src/domain/presets.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { defaultRaceConfig, generateAgeGroups, RACE_PRESETS, normalizeRaceConfig, MODALITY_LABEL } from './presets';

describe('presets', () => {
  it('individual default config', () => {
    const c = defaultRaceConfig(1);
    expect(c.rankings.map(r => r.id)).toEqual(['geral', 'faixa']);
    expect(c.rankings[0]).toEqual({ id: 'geral', name: 'Geral', dims: ['sex'], size: 3 });
    expect(c.rankings[1]).toEqual({ id: 'faixa', name: 'Faixa etária', dims: ['sex', 'age'], size: 3 });
    expect(c.age_groups.map(g => g.label)).toEqual(['até 19', '20-29', '30-39', '40-49', '50-59', '60+']);
    expect(c).toMatchObject({ cumulative: false, same_crossing_window_s: 30, divergence_threshold_s: 3, time_source: 'median', age_rule: 'year_end', team_age_rule: 'sum', reference_timekeeper_id: null });
  });
  it('team default config', () => {
    const c = defaultRaceConfig(2);
    expect(c.rankings).toEqual([{ id: 'geral', name: 'Geral', dims: ['sex'], size: 3 }]);
    expect(c.age_groups).toEqual([]);
  });
  it('generates age groups', () => {
    expect(generateAgeGroups(20, 10, 60)).toEqual([
      { label: 'até 19', min: 0, max: 19 }, { label: '20-29', min: 20, max: 29 }, { label: '30-39', min: 30, max: 39 },
      { label: '40-49', min: 40, max: 49 }, { label: '50-59', min: 50, max: 59 }, { label: '60+', min: 60, max: null },
    ]);
    expect(generateAgeGroups(18, 5, 28).map(g => g.label)).toEqual(['até 17', '18-22', '23-27', '28+']);
  });
  it('has the race presets', () => {
    const ids = RACE_PRESETS.map(p => p.id);
    expect(ids).toEqual(['corrida-5k', 'corrida-10k', 'natacao-1500', 'ciclismo-20k', 'duathlon', 'aquathlon', 'triathlon-sprint', 'triathlon-olimpico', 'revezamento-dupla-aquathlon', 'revezamento-trio-triathlon', 'personalizada']);
    const sprint = RACE_PRESETS.find(p => p.id === 'triathlon-sprint')!;
    expect(sprint.legs.map(l => [l.modality, l.distance_m])).toEqual([['swim', 750], ['bike', 20000], ['run', 5000]]);
    expect(RACE_PRESETS.find(p => p.id === 'duathlon')!.legs.map(l => l.distance_m)).toEqual([5000, 20000, 2500]);
    expect(RACE_PRESETS.find(p => p.id === 'revezamento-dupla-aquathlon')!.team_size).toBe(2);
    expect(RACE_PRESETS.find(p => p.id === 'revezamento-trio-triathlon')!.team_size).toBe(3);
    expect(MODALITY_LABEL.swim).toBe('Natação');
  });
  it('normalizes partial configs', () => {
    expect(normalizeRaceConfig(null, 2)).toEqual(defaultRaceConfig(2));
    const c = normalizeRaceConfig({ divergence_threshold_s: -1, same_crossing_window_s: 0, rankings: [] }, 1);
    expect(c.divergence_threshold_s).toBe(3);
    expect(c.same_crossing_window_s).toBe(30);
    expect(c.rankings).toEqual([]);
  });
});
```

`src/domain/categories.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ageOn, entryCategory, groupLabel, groupKey, sexLabel, validateAgeGroups } from './categories';
import { generateAgeGroups } from './presets';
import { makeAthlete, makeEntry, makeRace } from './testing/fixtures';

const ev = { date: '2026-10-11', levels: ['Elite', 'Base'] };
describe('categories', () => {
  it('computes age by rule', () => {
    expect(ageOn('1990-12-31', '2026-10-11', 'year_end')).toBe(36);
    expect(ageOn('1990-12-31', '2026-10-11', 'event_date')).toBe(35);
    expect(ageOn('1990-10-11', '2026-10-11', 'event_date')).toBe(36);
  });
  it('individual category', () => {
    const a = makeAthlete({ birth_date: '1990-06-15' });
    expect(entryCategory(makeEntry({ level: 'Elite' }), new Map([[a.id, a]]), makeRace(), ev)).toEqual({ sex: 'F', age: 36, age_group: '30-39', level: 'Elite' });
  });
  it('team sex and age rules', () => {
    const a1 = makeAthlete({ id: 'a1', sex: 'M', birth_date: '1990-01-01' });
    const a2 = makeAthlete({ id: 'a2', sex: 'F', birth_date: '1986-01-01' });
    const r = makeRace({ team_size: 2, configPatch: { team_age_rule: 'sum', age_groups: [{ label: 'até 79', min: 0, max: 79 }, { label: '80+', min: 80, max: null }] } });
    const e = makeEntry({ team_name: 'Tubarões', members: [{ athlete_id: 'a1', position: 0, legs: [0] }, { athlete_id: 'a2', position: 1, legs: [1] }] });
    const m = new Map([[a1.id, a1], [a2.id, a2]]);
    expect(entryCategory(e, m, r, ev)).toMatchObject({ sex: 'MISTO', age: 76, age_group: 'até 79' });
    expect(entryCategory(e, m, { ...r, config: { ...r.config, team_age_rule: 'oldest' } }, ev).age).toBe(40);
    expect(entryCategory(e, m, { ...r, config: { ...r.config, team_age_rule: 'youngest' } }, ev).age).toBe(36);
    const allMale = new Map([[a1.id, a1], [a2.id, { ...a2, sex: 'M' as const }]]);
    expect(entryCategory(e, allMale, r, ev).sex).toBe('M');
  });
  it('missing birth date gives no age', () => {
    const a = makeAthlete({ birth_date: null });
    expect(entryCategory(makeEntry(), new Map([[a.id, a]]), makeRace(), ev)).toMatchObject({ age: null, age_group: null });
  });
  it('uses precomputed public ages', () => {
    const a = makeAthlete({ birth_date: null, age_year_end: 41, age_event: 40 });
    expect(entryCategory(makeEntry(), new Map([[a.id, a]]), makeRace(), ev).age).toBe(41);
    const r = makeRace({ configPatch: { age_rule: 'event_date' } });
    expect(entryCategory(makeEntry(), new Map([[a.id, a]]), r, ev).age).toBe(40);
  });
  it('ignores level when the event has none', () => {
    const a = makeAthlete();
    expect(entryCategory(makeEntry({ level: 'Elite' }), new Map([[a.id, a]]), makeRace(), { date: '2026-10-11', levels: [] }).level).toBeNull();
  });
  it('labels and keys', () => {
    const cat = { sex: 'F', age: 36, age_group: '30-39', level: 'Elite' } as const;
    expect(groupLabel([], cat)).toBe('Geral');
    expect(groupLabel(['sex', 'age'], cat)).toBe('Feminino · 30-39');
    expect(groupLabel(['sex', 'age', 'level'], { ...cat, age_group: null })).toBe('Feminino · Sem faixa · Elite');
    expect(groupKey([], cat)).toBe('all');
    expect(groupKey(['sex', 'age'], cat)).toBe('F|30-39');
    expect(sexLabel('MISTO')).toBe('Misto');
  });
  it('validates age groups', () => {
    expect(validateAgeGroups([{ label: 'a', min: 20, max: 29 }, { label: 'b', min: 25, max: 34 }])).toHaveLength(1);
    expect(validateAgeGroups([{ label: 'a', min: 30, max: 20 }])).toHaveLength(1);
    expect(validateAgeGroups(generateAgeGroups(20, 10, 60))).toEqual([]);
  });
});
```

`src/domain/eventModel.test.ts`: `indexEvent` builds all maps and `wavesByRace` sorted by `position`; `entryWave` returns the entry's wave or, when `wave_id` is null, the first wave of the race; `entryDisplayName` returns `team_name` when present else athlete names joined `' / '` (falls back to `'Nº <bib>'` when names are unknown); `legAthleteId(entry, k)` returns the member whose `legs` contains `k` or `null`; `mergeById(current, incoming)` replaces items with the same id when `incoming.updated_at >= current.updated_at` (or when either lacks `updated_at`), keeps the newer one otherwise, appends unknown ids, and preserves order by the original array followed by new items.

`src/domain/bib.test.ts` (Review Focus 2):
```ts
import { describe, it, expect } from 'vitest';
import { normalizeBib, resolveBib } from './bib';
import { makeEntry } from './testing/fixtures';

const entries = [makeEntry({ id: 'e7', bib: '007' }), makeEntry({ id: 'e101', bib: '101' }), makeEntry({ id: 'e5', bib: '5', status: 'dns' }), makeEntry({ id: 'e9', bib: '9', status: 'dsq' }), makeEntry({ id: 'e12a', bib: '12A' })];
describe('bib resolution', () => {
  it('normalizes', () => { expect(normalizeBib('  101 ')).toBe('101'); expect(normalizeBib(' 12a ')).toBe('12A'); });
  it('matches exact, trimmed and numeric-equivalent bibs', () => {
    expect(resolveBib(entries, ' 101 ')).toMatchObject({ entry: { id: 'e101' }, warning: null });
    expect(resolveBib(entries, '7')).toMatchObject({ entry: { id: 'e7' } });
    expect(resolveBib(entries, '0101')).toMatchObject({ entry: { id: 'e101' } });
    expect(resolveBib(entries, '12a')).toMatchObject({ entry: { id: 'e12a' } });
  });
  it('reports unknown or empty bibs', () => {
    expect(resolveBib(entries, '999')).toEqual({ error: 'Nº 999 não encontrado' });
    expect(resolveBib(entries, '  ')).toEqual({ error: 'Digite o nº de peito' });
  });
  it('warns (does not block) for DNS and DSQ', () => {
    expect(resolveBib(entries, '5')).toMatchObject({ entry: { id: 'e5' }, warning: 'Nº 5 está marcado como DNS' });
    expect(resolveBib(entries, '9')).toMatchObject({ entry: { id: 'e9' }, warning: 'Nº 9 está marcado como DSQ' });
  });
});
```

- [ ] **Step 3: Run** `npx vitest run src/domain` → FAIL.

- [ ] **Step 4: Implement.** Notes:
  - `defaultRaceConfig(teamSize)`: exactly the values asserted above (`teamSize > 1` → team variant). Must match SQL `default_race_config` from Task 3.
  - `generateAgeGroups(start, step, last)`: `até ${start-1}` (min 0) then `[a, a+step-1]` while `a < last`, then `${last}+` with `max null`.
  - Presets: names `Corrida 5 km`, `Corrida 10 km`, `Natação 1.500 m`, `Ciclismo 20 km`, `Duathlon` (run 5000, bike 20000, run 2500), `Aquathlon` (swim 750, run 5000), `Triathlon Sprint` (750/20000/5000), `Triathlon Olímpico` (1500/40000/10000), `Revezamento em dupla (natação + corrida)` (team 2; swim 750, run 5000), `Revezamento em trio (triathlon sprint)` (team 3), `Personalizada` (one `run` leg, 5000). Leg labels = `MODALITY_LABEL[modality]`.
  - `normalizeRaceConfig(partial, teamSize)`: start from defaults; copy each field only if valid (enums in range; numbers finite and > 0; arrays are arrays; `reference_timekeeper_id` string or null).
  - `ageOn`: `year_end` → `eventYear - birthYear`; `event_date` → full years at the event date (string arithmetic on `YYYY-MM-DD`, no `Date` time zone pitfalls).
  - `athleteAge`: birth_date → `ageOn`; else `age_year_end`/`age_event` by rule; else null.
  - `entryCategory`: sex rule (§9), team ages by `team_age_rule` (null if any member lacks an age), `age_group` = first group containing the age, `level` = `entry.level` only if `event.levels` includes it.
  - `groupKey(dims, cat)`: `[]` → `'all'`; else values joined by `|` where sex → `cat.sex`, age → `cat.age_group ?? '∅'`, level → `cat.level ?? '∅'`. `groupLabel`: `[]` → `'Geral'`; parts: `sexLabel`, `age_group ?? 'Sem faixa'`, `level ?? 'Sem nível'`, joined `' · '`.
  - `validateAgeGroups`: messages `Faixa "<label>": idade final menor que a inicial` and `Faixas "<a>" e "<b>" se sobrepõem`.
  - `resolveBib`: `normalizeBib` = trim + uppercase; exact match first; if the input is all digits, match entries whose bib is all digits with the same integer value; DNS/DSQ warnings `Nº <bib> está marcado como DNS|DSQ` (use the entry's bib).
- [ ] **Step 5: Run** → PASS. **Step 6: Commit** (`feat(domain): presets, categories, event index and bib resolution`).

---

## Task 10: Domain — time consolidation and leg suggestion (core of timing)

**Files:**
- Create: `src/domain/consolidation.ts`, `src/domain/consolidation.test.ts`, `src/domain/suggestLeg.ts`, `src/domain/suggestLeg.test.ts`

**Interfaces:**
- Consumes: Task 9 (`presets`, `eventModel`, fixtures), `src/lib/format.ts`.
- Produces: `median`, `computeCrossing`, `computeEntryTiming`, `computeEventTiming`, `suggestLeg` and the `Crossing`/`EntryTiming`/`Issue`/`EventTiming`/`LegSuggestion` types (see "Domain signatures").

Algorithm (spec §8, implement exactly):
- `median(values)`: sorted; odd → middle; even → `Math.round((a+b)/2)`; empty → null.
- `computeCrossing`: consider marks with `!discarded && leg_index === legIndex` (callers pass only the entry's marks), sorted by `(ts, id)`. Candidate key = `timekeeper_id ?? 'org:' + mark.id`; first mark per key is the candidate, later ones go to `duplicates`. `median_ms`/`spread_ms` over candidates. System = reference timekeeper's candidate when `time_source === 'reference'` and it exists (`system_source 'reference'`), else median (`'median'`). Official: resolution `manual` → `Date.parse(manual_ts)` (`'manual'`); `mark` → the referenced mark if it is among the non-discarded marks of this leg (`'mark'`), otherwise `chosen_mark_discarded = true` and use system; `system`/none → system. `divergent = candidates.length >= 2 && spread_ms > divergence_threshold_s * 1000`.
- `computeEntryTiming`: start = wave `start_at`; per leg: crossing, `athlete_id = legAthleteId`, `start_ms` = previous official (or start for leg 0), `leg_ms` = official − start when both exist. `total_ms` = last official − start; `final_ms = total_ms + penalty_ms`. Status: entry `dns|dnf|dsq` override; else last crossing present → `finished`; else start or any crossing present → `on_course`; else `not_started`. For `on_course`: `current_leg = (last k with official) + 1` (0 if none), `current_leg_start_ms` = that previous official or start.
- `computeEventTiming(agg, nowMs)`: timing for every entry (wave via `entryWave`), plus issues:
  - `divergence` (warning) when `crossing.divergent && !crossing.resolution`: outliers = candidates with `|ts − median| > threshold` (with exactly 2 candidates both count); for each outlier, compare with the medians of the **other** legs of the same entry: first leg `j` with `|ts − median_j| <= same_crossing_window_s*1000` → `suggested_leg_index = j`; `mark_ids` = outlier mark ids. Message: `Nº <bib> · Perna <k+1> (<label>): divergência de <spread s with 1 decimal, pt-BR> s entre cronometristas`.
  - `duplicate` (info): `Nº <bib> · Perna <k+1> (<label>): <timekeeper name|Organização> marcou mais de uma vez`, `mark_ids` = duplicates.
  - `chosen_mark_discarded` (warning): `Nº <bib> · Perna <k+1> (<label>): a marcação escolhida foi descartada`.
  - `missing_crossing` (error): leg `k` without official while some later leg has one: `Nº <bib> · Perna <k+1> (<label>): passagem não registrada (há passagem posterior)`.
  - `order` (error): official ≤ previous official (or ≤ start for leg 0): `Nº <bib> · Perna <k+1> (<label>): passagem antes da anterior/largada`.
  - `no_start` (warning): entry has non-discarded marks but no start: `Nº <bib>: marcação sem largada registrada (<wave name>)`.
  - `not_finished` (info): status `on_course`: `Nº <bib>: ainda em prova`.
  - `unassigned` (warning): non-discarded marks with `entry_id null` and `nowMs − ts > 60_000`: `Marcação <formatClock(ts,{tenths})> (<timekeeper name|Organização>) sem atleta`.
  - Sort issues: error, warning, info; then message.
- `suggestLeg` (spec §7.5): window = `same_crossing_window_s*1000`; consider the entry's non-discarded marks with a leg; `candidateLegs` = the selected athlete's legs (sorted) when `athleteId` is a member, else all legs; per-leg median; if any candidate leg has `|ts − median| <= window` → the closest one, reason `same_crossing`; else `last` = max leg (over **all** legs) with `median < ts − window` (−1 if none) → smallest candidate leg `> last`, reason `next`; none → last candidate leg, `warning 'already_finished'`. `athlete_id = legAthleteId(entry, leg)`.

- [ ] **Step 1: Write failing `src/domain/consolidation.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { median, computeCrossing, computeEntryTiming, computeEventTiming } from './consolidation';
import { makeRace, makeWave, makeEntry, makeMark, makeResolution, makeTimekeeper, makeAthlete, T0, SEC, MIN, iso } from './testing/fixtures';

const race = makeRace();
const cfg = race.config;
const L0 = T0 + 10 * MIN;

describe('median', () => {
  it('handles odd, even and empty', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(3);
    expect(median([])).toBeNull();
  });
});

describe('computeCrossing', () => {
  it('uses the median and flags divergence (10:05, 10:06, 10:19 → 10:06)', () => {
    const marks = [makeMark({ at: L0 + 5 * SEC, timekeeper_id: 'tk1' }), makeMark({ at: L0 + 6 * SEC, timekeeper_id: 'tk2' }), makeMark({ at: L0 + 19 * SEC, timekeeper_id: 'tk3' })];
    const c = computeCrossing({ legIndex: 0, marks, resolution: null, config: cfg });
    expect(c.official_ms).toBe(L0 + 6 * SEC);
    expect(c.official_source).toBe('median');
    expect(c.spread_ms).toBe(14 * SEC);
    expect(c.divergent).toBe(true);
  });
  it('two close marks: median is the mean, no divergence', () => {
    const c = computeCrossing({ legIndex: 0, marks: [makeMark({ at: L0, timekeeper_id: 'tk1' }), makeMark({ at: L0 + SEC, timekeeper_id: 'tk2' })], resolution: null, config: cfg });
    expect(c.official_ms).toBe(L0 + 500);
    expect(c.divergent).toBe(false);
  });
  it('organizer can pick a specific mark or type a manual time', () => {
    const a = makeMark({ at: L0, timekeeper_id: 'tk1' });
    const b = makeMark({ at: L0 + 5 * SEC, timekeeper_id: 'tk2' });
    const pick = computeCrossing({ legIndex: 0, marks: [a, b], resolution: makeResolution({ entry_id: 'en1', leg_index: 0, mode: 'mark', mark_id: b.id }), config: cfg });
    expect(pick.official_ms).toBe(L0 + 5 * SEC);
    expect(pick.official_source).toBe('mark');
    const manual = computeCrossing({ legIndex: 0, marks: [a, b], resolution: makeResolution({ entry_id: 'en1', leg_index: 0, mode: 'manual', manual_ts: iso(L0 + 2 * SEC) }), config: cfg });
    expect(manual.official_ms).toBe(L0 + 2 * SEC);
    expect(manual.official_source).toBe('manual');
    const none = computeCrossing({ legIndex: 0, marks: [], resolution: makeResolution({ entry_id: 'en1', leg_index: 0, mode: 'manual', manual_ts: iso(L0) }), config: cfg });
    expect(none.official_ms).toBe(L0);
  });
  it('reference timekeeper policy falls back to the median', () => {
    const refCfg = { ...cfg, time_source: 'reference' as const, reference_timekeeper_id: 'tk2' };
    const marks = [makeMark({ at: L0, timekeeper_id: 'tk1' }), makeMark({ at: L0 + 2 * SEC, timekeeper_id: 'tk2' }), makeMark({ at: L0 + 3 * SEC, timekeeper_id: 'tk3' })];
    expect(computeCrossing({ legIndex: 0, marks, resolution: null, config: refCfg })).toMatchObject({ official_ms: L0 + 2 * SEC, system_source: 'reference' });
    expect(computeCrossing({ legIndex: 0, marks: [marks[0], marks[2]], resolution: null, config: refCfg })).toMatchObject({ official_ms: L0 + 1500, system_source: 'median' });
  });
  it('keeps only the earliest mark per timekeeper and ignores discarded marks', () => {
    const first = makeMark({ at: L0, timekeeper_id: 'tk1' });
    const dup = makeMark({ at: L0 + 300, timekeeper_id: 'tk1' });
    const other = makeMark({ at: L0 + 500, timekeeper_id: 'tk2' });
    const gone = makeMark({ at: L0 + 50 * SEC, timekeeper_id: 'tk3', discarded: true, discarded_by: 'organizer' });
    const c = computeCrossing({ legIndex: 0, marks: [dup, other, first, gone], resolution: null, config: cfg });
    expect(c.candidates.map(x => x.mark_id)).toEqual([first.id, other.id]);
    expect(c.duplicates).toEqual([dup.id]);
    expect(c.official_ms).toBe(L0 + 250);
  });
  it('falls back to the system time when the chosen mark was discarded', () => {
    const a = makeMark({ at: L0, timekeeper_id: 'tk1' });
    const b = makeMark({ at: L0 + SEC, timekeeper_id: 'tk2', discarded: true, discarded_by: 'organizer' });
    const c = computeCrossing({ legIndex: 0, marks: [a, b], resolution: makeResolution({ entry_id: 'en1', leg_index: 0, mode: 'mark', mark_id: b.id }), config: cfg });
    expect(c.chosen_mark_discarded).toBe(true);
    expect(c.official_ms).toBe(L0);
  });
});

describe('computeEntryTiming', () => {
  const relay = makeRace({ team_size: 2 });
  const team = makeEntry({ team_name: 'Tubarões', members: [{ athlete_id: 'a1', position: 0, legs: [0] }, { athlete_id: 'a2', position: 1, legs: [1] }] });
  it('relay handoff: the end of leg 1 starts leg 2 for the next athlete', () => {
    const m0 = makeMark({ at: L0, leg_index: 0 });
    const t1 = computeEntryTiming(team, relay, makeWave(), [m0], []);
    expect(t1.status).toBe('on_course');
    expect(t1.current_leg).toBe(1);
    expect(t1.current_leg_start_ms).toBe(L0);
    expect(t1.legs[1].athlete_id).toBe('a2');
    const t2 = computeEntryTiming(team, relay, makeWave(), [m0, makeMark({ at: T0 + 30 * MIN, leg_index: 1 })], []);
    expect(t2.status).toBe('finished');
    expect(t2.legs.map(l => l.leg_ms)).toEqual([10 * MIN, 20 * MIN]);
    expect(t2.total_ms).toBe(30 * MIN);
  });
  it('adds penalties and honors status overrides', () => {
    const marks = [makeMark({ at: L0, leg_index: 0 }), makeMark({ at: T0 + 30 * MIN, leg_index: 1 })];
    expect(computeEntryTiming(makeEntry({ penalty_ms: 60_000 }), race, makeWave(), marks, []).final_ms).toBe(31 * MIN);
    expect(computeEntryTiming(makeEntry({ status: 'dnf' }), race, makeWave(), marks, []).status).toBe('dnf');
  });
  it('not started without a wave start and without marks', () => {
    const t = computeEntryTiming(makeEntry(), race, makeWave({ start_at: null }), [], []);
    expect(t.status).toBe('not_started');
    expect(t.current_leg).toBeNull();
  });
});

describe('computeEventTiming issues', () => {
  const base = { races: [race], waves: [makeWave()], entries: [makeEntry()], athletes: [makeAthlete()], timekeepers: [makeTimekeeper({ id: 'tk1', name: 'Ana' }), makeTimekeeper({ id: 'tk2', name: 'Bia' }), makeTimekeeper({ id: 'tk3', name: 'Caio' })], resolutions: [] as any[] };
  it('late wave start recomputes everything (Review Focus 5)', () => {
    const marks = [makeMark({ at: L0, leg_index: 0 }), makeMark({ at: T0 + 30 * MIN, leg_index: 1 })];
    const before = computeEventTiming({ ...base, waves: [makeWave({ start_at: null })], marks }, T0 + 40 * MIN);
    expect(before.issues.map(i => i.type)).toContain('no_start');
    expect(before.byEntry.get('en1')!.total_ms).toBeNull();
    const after = computeEventTiming({ ...base, waves: [makeWave({ start_at: iso(T0) })], marks }, T0 + 40 * MIN);
    expect(after.issues.map(i => i.type)).not.toContain('no_start');
    expect(after.byEntry.get('en1')!.total_ms).toBe(30 * MIN);
  });
  it('divergence issue only while unresolved', () => {
    const marks = [makeMark({ at: L0, timekeeper_id: 'tk1' }), makeMark({ at: L0 + 14 * SEC, timekeeper_id: 'tk2' })];
    const open = computeEventTiming({ ...base, marks }, T0 + 20 * MIN);
    const div = open.issues.find(i => i.type === 'divergence')!;
    expect(div.message).toContain('Nº 101');
    expect(div.message).toContain('divergência de 14,0 s');
    const resolved = computeEventTiming({ ...base, marks, resolutions: [makeResolution({ entry_id: 'en1', leg_index: 0, mode: 'system' })] }, T0 + 20 * MIN);
    expect(resolved.issues.find(i => i.type === 'divergence')).toBeUndefined();
  });
  it('outlier near the next crossing suggests moving it (Review Focus 1)', () => {
    const wrong = makeMark({ at: T0 + 30 * MIN + 2 * SEC, timekeeper_id: 'tk3', leg_index: 0 });
    const marks = [
      makeMark({ at: L0, timekeeper_id: 'tk1', leg_index: 0 }), makeMark({ at: L0 + SEC, timekeeper_id: 'tk2', leg_index: 0 }), wrong,
      makeMark({ at: T0 + 30 * MIN, timekeeper_id: 'tk1', leg_index: 1 }), makeMark({ at: T0 + 30 * MIN + 500, timekeeper_id: 'tk2', leg_index: 1 }),
    ];
    const r = computeEventTiming({ ...base, marks }, T0 + 40 * MIN);
    const div = r.issues.find(i => i.type === 'divergence' && i.leg_index === 0)!;
    expect(div.mark_ids).toEqual([wrong.id]);
    expect(div.suggested_leg_index).toBe(1);
    expect(r.byEntry.get('en1')!.legs[0].crossing.official_ms).toBe(L0 + SEC); // median stays robust
  });
  it('missing crossing, order, duplicates, unassigned and not finished', () => {
    const onlyFinish = computeEventTiming({ ...base, marks: [makeMark({ at: T0 + 30 * MIN, leg_index: 1 })] }, T0 + 40 * MIN);
    expect(onlyFinish.issues.find(i => i.type === 'missing_crossing')!.leg_index).toBe(0);
    expect(onlyFinish.byEntry.get('en1')!.total_ms).toBe(30 * MIN);
    const reversed = computeEventTiming({ ...base, marks: [makeMark({ at: T0 + 20 * MIN, leg_index: 0 }), makeMark({ at: T0 + 10 * MIN, leg_index: 1 })] }, T0 + 40 * MIN);
    expect(reversed.issues.find(i => i.type === 'order')!.leg_index).toBe(1);
    const dups = computeEventTiming({ ...base, marks: [makeMark({ at: L0 }), makeMark({ at: L0 + 200 })] }, T0 + 40 * MIN);
    expect(dups.issues.find(i => i.type === 'duplicate')!.message).toContain('Ana marcou mais de uma vez');
    const now = T0 + 40 * MIN;
    const un = computeEventTiming({ ...base, marks: [makeMark({ at: now - 61 * SEC, entry_id: null, leg_index: null }), makeMark({ at: now - 10 * SEC, entry_id: null, leg_index: null })] }, now);
    expect(un.issues.filter(i => i.type === 'unassigned')).toHaveLength(1);
    const running = computeEventTiming({ ...base, marks: [makeMark({ at: L0 })] }, now);
    expect(running.issues.map(i => i.type)).toContain('not_finished');
    const mixed = computeEventTiming({ ...base, marks: [makeMark({ at: now - 61 * SEC, entry_id: null, leg_index: null }), makeMark({ at: L0 })] }, now);
    expect(mixed.issues.map(i => i.severity)).toEqual(['warning', 'info']); // sorted by severity first
  });
});
```

- [ ] **Step 2: Write failing `src/domain/suggestLeg.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { suggestLeg } from './suggestLeg';
import { makeRace, makeEntry, makeMark, T0, SEC, MIN } from './testing/fixtures';

const solo = makeRace();
const soloEntry = makeEntry();
describe('suggestLeg', () => {
  it('first arrival is leg 0', () => {
    expect(suggestLeg({ entry: soloEntry, race: solo, marks: [], tsMs: T0 + 10 * MIN })).toMatchObject({ leg_index: 0, reason: 'next', warning: null, athlete_id: 'a1' });
  });
  it('another timekeeper confirming the same crossing gets the same leg', () => {
    const marks = [makeMark({ at: T0 + 10 * MIN, leg_index: 0, timekeeper_id: 'tk2' })];
    expect(suggestLeg({ entry: soloEntry, race: solo, marks, tsMs: T0 + 10 * MIN + 2 * SEC })).toMatchObject({ leg_index: 0, reason: 'same_crossing' });
  });
  it('a later arrival is the next leg', () => {
    const marks = [makeMark({ at: T0 + 10 * MIN, leg_index: 0 })];
    expect(suggestLeg({ entry: soloEntry, race: solo, marks, tsMs: T0 + 40 * MIN })).toMatchObject({ leg_index: 1, reason: 'next' });
  });
  it('warns when the entry already finished', () => {
    const marks = [makeMark({ at: T0 + 10 * MIN, leg_index: 0 }), makeMark({ at: T0 + 30 * MIN, leg_index: 1 })];
    expect(suggestLeg({ entry: soloEntry, race: solo, marks, tsMs: T0 + 60 * MIN })).toMatchObject({ leg_index: 1, warning: 'already_finished' });
  });
  it('relay: selecting the second athlete targets their leg even if leg 1 was missed', () => {
    const duo = makeRace({ team_size: 2 });
    const e = makeEntry({ team_name: 'Tubarões', members: [{ athlete_id: 'a1', position: 0, legs: [0] }, { athlete_id: 'a2', position: 1, legs: [1] }] });
    expect(suggestLeg({ entry: e, race: duo, marks: [], tsMs: T0 + 30 * MIN, athleteId: 'a2' })).toMatchObject({ leg_index: 1, athlete_id: 'a2' });
  });
  it('athlete doing two legs of a trio race', () => {
    const trio = makeRace({ team_size: 2, legs: [{ modality: 'run', label: 'Corrida', distance_m: 5000 }, { modality: 'bike', label: 'Ciclismo', distance_m: 20000 }, { modality: 'run', label: 'Corrida', distance_m: 2500 }] });
    const e = makeEntry({ team_name: 'Dupla', members: [{ athlete_id: 'a1', position: 0, legs: [0, 2] }, { athlete_id: 'a2', position: 1, legs: [1] }] });
    expect(suggestLeg({ entry: e, race: trio, marks: [], tsMs: T0 + 20 * MIN, athleteId: 'a1' }).leg_index).toBe(0);
    const marks = [makeMark({ at: T0 + 20 * MIN, leg_index: 0 }), makeMark({ at: T0 + 55 * MIN, leg_index: 1 })];
    expect(suggestLeg({ entry: e, race: trio, marks, tsMs: T0 + 70 * MIN, athleteId: 'a1' }).leg_index).toBe(2);
  });
  it('ignores discarded marks', () => {
    const marks = [makeMark({ at: T0 + 10 * MIN, leg_index: 0, discarded: true, discarded_by: 'timekeeper' })];
    expect(suggestLeg({ entry: soloEntry, race: solo, marks, tsMs: T0 + 40 * MIN }).leg_index).toBe(0);
  });
});
```

- [ ] **Step 3: Run** `npx vitest run src/domain` → FAIL. **Step 4: Implement** both modules per the algorithm above. **Step 5: Run** → PASS. **Step 6: Commit** (`feat(domain): median time consolidation, issues and leg suggestion`).

---

## Task 11: Domain — classification, podiums, finalize snapshot

**Files:**
- Create: `src/domain/ranking.ts`, `src/domain/ranking.test.ts`, `src/domain/snapshot.ts`, `src/domain/snapshot.test.ts`

**Interfaces:**
- Consumes: Tasks 9–10 (`entryCategory`, `groupKey`, `groupLabel`, `EntryTiming`), types.
- Produces: `classifyRace`, `RankedEntry`, `PodiumGroup`, `RaceClassification`, `buildFinalizeRows`.

Rules (spec §9): ranked = `status === 'finished' && final_ms !== null`, ordered by `final_ms`, ties share the position (competition ranking), display tie-break by numeric-aware bib. Unranked rows follow in this status order: `on_course`, `not_started`, `dnf`, `dns`, `dsq` (then bib). `sex_pos` within entry sex. `ranking_pos[r.id]` = competition position inside `groupKey(r.dims)`. `gap_ms` = `final_ms − leader final_ms`. Podiums: for each ranking in config order, groups ordered by sex `M, F, MISTO`, then age group by `min` (`Sem faixa` last), then level by `event.levels` order (`Sem nível` last); places = ranked entries of the group, excluding (when `cumulative === false`) entries already placed in an earlier ranking, re-ranked with competition positions, keeping those with position `<= size`; omit empty groups.

- [ ] **Step 1: Write failing `src/domain/ranking.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { classifyRace } from './ranking';
import type { EntryTiming, TimingStatus } from './consolidation';
import type { AthleteRow, EntryRow } from '../lib/types';
import { makeRace, makeEntry, makeAthlete, T0, MIN } from './testing/fixtures';

const ev = { date: '2026-10-11', levels: [] as string[] };
function timing(entry_id: string, final_ms: number | null, status: TimingStatus = final_ms === null ? 'on_course' : 'finished'): EntryTiming {
  return { entry_id, race_id: 'r1', start_ms: T0, legs: [], total_ms: final_ms, final_ms, status, current_leg: null, current_leg_start_ms: null };
}
const people: [string, 'M' | 'F', string | null, number | null, EntryRow['status']?][] = [
  ['f1', 'F', '1990-01-01', 20 * MIN], ['f2', 'F', '2000-01-01', 21 * MIN], ['f3', 'F', '1992-01-01', 22 * MIN],
  ['f4', 'F', '1988-01-01', 23 * MIN], ['f5', 'F', '2001-01-01', 24 * MIN],
  ['m1', 'M', '1995-01-01', 18 * MIN], ['m2', 'M', '1995-05-05', 18 * MIN], ['m3', 'M', '1980-01-01', 19 * MIN],
  ['m4', 'M', null, 25 * MIN], ['m5', 'M', '1990-01-01', null, 'dnf'], ['f6', 'F', '1990-01-01', null, 'dns'],
];
const athletes = new Map<string, AthleteRow>(people.map(([id, sex, birth]) => [id, makeAthlete({ id, sex, birth_date: birth, name: id.toUpperCase() })]));
const entries = people.map(([id, , , , status], i) => makeEntry({ id: `e-${id}`, bib: String(i + 1), status: status ?? 'ok', members: [{ athlete_id: id, position: 0, legs: [0] }] }));
const timings = new Map(people.map(([id, , , fin, status]) => [`e-${id}`, timing(`e-${id}`, fin, status === 'dnf' ? 'dnf' : status === 'dns' ? 'dns' : undefined)]));
const race = makeRace({ legs: [{ modality: 'run', label: 'Corrida', distance_m: 5000 }] });
const idOf = (r: { entry: EntryRow }) => r.entry.id.replace('e-', '');

describe('classifyRace', () => {
  const cls = classifyRace(race, entries, timings, athletes, ev);
  it('orders finishers with shared positions for ties, then non-finishers', () => {
    expect(cls.rows.map(idOf)).toEqual(['m1', 'm2', 'm3', 'f1', 'f2', 'f3', 'f4', 'f5', 'm4', 'm5', 'f6']);
    expect(cls.rows.map(r => r.overall_pos)).toEqual([1, 1, 3, 4, 5, 6, 7, 8, 9, null, null]);
    expect(cls.finishers).toBe(9);
  });
  it('computes sex positions, gaps and per-ranking positions', () => {
    const byId = new Map(cls.rows.map(r => [idOf(r), r]));
    expect(byId.get('m4')!.sex_pos).toBe(4);
    expect(byId.get('f1')!.sex_pos).toBe(1);
    expect(byId.get('f1')!.gap_ms).toBe(2 * MIN);
    expect(byId.get('f4')!.ranking_pos).toEqual({ geral: 4, faixa: 3 });
  });
  it('non-cumulative podiums skip athletes already awarded', () => {
    const geral = cls.podiums.filter(p => p.ranking.id === 'geral');
    expect(geral.map(g => [g.group_label, g.places.map(p => [idOf(p.ranked), p.podium_pos])])).toEqual([
      ['Masculino', [['m1', 1], ['m2', 1], ['m3', 3]]],
      ['Feminino', [['f1', 1], ['f2', 2], ['f3', 3]]],
    ]);
    const faixa = cls.podiums.filter(p => p.ranking.id === 'faixa');
    expect(faixa.map(g => [g.group_label, g.places.map(p => [idOf(p.ranked), p.podium_pos])])).toEqual([
      ['Masculino · Sem faixa', [['m4', 1]]],
      ['Feminino · 20-29', [['f5', 1]]],
      ['Feminino · 30-39', [['f4', 1]]],
    ]);
  });
  it('cumulative podiums repeat athletes', () => {
    const cum = classifyRace({ ...race, config: { ...race.config, cumulative: true } }, entries, timings, athletes, ev);
    const faixa = cum.podiums.filter(p => p.ranking.id === 'faixa');
    expect(faixa.map(g => [g.group_label, g.places.map(p => idOf(p.ranked))])).toEqual([
      ['Masculino · 30-39', ['m1', 'm2']], ['Masculino · 40-49', ['m3']], ['Masculino · Sem faixa', ['m4']],
      ['Feminino · 20-29', ['f2', 'f5']], ['Feminino · 30-39', ['f1', 'f3', 'f4']],
    ]);
  });
  it('team races group by Masculino, Feminino, Misto', () => {
    const duo = makeRace({ team_size: 2 });
    const ath = new Map<string, AthleteRow>([['x1', makeAthlete({ id: 'x1', sex: 'M' })], ['x2', makeAthlete({ id: 'x2', sex: 'M' })], ['y1', makeAthlete({ id: 'y1', sex: 'F' })], ['y2', makeAthlete({ id: 'y2', sex: 'F' })]]);
    const mk = (id: string, a: string, b: string) => makeEntry({ id, team_name: id, members: [{ athlete_id: a, position: 0, legs: [0] }, { athlete_id: b, position: 1, legs: [1] }] });
    const es = [mk('mix', 'x1', 'y1'), mk('fem', 'y1', 'y2'), mk('mas', 'x1', 'x2')];
    const tm = new Map([['mix', timing('mix', 30 * MIN)], ['fem', timing('fem', 31 * MIN)], ['mas', timing('mas', 32 * MIN)]]);
    const c = classifyRace(duo, es, tm, ath, ev);
    expect(c.podiums.map(p => p.group_label)).toEqual(['Masculino', 'Feminino', 'Misto']);
  });
});
```

(`faixa` for `f4` = 3 because `F|30-39` finishers are f1 (1990→36), f3 (1992→34), f4 (1988→38) in time order.)

- [ ] **Step 2: Write failing `src/domain/snapshot.test.ts`**: using the same fixture data (export the setup from the ranking test into a local helper within the snapshot test), `buildFinalizeRows(makeEvent(), cls, athletes)` returns 11 rows; row for `f1`: `athlete_ids ['f1']`, `status 'finished'`, `final_ms 20*MIN`, `overall_pos 4`, `data.positions {overall: 4, sex: 1, finishers: 9}`, `data.category {sex: 'F', age: 36, age_group: '30-39', level: null}`, `data.podiums` contains `{ranking_id: 'geral', ranking_name: 'Geral', group_label: 'Feminino', podium_pos: 1}`, `data.members [{athlete_id: 'f1', name: 'F1', legs: [0]}]`, `data.legs[0]` = `{leg_index: 0, modality: 'run', label: 'Corrida', distance_m: 5000, athlete_id: 'f1', time_ms: null}` (fixture timings have no legs → `time_ms` null), `data.event {id:'e1', name:'Evento Teste', date:'2026-10-11'}`, `data.race {id:'r1', name: race.name, team_size: 1}`; row for `m5`: `status 'dnf'`, `final_ms null`, `overall_pos null`, `data.podiums []`.
- [ ] **Step 3:** run → FAIL. **Step 4:** implement (`buildFinalizeRows` maps each `RankedEntry`: legs from `race.legs` merged with `timing.legs[k]?.leg_ms ?? null` and `legAthleteId`; podiums collected from `cls.podiums` places). **Step 5:** run → PASS. **Step 6: Commit** (`feat(domain): classification, podiums and finalize snapshot`).

---

## Task 12: Domain — athlete statistics

**Files:**
- Create: `src/domain/stats.ts`, `src/domain/stats.test.ts`

**Interfaces:**
- Consumes: `ResultRow`/`ResultSnapshot` types, `formatPace` (Task 1).
- Produces: `computeAthleteStats(athleteId, results): AthleteStats` (shape in "Domain signatures").

Definitions (spec §10): participations = status not in (`dns`, `not_started`); finishes = `finished`; dnf = `dnf` + `on_course`; dns = `dns` + `not_started`; completion_rate = finishes/participations (null if 0); wins_overall = `overall_pos === 1`; wins_category = results with any podium `podium_pos === 1`; podiums = results with any podium `podium_pos <= 3`; best_overall_pos = min overall_pos; avg_percentile = mean of `overall_pos / positions.finishers` over results with both; records = per `(modality, distance_m)` the minimum `time_ms` among legs where `athlete_id === athleteId` (ignore null time or null distance); pace via `formatPace`; pace_by_modality = per modality sum distance/time over those legs (skip `other`); km_by_modality = sum distance/1000 of those legs; history sorted by event date desc (category text = `groupLabel(['sex','age','level'])`-like `"Feminino · 30-39"` using `category` fields, podiums as `"<ranking_name>: <podium_pos>º (<group_label>)"`, `my_legs` = legs of this athlete with `label` and `time_ms`); evolution = the `(modality, distance)` with most timed legs (≥ 2), points sorted by date asc; partners = other members across team results, counted, sorted by count desc then name.

- [ ] **Step 1: Write failing `src/domain/stats.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { computeAthleteStats } from './stats';
import type { ResultRow, ResultSnapshot } from '../lib/types';

function result(p: { date: string; name: string; race: string; status: ResultSnapshot['status']; final: number | null; pos: number | null; fin: number; podiums?: ResultSnapshot['podiums']; members?: ResultSnapshot['members']; legs: ResultSnapshot['legs'] }): ResultRow {
  const members = p.members ?? [{ athlete_id: 'a1', name: 'Ana', legs: p.legs.map(l => l.leg_index) }];
  return {
    race_id: `r-${p.date}`, entry_id: `en-${p.date}`, event_id: `e-${p.date}`, athlete_ids: members.map(m => m.athlete_id),
    status: p.status, final_ms: p.final, overall_pos: p.pos, finalized_at: `${p.date}T20:00:00Z`,
    data: { event: { id: `e-${p.date}`, name: p.name, date: p.date }, race: { id: `r-${p.date}`, name: p.race, team_size: members.length }, bib: '1', team_name: members.length > 1 ? 'Tubarões' : null, members, legs: p.legs, category: { sex: 'F', age: 36, age_group: '30-39', level: null }, status: p.status, total_ms: p.final, penalty_ms: 0, final_ms: p.final, positions: { overall: p.pos, sex: p.pos, finishers: p.fin }, podiums: p.podiums ?? [] },
  };
}
const run = (t: number | null) => ({ leg_index: 0, modality: 'run' as const, label: 'Corrida', distance_m: 5000, athlete_id: 'a1', time_ms: t });
const results = [
  result({ date: '2026-03-10', name: 'Etapa 1', race: 'Corrida 5K', status: 'finished', final: 1_350_000, pos: 1, fin: 20, podiums: [{ ranking_id: 'geral', ranking_name: 'Geral', group_label: 'Feminino', podium_pos: 1 }], legs: [run(1_350_000)] }),
  result({ date: '2026-06-20', name: 'Etapa 2', race: 'Aquathlon Revezamento', status: 'finished', final: 2_400_000, pos: 3, fin: 12, podiums: [{ ranking_id: 'geral', ranking_name: 'Geral', group_label: 'Misto', podium_pos: 2 }],
    members: [{ athlete_id: 'a1', name: 'Ana', legs: [0] }, { athlete_id: 'a2', name: 'Bia', legs: [1] }],
    legs: [{ leg_index: 0, modality: 'swim', label: 'Natação', distance_m: 750, athlete_id: 'a1', time_ms: 750_000 }, { leg_index: 1, modality: 'run', label: 'Corrida', distance_m: 5000, athlete_id: 'a2', time_ms: 1_650_000 }] }),
  result({ date: '2026-09-01', name: 'Etapa 3', race: 'Corrida 5K', status: 'dnf', final: null, pos: null, fin: 25, legs: [run(null)] }),
  result({ date: '2026-09-20', name: 'Etapa 4', race: 'Corrida 5K', status: 'finished', final: 1_300_000, pos: 5, fin: 30, podiums: [{ ranking_id: 'faixa', ranking_name: 'Faixa etária', group_label: 'Feminino · 30-39', podium_pos: 1 }], legs: [run(1_300_000)] }),
];

describe('computeAthleteStats', () => {
  const s = computeAthleteStats('a1', results);
  it('counts participations and outcomes', () => {
    expect(s).toMatchObject({ participations: 4, finishes: 3, dnf: 1, dsq: 0, dns: 0, completion_rate: 0.75, wins_overall: 1, wins_category: 2, podiums: 3, best_overall_pos: 1 });
    expect(s.avg_percentile).toBeCloseTo((1 / 20 + 3 / 12 + 5 / 30) / 3, 6);
  });
  it('personal records and paces use only the athlete own legs', () => {
    expect(s.records.find(r => r.modality === 'run')).toMatchObject({ distance_m: 5000, time_ms: 1_300_000, pace: '4:20 /km', event_name: 'Etapa 4' });
    expect(s.records.find(r => r.modality === 'swim')).toMatchObject({ distance_m: 750, time_ms: 750_000, pace: '1:40 /100m' });
    expect(s.pace_by_modality.find(p => p.modality === 'run')).toMatchObject({ distance_m: 10_000, time_ms: 2_650_000, pace: '4:25 /km' });
    expect(s.km_by_modality).toEqual({ run: 10, swim: 0.75 });
  });
  it('history, evolution and partners', () => {
    expect(s.history.map(h => h.event_name)).toEqual(['Etapa 4', 'Etapa 3', 'Etapa 2', 'Etapa 1']);
    expect(s.history[0].podiums).toEqual(['Faixa etária: 1º (Feminino · 30-39)']);
    expect(s.evolution).toMatchObject({ modality: 'run', distance_m: 5000, points: [{ date: '2026-03-10', time_ms: 1_350_000 }, { date: '2026-09-20', time_ms: 1_300_000 }] });
    expect(s.partners).toEqual([{ athlete_id: 'a2', name: 'Bia', count: 1 }]);
  });
  it('empty history', () => {
    expect(computeAthleteStats('zz', [])).toMatchObject({ participations: 0, completion_rate: null, best_overall_pos: null, avg_percentile: null, evolution: null, records: [] });
  });
});
```

- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS. **Step 5: Commit** (`feat(domain): athlete statistics`).

---

## Task 13: Synced clock and offline outbox

**Files:**
- Create: `src/lib/clock.ts`, `src/lib/clock.test.ts`, `src/lib/outbox.ts`, `src/lib/outbox.test.ts`

**Interfaces:**
- Consumes: `src/lib/storage.ts`, `TkMarkInput`.
- Produces: `ClockSync`, `takeSample`, `ClockState`, `Outbox`, `LocalMark`, `OutboxItem` (see "Libs signatures").

Rules: an RTT < 0 sample is ignored; `offset = server − (t0 + t1)/2` (round to integer ms); the effective offset is the one of the minimum-RTT sample among the last `maxSamples` (default 10); with no samples but an `initial` state, use it (`synced` true, `syncedAt` from state); `now()` = `now() + (offset ?? 0)`; `state()` returns `{offset_ms, rtt_ms, synced_at}` of the effective sample (`synced_at` = injected `now()` when that sample was added). Outbox persists `{items: {[id]: OutboxItem}}` under its key via `writeJSON` after every mutation; corrupted JSON → empty.

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/clock.test.ts
import { describe, it, expect } from 'vitest';
import { ClockSync, takeSample } from './clock';

describe('ClockSync', () => {
  it('falls back to the device clock until synced', () => {
    const c = new ClockSync({ now: () => 1_000 });
    expect(c.synced).toBe(false);
    expect(c.offsetMs).toBeNull();
    expect(c.now()).toBe(1_000);
  });
  it('uses the minimum-RTT sample', () => {
    const c = new ClockSync({ now: () => 10_000 });
    c.addSample({ t0: 1000, t1: 1400, server: 6200 }); // rtt 400 → offset 5000
    c.addSample({ t0: 2000, t1: 2100, server: 7100 }); // rtt 100 → offset 5050
    c.addSample({ t0: 3000, t1: 3300, server: 8000 }); // rtt 300 → offset 4850
    expect(c.offsetMs).toBe(5050);
    expect(c.rttMs).toBe(100);
    expect(c.now()).toBe(15_050);
  });
  it('keeps only the last N samples and ignores negative RTT', () => {
    const c = new ClockSync({ maxSamples: 2, now: () => 0 });
    c.addSample({ t0: 0, t1: 10, server: 105 });
    c.addSample({ t0: 0, t1: 50, server: 225 });
    c.addSample({ t0: 0, t1: 40, server: 320 });
    c.addSample({ t0: 10, t1: 5, server: 999 });
    expect(c.offsetMs).toBe(300);
  });
  it('persists and restores state', () => {
    const c = new ClockSync({ now: () => 5_000 });
    c.addSample({ t0: 1000, t1: 1100, server: 2050 });
    expect(c.state()).toEqual({ offset_ms: 1000, rtt_ms: 100, synced_at: 5000 });
    const d = new ClockSync({ now: () => 9_000, initial: c.state() });
    expect(d.synced).toBe(true);
    expect(d.now()).toBe(10_000);
  });
  it('takeSample brackets the server call', async () => {
    let t = 100;
    const s = await takeSample(async () => { t += 50; return 999; }, () => (t += 10));
    expect(s).toEqual({ t0: 110, t1: 170, server: 999 });
  });
});
```

```ts
// src/lib/outbox.test.ts
import { describe, it, expect } from 'vitest';
import { Outbox } from './outbox';
import { memoryStorage } from './storage';

const base = { ts: '2026-10-11T11:10:00.000Z', device_ts: '2026-10-11T11:10:00.000Z', clock_offset_ms: 0, clock_rtt_ms: 80, entry_id: null, leg_index: null, athlete_id: null, discarded: false };
describe('Outbox', () => {
  it('stores new marks as pending and persists them', () => {
    const s = memoryStorage(); let t = 1;
    new Outbox(s, 'k', () => t++).upsert({ id: 'm1', ...base });
    const again = new Outbox(s, 'k');
    expect(again.get('m1')!.state).toBe('pending');
    expect(again.pendingCount()).toBe(1);
  });
  it('only confirms marks that did not change while in flight', () => {
    const s = memoryStorage(); let t = 1; const o = new Outbox(s, 'k', () => t++);
    o.upsert({ id: 'm1', ...base });
    o.upsert({ id: 'm2', ...base, ts: '2026-10-11T11:11:00.000Z' });
    const batch = o.pending();
    o.markSent(batch);
    const { local_updated_at: _ignored, ...m2 } = batch[1];
    o.upsert({ ...m2, entry_id: 'en1', leg_index: 0 });
    o.applyResult(['m1', 'm2'], []);
    expect(o.get('m1')!.state).toBe('synced');
    expect(o.get('m2')!.state).toBe('pending');
  });
  it('records rejections and re-queues on edit', () => {
    const s = memoryStorage(); let t = 1; const o = new Outbox(s, 'k', () => t++);
    o.upsert({ id: 'm1', ...base });
    o.markSent(o.pending());
    o.applyResult([], [{ id: 'm1', reason: 'Perna inválida' }]);
    expect(o.get('m1')).toMatchObject({ state: 'rejected', reason: 'Perna inválida' });
    expect(o.pendingCount()).toBe(0);
    o.upsert({ id: 'm1', ...base, discarded: true });
    expect(o.get('m1')!.state).toBe('pending');
  });
  it('orders by ts and honors limits', () => {
    const s = memoryStorage(); const o = new Outbox(s, 'k');
    o.upsert({ id: 'late', ...base, ts: '2026-10-11T11:20:00.000Z' });
    o.upsert({ id: 'early', ...base, ts: '2026-10-11T11:00:00.000Z' });
    expect(o.all().map(i => i.mark.id)).toEqual(['early', 'late']);
    expect(o.pending(1).map(m => m.id)).toEqual(['early']);
  });
  it('survives corrupted storage', () => {
    const s = memoryStorage(); s.setItem('k', '{oops');
    expect(new Outbox(s, 'k').all()).toEqual([]);
  });
});
```

- [ ] **Step 2:** run `npx vitest run src/lib` → FAIL. **Step 3:** implement. **Step 4:** run → PASS. **Step 5: Commit** (`feat(lib): synced clock and offline outbox`).

---

## Task 14: XLSX writer/reader, CSV parser, import mapping

**Files:**
- Create: `src/lib/xlsx/writer.ts`, `src/lib/xlsx/writer.test.ts`, `src/lib/xlsx/reader.ts`, `src/lib/xlsx/reader.test.ts`, `src/lib/csv.ts`, `src/lib/csv.test.ts`, `src/lib/importMapping.ts`, `src/lib/importMapping.test.ts`, `scripts/verify-xlsx.py`

**Interfaces:**
- Consumes: `fflate` (`zipSync`, `unzipSync`, `strToU8`, `strFromU8`), `parseDateInput` (Task 1), `ImportRowInput`.
- Produces: `writeXlsx`, `sanitizeSheetName`, `colLetter`, `WorkbookModel`/`SheetModel`/`Cell`/`StyleName` types, `readXlsxFirstSheet`, `parseCsv`, `mapImportRows`.

XLSX writer requirements (SpreadsheetML, no dependencies besides fflate):
- Parts: `[Content_Types].xml` (Defaults for `rels`/`xml`, Overrides for workbook, styles and each `xl/worksheets/sheetN.xml`), `_rels/.rels` (officeDocument → `xl/workbook.xml`), `xl/workbook.xml` (`<sheets>` with `name`, `sheetId`, `r:id`; `<calcPr calcId="191029" fullCalcOnLoad="1"/>`), `xl/_rels/workbook.xml.rels` (sheets `rId1..n`, styles `rId{n+1}`), `xl/styles.xml`, one worksheet per sheet.
- Styles (`cellXfs` index → StyleName): 0 `default`; 1 `header` (bold font, solid fill `FFD9D3C9`, thin bottom border); 2 `title` (bold, size 13); 3 `bold`; 4 `time` (numFmt 164 `hh:mm:ss.0`); 5 `duration` (numFmt 165 `[h]:mm:ss.0`); 6 `int` (numFmtId 1); 7 `decimal1` (numFmt 166 `0.0`). Fonts: Calibri 11. Include the mandatory `gray125` fill at index 1.
- Worksheet: optional frozen header (`<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`), `<cols>` with widths (default 14), `<sheetData>`; header row 1 (unless `headerless`) with style `header`; data rows follow. Cell style = explicit `{v, s}` style, else the column's `style`, else `default`. Strings → `t="inlineStr"` + `<is><t xml:space="preserve">…</t></is>` (XML-escaped, invalid XML control chars removed); numbers → `<v>`; booleans → `t="b"` with `1/0`; `null`/`''`-less `null` → cell omitted; formulas → `<f>` (no leading `=`) plus `<v>` cached result (`t="str"` when the result is a string). Cell refs via `colLetter`.
- `sanitizeSheetName`: replace each of `[]:*?/\` with a space, collapse whitespace, trim, cut to 31 chars, empty → `Planilha`; if already used, append ` (2)`, ` (3)`… (cutting the base so the total stays ≤ 31); adds the result to `used`.

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/xlsx/writer.test.ts
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { writeXlsx, sanitizeSheetName, colLetter, type WorkbookModel } from './writer';

export const sampleModel: WorkbookModel = { sheets: [
  { name: 'Tempos – Corrida 5K', freezeHeader: true,
    columns: [{ header: 'Nº' }, { header: 'Atleta', width: 30 }, { header: 'Largada', style: 'time' }, { header: 'Chegada', style: 'time' }, { header: 'Tempo', style: 'duration' }],
    rows: [['101', 'Ana & Bia <3>', 46306.4583, 46306.4722, { formula: 'D2-C2', result: 0.0139 }], [null, true, 1, 2, { v: 'Total', s: 'bold' }]] },
  { name: 'Tempos – Corrida 5K', columns: [{ header: 'x' }], rows: [] },
] };

describe('writeXlsx', () => {
  const files = unzipSync(writeXlsx(sampleModel));
  it('contains the package parts', () => {
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']));
  });
  it('names sheets uniquely and recalculates on load', () => {
    const wb = strFromU8(files['xl/workbook.xml']);
    expect(wb).toContain('name="Tempos – Corrida 5K"');
    expect(wb).toContain('name="Tempos – Corrida 5K (2)"');
    expect(wb).toContain('fullCalcOnLoad="1"');
  });
  it('writes escaped strings, numbers, booleans, formulas; omits nulls; freezes header', () => {
    const s = strFromU8(files['xl/worksheets/sheet1.xml']);
    expect(s).toContain('<t xml:space="preserve">Ana &amp; Bia &lt;3&gt;</t>');
    expect(s).toMatch(/<c r="C2" s="\d+"><v>46306.4583<\/v><\/c>/);
    expect(s).toContain('<f>D2-C2</f><v>0.0139</v>');
    expect(s).toMatch(/<c r="B3"[^>]*t="b"[^>]*><v>1<\/v><\/c>/);
    expect(s).toContain('state="frozen"');
    expect(s).not.toContain('r="A3"');
  });
});
describe('helpers', () => {
  it('sanitizes sheet names', () => {
    const used = new Set<string>();
    expect(sanitizeSheetName('Tempos: A/B [x]', used)).toBe('Tempos A B x');
    expect(sanitizeSheetName('', used)).toBe('Planilha');
    const long = sanitizeSheetName('Classificação – Triathlon Olímpico Revezamento', used);
    expect(long.length).toBeLessThanOrEqual(31);
    expect(sanitizeSheetName('Classificação – Triathlon Olímpico Revezamento', used).endsWith(' (2)')).toBe(true);
  });
  it('column letters', () => {
    expect([0, 25, 26, 701, 702].map(colLetter)).toEqual(['A', 'Z', 'AA', 'ZZ', 'AAA']);
  });
});
```

```ts
// src/lib/xlsx/reader.test.ts
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { readXlsxFirstSheet } from './reader';
import { writeXlsx } from './writer';
import { sampleModel } from './writer.test';

describe('readXlsxFirstSheet', () => {
  it('roundtrips our own files', () => {
    const rows = readXlsxFirstSheet(writeXlsx(sampleModel));
    expect(rows[0]).toEqual(['Nº', 'Atleta', 'Largada', 'Chegada', 'Tempo']);
    expect(rows[1].slice(0, 3)).toEqual(['101', 'Ana & Bia <3>', '46306.4583']);
    expect(rows[2][0]).toBe('');
  });
  it('reads Excel files with shared strings and gaps', () => {
    const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const zip = zipSync({
      'xl/workbook.xml': strToU8(`<workbook ${ns}><sheets><sheet name="Inscritos" sheetId="1" r:id="rId1"/></sheets></workbook>`),
      'xl/_rels/workbook.xml.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
      'xl/sharedStrings.xml': strToU8(`<sst ${ns}><si><t>Nome</t></si><si><r><t>Ana </t></r><r><t>Souza</t></r></si><si><t>Sexo</t></si></sst>`),
      'xl/worksheets/sheet1.xml': strToU8(`<worksheet ${ns}><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>2</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="C2" t="inlineStr"><is><t>F</t></is></c></row></sheetData></worksheet>`),
    });
    expect(readXlsxFirstSheet(zip)).toEqual([['Nome', '', 'Sexo'], ['Ana Souza', '', 'F']]);
  });
});
```

```ts
// src/lib/csv.test.ts
import { describe, it, expect } from 'vitest';
import { parseCsv } from './csv';
describe('parseCsv', () => {
  it('handles BOM, semicolons, escaped quotes and CRLF', () => {
    const text = '﻿Nome;Sexo;Nascimento\r\n"Souza; Ana";F;15/06/1990\r\n"Beto ""Rápido""";M;\r\n';
    expect(parseCsv(text)).toEqual([['Nome', 'Sexo', 'Nascimento'], ['Souza; Ana', 'F', '15/06/1990'], ['Beto "Rápido"', 'M', '']]);
  });
  it('handles commas, tabs and newlines inside quotes', () => {
    expect(parseCsv('a,b\n"x\ny",2\n')).toEqual([['a', 'b'], ['x\ny', '2']]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });
});
```

```ts
// src/lib/importMapping.test.ts  (Review Focus 3)
import { describe, it, expect } from 'vitest';
import { mapImportRows } from './importMapping';
describe('mapImportRows', () => {
  it('maps Brazilian headers and values, reporting bad rows by spreadsheet row number', () => {
    const table = [
      ['Nome Completo', 'Gênero', 'Data de Nascimento', 'E-mail', 'Celular', 'Cidade', 'Assessoria', 'Prova'],
      ['  Ana   Souza ', 'Feminino', '15/06/1990', 'ANA@X.COM', '27 99999-0000', 'Vitória', 'EBC Team', 'Corrida 5K'],
      ['Beto', 'masc', '33039', '', '', '', '', ''],
      ['', 'F', '', '', '', '', '', ''],
      ['Caio', 'X', '', '', '', '', '', ''],
      ['Dani', 'fem', '31/02/1990', '', '', '', '', ''],
      ['', '', '', '', '', '', '', ''],
    ];
    const r = mapImportRows(table);
    expect(r.rows).toEqual([
      { name: 'Ana Souza', sex: 'F', birth_date: '1990-06-15', email: 'ana@x.com', phone: '27 99999-0000', city: 'Vitória', team_club: 'EBC Team', race_name: 'Corrida 5K' },
      { name: 'Beto', sex: 'M', birth_date: '1990-06-15', email: null, phone: null, city: null, team_club: null, race_name: null },
    ]);
    expect(r.errors).toEqual([
      { row: 4, message: 'Nome vazio' },
      { row: 5, message: 'Sexo inválido: "X"' },
      { row: 6, message: 'Data de nascimento inválida: "31/02/1990"' },
    ]);
  });
  it('requires name and sex columns', () => {
    expect(mapImportRows([['Atleta', 'Cidade'], ['Ana', 'X']]).errors).toEqual([{ row: 1, message: 'Coluna obrigatória não encontrada: Sexo' }]);
  });
});
```

Import mapping rules: header row = first row with any non-empty cell; header normalization = lowercase, strip accents (`normalize('NFD').replace(/\p{Diacritic}/gu, '')`), trim, collapse spaces. Synonyms — name: `nome, nome completo, atleta, name`; sex: `sexo, genero, sex`; birth_date: `nascimento, data de nascimento, data nascimento, dt nascimento, data de nasc, birth_date`; email: `email, e-mail, e mail`; phone: `telefone, celular, whatsapp, fone, phone`; city: `cidade, city`; team_club: `equipe, assessoria, clube, time, team`; race_name: `prova, race`. Sex values (normalized): `m, masc, masculino, homem, male` → M; `f, fem, feminino, mulher, female` → F. Birth date: `parseDateInput`, or an integer 1..60000 as an Excel serial (days after 1899-12-30); empty → null. Skip rows whose cells are all empty. Row numbers are 1-based positions in the table.

- [ ] **Step 2:** run → FAIL. **Step 3:** implement `writer.ts`, `reader.ts` (DOMParser; match elements by `localName` so namespaces don't matter; resolve the first `<sheet>` through the workbook rels; read `sharedStrings.xml` when present, joining every `<t>` inside each `<si>`; types `s`, `inlineStr`, `str`, `b`, default numeric raw text; return a rectangular `string[][]` sized by the max row/column), `csv.ts` (delimiter = the most frequent of `;`, `,`, `\t` in the first line outside quotes; default `,`), `importMapping.ts`. **Step 4:** run → PASS.

- [ ] **Step 5: `scripts/verify-xlsx.py`** (used by Tasks 15 and 28):

```python
#!/usr/bin/env python3
import sys
from openpyxl import load_workbook
wb = load_workbook(sys.argv[1])
for ws in wb.worksheets:
    print(f"== {ws.title} ({ws.max_row}x{ws.max_column})")
    for row in ws.iter_rows(min_row=1, max_row=min(ws.max_row, 3), values_only=True):
        print("   ", row)
print("OK", len(wb.worksheets), "sheets")
```

Add to `writer.test.ts` a test that writes `sampleModel` to a temp file with `node:fs` and runs `python3 scripts/verify-xlsx.py <file>` via `execSync`, asserting the output contains `OK 2 sheets`.

- [ ] **Step 6: Commit** (`feat(lib): XLSX writer/reader, CSV parser and import mapping`).

---

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

## Task 16: UI kit, layout, theme and test utilities

**Files:**
- Create: `src/components/ui/Button.tsx`, `Field.tsx` (Input, Select, Textarea, Checkbox wrappers with label/hint/error), `Modal.tsx`, `Confirm.tsx` (`ConfirmProvider`, `useConfirm`), `Tabs.tsx`, `Badge.tsx`, `Card.tsx`, `Table.tsx`, `Toast.tsx` (`ToastProvider`, `useToast`), `Spinner.tsx`, `EmptyState.tsx`, `src/components/ui/index.ts`, `src/components/Layout.tsx`, `src/components/Logo.tsx`, `src/components/ThemeToggle.tsx`, `src/components/QrCode.tsx`, `src/components/LineChart.tsx`, `src/hooks/useNow.ts`, `src/test/renderWithProviders.tsx`, `src/components/ui/ui.test.tsx`

**Interfaces:**
- Produces:
  - `Button` props: `variant?: 'primary'|'secondary'|'ghost'|'danger'`, `size?: 'sm'|'md'|'lg'|'xl'`, `loading?: boolean`, plus all `button` props (incl. `data-testid`).
  - `Input`, `Select`, `Textarea`, `Checkbox`: `label`, `hint?`, `error?` + native props; `Select` takes `options: {value: string; label: string}[]`.
  - `Modal({ open, onClose, title, children, footer?, size?: 'md'|'lg'|'xl' })` — `role="dialog"`, `aria-modal`, Esc closes, click on backdrop closes.
  - `useConfirm(): (opts: { title: string; message?: ReactNode; confirmLabel?: string; danger?: boolean }) => Promise<boolean>` — buttons `data-testid="confirm-ok"` / `"confirm-cancel"`.
  - `Tabs({ items: {id: string; label: string; to: string; badge?: ReactNode}[] })` rendering `NavLink`s with `data-testid="tab-<id>"`.
  - `Badge({ tone?: 'neutral'|'success'|'warning'|'danger'|'info', children })`, `Card`, `Table` (wrapper with horizontal scroll, sticky header), `Spinner`, `EmptyState({ title, children? })`.
  - `useToast(): { show(t: { message: ReactNode; tone?: 'neutral'|'success'|'warning'|'danger'; actions?: {label: string; onClick(): void; testid?: string}[]; testid?: string; durationMs?: number }): string; dismiss(id: string): void }` — default 5 s.
  - `Layout` (header: `Logo` + `ENDURANCE BASE CLUB` in `brand-title`, nav links Eventos `/eventos`, Atletas `/atletas`, Ajuda `/ajuda`, Configurações `/config`, `ThemeToggle`, logout button `data-testid="logout"` calling an `onLogout` prop; renders `<Outlet/>`; nav collapses into a horizontally scrollable row on mobile).
  - `ThemeToggle` toggles `document.documentElement.dataset.theme` between `dark`/`light` and stores `ebc.theme` via `safeLocalStorage`.
  - `QrCode({ value, size?, testid? })` → `<img>` from `QRCode.toDataURL(value, { margin: 1, width: size })`.
  - `LineChart({ points: {label: string; value: number; tooltip?: string}[]; formatValue(v: number): string; title: string; height?: number })` — accessible SVG line chart (**before writing it, load the `dataviz` skill and follow it**; use `--fg`/`--muted` tokens so it works in both themes; lower values are better for times, so annotate "menor é melhor").
  - `useNow(intervalMs = 1000): number`.
  - `renderWithProviders(ui, { route = '/', path = '*' } = {})` → wraps `QueryClientProvider` (retry false), `ToastProvider`, `ConfirmProvider`, and a `createMemoryRouter` with the given path/route; returns Testing Library's result plus `router`.
- Visual rules: use tokens (`bg-bg`, `text-fg`, `bg-surface`, `border-border`, `text-muted`, `bg-accent text-accent-fg`), rounded-xl, generous padding, min touch target 44 px, focus rings visible, `tabular` class on numbers.

- [ ] **Step 1: Write failing `src/components/ui/ui.test.tsx`**: Button renders children and calls `onClick`, shows a spinner and is disabled when `loading`; `useConfirm` resolves `true` on `confirm-ok` and `false` on `confirm-cancel`; `Modal` calls `onClose` on Escape; `ThemeToggle` flips `data-theme` and writes `ebc.theme`; `useToast().show` renders the message and an action button that fires its handler.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS; `npm run typecheck` clean. **Step 5: Commit** (`feat(ui): design system components, layout and test utilities`).

---

## Task 17: App shell — API client, session/auth, router, event data context

**Files:**
- Create: `src/lib/supabase.ts`, `src/lib/api.ts`, `src/lib/api.test.ts`, `src/hooks/useClock.ts`, `src/hooks/useEventData.ts`, `src/features/events/EventContext.tsx`, `src/features/events/EventLayout.tsx`, `src/features/auth/session.tsx`, `src/features/auth/LoginPage.tsx`, `src/features/auth/ChangePasswordPage.tsx`, `src/features/auth/RequireOrganizer.tsx`, `src/features/auth/auth.test.tsx`, `src/features/NotFound.tsx`
- Create stubs (each `export default function X() { return <h1 className="p-6 brand-title">X</h1>; }`, to be replaced by later tasks): `src/features/events/EventsPage.tsx`, `src/features/events/EventGeneralTab.tsx`, `src/features/settings/SettingsPage.tsx`, `src/features/help/HelpPage.tsx`, `src/features/races/RacesTab.tsx`, `src/features/entries/EntriesTab.tsx`, `src/features/athletes/AthletesPage.tsx`, `src/features/athletes/AthleteProfilePage.tsx`, `src/features/timing/TimingTab.tsx`, `src/features/review/ReviewTab.tsx`, `src/features/results/ResultsTab.tsx`, `src/features/timekeeper/TimekeeperPage.tsx`, `src/features/public/PublicHome.tsx`, `src/features/public/PublicEventPage.tsx`, `src/features/public/PublicAthletePage.tsx`
- Modify: `src/App.tsx` (replace), `src/main.tsx` (providers)

**Interfaces:**
- Consumes: Tasks 1, 9–11, 13, 16.
- Produces:
  - `supabase` client (`persistSession: true`, `autoRefreshToken: true`, `detectSessionInUrl: false`, `storageKey: 'ebc.auth'`).
  - `api` + `ApiError` exactly as in "Libs signatures"; network failures (`TypeError`/fetch errors) → `new ApiError('Sem conexão com o servidor', 'network')`.
  - `useClock(): ClockSync` — module-level singleton; on first use restores `ebc.clock` state, takes 5 samples 300 ms apart via `api.serverTime`, then one every 20 s and on `visibilitychange` → visible; persists state after each sample.
  - `SessionProvider`, `useSession(): { status: 'loading'|'anon'|'organizer'|'forbidden'; me: AdminMe | null; signIn(email, password): Promise<void>; signOut(): Promise<void>; changePassword(pw: string): Promise<void>; refreshMe(): Promise<void> }` — `signIn` maps Supabase `Invalid login credentials` to `ApiError('E-mail ou senha incorretos')`; after sign-in or session restore calls `api.admin.me()`; `42501` → `forbidden` + sign out; `changePassword` = `supabase.auth.updateUser({password})` then `api.admin.passwordChanged()` then `refreshMe()`.
  - `RequireOrganizer` (wraps admin routes): loading → `Spinner`; anon → `<Navigate to="/entrar" state={{ from }}>`; forbidden → message "Esta conta não tem acesso de organização" + logout; `me.must_change_password` → `<Navigate to="/trocar-senha">`.
  - `useEventData(eventId: string, opts: { live: boolean })` → `{ agg: EventAggregate | undefined; isLoading; error; refresh(): Promise<void>; patchAgg(fn: (a: EventAggregate) => EventAggregate): void }`: TanStack query key `['event', eventId]` for `api.admin.getEvent`; a polling effect (2 s when `live`, 15 s otherwise, paused while `document.hidden`) calls `api.admin.live(eventId, since)` with `since = lastServerNow − 10 s`, merges marks with `mergeById`, replaces resolutions and waves, and calls `refresh()` when `delta.version !== agg.version`.
  - `EventContext` value (via `useEventContext()`): `{ eventId, agg, index: EventIndex, timing: EventTiming, classifications: Map<string, RaceClassification>, nowMs, refresh, patchAgg, clock: ClockSync }` — `timing`/`classifications` memoized on `agg` (+ a 10 s `useNow` tick for time-dependent issues).
  - `EventLayout`: loads `useEventData(eventId, { live: tab in ['cronometragem','revisao','resultados'] })`, shows event name/date/status + `Tabs` (`geral` Geral, `provas` Provas, `inscricoes` Inscrições, `cronometragem` Cronometragem, `revisao` Revisão (badge with error+warning count), `resultados` Resultados) and provides `EventContext` to `<Outlet/>`; loading/error states.
  - Routes (`createHashRouter`): `/` → organizer ? `<Navigate to="/eventos">` : `PublicHome`; `/entrar` `LoginPage`; `/trocar-senha` `ChangePasswordPage`; admin group (`RequireOrganizer` + `Layout`): `/eventos` `EventsPage`, `/eventos/:eventId` `EventLayout` (index → `geral`; `geral`, `provas`, `inscricoes`, `cronometragem`, `revisao`, `resultados`), `/atletas` `AthletesPage`, `/atletas/:athleteId` `AthleteProfilePage`, `/ajuda` `HelpPage`, `/config` `SettingsPage`; `/c/:token` `TimekeeperPage`; `/p/:slug` `PublicEventPage`; `/atleta/:athleteId` `PublicAthletePage`; `*` `NotFound`. `main.tsx` providers: `QueryClientProvider` (staleTime 5 s), `SessionProvider`, `ToastProvider`, `ConfirmProvider`, `RouterProvider`.
  - `LoginPage` (logo, testids `login-email`, `login-password`, `login-submit`, error text) and `ChangePasswordPage` (`newpass-1`, `newpass-2`, `newpass-submit`; ≥ 8 chars and equal, messages "A senha precisa ter pelo menos 8 caracteres" / "As senhas não conferem").

- [ ] **Step 1: Write failing tests.** `api.test.ts`: `vi.mock('./supabase', () => ({ supabase: { rpc: vi.fn() } }))`; assert `api.admin.saveEvent(e)` → `rpc('admin_save_event', { p_event: e })`; `api.tk.sync('t','k','s',[m],null)` → `rpc('tk_sync', { p_token:'t', p_timekeeper_id:'k', p_secret:'s', p_marks:[m], p_since:null })`; `api.pub.live('slug','2026-…')` → `rpc('pub_live', { p_slug:'slug', p_since:'2026-…' })`; `api.admin.setResolution('e',1,'manual',null,'2026-…','x')` → the six `p_` params; an `{error:{message:'Falhou',code:'P0001'}}` result throws `ApiError` with that message and code; a rejected promise with `TypeError('Failed to fetch')` throws `ApiError('Sem conexão com o servidor','network')`. `auth.test.tsx` (with a mocked `useSession` context): LoginPage submits credentials and navigates to `/eventos`; shows "E-mail ou senha incorretos" on failure; `RequireOrganizer` redirects anon to `/entrar` and `must_change_password` to `/trocar-senha`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS; `npm run typecheck`; `npm run build`. **Step 5: Commit** (`feat(app): API client, session, router and event data context`).

---

## Task 18: Events dashboard, event general tab, settings, help

**Files:**
- Modify (replace stubs): `src/features/events/EventsPage.tsx`, `src/features/events/EventGeneralTab.tsx`, `src/features/settings/SettingsPage.tsx`, `src/features/help/HelpPage.tsx`
- Create: `src/features/events/events.test.tsx`

**Interfaces:**
- Consumes: `api.admin.listEvents/saveEvent/deleteEvent/duplicateEvent/listOrganizers/createOrganizer/deleteOrganizer`, `useEventContext`, `useSession`, UI kit.

Behavior:
- `EventsPage`: cards (name, `formatDateBR`, location, status badge, provas/inscrições counts) sorted by date desc; "Novo evento" (`new-event`) opens a modal with name (`event-name`), date (`event-date`, `type=date`), location (`event-location`), levels (`event-levels`, comma-separated text → trimmed unique list; hint "Ex.: Elite, Base") → `saveEvent` → navigate to `/eventos/:id/provas`. Card menu: Duplicar (asks new name/date → `duplicateEvent` → navigate), Excluir (confirm danger → `deleteEvent`).
- `EventGeneralTab`: edit name/date/location/description/levels/status (select Planejado/Ao vivo/Encerrado); public section: checkbox `event-public` "Resultados públicos", slug input with preview link `…/#/p/<slug>` and copy button; save `event-save` → `saveEvent` → `refresh()`; danger zone delete.
- `SettingsPage`: "Minha conta" (name/email/role, change password form reusing `useSession().changePassword`); "Organizadores" list; owner sees "Adicionar organizador" (email, name, temporary password generator button producing 12 random chars) → `createOrganizer` → shows the credentials once with a copy button; remove (confirm) → `deleteOrganizer`.
- `HelpPage`: static pt-BR guide with sections: Antes do evento (criar evento → provas/pernas/ondas → atletas/importação → inscrições → testar o link do cronometrista no local; reativar o Supabase se ficou 7 dias parado), Durante (Largar agora; cronometristas tocam MARCAR e informam o nº; revezamento automático; acompanhar Revisão), Depois (resolver pendências, finalizar provas, exportar planilha, desativar link), Como o tempo oficial é escolhido (mediana, divergência, escolher marcação ou tempo manual — include the 10:00:05/10:00:06/10:00:19 example).

- [ ] **Step 1: Failing `events.test.tsx`** (mock `api`): creating an event calls `saveEvent` with `{name, date, location, levels: ['Elite','Base']}` from input `"Elite, Base, Elite"` and navigates to the provas tab; duplicate calls `duplicateEvent`; settings shows "Adicionar organizador" only for owners.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS + typecheck. **Step 5: Commit** (`feat(events): events dashboard, general tab, settings and help`).

---

## Task 19: Races tab — race editor (legs, waves, categories, podium, timing rules)

**Files:**
- Modify: `src/features/races/RacesTab.tsx`
- Create: `src/features/races/RaceEditor.tsx`, `src/features/races/LegsEditor.tsx`, `src/features/races/AgeGroupsEditor.tsx`, `src/features/races/RankingsEditor.tsx`, `src/features/races/raceForm.ts`, `src/features/races/raceForm.test.ts`, `src/features/races/races.test.tsx`

**Interfaces:**
- Consumes: `useEventContext`, `api.admin.saveRace/deleteRace`, `RACE_PRESETS`, `defaultRaceConfig`, `normalizeRaceConfig`, `generateAgeGroups`, `validateAgeGroups`, `MODALITY_LABEL`.
- Produces: `raceForm.ts` pure helpers: `raceToForm(race: RaceRow, waves: WaveRow[]): RaceForm`, `presetToForm(preset: RacePreset, eventId: string): RaceForm`, `validateRaceForm(f: RaceForm): string[]`, `formToPayload(f: RaceForm)` (matching `api.admin.saveRace`), where `RaceForm = { id?: string; event_id: string; name: string; position: number; team_size: number; legs: { modality: Modality; label: string; distance: string; unit: 'm'|'km' }[]; waves: { id?: string; name: string; position: number; start_at: string | null }[]; config: RaceConfig }` (distance typed as text so users can type `2,5`; `formToPayload` converts to meters: `km` → ×1000, comma decimal accepted; `other` legs may have empty distance → `null`).

Behavior:
- `RacesTab`: list of races (name, team size label "Individual/Dupla/Trio/Equipe de N", legs summary "Natação 750 m → Corrida 5 km", inscrições count, finalizada badge); "Nova prova" (`new-race`) → preset picker (`race-preset`, a `Select` of `RACE_PRESETS` names) → editor prefilled; edit/delete (confirm; server errors shown via toast).
- `RaceEditor` sections: **Dados** (name `race-name`, team size `race-team-size` select 1..6 with labels; changing team size resets config defaults for rankings/age groups only if the user confirms); **Pernas** (`LegsEditor`: ordered rows with modality select, label, distance + unit, move up/down, remove, add `leg-add`; at least one leg); **Largadas** (list of waves with name, add `wave-add`, remove; start time is set in Cronometragem, show it read-only); **Categorias** (age rule radio: "Idade em 31/12 do ano da prova" / "Idade na data da prova"; team age rule for teams: Soma/Mais velho/Mais novo; `AgeGroupsEditor` with rows label/min/max, generator "de X em X anos a partir de Y até Z" using `generateAgeGroups`, validation messages from `validateAgeGroups`); **Pódio** (`RankingsEditor`: rows with name, dimension checkboxes Sexo/Faixa etária/Nível (Nível disabled when the event has no levels), size 1..10, move up/down, remove, add; checkbox "Premiação cumulativa" with help text explaining non-cumulative); **Cronometragem** (same-crossing window seconds, divergence threshold seconds, time source radio "Mediana (recomendado)" / "Cronometrista de referência" + select from `agg.timekeepers`). Save `race-save` → `formToPayload` → `api.admin.saveRace` → `refresh()` → toast "Prova salva". Show server validation errors inline in a banner.

- [ ] **Step 1: Failing tests.** `raceForm.test.ts`: `presetToForm(triathlon-sprint)` → legs `[{swim,'750','m'},{bike,'20','km'},{run,'5','km'}]` (display km when divisible by 1000 and ≥ 1000); `formToPayload` converts `'2,5' km` → 2500 m and `other` empty → null; `validateRaceForm` reports `Informe o nome da prova`, `Adicione pelo menos uma perna`, `Distância inválida na perna 2`, age group overlap messages, and `O pódio "X" precisa de tamanho entre 1 e 10`. `races.test.tsx` (mock api): creating from the "Revezamento em dupla" preset and saving calls `saveRace` with `team_size 2`, two legs and default team config; moving a leg up reorders legs in the payload.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS + typecheck. **Step 5: Commit** (`feat(races): race editor with legs, waves, categories and podium rules`).

---

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

## Task 22: Timekeeper app (`#/c/:token`) — the critical screen

**Files:**
- Modify: `src/features/timekeeper/TimekeeperPage.tsx`
- Create: `src/features/timekeeper/tkStore.ts`, `src/features/timekeeper/tkStore.test.ts`, `src/features/timekeeper/useTimekeeper.ts`, `src/features/timekeeper/timekeeper.test.tsx`

**Interfaces:**
- Consumes: `api.tk.*`, `api.serverTime`, `ClockSync`/`takeSample`, `Outbox`, `safeLocalStorage`/`readJSON`/`writeJSON`, `suggestLeg`, `computeEntryTiming`, `resolveBib`, `indexEvent`, `entryDisplayName`, `mergeById`, `formatClock`, `formatDuration`, `MODALITY_LABEL`, UI kit (`useToast`).
- Produces (`tkStore.ts`, pure and unit-tested):
  - `localToMarkRow(m: LocalMark, eventId: string, timekeeperId: string): MarkRow` (`discarded_by` = `'timekeeper'` when discarded, `created_at` = ts, `updated_at` = ISO of `local_updated_at`).
  - `mergedMarks(server: MarkRow[], local: OutboxItem[], eventId, timekeeperId): MarkRow[]` — server marks plus local ones; a local item that is `pending` overrides the server copy.
  - `newMark(nowMs: number, deviceNowMs: number, clock: ClockState | null): TkMarkInput` (`id` via `crypto.randomUUID()`).
  - `assignMark(mark: TkMarkInput, entry: EntryRow, race: RaceRow, allMarks: MarkRow[], athleteId?: string | null): { mark: TkMarkInput; suggestion: LegSuggestion }` (uses `suggestLeg` with `allMarks` excluding the mark itself).
  - `onCourse(session: TkSession, marks: MarkRow[], nowMs: number): { entry: EntryRow; race: RaceRow; timing: EntryTiming; legLabel: string; athleteName: string; legElapsedMs: number }[]` — entries whose timing status is `on_course` (wave started), sorted by `legElapsedMs` desc.
  - `assignmentMessage(entry, race, suggestion, athleteName): string` → `✓ Nº 101 · Matheus · fim da Corrida (2/2)`; with `warning 'already_finished'` → `Nº 101 já concluiu — registrada como fim da Corrida (2/2)`.

`useTimekeeper(token)` responsibilities (spec §7): cached session `ebc.tk.session.<token>`; registration `ebc.tk.reg.<token>` = `{timekeeper_id, secret, name}`; server marks cache `ebc.tk.marks.<eventId>`; outbox key `ebc.tk.<eventId>.<timekeeperId>`; phases `loading | invalid | register | main | disabled`; `tk.open` failure with a non-network ApiError → `invalid`; network failure with cache → `main` offline; clock sync via `takeSample(api.serverTime)` (5 samples at start, every 20 s, on `visibilitychange`); sync loop every 2 s (backoff ×2 up to 10 s on network errors) sending `outbox.pending(200)` with `since = lastServerNow − 10 s`, applying `accepted/rejected`, merging returned marks, updating wave `start_at`s, re-opening the session when `version` changes; `Cronometrista não autorizado` → drop registration → `register`; `Seu acesso foi desativado…` → `disabled`. Actions: `mark(bibText?)`, `assign(markId, entryId, athleteId?)`, `changeLeg(markId, legIndex)`, `unassign(markId)`, `discard(markId)`; state: `online`, `pendingCount`, `clockQuality` (ms or null), `unassigned` (my non-discarded marks without entry, oldest first), `myMarks`, `onCourse`, `session`.

UI (`TimekeeperPage`, mobile-first, no admin `Layout`):
- `register`: logo, event name/date, name input `tk-name`, button `tk-register` "Começar a cronometrar".
- `main`: sticky header with event name, `tk-sync-status` ("Online · tudo sincronizado" / "Sincronizando N…" / "Sem internet · N marcações guardadas no aparelho"), theme toggle; big clock `tk-clock` (`formatClock(clock.now(), {tenths:true})`, refreshed every 100 ms) with quality `±0,05 s` or warning "Relógio não sincronizado"; bib input `bib-input` (`inputMode="numeric"`, large) + `bib-submit`; **MARCAR** button `mark-button` (≥ 35 vh tall, full width, vibrate 50 ms).
  - MARCAR with a bib typed → mark + assign (errors from `resolveBib` shown as toast; the mark stays in "Sem atleta"); without bib → unassigned mark, selected.
  - `bib-submit`: assigns the selected unassigned mark (or the oldest one) to the bib; with none → toast "Toque em MARCAR primeiro".
  - "Sem atleta" list `unassigned-list` (select on tap, discard ×).
  - "Em prova" list `oncourse-list`: search box, race filter chips, rows (`Nº`, name/team, current athlete and leg label, running leg timer); tapping a row assigns the selected mark, or — if none is selected — creates a mark now and assigns it (arrival tap).
  - Assignment toast `assign-toast` with actions `toast-undo` ("Desfazer" → unassign) and "Trocar perna" (sheet listing legs).
  - "Minhas marcações" `my-marks` (collapsible: time, Nº, leg, state icon, discard/reassign).
  - Wake lock: request `navigator.wakeLock.request('screen')` in `main` phase when visible; ignore failures.
- `invalid`: "Link de cronometragem inválido ou desativado. Peça um novo link à organização." `disabled`: "Seu acesso foi desativado pela organização."

- [ ] **Step 1: Failing `tkStore.test.ts`** using domain fixtures: `mergedMarks` prefers a pending local edit over the server copy and keeps synced server marks; `assignMark` on a relay entry with a `athleteId` of the second member returns `leg_index 1`; `onCourse` lists a relay whose leg 0 was marked, with `athleteName` of the second member and `legElapsedMs = now − leg0`; `assignmentMessage` produces both message forms; `newMark` stamps `ts = nowMs` ISO and `clock_offset_ms`.
- [ ] **Step 2: Failing `timekeeper.test.tsx`** (mock `api.tk.open` → session fixture, `api.tk.register`, `api.tk.sync` → `{accepted: ids, rejected: [], marks: [], waves: [], version: 1, server_now}`, `api.serverTime`): register flow shows the main screen; clicking `mark-button` adds a row to `unassigned-list`; typing `101` + `bib-submit` shows `assign-toast` containing `Nº 101`; clicking `toast-undo` returns the mark to `unassigned-list`; after the sync interval (fake timers) `tk-sync-status` shows "tudo sincronizado"; when `api.tk.sync` rejects with a network ApiError, status shows "Sem internet".
- [ ] **Step 3:** FAIL. **Step 4:** implement. **Step 5:** PASS + typecheck. **Step 6: Commit** (`feat(timekeeper): offline-first timekeeper app with synced clock`).

---

## Task 23: Timing tab — link/QR, timekeepers, starts, live board

**Files:**
- Modify: `src/features/timing/TimingTab.tsx`
- Create: `src/features/timing/TimekeepersPanel.tsx`, `src/features/timing/WavesPanel.tsx`, `src/features/timing/LiveBoard.tsx`, `src/features/timing/timing.test.tsx`

**Interfaces:**
- Consumes: `useEventContext` (`agg`, `index`, `timing`, `clock`, `refresh`, `patchAgg`), `api.admin.saveEvent/rotateTkToken/updateTimekeeper/setWaveStart/updateMark`, `QrCode`, `suggestLeg`, `resolveBib`, `formatClock`, `parseClockInput`, `formatDuration`, `useNow`, `useConfirm`, `useToast`.

Behavior:
- **Link dos cronometristas**: URL `${location.origin}${location.pathname}#/c/${event.tk_token}` shown in `tk-link` (read-only input), copy `tk-copy` (clipboard + toast), share (Web Share API when available, WhatsApp link fallback `https://wa.me/?text=…`), QR `tk-qr`, toggle "Link ativo" (`saveEvent({ ...event, tk_enabled })`), "Gerar novo link" (confirm → `rotateTkToken`).
- **Cronometristas**: table (nome, última atividade relative "há 12 s", marcações, ativo toggle → `updateTimekeeper`), note which one is the reference per race (from race configs).
- **Largadas** (`WavesPanel`): per race and wave: status (horário `formatClock(…, {tenths:true})` or "Não largou"), **Largar agora** `wave-start` → `useConfirm` ("Largar <prova> – <onda> agora?") → `setWaveStart(wave.id, new Date(clock.now()).toISOString())` → `patchAgg` + `refresh`; edit time: input `wave-time-input` (`hh:mm:ss.d`) → `parseClockInput(text, event.date)`; clear (confirm).
- **Ao vivo** (`LiveBoard`, `live-board`): counters (em prova, concluídos, não largaram, pendências with link to `revisao`); per race the on-course entries with current athlete, leg label and running leg timer (`useNow(500)`); recent 30 marks feed (hora, cronometrista, Nº, perna, situação); "Sem atleta" list with an inline bib input per mark → `resolveBib` → `suggestLeg` → `updateMark(id, {entry_id, leg_index})` → `refresh`.

- [ ] **Step 1: Failing `timing.test.tsx`** (mock context/api): `wave-start` + `confirm-ok` calls `setWaveStart(waveId, <ISO equal to clock.now()>)` using a fake clock; typing `08:00:05.3` in `wave-time-input` and saving calls `setWaveStart` with `2026-10-11T11:00:05.300Z` for event date `2026-10-11`; assigning an unassigned mark to bib `101` calls `updateMark(id, {entry_id: 'en1', leg_index: 0})`; `tk-link` contains `#/c/<token>`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS + typecheck. **Step 5: Commit** (`feat(timing): timekeeper link, starts and live board`).

---

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

## Task 26: Public pages — events, live results, athlete profile

**Files:**
- Modify: `src/features/public/PublicHome.tsx`, `src/features/public/PublicEventPage.tsx`, `src/features/public/PublicAthletePage.tsx`
- Create: `src/features/public/public.test.tsx`

**Interfaces:**
- Consumes: `api.pub.*`, `computeEventTiming`, `classifyRace`, `indexEvent`, `mergeById`, `ClassificationTable`, `PodiumView` (Task 25), `StatsView` (Task 20), `Logo`, `ThemeToggle`.

Behavior:
- Public shell (no admin nav): logo + "ENDURANCE BASE CLUB", theme toggle, link "Área da organização" → `#/entrar`.
- `PublicHome` (`public-events`): list of public events (date, name, location, status "Ao vivo" highlighted) linking to `#/p/<slug>`.
- `PublicEventPage` (`public-results`): loads `pub.event(slug)`; polls `pub.live(slug, since)` every 10 s while visible (merge like the admin); per race tabs; if the race has finalized `results`, show them ordered by `overall_pos` (from snapshots) with badge "Resultado oficial"; else compute timing/classification client-side with badge "Parcial – ao vivo" and auto-refresh note; podiums; athlete names link to `#/atleta/<id>` when `public_profile`.
- `PublicAthletePage` (`public-athlete`): `pub.athlete(id)` → name/city/team + `StatsView(publicMode)`; not found message.
- `document.title` updated per page (`<Evento> – Resultados`).

- [ ] **Step 1: Failing `public.test.tsx`** (mock api): home lists events with links; event page renders classification rows from a live payload and shows "Resultado oficial" when `results` exist for a race; athlete page renders "Participações".
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS + typecheck. **Step 5: Commit** (`feat(public): public results and athlete profiles`).

---

## Task 27: PWA (offline app shell for timekeepers)

**Files:**
- Modify: `vite.config.ts`, `src/main.tsx`, `src/vite-env.d.ts`

**Interfaces:**
- Consumes: `vite-plugin-pwa`.

- [ ] **Step 1:** Add `VitePWA({ registerType: 'autoUpdate', injectRegister: null, includeAssets: ['favicon.png', 'logo.png', 'icon-192.png'], manifest: { name: 'EnduranceBaseClub', short_name: 'EBC', lang: 'pt-BR', theme_color: '#191513', background_color: '#191513', display: 'standalone', start_url: '/', icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/logo.png', sizes: '150x150', type: 'image/png' }] }, workbox: { globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'], navigateFallback: '/index.html', cleanupOutdatedCaches: true, clientsClaim: true, skipWaiting: true } })` to `vite.config.ts` plugins; in `main.tsx` call `registerSW({ immediate: true })` from `virtual:pwa-register` only when `import.meta.env.PROD`; add `/// <reference types="vite-plugin-pwa/client" />` to `src/vite-env.d.ts`.
- [ ] **Step 2: Verify** `npm run build` → `dist/sw.js` and `dist/manifest.webmanifest` exist; `npx vitest run` still green; `npm run typecheck` clean.
- [ ] **Step 3: Commit** (`feat(pwa): offline app shell for the timekeeper link`).

---

## Task 28: E2E validation with agent-browser (Vercel) against the local stack

**Files:**
- Create: `tests/e2e/run.sh`, `tests/e2e/lib.sh`, `tests/e2e/01_master_setup.sh`, `tests/e2e/02_timing.sh`, `tests/e2e/03_review_results.sh`, `tests/e2e/04_public_offline.sh`, `tests/e2e/artifacts/.gitkeep`, `tests/e2e/README.md`
- Modify: any source file needed to fix defects found (each fix gets its own failing unit test first, per TDD, then a `fix:` commit).

**Interfaces:**
- Consumes: everything; `agent-browser` 0.27 (`npm i -g agent-browser` already done), Chromium at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.

`tests/e2e/lib.sh` essentials:

```bash
export AGENT_BROWSER_EXECUTABLE_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome
export NO_PROXY="127.0.0.1,localhost${NO_PROXY:+,$NO_PROXY}"
APP=${APP:-http://127.0.0.1:4173}
ART=tests/e2e/artifacts
ab() { local s=$1; shift; agent-browser --session "$s" "$@"; }                  # ab master click '[data-testid=x]'
tid() { printf '[data-testid="%s"]' "$1"; }
wait_tid() { ab "$1" wait "$(tid "$2")" >/dev/null; }
expect_text() { local s=$1 sel=$2 want=$3 got; got=$(ab "$s" get text "$sel"); [[ "$got" == *"$want"* ]] || { echo "EXPECT FAIL: '$want' not in $sel: $got"; ab "$s" screenshot "$ART/fail-$(date +%s).png"; exit 1; }; }
snap() { ab "$1" screenshot "$ART/$2.png" >/dev/null; }
step() { echo "--- $*"; }
```

`tests/e2e/run.sh`: `set -euo pipefail`; `export EBC_DB=ebc_e2e SHIM_PORT=54321`; `bash scripts/db-local.sh reset`; seed `select public.bootstrap_owner('master@ebc.local','ebc-dev-12345','Master E2E')` (keeps `must_change_password = true`); start the shim in background (log to `$ART/shim.log`) and wait for `/rest/v1/`; `npx vite build --mode e2e` then `npx vite preview --mode e2e --port 4173 --strictPort &` (log) and wait; run `01..04` in order with `bash`; on exit (`trap`) `agent-browser close --all`, kill background jobs; print `E2E PASS` or the failing script. Scenario scripts share state through `tests/e2e/artifacts/state.env` (e.g. `TK_LINK`, `SLUG`, bibs).

Scenarios (use `data-testid`s from "Test IDs"; use `find text "<label>" click` only for list items without testids):
1. `01_master_setup.sh` — open `$APP/#/entrar`, log in, forced password change to `ebc-dev-67890` (`newpass-*`), create event "Desafio EBC E2E" (today's date, levels `Elite, Base`), enable public results in Geral (`event-public`, `event-save`); Provas: create "Revezamento em dupla (natação + corrida)" preset and "Corrida 5 km" preset; Atletas: create Ana (F, 15/06/1990), Beto (M, 20/01/1988), Caio (M, 03/03/1995), Duda (F, 09/09/1999); Inscrições: team "Tubarões" (Ana → Natação, Beto → Corrida) and bulk entries for Corrida 5 km (Caio, Duda); assert the entries table lists the three bibs; screenshots `01-*.png`.
2. `02_timing.sh` — master: Cronometragem, read `TK_LINK` from `tk-link` (`get value`), start both waves (`wave-start` ×2 + `confirm-ok`); sessions `tk1` and `tk2` open `TK_LINK`, register "Ana TK" / "Bia TK"; tk1 types the team bib and taps `mark-button` → `assign-toast` contains "Natação"; `oncourse-list` then shows the team with "Corrida" (relay handoff); tk2 taps `mark-button` without bib then assigns it via `bib-input` + `bib-submit`; tk1 `set offline on`, marks the team finish, `tk-sync-status` contains "Sem internet", `set offline off`, wait until it contains "sincronizado"; tk1 and tk2 mark Caio's finish; tk1 marks Duda, `wait 4500`, tk2 marks Duda (≥ 4 s divergence); screenshots of the timekeeper screen in light and dark themes.
3. `03_review_results.sh` — master Revisão: `issues-list` contains "divergência"; open it, pick `resolution-mark-*` of Ana TK, `resolution-save`; issue gone; Resultados: select Corrida 5 km (`race-select`), `classification-table` lists Caio and Duda with positions; `podiums` visible; `ab master download "$(tid export-xlsx)" "$ART/planilha.xlsx"` then `python3 scripts/verify-xlsx.py "$ART/planilha.xlsx"` prints `OK`; `finalize-race` + `confirm-ok` → badge "Oficial"; Atletas → Ana profile shows "Pódios".
4. `04_public_offline.sh` — session `pub` opens `$APP/#/p/<slug>` → `public-results` contains "Tubarões"; opens an athlete link → `public-athlete` contains "Participações"; session `tk1`: reload `TK_LINK` with `set offline on` → the page still renders `mark-button` (service worker), then `set offline off`.

- [ ] **Step 1:** write the scripts. **Step 2:** `bash tests/e2e/run.sh` — iterate: for every failure, reproduce, write a failing unit/component test that captures the defect, fix, re-run the unit suite and E2E. **Step 3:** review every screenshot (Read the PNGs) for layout problems at 390×844 (timekeeper: `ab tk1 set viewport 390 844`) and 1280×800 (master); fix visual defects. **Step 4:** final green run of `npm run typecheck && npx vitest run && npm run test:integration && bash scripts/test-sql.sh && bash tests/e2e/run.sh`. **Step 5: Commit** (`test(e2e): agent-browser scenarios for setup, timing, review, results and public pages`).

---

## Task 29: Production — Supabase migrations, owner account, Vercel deploy, smoke test (controller)

Performed by the controller (needs MCP connectors). No new source files except `scripts/deploy-files.mjs` and `docs/DEPLOY.md`.

- [ ] **Step 1: Apply migrations** with `mcp__Supabase__apply_migration` (project `wlishmznbhhcqzncdxnq`) in order: `ebc_0001_schema`, `ebc_0002_internal`, `ebc_0003_admin_events`, `ebc_0004_admin_athletes_entries`, `ebc_0005_timing`, `ebc_0006_public_grants` (file contents verbatim). Verify with `list_migrations` and `list_tables`.
- [ ] **Step 2: Run the SQL test suite on production inside one rolled-back transaction per file**: for each `supabase/tests/1*.sql … 6*.sql`, send via `execute_sql`: `begin;` + contents of `00_helpers.sql` + the test file with its own leading `begin;` and trailing `rollback;` removed + `rollback;`. Expect no error. Then confirm nothing leaked: `select count(*) from public.events` = 0 and `select to_regnamespace('tests')` is null.
- [ ] **Step 3: Advisors** — `get_advisors(security)` and `get_advisors(performance)`; fix anything ERROR-level with a new migration `ebc_0007_*` (repeat the grant DO block at its end); WARN items: fix when cheap (e.g. missing FK indexes), otherwise record in `docs/DEPLOY.md`.
- [ ] **Step 4: Owner account** — generate a 16-char password (letters+digits, no ambiguous chars) locally; `execute_sql`: `select public.bootstrap_owner('matheuslsf13@gmail.com', '<pw>', 'Matheus');`. Keep the password only for the final message (never commit it).
- [ ] **Step 5: Vercel deploy** — `scripts/deploy-files.mjs` prints the deploy file list (`package.json`, `index.html`, `vite.config.ts`, `tsconfig.json`, `vercel.json`, `.env.production`, `public/**`, `src/**` excluding `*.test.*`, `src/test/**`, `src/domain/testing/**`) with sizes and SHA-1. Create the project with `mcp__Vercel__create_project` (`name: 'endurance-base-club'`, `framework: 'vite'`, `buildCommand: 'vite build'`, `outputDirectory: 'dist'`, `installCommand: 'npm install --no-audit --no-fund'`, team `team_5RKNbN1EiWlEpXuYzgVp3yy9`); upload binary files with `mcp__Vercel__upload_file` (base64 + SHA-1); call `mcp__Vercel__create_deployment` with `target: 'production'`, `project`, `projectSettings` as above, text files inlined as `utf-8` and binaries referenced by `sha`/`size` (split into pre-uploaded files if the request would be too large). Poll `get_deployment` until `READY`; on `ERROR` read `list_deployment_events` and fix.
- [ ] **Step 6: Verify production** — `mcp__Vercel__web_fetch_vercel_url` on the production URL returns the app HTML; if the deployment is protected, set `ssoProtection` to preview-only via `update_project`. Smoke test through the user's desktop built-in browser (Claude_Browser, if online): open the URL, log in as the owner with the temporary password, confirm the forced password-change screen appears (do **not** change the user's password — log out), confirm the events page loads (`admin_me` works against real GoTrue), open a test timekeeper flow on a throwaway event created via SQL (`admin_save_event` as the owner is not possible from SQL without a JWT → create via `execute_sql` inserts), mark one time, verify via `execute_sql` that the mark arrived, then delete the throwaway event. If the browser is unavailable, record which checks ran.
- [ ] **Step 7: Deliverables** — `docs/DEPLOY.md` (URLs, how to redeploy, Supabase pause warning, how to reset a password in the Supabase dashboard); zip of the repository without `node_modules`/`dist` and the E2E sample workbook (`tests/e2e/artifacts/planilha.xlsx`) sent with `SendUserFile`; final message with URL, login, temporary password, and the pre-event checklist.

