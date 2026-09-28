import { supabase } from './supabase';
import type {
  AdminMe, AthleteProfile, AthleteRow, PubStatsPayload, EntryRow, EntryStatus, EventAggregate, EventRow, EventSummary,
  FinalizeRowInput, ImportResult, ImportRowInput, Leg, LiveDelta, MarkRow, OrganizerRow, PubEventListItem,
  PubEventPayload, RaceRow, ResolutionMode, ResolutionRow, Sex, TimekeeperRow, TkMarkInput, TkRegistration,
  TkSession, TkSyncResult, WaveRow,
} from './types';

/** Every `api` failure: the pt-BR message to show plus the Postgres/PostgREST error code
 * (`P0001` validation, `42501` permission, `PGRST301` rejected JWT, …) or `'network'` when the
 * server was unreachable, did not answer in time or answered 5xx. `status` is the HTTP status,
 * when there was one. Only P0001/42501 messages come from the server verbatim (A-M2). */
export class ApiError extends Error {
  code: string | null;
  status: number | null;

  constructor(message: string, code: string | null = null, status: number | null = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

const NETWORK_MESSAGE = 'Sem conexão com o servidor';
/** A request hung on a bad mobile connection must not hold single-flight loops (sync, polls) forever. */
const RPC_TIMEOUT_MS = 15_000;
/** Clock samples are only useful with a short round trip; the next one comes soon anyway. */
const SERVER_TIME_TIMEOUT_MS = 5_000;

interface RpcResult {
  data: unknown;
  error: { message?: string; code?: string | null } | null;
  status?: number;
}

const GENERIC_MESSAGE = 'Não foi possível concluir a operação.';
const SERVER_DOWN_MESSAGE = 'Servidor indisponível no momento. Tente de novo em instantes.';
const BAD_VALUE_MESSAGE = 'Valor em formato inválido. Confira os campos e tente de novo.';

/**
 * A-M2: pt-BR text for the Postgres/PostgREST codes that can reach the app besides our own P0001
 * (validation) and 42501 (permission) errors, whose messages are already pt-BR and pass through.
 * `network: true` marks a failure worth retrying like a dropped connection (the timekeeper keeps
 * its marks pending, queries retry).
 */
const SERVER_ERRORS: Record<string, { message: string; network?: boolean }> = {
  '57014': { message: 'O servidor demorou demais para responder. Tente de novo.', network: true }, // statement timeout
  '23505': { message: 'Este registro já existe (valor repetido). Atualize a página e tente de novo.' },
  '23503': { message: 'Um registro ligado a este não existe mais ou ainda está em uso. Atualize a página e tente de novo.' },
  '23502': { message: 'Um campo obrigatório ficou vazio.' },
  '23514': { message: 'Um valor está fora do permitido. Confira os campos e tente de novo.' },
  '22P02': { message: BAD_VALUE_MESSAGE }, // invalid text representation (uuid, number, boolean…)
  '22007': { message: BAD_VALUE_MESSAGE }, // invalid date/time format
  '22008': { message: BAD_VALUE_MESSAGE }, // date/time field out of range
  '22003': { message: BAD_VALUE_MESSAGE }, // numeric value out of range
  '40P01': { message: 'O servidor estava ocupado com outra alteração. Tente de novo.' }, // deadlock
  '40001': { message: 'O servidor estava ocupado com outra alteração. Tente de novo.' }, // serialization failure
  PGRST202: { message: 'Esta versão do app não corresponde à do servidor. Recarregue a página.' }, // unknown function
  PGRST002: { message: SERVER_DOWN_MESSAGE, network: true }, // schema cache still loading
  PGRST301: { message: 'Sua sessão expirou. Entre novamente.' }, // JWT expired/invalid
  PGRST303: { message: 'Sua sessão expirou. Entre novamente.' }, // JWT claims rejected
};

/** The error the app shows for a failed RPC answer (`status` = its HTTP status). */
function serverError(error: { message?: string; code?: string | null }, status: number | null): ApiError {
  const code = error.code || null;
  if (code === 'P0001') return new ApiError(error.message || 'Erro inesperado', code, status);
  if (code === '42501') {
    // Our own checks raise pt-BR texts ("Acesso restrito à organização"); Postgres's grant checks
    // raise English ones ("permission denied for function …", "must be owner of …").
    const message = error.message ?? '';
    const english = message === '' || /^(permission denied|must be owner)/i.test(message);
    return new ApiError(english ? 'Sem permissão para esta ação.' : message, code, status);
  }
  const known = code ? SERVER_ERRORS[code] : undefined;
  if (known) return new ApiError(known.message, known.network ? 'network' : code, status);
  // A gateway/5xx body (HTML or English text) says only that the server is not answering.
  if (status !== null && status >= 500) return new ApiError(SERVER_DOWN_MESSAGE, 'network', status);
  return new ApiError(code ? `Não foi possível concluir a operação (erro ${code}).` : GENERIC_MESSAGE, code, status);
}

function thrownToApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  const name = typeof e === 'object' && e !== null ? (e as { name?: unknown }).name : undefined;
  // fetch() rejects with a TypeError when the network is down, DNS fails or CORS blocks the call,
  // and with an AbortError when our timeout aborts it.
  if (e instanceof TypeError || name === 'FetchError' || name === 'AbortError' || name === 'TimeoutError') {
    return new ApiError(NETWORK_MESSAGE, 'network');
  }
  // Anything else (a body that is not JSON, a library bug) has an English message of no use here.
  return new ApiError(GENERIC_MESSAGE);
}

async function call<T>(fn: string, args?: Record<string, unknown>, timeoutMs = RPC_TIMEOUT_MS): Promise<T> {
  // AbortController + setTimeout rather than AbortSignal.timeout(): the latter is missing on
  // Safari < 16 (older timekeeper phones) and its timer cannot be cleared once the answer arrives.
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  let res: RpcResult;
  try {
    const query = args === undefined ? supabase.rpc(fn) : supabase.rpc(fn, args);
    res = await query.abortSignal(timeout.signal);
  } catch (e) {
    throw thrownToApiError(e);
  } finally {
    clearTimeout(timer);
  }
  if (res.error) {
    // postgrest-js does not reject on a failed or aborted fetch: it resolves with HTTP status 0.
    if (res.status === 0) throw new ApiError(NETWORK_MESSAGE, 'network');
    throw serverError(res.error, res.status ?? null);
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
    stats(): Promise<PubStatsPayload>;
  };
}

/** Typed wrapper over the Postgres RPC functions — the app's only way to reach the database. */
export const api: Api = {
  serverTime: async () => {
    // bigint arrives as a JSON number from PostgREST; Number() also accepts a numeric string.
    const ms = Number(await call<number | string | null>('server_time', undefined, SERVER_TIME_TIMEOUT_MS));
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
    stats: () => call('pub_stats'),
  },
};
