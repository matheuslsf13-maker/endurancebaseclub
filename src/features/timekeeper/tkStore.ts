// Pure helpers behind the timekeeper app (spec §7): turning outbox items into mark rows, the
// merged view of server + local marks, new marks stamped with the synced clock, leg assignment
// and the "Em prova" list. No I/O and no clock reads here — time always comes in as arguments.

import type { AthleteRow, EntryRow, MarkRow, RaceRow, TkMarkInput, TkSession, WaveRow } from '../../lib/types';
import type { ClockState } from '../../lib/clock';
import type { LocalMark, OutboxItem } from '../../lib/outbox';
import { computeEntryTiming } from '../../domain/consolidation';
import type { EntryTiming } from '../../domain/consolidation';
import { entryDisplayName, entryWave, indexEvent, legAthleteId } from '../../domain/eventModel';
import type { EventIndex } from '../../domain/eventModel';
import { suggestLeg } from '../../domain/suggestLeg';
import type { LegSuggestion } from '../../domain/suggestLeg';

const iso = (ms: number) => new Date(ms).toISOString();

/** The server's view of a mark that so far only exists (or was last edited) on this device. */
export function localToMarkRow(m: LocalMark, eventId: string, timekeeperId: string): MarkRow {
  return {
    id: m.id, event_id: eventId, timekeeper_id: timekeeperId, ts: m.ts, device_ts: m.device_ts,
    clock_offset_ms: m.clock_offset_ms, clock_rtt_ms: m.clock_rtt_ms,
    entry_id: m.entry_id, leg_index: m.leg_index, athlete_id: m.athlete_id,
    discarded: m.discarded, discarded_by: m.discarded ? 'timekeeper' : null,
    created_at: m.ts, updated_at: iso(m.local_updated_at),
  };
}

/**
 * Every mark this device knows: the server's copies, where a `pending` local item (an edit not
 * acknowledged yet) overrides the server copy — a synced or rejected one never does, so an
 * organizer's move wins (Ruling 27) — plus local marks the server has not returned yet. A
 * rejected mark the server never stored is left out: it does not exist for the event (it stays
 * listed with its reason in "Minhas marcações").
 */
export function mergedMarks(server: MarkRow[], local: OutboxItem[], eventId: string, timekeeperId: string): MarkRow[] {
  const localById = new Map(local.map((it): [string, OutboxItem] => [it.mark.id, it]));
  const serverIds = new Set<string>();
  const merged = server.map(row => {
    serverIds.add(row.id);
    const it = localById.get(row.id);
    return it && it.state === 'pending' ? localToMarkRow(it.mark, eventId, timekeeperId) : row;
  });
  for (const it of local) {
    if (serverIds.has(it.mark.id) || it.state === 'rejected') continue;
    merged.push(localToMarkRow(it.mark, eventId, timekeeperId));
  }
  return merged;
}

/** The fields a timekeeper sends for a mark (tk_sync payload), taken from a full row. */
export function markToInput(m: MarkRow): TkMarkInput {
  return {
    id: m.id, ts: m.ts, device_ts: m.device_ts, clock_offset_ms: m.clock_offset_ms, clock_rtt_ms: m.clock_rtt_ms,
    entry_id: m.entry_id, leg_index: m.leg_index, athlete_id: m.athlete_id, discarded: m.discarded,
  };
}

/** RFC 4122 v4 id. `crypto.randomUUID` only exists in secure contexts (https/localhost); a phone
 * opening the dev server over the LAN must still be able to mark, so fall back to random bytes. */
function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** A new, unassigned mark at the synced instant `nowMs`; the device time and the clock state
 * travel with it for auditing (null offset/RTT = the clock had never synced). */
export function newMark(nowMs: number, deviceNowMs: number, clock: ClockState | null): TkMarkInput {
  return {
    id: uuid(), ts: iso(nowMs), device_ts: iso(deviceNowMs),
    clock_offset_ms: clock ? clock.offset_ms : null, clock_rtt_ms: clock ? clock.rtt_ms : null,
    entry_id: null, leg_index: null, athlete_id: null, discarded: false,
  };
}

/** `mark` filed under `entryId` on the suggested leg (and that leg's athlete). */
export function withSuggestion(mark: TkMarkInput, entryId: string, suggestion: LegSuggestion): TkMarkInput {
  return { ...mark, entry_id: entryId, leg_index: suggestion.leg_index, athlete_id: suggestion.athlete_id };
}

/** Files `mark` under `entry` on the leg `suggestLeg` picks from the other known marks (the mark
 * itself is left out so it can never "confirm" its own crossing). */
export function assignMark(
  mark: TkMarkInput, entry: EntryRow, race: RaceRow, allMarks: MarkRow[], athleteId?: string | null,
): { mark: TkMarkInput; suggestion: LegSuggestion } {
  const others = allMarks.filter(m => m.id !== mark.id);
  const suggestion = suggestLeg({ entry, race, marks: others, tsMs: Date.parse(mark.ts), athleteId });
  return { mark: withSuggestion(mark, entry.id, suggestion), suggestion };
}

/** "perna 2/2 (Corrida)" — Ruling 8: never "fim da <rótulo>" (wrong gender for "Ciclismo"). */
export function legText(race: RaceRow, legIndex: number): string {
  return `perna ${legIndex + 1}/${race.legs.length} (${race.legs[legIndex]?.label ?? ''})`;
}

/** The assignment toast line: `✓ Nº 101 · Matheus · fim da perna 2/2 (Corrida)`. */
export function assignmentMessage(entry: EntryRow, race: RaceRow, suggestion: LegSuggestion, athleteName: string): string {
  const leg = `fim da ${legText(race, suggestion.leg_index)}`;
  if (suggestion.warning === 'already_finished') return `Nº ${entry.bib} já concluiu — registrada como ${leg}`;
  return `✓ Nº ${entry.bib} · ${athleteName} · ${leg}`;
}

/** Name of the member doing `athleteId`'s legs, as embedded by tk_open. */
export function memberName(entry: EntryRow, athleteId: string | null): string | null {
  if (athleteId === null) return null;
  return entry.members.find(m => m.athlete_id === athleteId)?.name ?? null;
}

/**
 * `indexEvent` over a tk_open session. The session has no athlete list — member names come
 * embedded in the entries — so minimal athlete rows are synthesized from them; only `name` is
 * meaningful (used by `entryDisplayName`).
 */
export function sessionIndex(session: TkSession): EventIndex {
  const athletes = new Map<string, AthleteRow>();
  for (const e of session.entries) {
    for (const m of e.members) {
      if (m.name && !athletes.has(m.athlete_id)) {
        athletes.set(m.athlete_id, {
          id: m.athlete_id, name: m.name, sex: 'M', birth_date: null, city: null, team_club: null, public_profile: false,
        });
      }
    }
  }
  return indexEvent({ ...session, athletes: [...athletes.values()] });
}

/** The session with the wave starts tk_sync reports (it returns every wave of the event); the same
 * object when nothing changed, so callers can skip re-rendering and re-saving. */
export function applyWaveStarts(session: TkSession, waves: Pick<WaveRow, 'id' | 'start_at'>[]): TkSession {
  const startById = new Map(waves.map((w): [string, string | null] => [w.id, w.start_at]));
  let changed = false;
  const next = session.waves.map(w => {
    const start = startById.get(w.id);
    if (start === undefined || start === w.start_at) return w;
    changed = true;
    return { ...w, start_at: start };
  });
  return changed ? { ...session, waves: next } : session;
}

/** A crossing other timekeepers can still confirm: shown pinned on top of "Em prova" (Ruling 22). */
export interface ConfirmInfo {
  leg_index: number; leg_label: string; leg_ms: number | null; crossing_ms: number;
  /** Whole seconds left in the same-crossing window (1..window). */
  remaining_s: number;
}

export interface OnCourseItem {
  entry: EntryRow; race: RaceRow; timing: EntryTiming;
  /** Team name or member names. */
  displayName: string;
  /** Leg being done now; null for a finished entry (listed only while `confirm` is set). */
  legIndex: number | null;
  /** Label and athlete of the current leg (of the last leg once finished). */
  legLabel: string; athleteName: string;
  /** Time on the current leg; for a finished entry, time since the finish. */
  legElapsedMs: number;
  confirm: ConfirmInfo | null;
}

const bibCollator = new Intl.Collator('pt-BR', { numeric: true });

/**
 * The "Em prova" list: entries on course (their wave started or a crossing is already known),
 * sorted by time on the current leg, longest first (the next ones to arrive). An entry whose
 * latest crossing is still inside the same-crossing window — a relay handoff or a finish — is
 * pinned on top, most recent first, and stays listed even once finished until the window closes,
 * so the card just tapped does not jump away and the other timekeepers can confirm it (Ruling 22).
 */
export function onCourse(session: TkSession, marks: MarkRow[], nowMs: number): OnCourseItem[] {
  const idx = sessionIndex(session);
  const marksByEntry = new Map<string, MarkRow[]>();
  for (const m of marks) {
    if (m.entry_id === null) continue;
    const list = marksByEntry.get(m.entry_id);
    if (list) list.push(m);
    else marksByEntry.set(m.entry_id, [m]);
  }

  const items: OnCourseItem[] = [];
  for (const entry of session.entries) {
    const race = idx.racesById.get(entry.race_id);
    if (!race || race.legs.length === 0) continue;
    const timing = computeEntryTiming(entry, race, entryWave(entry, idx), marksByEntry.get(entry.id) ?? [], []);
    const running = timing.status === 'on_course' && timing.current_leg !== null && timing.current_leg_start_ms !== null;
    if (!running && timing.status !== 'finished') continue;

    let latest: { leg: number; at: number } | null = null;
    for (const lt of timing.legs) {
      const at = lt.crossing.median_ms;
      if (at !== null && (latest === null || at > latest.at)) latest = { leg: lt.leg_index, at };
    }
    const windowMs = race.config.same_crossing_window_s * 1000;
    const confirm: ConfirmInfo | null = latest !== null && nowMs - latest.at < windowMs && latest.at - nowMs <= windowMs
      ? {
          leg_index: latest.leg, leg_label: race.legs[latest.leg].label, leg_ms: timing.legs[latest.leg].leg_ms,
          crossing_ms: latest.at,
          remaining_s: Math.min(race.config.same_crossing_window_s, Math.ceil((latest.at + windowMs - nowMs) / 1000)),
        }
      : null;
    if (!running && confirm === null) continue;

    const displayName = entryDisplayName(entry, idx);
    const leg = running ? (timing.current_leg as number) : race.legs.length - 1;
    items.push({
      entry, race, timing, displayName,
      legIndex: running ? leg : null,
      legLabel: race.legs[leg].label,
      athleteName: memberName(entry, legAthleteId(entry, leg)) ?? displayName,
      legElapsedMs: running ? nowMs - (timing.current_leg_start_ms as number) : nowMs - (confirm as ConfirmInfo).crossing_ms,
      confirm,
    });
  }

  return items.sort((a, b) => {
    if (a.confirm && b.confirm) return b.confirm.crossing_ms - a.confirm.crossing_ms || bibCollator.compare(a.entry.bib, b.entry.bib);
    if (a.confirm) return -1;
    if (b.confirm) return 1;
    return b.legElapsedMs - a.legElapsedMs || bibCollator.compare(a.entry.bib, b.entry.bib);
  });
}
