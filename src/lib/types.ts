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
