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
  applyWaveStarts, assignMark, assignmentMessage, keepAside, localToMarkRow, markToInput, memberName, mergedMarks, newMark,
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
/** While the link is refused (rotated or turned off), tk_open is asked again this often (B2-I4b). */
const LINK_RECHECK_MS = 10_000;

const sessionKey = (token: string) => `ebc.tk.session.${token}`;
/** Before B2-I4c the registration was kept per link; it is moved to `deviceKey` when read. */
const legacyRegKey = (token: string) => `ebc.tk.reg.${token}`;
/** The device's registration for an event (B2-I4c): a new link of the same event keeps the same
 * timekeeper id and secret (tk_sync accepts them with any valid token of the event). */
const deviceKey = (eventId: string) => `ebc.tk.device.${eventId}`;
const marksKey = (eventId: string) => `ebc.tk.marks.${eventId}`;
const outboxKey = (eventId: string, timekeeperId: string) => `ebc.tk.${eventId}.${timekeeperId}`;
/** Timekeeper ids with an outbox for this event on this device — lets a new registration pick up
 * marks still pending under a registration that stopped working (rotated link, unknown id). */
const outboxesKey = (eventId: string) => `ebc.tk.outboxes.${eventId}`;
/** Ids of this timekeeper's marks deselected in "Sem atleta" (set aside, Ruling 55), kept on the
 * device so a reload or another tab taking over does not make them automatic targets again. */
const asideKey = (eventId: string, timekeeperId: string) => `ebc.tk.aside.${eventId}.${timekeeperId}`;

/** `other_tab`: another tab of this device has the link open (Ruling 45) — nothing is marked here. */
export type TkPhase = 'loading' | 'invalid' | 'register' | 'main' | 'disabled' | 'other_tab';

/** The synced instant of a tap and the clock state behind it, read when the finger landed. */
export interface TapStamp { tapMs: number; deviceMs: number; clock: ClockState | null }

/** What the device keeps after `tk_register` (`ebc.tk.device.<eventId>`). */
export interface TkDevice { timekeeper_id: string; secret: string; name: string }

/** Why the sync is not reaching the server: no answer at all, or the server answered with a
 * failure (5xx, overloaded) — the same retries, told apart for the timekeeper (Ruling 59 entry). */
export type OfflineReason = 'internet' | 'server';

export type AssignResult =
  | {
      ok: true; markId: string; ts: string; entry: EntryRow; race: RaceRow; suggestion: LegSuggestion;
      /** `✓ Nº 101 · Matheus · fim da perna 2/2 (Corrida)` (or the already-finished form). */
      message: string;
      /** Bib warning (DNS/DSQ) or already-finished notice from `planBibAssignment`. */
      warning: string | null;
    }
  | { ok: false; markId: string | null; error: string };

/** `note`: why an edit of this mark was refused although the server keeps a copy of it — settled,
 * the server copy wins (Ruling 27) and nothing is left to fix (B2-m7). */
export interface MyMark { mark: MarkRow; state: OutboxState; reason: string | null; note: string | null }

export interface Timekeeper {
  phase: TkPhase;
  session: TkSession | null;
  index: EventIndex | null;
  registration: TkDevice | null;
  clock: ClockSync;
  /** False after a network failure (or the browser's "offline" event) until a sync succeeds. */
  online: boolean;
  /** While `online` is false: whether the internet or the server is failing. */
  offline: OfflineReason | null;
  /** The link was refused (rotated or turned off) while this device has a registration: MARCAR
   * keeps working into the outbox, tk_open is checked again every 10 s (B2-I4b/d). */
  linkInvalid: boolean;
  /** At least one sync succeeded since the page opened. */
  synced: boolean;
  /** Last non-network sync failure (pt-BR server message), cleared by the next success. */
  syncError: string | null;
  /** Why tk_open failed while loading. */
  loadError: string | null;
  pendingCount: number;
  /** Rejected marks still to be fixed here: those the server never stored (B2-m7). */
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
  /** Ids of `unassigned` marks the timekeeper deselected (Ruling 55): no automatic target. */
  aside: ReadonlySet<string>;
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
  /** Sets a mark aside (deselected) or takes it back; kept on the device. */
  setAside(markId: string, aside: boolean): void;
  /** Loading: try tk_open now. Disabled: try syncing again. Link refused: check it again now. */
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

function parseDevice(v: unknown): TkDevice | null {
  return isRecord(v) && typeof v.timekeeper_id === 'string' && typeof v.secret === 'string' && typeof v.name === 'string'
    ? { timekeeper_id: v.timekeeper_id, secret: v.secret, name: v.name }
    : null;
}

/** This device's registration for `eventId`; one still kept under the link `token` (before
 * B2-I4c) is moved to the event key. */
function readDevice(storage: ReturnType<typeof safeLocalStorage>, eventId: string, token: string): TkDevice | null {
  const own = parseDevice(readJSON<unknown>(storage, deviceKey(eventId), null));
  if (own) return own;
  const legacy = parseDevice(readJSON<unknown>(storage, legacyRegKey(token), null));
  if (!legacy) return null;
  writeJSON(storage, deviceKey(eventId), legacy);
  storage.removeItem(legacyRegKey(token));
  return legacy;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * B2-m5: the timekeeper keys of OTHER events are removed when a session opens — sessions (and old
 * per-link registrations) of their links, registration, marks cache, outboxes and set-aside ids —
 * unless one of their outboxes still has a mark to send, or another tab is timing that event
 * right now (its Web Lock is held). After a few events the quota would otherwise fill up and the
 * current outbox fall back to memory. Only keys whose event is known are touched: ids are UUIDs,
 * a session names its event; anything else under `ebc.tk.` is left alone.
 */
async function pruneOtherEvents(currentEventId: string): Promise<void> {
  let ls: Storage;
  const keys: string[] = [];
  try {
    ls = window.localStorage;
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k !== null && k.startsWith('ebc.tk.')) keys.push(k);
    }
  } catch {
    return;
  }
  const json = (k: string): unknown => {
    try {
      const raw = ls.getItem(k);
      return raw === null ? null : JSON.parse(raw);
    } catch {
      return null;
    }
  };
  const tokenEvent = new Map<string, string>();
  for (const k of keys) {
    if (!k.startsWith('ebc.tk.session.')) continue;
    const v = json(k);
    const id = isRecord(v) && isRecord(v.event) ? v.event.id : null;
    if (typeof id === 'string' && UUID.test(id)) tokenEvent.set(k.slice('ebc.tk.session.'.length), id);
  }
  const eventOf = (k: string): { eventId: string; outbox: boolean } | null => {
    const [head, ...tail] = k.slice('ebc.tk.'.length).split('.');
    const one = tail.length === 1 && UUID.test(tail[0]) ? tail[0] : null;
    switch (head) {
      case 'session':
      case 'reg': {
        const id = tokenEvent.get(tail.join('.'));
        return id ? { eventId: id, outbox: false } : null;
      }
      case 'device':
      case 'marks':
      case 'outboxes':
        return one ? { eventId: one, outbox: false } : null;
      case 'aside':
        return tail.length === 2 && UUID.test(tail[0]) ? { eventId: tail[0], outbox: false } : null;
      default:
        return tail.length === 1 && UUID.test(head) && UUID.test(tail[0]) ? { eventId: head, outbox: true } : null;
    }
  };
  const byEvent = new Map<string, string[]>();
  const keep = new Set<string>([currentEventId]);
  for (const k of keys) {
    const owner = eventOf(k);
    if (!owner) continue;
    byEvent.set(owner.eventId, [...(byEvent.get(owner.eventId) ?? []), k]);
    if (owner.outbox) {
      const v = json(k);
      const items = isRecord(v) && isRecord(v.items) ? Object.values(v.items) : [];
      if (items.some(it => isRecord(it) && it.state === 'pending')) keep.add(owner.eventId);
    }
  }
  const locks = webLocks();
  if (locks && typeof locks.query === 'function') {
    try {
      const held = (await locks.query()).held ?? [];
      for (const l of held) if (l.name?.startsWith('ebc.tk.')) keep.add(l.name.slice('ebc.tk.'.length));
    } catch {
      return; // unsure who is timing what: keep everything
    }
  }
  for (const [eventId, list] of byEvent) {
    if (keep.has(eventId)) continue;
    for (const k of list) {
      try {
        ls.removeItem(k);
      } catch {
        // Storage refused: nothing lost, it is tried again next time.
      }
    }
  }
}

function readMarksCache(storage: ReturnType<typeof safeLocalStorage>, eventId: string): MarksCache {
  const v = readJSON<unknown>(storage, marksKey(eventId), null);
  if (!isRecord(v) || !Array.isArray(v.marks)) return { server_now: null, marks: [] };
  return { server_now: typeof v.server_now === 'string' ? v.server_now : null, marks: v.marks as MarkRow[] };
}

function readAside(storage: ReturnType<typeof safeLocalStorage>, key: string): string[] {
  const v = readJSON<unknown>(storage, key, []);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function toInput(m: LocalMark): TkMarkInput {
  const { local_updated_at: _sentAt, ...input } = m;
  return input;
}

const byTs = (a: MarkRow, b: MarkRow) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

type Failure = 'network' | 'unauthorized' | 'disabled' | 'invalid' | 'other';
function classify(e: unknown): { kind: Failure; message: string; offline: OfflineReason } {
  const message = e instanceof Error && e.message ? e.message : 'Erro inesperado';
  // api.ts maps both a missing answer and a 5xx answer to 'network' (A-M2); an HTTP status says the
  // server did answer.
  const offline: OfflineReason = e instanceof ApiError && e.status !== null && e.status > 0 ? 'server' : 'internet';
  if (e instanceof ApiError && e.code === 'network') return { kind: 'network', message, offline };
  const other = (kind: Failure) => ({ kind, message, offline });
  if (message.includes('Cronometrista não autorizado')) return other('unauthorized');
  if (message.includes('Seu acesso foi desativado')) return other('disabled');
  if (message.includes('Link de cronometragem inválido')) return other('invalid');
  return other('other');
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

  const [cached] = useState(() => {
    const s = readSession(storage, token);
    return { session: s, device: s ? readDevice(storage, s.event.id, token) : null };
  });
  const [session, setSessionState] = useState<TkSession | null>(cached.session);
  const [registration, setRegistration] = useState<TkDevice | null>(cached.device);
  // With something cached the screen opens at once — a phone reloading without signal must not
  // sit on a spinner while tk_open times out.
  const [phase, setPhase] = useState<TkPhase>(() => (session ? (registration ? 'main' : 'register') : 'loading'));
  const [offline, setOffline] = useState<OfflineReason | null>(
    () => (typeof navigator !== 'undefined' && navigator.onLine === false ? 'internet' : null),
  );
  const [linkInvalid, setLinkInvalid] = useState(false);
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
  const asideRef = useRef<{ key: string; ids: string[] } | null>(null);
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

  /** The set-aside ids as stored for this event and timekeeper (mutated in place, then saved). */
  const asideFor = useCallback((eventId: string, timekeeperId: string): { key: string; ids: string[] } => {
    const key = asideKey(eventId, timekeeperId);
    if (asideRef.current?.key !== key) asideRef.current = { key, ids: readAside(storage, key) };
    return asideRef.current;
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

  /** Loading, a refused link that works again, or a registration found for the event: time. */
  const toMainOrRegister = useCallback(() => {
    setPhase(p => (p === 'loading' || p === 'invalid' || (p === 'register' && deviceRef.current)
      ? (deviceRef.current ? 'main' : 'register')
      : p));
  }, []);

  /** Picks up this device's registration for the event of a session just opened (B2-I4c): a new
   * link of the same event times as the same timekeeper, with the same outbox. */
  const adoptDevice = useCallback((eventId: string) => {
    if (deviceRef.current) return;
    const device = readDevice(storage, eventId, token);
    if (!device) return;
    deviceRef.current = device;
    setRegistration(device);
  }, [storage, token]);

  /** The link was refused: with a registration the screen keeps timing into the outbox and checks
   * the link again (B2-I4b/d); without one there is nothing to time with. */
  const onInvalid = useCallback(() => {
    if (sessionRef.current && deviceRef.current) setLinkInvalid(true);
    else setPhase('invalid');
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
        adoptDevice(s.event.id);
        setLoadError(null);
        toMainOrRegister();
      } catch (e) {
        if (cancelled) return;
        const f = classify(e);
        // tk_open only raises P0001 for a wrong or disabled link.
        if (f.kind === 'invalid' || (e instanceof ApiError && e.code === 'P0001')) {
          onInvalid();
          return;
        }
        setLoadError(f.message);
        if (f.kind === 'network') setOffline(f.offline);
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
  }, [token, applySession, adoptDevice, toMainOrRegister, onInvalid]);

  // B2-I4b: while the link is refused, ask tk_open again every 10 s (and on "Tentar novamente"):
  // a link turned back on resumes by itself; a rotated one waits for the new link on this device.
  const checking = useRef(false);
  const checkLink = useCallback(async () => {
    if (checking.current) return;
    checking.current = true;
    try {
      const s = await api.tk.open(token);
      applySession(s);
      adoptDevice(s.event.id);
      setLoadError(null);
      setLinkInvalid(false);
      toMainOrRegister();
    } catch (e) {
      const f = classify(e);
      if (f.kind === 'network') setOffline(f.offline);
    } finally {
      checking.current = false;
    }
  }, [token, applySession, adoptDevice, toMainOrRegister]);
  useEffect(() => {
    if (phase !== 'invalid' && !linkInvalid) return;
    const id = setInterval(() => void checkLink(), LINK_RECHECK_MS);
    return () => clearInterval(id);
  }, [phase, linkInvalid, checkLink]);

  const reopen = useCallback(() => {
    if (reopening.current) return;
    reopening.current = true;
    api.tk.open(token)
      .then(
        s => applySession(s),
        e => {
          if (classify(e).kind === 'invalid') onInvalid();
        },
      )
      .finally(() => {
        reopening.current = false;
      });
  }, [token, applySession, onInvalid]);

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
    const evId = sessionRef.current?.event.id;
    if (evId) storage.removeItem(deviceKey(evId));
    storage.removeItem(legacyRegKey(token));
    deviceRef.current = null;
    setRegistration(null);
    setPhase('register');
  }, [storage, token]);

  // Ruling 45: one active tab per link and device. Two tabs would each keep their own outbox in
  // memory and overwrite each other's unsynced marks in storage, so only the tab holding the
  // Web Lock times; a second tab waits and takes over when the first one closes. Without Web
  // Locks the app runs as before.
  const eventId = session?.event.id ?? null;

  // B2-m5: other events' timekeeper data with nothing left to send goes once a session is open.
  useEffect(() => {
    if (eventId) void pruneOtherEvents(eventId);
  }, [eventId]);

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
      asideRef.current = null;
      const device = readDevice(storage, eventId, token);
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
    // A refused link sends nothing: the marks wait in the outbox until tk_open works again.
    if (phase !== 'main' || !active || !registration || !eventId || linkInvalid) return;
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
        setOffline(null);
        setSynced(true);
        setSyncError(null);
      } catch (e) {
        const f = classify(e);
        if (f.kind === 'unauthorized') return dropRegistration();
        if (f.kind === 'disabled') return setPhase('disabled');
        if (f.kind === 'invalid') return onInvalid();
        if (f.kind === 'network') setOffline(f.offline);
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
    const onOffline = () => setOffline('internet');

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
  }, [phase, active, registration, eventId, linkInvalid, token, outboxFor, cacheFor, applySyncResult, dropRegistration, onInvalid, bump, rememberOutbox]);

  // Leg timers and confirmation countdowns.
  useEffect(() => {
    if (phase !== 'main') return;
    const id = setInterval(() => setNowMs(clock.now()), 1_000);
    return () => clearInterval(id);
  }, [phase, clock]);

  /** Moves marks still pending under this device's previous registrations into the new outbox —
   * those set aside stay set aside (Ruling 55). */
  const adoptPending = useCallback((evId: string, timekeeperId: string) => {
    const box = outboxFor(evId, timekeeperId);
    const aside = asideFor(evId, timekeeperId);
    const asideBefore = aside.ids.length;
    for (const old of listedOutboxes(evId)) {
      if (old === timekeeperId) continue;
      const oldAside = new Set(readAside(storage, asideKey(evId, old)));
      for (const it of new Outbox(storage, outboxKey(evId, old)).all()) {
        if (it.state !== 'pending' || box.get(it.mark.id)) continue;
        box.upsert(toInput(it.mark));
        if (oldAside.has(it.mark.id) && !aside.ids.includes(it.mark.id)) aside.ids = [...aside.ids, it.mark.id];
      }
    }
    if (aside.ids.length !== asideBefore) writeJSON(storage, aside.key, aside.ids);
    // Adopted outboxes leave the list, so their marks are never picked up twice.
    writeJSON(storage, outboxesKey(evId), [timekeeperId]);
  }, [storage, outboxFor, asideFor, listedOutboxes]);

  const register = useCallback(async (name: string) => {
    const s = sessionRef.current;
    if (!s) throw new ApiError('Evento ainda não carregado');
    const clean = name.trim();
    const res = await api.tk.register(token, clean, deviceLabel());
    const device: TkDevice = { timekeeper_id: res.timekeeper_id, secret: res.secret, name: clean };
    writeJSON(storage, deviceKey(s.event.id), device);
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

  const setAside = (markId: string, on: boolean) => {
    const s = sessionRef.current;
    const device = deviceRef.current;
    if (!s || !device) return;
    const a = asideFor(s.event.id, device.timekeeper_id);
    if (a.ids.includes(markId) === on) return;
    a.ids = on ? [...a.ids, markId] : a.ids.filter(id => id !== markId);
    writeJSON(storage, a.key, a.ids);
    bump();
  };

  const retry = () => {
    if (phase === 'disabled') setPhase('main');
    else if (phase === 'loading') openNow.current();
    else if (phase === 'invalid' || linkInvalid) void checkLink();
  };

  // ---- derived state ----

  const derived = useMemo(() => {
    // A tab without the lock never loads the outbox: it would hold a copy that goes stale.
    if (!session || !registration || !active) {
      return {
        loaded: false, marks: [] as MarkRow[], unassigned: [] as MarkRow[], aside: new Set<string>() as ReadonlySet<string>,
        myMarks: [] as MyMark[], pendingCount: 0, rejectedCount: 0, storageFailed: false,
      };
    }
    const evId = session.event.id;
    const me = registration.timekeeper_id;
    const box = outboxFor(evId, me);
    const items = box.all();
    const serverMarks = cacheFor(evId).marks;
    const marks = mergedMarks(serverMarks, items, evId, me);
    const own = marks.filter(m => m.timekeeper_id === me);
    const byId = new Map(marks.map((m): [string, MarkRow] => [m.id, m]));
    // B2-m7: a rejected edit of a mark the server holds is settled — the server copy is what
    // counts (Ruling 27) — so it is shown with its reason but no longer counted as to be fixed.
    const onServer = new Set(serverMarks.map(m => m.id));
    const inBox = new Set<string>();
    const myMarks: MyMark[] = items.map(it => {
      inBox.add(it.mark.id);
      const mark = byId.get(it.mark.id) ?? localToMarkRow(it.mark, evId, me);
      if (it.state === 'rejected' && onServer.has(it.mark.id)) return { mark, state: 'synced', reason: null, note: it.reason ?? null };
      return { mark, state: it.state, reason: it.reason ?? null, note: null };
    });
    for (const m of own) if (!inBox.has(m.id)) myMarks.push({ mark: m, state: 'synced', reason: null, note: null });
    myMarks.sort((a, b) => byTs(b.mark, a.mark));
    const unassigned = own.filter(m => !m.discarded && m.entry_id === null).sort(byTs);
    return {
      loaded: true,
      marks,
      unassigned,
      aside: new Set(keepAside(asideFor(evId, me).ids, unassigned)) as ReadonlySet<string>,
      myMarks,
      pendingCount: box.pendingCount(),
      rejectedCount: items.filter(it => it.state === 'rejected' && !onServer.has(it.mark.id)).length,
      storageFailed: isMemoryOnly(outboxKey(evId, me)),
    };
    // `rev` stands for the outbox, marks cache and set-aside ids, which are mutated in place.
  }, [session, registration, active, rev, outboxFor, cacheFor, asideFor]);

  // A set-aside mark that left "Sem atleta" (identified or discarded, here or by the organization)
  // is no longer set aside: the stored list keeps only marks still waiting (Ruling 55). Only once
  // this tab holds the timekeeper's marks — an empty list while loading must not wipe it.
  useEffect(() => {
    if (!derived.loaded || !session || !registration) return;
    const a = asideFor(session.event.id, registration.timekeeper_id);
    const kept = keepAside(a.ids, derived.unassigned);
    if (kept.length === a.ids.length) return;
    a.ids = kept;
    writeJSON(storage, a.key, kept);
  }, [derived, session, registration, asideFor, storage]);

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
    online: offline === null, offline, linkInvalid, synced, syncError, loadError,
    pendingCount: derived.pendingCount, rejectedCount: derived.rejectedCount, storageFailed: derived.storageFailed,
    clockQuality: clock.synced && rtt !== null ? Math.round(rtt / 2) : null,
    nowMs, marks: derived.marks, unassigned: derived.unassigned, aside: derived.aside, myMarks: derived.myMarks,
    onCourse: onCourseList,
    register, stamp, mark, assign, assignBib, changeLeg, unassign, discard, restore, setAside, retry,
  };
}
