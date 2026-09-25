// State and side effects of the timekeeper app (spec §7): the cached tk_open session, the device
// registration, the offline outbox and the single-flight sync loop. Every tap is written to the
// outbox (localStorage) synchronously before anything else happens, so a mark survives a lost
// connection, a slow server and a page reload.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import type { ClockState, ClockSync } from '../../lib/clock';
import { Outbox } from '../../lib/outbox';
import type { LocalMark, OutboxState } from '../../lib/outbox';
import { isMemoryOnly, readJSON, safeLocalStorage, writeJSON } from '../../lib/storage';
import type { EntryRow, MarkRow, RaceRow, TkMarkInput, TkSession, TkSyncResult } from '../../lib/types';
import { useClock } from '../../hooks/useClock';
import { entryDisplayName, legAthleteId, mergeById } from '../../domain/eventModel';
import type { EventIndex } from '../../domain/eventModel';
import { planBibAssignment } from '../../domain/suggestLeg';
import type { LegSuggestion } from '../../domain/suggestLeg';
import {
  applyWaveStarts, assignMark, assignmentMessage, localToMarkRow, markToInput, memberName, mergedMarks, newMark,
  onCourse, sessionIndex, withSuggestion,
} from './tkStore';
import type { OnCourseItem } from './tkStore';

/** Sync cadence and batching (spec §7.4); the delta overlap matches the admin live feed. */
const SYNC_INTERVAL_MS = 2_000;
const MAX_BACKOFF_MS = 10_000;
const OVERLAP_MS = 10_000;
const BATCH_SIZE = 200;
/** Retry of tk_open while there is nothing cached to show. */
const OPEN_RETRY_MS = 5_000;

const sessionKey = (token: string) => `ebc.tk.session.${token}`;
const regKey = (token: string) => `ebc.tk.reg.${token}`;
const marksKey = (eventId: string) => `ebc.tk.marks.${eventId}`;
const outboxKey = (eventId: string, timekeeperId: string) => `ebc.tk.${eventId}.${timekeeperId}`;
/** Timekeeper ids with an outbox for this event on this device — lets a new registration pick up
 * marks still pending under a registration that stopped working (rotated link, unknown id). */
const outboxesKey = (eventId: string) => `ebc.tk.outboxes.${eventId}`;

/** `other_tab`: another tab of this device has the link open (Ruling 45) — nothing is marked here. */
export type TkPhase = 'loading' | 'invalid' | 'register' | 'main' | 'disabled' | 'other_tab';

/** The synced instant of a tap and the clock state behind it, read when the finger landed. */
export interface TapStamp { tapMs: number; deviceMs: number; clock: ClockState | null }

/** What the device keeps after `tk_register` (`ebc.tk.reg.<token>`). */
export interface TkDevice { timekeeper_id: string; secret: string; name: string }

export type AssignResult =
  | {
      ok: true; markId: string; ts: string; entry: EntryRow; race: RaceRow; suggestion: LegSuggestion;
      /** `✓ Nº 101 · Matheus · fim da perna 2/2 (Corrida)` (or the already-finished form). */
      message: string;
      /** Bib warning (DNS/DSQ) or already-finished notice from `planBibAssignment`. */
      warning: string | null;
    }
  | { ok: false; markId: string | null; error: string };

export interface MyMark { mark: MarkRow; state: OutboxState; reason: string | null }

export interface Timekeeper {
  phase: TkPhase;
  session: TkSession | null;
  index: EventIndex | null;
  registration: TkDevice | null;
  clock: ClockSync;
  /** False after a network failure (or the browser's "offline" event) until a sync succeeds. */
  online: boolean;
  /** At least one sync succeeded since the page opened. */
  synced: boolean;
  /** Last non-network sync failure (pt-BR server message), cleared by the next success. */
  syncError: string | null;
  /** Why tk_open failed while loading. */
  loadError: string | null;
  pendingCount: number;
  rejectedCount: number;
  /** The outbox could not be written to the device storage: marks live only in this page. */
  storageFailed: boolean;
  /** ± uncertainty of the synced clock in ms (half the best round trip), null if never synced. */
  clockQuality: number | null;
  /** Synced now, refreshed every second and after every action. */
  nowMs: number;
  /** Every known mark (server copies merged with this device's). */
  marks: MarkRow[];
  /** This timekeeper's non-discarded marks without an entry, oldest first. */
  unassigned: MarkRow[];
  /** This timekeeper's marks with their outbox state, newest first. */
  myMarks: MyMark[];
  onCourse: OnCourseItem[];
  register(name: string): Promise<void>;
  /** The synced instant now, to record a mark later at the moment a press began. */
  stamp(): TapStamp;
  /** Records a mark at the synced instant of the call (or at `at`); with a bib, also assigns it. */
  mark(bibText?: string, at?: TapStamp): { markId: string; ts: string; assignment: AssignResult | null };
  assign(markId: string, entryId: string, athleteId?: string | null): AssignResult;
  assignBib(markId: string, bibText: string): AssignResult;
  changeLeg(markId: string, legIndex: number): AssignResult;
  unassign(markId: string): void;
  discard(markId: string): void;
  restore(markId: string): void;
  /** Loading: try tk_open now. Disabled: try syncing again. */
  retry(): void;
}

interface MarksCache { server_now: string | null; marks: MarkRow[] }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function readSession(storage: ReturnType<typeof safeLocalStorage>, token: string): TkSession | null {
  const v = readJSON<unknown>(storage, sessionKey(token), null);
  const ok = isRecord(v) && isRecord(v.event) && typeof v.event.id === 'string'
    && Array.isArray(v.races) && Array.isArray(v.waves) && Array.isArray(v.entries);
  return ok ? (v as unknown as TkSession) : null;
}

function readDevice(storage: ReturnType<typeof safeLocalStorage>, token: string): TkDevice | null {
  const v = readJSON<unknown>(storage, regKey(token), null);
  return isRecord(v) && typeof v.timekeeper_id === 'string' && typeof v.secret === 'string' && typeof v.name === 'string'
    ? { timekeeper_id: v.timekeeper_id, secret: v.secret, name: v.name }
    : null;
}

function readMarksCache(storage: ReturnType<typeof safeLocalStorage>, eventId: string): MarksCache {
  const v = readJSON<unknown>(storage, marksKey(eventId), null);
  if (!isRecord(v) || !Array.isArray(v.marks)) return { server_now: null, marks: [] };
  return { server_now: typeof v.server_now === 'string' ? v.server_now : null, marks: v.marks as MarkRow[] };
}

function toInput(m: LocalMark): TkMarkInput {
  const { local_updated_at: _sentAt, ...input } = m;
  return input;
}

const byTs = (a: MarkRow, b: MarkRow) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

type Failure = 'network' | 'unauthorized' | 'disabled' | 'invalid' | 'other';
function classify(e: unknown): { kind: Failure; message: string } {
  const message = e instanceof Error && e.message ? e.message : 'Erro inesperado';
  if (e instanceof ApiError && e.code === 'network') return { kind: 'network', message };
  if (message.includes('Cronometrista não autorizado')) return { kind: 'unauthorized', message };
  if (message.includes('Seu acesso foi desativado')) return { kind: 'disabled', message };
  if (message.includes('Link de cronometragem inválido')) return { kind: 'invalid', message };
  return { kind: 'other', message };
}

function deviceLabel(): string {
  return typeof navigator === 'undefined' ? '' : navigator.userAgent.slice(0, 200);
}

/** The browser's Web Locks, or null where they do not exist (insecure origin, old browser). */
function webLocks(): LockManager | null {
  const locks = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { locks?: LockManager }).locks;
  return locks && typeof locks.request === 'function' ? locks : null;
}

/** Ruling 45: `held` = this tab may time; `busy` = another tab of this device has the link open. */
type LockState = 'pending' | 'held' | 'busy';

export function useTimekeeper(token: string): Timekeeper {
  const storage = useMemo(() => safeLocalStorage(), []);
  const clock = useClock();

  const [session, setSessionState] = useState<TkSession | null>(() => readSession(storage, token));
  const [registration, setRegistration] = useState<TkDevice | null>(() => readDevice(storage, token));
  // With something cached the screen opens at once — a phone reloading without signal must not
  // sit on a spinner while tk_open times out.
  const [phase, setPhase] = useState<TkPhase>(() => (session ? (registration ? 'main' : 'register') : 'loading'));
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  const [synced, setSynced] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  const [nowMs, setNowMs] = useState(() => clock.now());
  const [lock, setLock] = useState<LockState>(() => (webLocks() ? 'pending' : 'held'));

  // The async loops and the tap handlers read the latest values from refs, never from a stale render.
  const sessionRef = useRef(session);
  const deviceRef = useRef(registration);
  const boxRef = useRef<{ key: string; box: Outbox } | null>(null);
  const cacheRef = useRef<{ eventId: string; cache: MarksCache } | null>(null);
  const indexRef = useRef<{ session: TkSession; index: EventIndex } | null>(null);
  const inFlight = useRef(false);
  const reopening = useRef(false);
  const openNow = useRef<() => void>(() => {});

  const bump = useCallback(() => {
    setRev(r => r + 1);
    setNowMs(clock.now());
  }, [clock]);

  /** One Outbox instance per key: two instances would each persist their own copy. */
  const outboxFor = useCallback((eventId: string, timekeeperId: string): Outbox => {
    const key = outboxKey(eventId, timekeeperId);
    if (boxRef.current?.key !== key) boxRef.current = { key, box: new Outbox(storage, key) };
    return boxRef.current.box;
  }, [storage]);

  const cacheFor = useCallback((eventId: string): MarksCache => {
    if (cacheRef.current?.eventId !== eventId) cacheRef.current = { eventId, cache: readMarksCache(storage, eventId) };
    return cacheRef.current.cache;
  }, [storage]);

  const indexFor = useCallback((s: TkSession): EventIndex => {
    if (indexRef.current?.session !== s) indexRef.current = { session: s, index: sessionIndex(s) };
    return indexRef.current.index;
  }, []);

  const applySession = useCallback((s: TkSession) => {
    sessionRef.current = s;
    setSessionState(s);
    writeJSON(storage, sessionKey(token), s);
  }, [storage, token]);

  const toMainOrRegister = useCallback(() => {
    setPhase(p => (p === 'loading' ? (deviceRef.current ? 'main' : 'register') : p));
  }, []);

  // tk_open: refresh the cached session; keep retrying while there is nothing to show.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = async () => {
      clearTimeout(timer);
      try {
        const s = await api.tk.open(token);
        if (cancelled) return;
        applySession(s);
        setLoadError(null);
        toMainOrRegister();
      } catch (e) {
        if (cancelled) return;
        const f = classify(e);
        // tk_open only raises P0001 for a wrong or disabled link.
        if (f.kind === 'invalid' || (e instanceof ApiError && e.code === 'P0001')) {
          setPhase('invalid');
          return;
        }
        setLoadError(f.message);
        if (f.kind === 'network') setOnline(false);
        if (sessionRef.current) toMainOrRegister();
        else timer = setTimeout(() => void attempt(), OPEN_RETRY_MS);
      }
    };
    openNow.current = () => void attempt();
    void attempt();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [token, applySession, toMainOrRegister]);

  const reopen = useCallback(() => {
    if (reopening.current) return;
    reopening.current = true;
    api.tk.open(token)
      .then(
        s => applySession(s),
        e => {
          if (classify(e).kind === 'invalid') setPhase('invalid');
        },
      )
      .finally(() => {
        reopening.current = false;
      });
  }, [token, applySession]);

  const applySyncResult = useCallback((eventId: string, box: Outbox, res: TkSyncResult) => {
    // Marks in neither list stay pending and go again next cycle (Ruling 28).
    box.applyResult(res.accepted ?? [], res.rejected ?? []);
    const cache = cacheFor(eventId);
    const known = new Map(cache.marks.map((m): [string, string] => [m.id, m.updated_at]));
    const fresh = (res.marks ?? []).filter(m => known.get(m.id) !== m.updated_at);
    cache.server_now = res.server_now;
    // Saved only when marks changed; a stale server_now on reload just means a larger first delta.
    if (fresh.length > 0) {
      cache.marks = mergeById(cache.marks, fresh);
      writeJSON(storage, marksKey(eventId), cache);
    }
    const s = sessionRef.current;
    if (s && s.event.id === eventId) {
      const next = applyWaveStarts(s, res.waves ?? []);
      if (next !== s) applySession(next);
      if (res.version !== s.version) reopen();
    }
  }, [cacheFor, storage, applySession, reopen]);

  const listedOutboxes = useCallback((evId: string): string[] => {
    const listed = readJSON<unknown>(storage, outboxesKey(evId), []);
    return Array.isArray(listed) ? listed.filter((x): x is string => typeof x === 'string') : [];
  }, [storage]);

  const rememberOutbox = useCallback((evId: string, timekeeperId: string) => {
    const listed = listedOutboxes(evId);
    if (!listed.includes(timekeeperId)) writeJSON(storage, outboxesKey(evId), [...listed, timekeeperId]);
  }, [storage, listedOutboxes]);

  const dropRegistration = useCallback(() => {
    storage.removeItem(regKey(token));
    deviceRef.current = null;
    setRegistration(null);
    setPhase('register');
  }, [storage, token]);

  // Ruling 45: one active tab per link and device. Two tabs would each keep their own outbox in
  // memory and overwrite each other's unsynced marks in storage, so only the tab holding the
  // Web Lock times; a second tab waits and takes over when the first one closes. Without Web
  // Locks the app runs as before.
  const eventId = session?.event.id ?? null;
  useEffect(() => {
    const locks = webLocks();
    if (!eventId || !locks) return;
    const name = `ebc.tk.${eventId}`;
    const abort = new AbortController();
    let letGo: () => void = () => {};
    const take = () => {
      // Another tab may have written since this one started: read everything again.
      boxRef.current = null;
      cacheRef.current = null;
      const device = readDevice(storage, token);
      if (device?.timekeeper_id !== deviceRef.current?.timekeeper_id) {
        deviceRef.current = device;
        setRegistration(device);
        setPhase(p => (device ? (p === 'register' ? 'main' : p) : (p === 'main' ? 'register' : p)));
      }
      setLock('held');
      bump();
      return new Promise<void>(resolve => { letGo = resolve; });
    };
    // Web Locks refused here (e.g. an opaque-origin frame): run as without them.
    const runWithout = () => {
      if (!abort.signal.aborted) setLock('held');
    };
    try {
      locks.request(name, { ifAvailable: true }, held => {
        if (abort.signal.aborted) return undefined;
        if (held) return take();
        setLock('busy');
        locks.request(name, { signal: abort.signal }, () => (abort.signal.aborted ? undefined : take())).catch(() => {
          // Aborted on close, or refused: this tab stays out.
        });
        return undefined;
      }).catch(runWithout);
    } catch {
      runWithout();
    }
    return () => {
      abort.abort();
      letGo();
    };
  }, [eventId, storage, token, bump]);
  const active = lock === 'held';

  // The sync loop: single-flight (never two tk_sync requests out, or acks could be misapplied),
  // every 2 s, ×2 backoff up to 10 s on failures, paused while the page is hidden.
  useEffect(() => {
    if (phase !== 'main' || !active || !registration || !eventId) return;
    const device = registration;
    const box = outboxFor(eventId, device.timekeeper_id);
    rememberOutbox(eventId, device.timekeeper_id);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = SYNC_INTERVAL_MS;

    const schedule = () => {
      clearTimeout(timer);
      if (!cancelled) timer = setTimeout(() => void tick(), delay);
    };

    const tick = async () => {
      if (cancelled || document.visibilityState === 'hidden') return;
      if (inFlight.current) {
        schedule();
        return;
      }
      const batch = box.pending(BATCH_SIZE);
      box.markSent(batch);
      const cache = cacheFor(eventId);
      const since = cache.server_now ? new Date(Date.parse(cache.server_now) - OVERLAP_MS).toISOString() : null;
      inFlight.current = true;
      try {
        const res = await api.tk.sync(token, device.timekeeper_id, device.secret, batch.map(toInput), since);
        // Applied even if this effect was torn down meanwhile: acks are for marks already stored.
        applySyncResult(eventId, box, res);
        delay = SYNC_INTERVAL_MS;
        setOnline(true);
        setSynced(true);
        setSyncError(null);
      } catch (e) {
        const f = classify(e);
        if (f.kind === 'unauthorized') return dropRegistration();
        if (f.kind === 'disabled') return setPhase('disabled');
        if (f.kind === 'invalid') return setPhase('invalid');
        if (f.kind === 'network') setOnline(false);
        else setSyncError(f.message);
        delay = Math.min(delay * 2, MAX_BACKOFF_MS);
      } finally {
        inFlight.current = false;
        bump();
      }
      schedule();
    };

    const resume = () => {
      delay = SYNC_INTERVAL_MS;
      void tick();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') resume();
    };
    const onOffline = () => setOnline(false);

    void tick();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', resume);
    window.addEventListener('offline', onOffline);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', onOffline);
    };
  }, [phase, active, registration, eventId, token, outboxFor, cacheFor, applySyncResult, dropRegistration, bump, rememberOutbox]);

  // Leg timers and confirmation countdowns.
  useEffect(() => {
    if (phase !== 'main') return;
    const id = setInterval(() => setNowMs(clock.now()), 1_000);
    return () => clearInterval(id);
  }, [phase, clock]);

  /** Moves marks still pending under this device's previous registrations into the new outbox. */
  const adoptPending = useCallback((evId: string, timekeeperId: string) => {
    const box = outboxFor(evId, timekeeperId);
    for (const old of listedOutboxes(evId)) {
      if (old === timekeeperId) continue;
      for (const it of new Outbox(storage, outboxKey(evId, old)).all()) {
        if (it.state === 'pending' && !box.get(it.mark.id)) box.upsert(toInput(it.mark));
      }
    }
    // Adopted outboxes leave the list, so their marks are never picked up twice.
    writeJSON(storage, outboxesKey(evId), [timekeeperId]);
  }, [storage, outboxFor, listedOutboxes]);

  const register = useCallback(async (name: string) => {
    const s = sessionRef.current;
    if (!s) throw new ApiError('Evento ainda não carregado');
    const clean = name.trim();
    const res = await api.tk.register(token, clean, deviceLabel());
    const device: TkDevice = { timekeeper_id: res.timekeeper_id, secret: res.secret, name: clean };
    writeJSON(storage, regKey(token), device);
    adoptPending(s.event.id, device.timekeeper_id);
    deviceRef.current = device;
    setRegistration(device);
    setPhase('main');
    bump();
  }, [token, storage, adoptPending, bump]);

  // ---- actions (synchronous: they read and write the outbox directly) ----

  const context = useCallback(() => {
    const s = sessionRef.current;
    const device = deviceRef.current;
    if (!s || !device) throw new Error('Cronometragem não iniciada');
    const box = outboxFor(s.event.id, device.timekeeper_id);
    const cache = cacheFor(s.event.id);
    return {
      s, device, box, index: indexFor(s),
      marks: () => mergedMarks(cache.marks, box.all(), s.event.id, device.timekeeper_id),
    };
  }, [outboxFor, cacheFor, indexFor]);
  type Ctx = ReturnType<typeof context>;

  /** The current version of one of this timekeeper's marks (server copy unless an edit is pending). */
  const mine = (c: Ctx, markId: string): TkMarkInput | null => {
    const row = c.marks().find(m => m.id === markId && m.timekeeper_id === c.device.timekeeper_id);
    if (row) return markToInput(row);
    const it = c.box.get(markId);
    return it ? toInput(it.mark) : null;
  };

  const success = (c: Ctx, mark: TkMarkInput, entry: EntryRow, race: RaceRow, suggestion: LegSuggestion, warning: string | null): AssignResult => {
    const name = memberName(entry, suggestion.athlete_id) ?? entryDisplayName(entry, c.index);
    return { ok: true, markId: mark.id, ts: mark.ts, entry, race, suggestion, warning, message: assignmentMessage(entry, race, suggestion, name) };
  };

  const assignByBib = (c: Ctx, base: TkMarkInput, bibText: string): AssignResult => {
    // Ruling 2: the shared "typed bib → entry → suggested leg" helper.
    const plan = planBibAssignment({
      entries: c.s.entries, racesById: c.index.racesById, marks: c.marks(), markId: base.id,
      tsMs: Date.parse(base.ts), bibText,
    });
    if ('error' in plan) return { ok: false, markId: base.id, error: plan.error };
    const next = withSuggestion(base, plan.entry.id, plan.suggestion);
    c.box.upsert(next);
    return success(c, next, plan.entry, plan.race, plan.suggestion, plan.warning);
  };

  const stamp = (): TapStamp => {
    // The tap instant first: nothing may delay it.
    const tapMs = clock.now();
    return { tapMs, deviceMs: Date.now(), clock: clock.state() };
  };

  const mark = (bibText?: string, at?: TapStamp) => {
    // The tap instant, read before anything else can delay it (or taken when the press began).
    const t = at ?? stamp();
    const input = newMark(t.tapMs, t.deviceMs, t.clock);
    const c = context();
    // Stored unassigned first, so the tap survives whatever happens while assigning it.
    c.box.upsert(input);
    let assignment: AssignResult | null = null;
    if (bibText !== undefined && bibText.trim() !== '') {
      try {
        assignment = assignByBib(c, input, bibText);
      } catch {
        assignment = { ok: false, markId: input.id, error: 'Não foi possível atribuir — a marcação ficou em "Sem atleta"' };
      }
    }
    bump();
    return { markId: input.id, ts: input.ts, assignment };
  };

  const withMark = (markId: string, fn: (c: Ctx, base: TkMarkInput) => AssignResult): AssignResult => {
    const c = context();
    const base = mine(c, markId);
    if (!base) return { ok: false, markId, error: 'Marcação não encontrada' };
    const r = fn(c, base);
    bump();
    return r;
  };

  const assign = (markId: string, entryId: string, athleteId?: string | null): AssignResult =>
    withMark(markId, (c, base) => {
      const entry = c.index.entriesById.get(entryId);
      const race = entry ? c.index.racesById.get(entry.race_id) : undefined;
      if (!entry || !race) return { ok: false, markId, error: 'Inscrição não encontrada' };
      const { mark: next, suggestion } = assignMark(base, entry, race, c.marks(), athleteId);
      c.box.upsert(next);
      return success(c, next, entry, race, suggestion, null);
    });

  const assignBib = (markId: string, bibText: string): AssignResult =>
    withMark(markId, (c, base) => assignByBib(c, base, bibText));

  const changeLeg = (markId: string, legIndex: number): AssignResult =>
    withMark(markId, (c, base) => {
      const entry = base.entry_id ? c.index.entriesById.get(base.entry_id) : undefined;
      const race = entry ? c.index.racesById.get(entry.race_id) : undefined;
      if (!entry || !race) return { ok: false, markId, error: 'Marcação sem atleta' };
      if (legIndex < 0 || legIndex >= race.legs.length) return { ok: false, markId, error: 'Perna inválida' };
      const suggestion: LegSuggestion = { leg_index: legIndex, athlete_id: legAthleteId(entry, legIndex), reason: 'next', warning: null };
      const next = withSuggestion(base, entry.id, suggestion);
      c.box.upsert(next);
      return success(c, next, entry, race, suggestion, null);
    });

  const update = (markId: string, patch: Partial<TkMarkInput>) => {
    const c = context();
    const base = mine(c, markId);
    if (!base) return;
    c.box.upsert({ ...base, ...patch });
    bump();
  };
  const unassign = (markId: string) => update(markId, { entry_id: null, leg_index: null, athlete_id: null });
  const discard = (markId: string) => update(markId, { discarded: true });
  const restore = (markId: string) => update(markId, { discarded: false });

  const retry = () => {
    if (phase === 'disabled') setPhase('main');
    else if (phase === 'loading') openNow.current();
  };

  // ---- derived state ----

  const derived = useMemo(() => {
    // A tab without the lock never loads the outbox: it would hold a copy that goes stale.
    if (!session || !registration || !active) {
      return { marks: [] as MarkRow[], unassigned: [] as MarkRow[], myMarks: [] as MyMark[], pendingCount: 0, rejectedCount: 0, storageFailed: false };
    }
    const evId = session.event.id;
    const me = registration.timekeeper_id;
    const box = outboxFor(evId, me);
    const items = box.all();
    const marks = mergedMarks(cacheFor(evId).marks, items, evId, me);
    const own = marks.filter(m => m.timekeeper_id === me);
    const byId = new Map(marks.map((m): [string, MarkRow] => [m.id, m]));
    const inBox = new Set<string>();
    const myMarks: MyMark[] = items.map(it => {
      inBox.add(it.mark.id);
      return { mark: byId.get(it.mark.id) ?? localToMarkRow(it.mark, evId, me), state: it.state, reason: it.reason ?? null };
    });
    for (const m of own) if (!inBox.has(m.id)) myMarks.push({ mark: m, state: 'synced', reason: null });
    myMarks.sort((a, b) => byTs(b.mark, a.mark));
    return {
      marks,
      unassigned: own.filter(m => !m.discarded && m.entry_id === null).sort(byTs),
      myMarks,
      pendingCount: box.pendingCount(),
      rejectedCount: items.filter(it => it.state === 'rejected').length,
      storageFailed: isMemoryOnly(outboxKey(evId, me)),
    };
    // `rev` stands for the outbox and marks cache, which are mutated in place.
  }, [session, registration, active, rev, outboxFor, cacheFor]);

  const me = registration?.timekeeper_id ?? null;
  const onCourseList = useMemo(
    () => (session ? onCourse(session, derived.marks, nowMs, me) : []),
    [session, derived.marks, nowMs, me],
  );

  // Timing screens wait for the lock; the others (invalid, disabled, loading) show as they are.
  const shownPhase: TkPhase = !active && (phase === 'main' || phase === 'register')
    ? (lock === 'busy' ? 'other_tab' : 'loading')
    : phase;

  const rtt = clock.rttMs;
  return {
    phase: shownPhase, session, index: session ? indexFor(session) : null, registration, clock,
    online, synced, syncError, loadError,
    pendingCount: derived.pendingCount, rejectedCount: derived.rejectedCount, storageFailed: derived.storageFailed,
    clockQuality: clock.synced && rtt !== null ? Math.round(rtt / 2) : null,
    nowMs, marks: derived.marks, unassigned: derived.unassigned, myMarks: derived.myMarks, onCourse: onCourseList,
    register, stamp, mark, assign, assignBib, changeLeg, unassign, discard, restore, retry,
  };
}
