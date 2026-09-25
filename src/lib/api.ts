import { supabase } from './supabase';
import type {
  AdminMe, AthleteProfile, AthleteRow, EntryRow, EntryStatus, EventAggregate, EventRow, EventSummary,
  FinalizeRowInput, ImportResult, ImportRowInput, Leg, LiveDelta, MarkRow, OrganizerRow, PubEventListItem,
  PubEventPayload, RaceRow, ResolutionMode, ResolutionRow, Sex, TimekeeperRow, TkMarkInput, TkRegistration,
  TkSession, TkSyncResult, WaveRow,
} from './types';

/** Every `api` failure: the pt-BR message to show plus the Postgres/PostgREST error code
 * (`P0001` validation, `42501` permission, …) or `'network'` when the server was unreachable. */
export class ApiError extends Error {
  code: string | null;

  constructor(message: string, code: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

const NETWORK_MESSAGE = 'Sem conexão com o servidor';

interface RpcResult {
  data: unknown;
  error: { message?: string; code?: string | null } | null;
  status?: number;
}

function thrownToApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  // fetch() rejects with a TypeError when the network is down, DNS fails or CORS blocks the call.
  if (e instanceof TypeError || (e instanceof Error && e.name === 'FetchError')) return new ApiError(NETWORK_MESSAGE, 'network');
  return new ApiError(e instanceof Error && e.message ? e.message : 'Erro inesperado');
}

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  let res: RpcResult;
  try {
    res = await (args === undefined ? supabase.rpc(fn) : supabase.rpc(fn, args));
  } catch (e) {
    throw thrownToApiError(e);
  }
  if (res.error) {
    // postgrest-js does not reject on a failed fetch: it resolves with HTTP status 0 instead.
    if (res.status === 0) throw new ApiError(NETWORK_MESSAGE, 'network');
    throw new ApiError(res.error.message || 'Erro inesperado', res.error.code || null);
  }
  return res.data as T;
}

async function callVoid(fn: string, args?: Record<string, unknown>): Promise<void> {
  await call<unknown>(fn, args);
}

interface Api {
  serverTime(): Promise<number>;
  admin: {
    me(): Promise<AdminMe>;
    passwordChanged(): Promise<void>;
    listOrganizers(): Promise<OrganizerRow[]>;
    createOrganizer(email: string, password: string, name: string): Promise<OrganizerRow>;
    deleteOrganizer(userId: string): Promise<void>;
    listEvents(): Promise<EventSummary[]>;
    getEvent(id: string): Promise<EventAggregate>;
    saveEvent(e: Partial<EventRow> & { name: string; date: string }): Promise<EventRow>;
    deleteEvent(id: string): Promise<void>;
    duplicateEvent(id: string, name: string, date: string): Promise<string>;
    rotateTkToken(eventId: string): Promise<string>;
    saveRace(r: Partial<RaceRow> & { event_id: string; name: string; legs: Leg[]; waves?: Partial<WaveRow>[] }): Promise<{ race: RaceRow; waves: WaveRow[] }>;
    deleteRace(id: string): Promise<void>;
    setWaveStart(waveId: string, startAt: string | null): Promise<WaveRow>;
    listAthletes(): Promise<AthleteRow[]>;
    saveAthlete(a: Partial<AthleteRow> & { name: string; sex: Sex }): Promise<AthleteRow>;
    deleteAthlete(id: string): Promise<void>;
    importAthletes(eventId: string | null, rows: ImportRowInput[]): Promise<ImportResult>;
    athleteProfile(id: string): Promise<AthleteProfile>;
    saveEntry(e: {
      id?: string; race_id: string; wave_id?: string | null; bib?: string | null; team_name?: string | null;
      level?: string | null; notes?: string; members: { athlete_id: string; legs: number[] }[];
    }): Promise<EntryRow>;
    bulkCreateEntries(raceId: string, athleteIds: string[]): Promise<EntryRow[]>;
    updateEntryStatus(id: string, status: EntryStatus, penaltyMs: number, notes: string): Promise<EntryRow>;
    deleteEntry(id: string): Promise<void>;
    live(eventId: string, since: string | null): Promise<LiveDelta>;
    updateMark(id: string, patch: { entry_id?: string | null; leg_index?: number | null; discarded?: boolean }): Promise<MarkRow>;
    setResolution(entryId: string, legIndex: number, mode: ResolutionMode, markId: string | null, manualTs: string | null, note: string): Promise<ResolutionRow>;
    clearResolution(entryId: string, legIndex: number): Promise<void>;
    updateTimekeeper(id: string, patch: { name?: string; active?: boolean }): Promise<TimekeeperRow>;
    finalizeRace(raceId: string, rows: FinalizeRowInput[]): Promise<{ finalized_at: string; count: number }>;
    unfinalizeRace(raceId: string): Promise<void>;
  };
  tk: {
    open(token: string): Promise<TkSession>;
    register(token: string, name: string, deviceLabel: string): Promise<TkRegistration>;
    sync(token: string, timekeeperId: string, secret: string, marks: TkMarkInput[], since: string | null): Promise<TkSyncResult>;
  };
  pub: {
    events(): Promise<PubEventListItem[]>;
    event(slug: string): Promise<PubEventPayload>;
    live(slug: string, since: string | null): Promise<LiveDelta>;
    athlete(id: string): Promise<AthleteProfile>;
  };
}

/** Typed wrapper over the Postgres RPC functions — the app's only way to reach the database. */
export const api: Api = {
  serverTime: async () => {
    // bigint arrives as a JSON number from PostgREST; Number() also accepts a numeric string.
    const ms = Number(await call<number | string | null>('server_time'));
    // Never hand a bogus value (null → 0) to the clock sync: every mark's time depends on it.
    if (!Number.isFinite(ms) || ms <= 0) throw new ApiError('Resposta inválida do servidor');
    return ms;
  },
  admin: {
    me: () => call('admin_me'),
    passwordChanged: () => callVoid('admin_password_changed'),
    listOrganizers: () => call('admin_list_organizers'),
    createOrganizer: (email, password, name) => call('admin_create_organizer', { p_email: email, p_password: password, p_name: name }),
    deleteOrganizer: (userId) => callVoid('admin_delete_organizer', { p_user_id: userId }),
    listEvents: () => call('admin_list_events'),
    getEvent: (id) => call('admin_get_event', { p_event_id: id }),
    saveEvent: (e) => call('admin_save_event', { p_event: e }),
    deleteEvent: (id) => callVoid('admin_delete_event', { p_event_id: id }),
    duplicateEvent: (id, name, date) => call('admin_duplicate_event', { p_event_id: id, p_name: name, p_date: date }),
    rotateTkToken: (eventId) => call('admin_rotate_tk_token', { p_event_id: eventId }),
    saveRace: (r) => call('admin_save_race', { p_race: r }),
    deleteRace: (id) => callVoid('admin_delete_race', { p_race_id: id }),
    setWaveStart: (waveId, startAt) => call('admin_set_wave_start', { p_wave_id: waveId, p_start_at: startAt }),
    listAthletes: () => call('admin_list_athletes'),
    saveAthlete: (a) => call('admin_save_athlete', { p_athlete: a }),
    deleteAthlete: (id) => callVoid('admin_delete_athlete', { p_athlete_id: id }),
    importAthletes: (eventId, rows) => call('admin_import_athletes', { p_event_id: eventId, p_rows: rows }),
    athleteProfile: (id) => call('admin_athlete_profile', { p_athlete_id: id }),
    saveEntry: (e) => call('admin_save_entry', { p_entry: e }),
    bulkCreateEntries: (raceId, athleteIds) => call('admin_bulk_create_entries', { p_race_id: raceId, p_athlete_ids: athleteIds }),
    updateEntryStatus: (id, status, penaltyMs, notes) =>
      call('admin_update_entry_status', { p_entry_id: id, p_status: status, p_penalty_ms: penaltyMs, p_notes: notes }),
    deleteEntry: (id) => callVoid('admin_delete_entry', { p_entry_id: id }),
    live: (eventId, since) => call('admin_live', { p_event_id: eventId, p_since: since }),
    updateMark: (id, patch) => call('admin_update_mark', { p_mark_id: id, p_patch: patch }),
    setResolution: (entryId, legIndex, mode, markId, manualTs, note) =>
      call('admin_set_resolution', {
        p_entry_id: entryId, p_leg_index: legIndex, p_mode: mode, p_mark_id: markId, p_manual_ts: manualTs, p_note: note,
      }),
    clearResolution: (entryId, legIndex) => callVoid('admin_clear_resolution', { p_entry_id: entryId, p_leg_index: legIndex }),
    updateTimekeeper: (id, patch) => call('admin_update_timekeeper', { p_timekeeper_id: id, p_patch: patch }),
    finalizeRace: (raceId, rows) => call('admin_finalize_race', { p_race_id: raceId, p_rows: rows }),
    unfinalizeRace: (raceId) => callVoid('admin_unfinalize_race', { p_race_id: raceId }),
  },
  tk: {
    open: (token) => call('tk_open', { p_token: token }),
    register: (token, name, deviceLabel) => call('tk_register', { p_token: token, p_name: name, p_device_label: deviceLabel }),
    sync: (token, timekeeperId, secret, marks, since) =>
      call('tk_sync', { p_token: token, p_timekeeper_id: timekeeperId, p_secret: secret, p_marks: marks, p_since: since }),
  },
  pub: {
    events: () => call('pub_events'),
    event: (slug) => call('pub_event', { p_slug: slug }),
    live: (slug, since) => call('pub_live', { p_slug: slug, p_since: since }),
    athlete: (id) => call('pub_athlete', { p_athlete_id: id }),
  },
};
