import type { AthleteRow, EntryRow, EventAggregate, RaceRow, TimekeeperRow, WaveRow } from '../lib/types';

export interface EventIndex {
  racesById: Map<string, RaceRow>; wavesById: Map<string, WaveRow>; wavesByRace: Map<string, WaveRow[]>;
  entriesById: Map<string, EntryRow>; entriesByRace: Map<string, EntryRow[]>; athletesById: Map<string, AthleteRow>;
  timekeepersById: Map<string, TimekeeperRow>;
}

function byId<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((r): [string, T] => [r.id, r]));
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

/** Builds lookup/grouping maps for an event's data, shared by every screen that reads it. */
export function indexEvent(a: Pick<EventAggregate, 'races' | 'waves' | 'entries' | 'athletes' | 'timekeepers'>): EventIndex {
  const wavesByRace = groupBy(a.waves, w => w.race_id);
  for (const list of wavesByRace.values()) list.sort((x, y) => x.position - y.position);

  return {
    racesById: byId(a.races),
    wavesById: byId(a.waves),
    wavesByRace,
    entriesById: byId(a.entries),
    entriesByRace: groupBy(a.entries, e => e.race_id),
    athletesById: byId(a.athletes),
    timekeepersById: byId(a.timekeepers),
  };
}

/** The entry's own wave, or the first wave (by position) of its race when `wave_id` is null. */
export function entryWave(entry: EntryRow, idx: EventIndex): WaveRow | null {
  if (entry.wave_id) return idx.wavesById.get(entry.wave_id) ?? null;
  const waves = idx.wavesByRace.get(entry.race_id);
  return waves && waves.length > 0 ? waves[0] : null;
}

/** `team_name` when set; otherwise member athlete names (in member-position order) joined by
 * ' / '; falls back to `Nº <bib>` when no member name can be resolved from the index. */
export function entryDisplayName(entry: EntryRow, idx: EventIndex): string {
  if (entry.team_name) return entry.team_name;
  const names = entry.members
    .slice()
    .sort((a, b) => a.position - b.position)
    .map(m => idx.athletesById.get(m.athlete_id)?.name)
    .filter((n): n is string => !!n);
  return names.length > 0 ? names.join(' / ') : `Nº ${entry.bib}`;
}

/** The id of the member assigned to `legIndex`, or null if no member covers that leg. */
export function legAthleteId(entry: EntryRow, legIndex: number): string | null {
  return entry.members.find(m => m.legs.includes(legIndex))?.athlete_id ?? null;
}

/**
 * Merges a delta (`incoming`) into a known list (`current`) by id: an incoming row replaces the
 * current one with the same id when it is at least as new (`incoming.updated_at >= current.updated_at`),
 * or whenever either side lacks `updated_at` (there is nothing to compare, so the incoming row —
 * freshly fetched — wins); otherwise the current row is kept. Rows with unknown ids are appended.
 * Order is preserved: the original array's order, then newly appended rows in incoming order.
 */
export function mergeById<T extends { id: string; updated_at?: string }>(current: T[], incoming: T[]): T[] {
  const result = current.slice();
  const indexOf = new Map(result.map((row, i): [string, number] => [row.id, i]));
  for (const inc of incoming) {
    const i = indexOf.get(inc.id);
    if (i === undefined) {
      indexOf.set(inc.id, result.length);
      result.push(inc);
    } else {
      const cur = result[i];
      const incomingIsNewer = !cur.updated_at || !inc.updated_at || inc.updated_at >= cur.updated_at;
      if (incomingIsNewer) result[i] = inc;
    }
  }
  return result;
}
