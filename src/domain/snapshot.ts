import type { AthleteRow, EntryRow, EventRow, FinalizeRowInput, RaceRow, ResultRow, ResultSnapshot } from '../lib/types';
import type { EntryCategory } from './categories';
import type { Crossing, EntryTiming, LegTiming } from './consolidation';
import { legAthleteId } from './eventModel';
import { compareBib, compareGroupOrder, UNRANKED_STATUS_ORDER } from './ranking';
import type { PodiumGroup, PodiumPlace, RaceClassification, RankedEntry } from './ranking';

type SnapshotPodium = ResultSnapshot['podiums'][number];

/** Every podium place `cls.podiums` awarded, indexed by the winning entry's id (an entry can
 * appear under more than one ranking, e.g. under a cumulative config). */
function podiumsByEntry(cls: RaceClassification): Map<string, SnapshotPodium[]> {
  const map = new Map<string, SnapshotPodium[]>();
  for (const group of cls.podiums) {
    for (const place of group.places) {
      const entry = place.ranked.entry.id;
      const list = map.get(entry) ?? [];
      list.push({ ranking_id: group.ranking.id, ranking_name: group.ranking.name, group_label: group.group_label, podium_pos: place.podium_pos });
      map.set(entry, list);
    }
  }
  return map;
}

/** Builds one `FinalizeRowInput` for `r`, snapshotting everything `admin_finalize_race` needs to
 * persist independently of the live timing/config data (spec §9): category, per-leg times and the
 * podium places `r` won. */
function buildRow(event: EventRow, cls: RaceClassification, r: RankedEntry, athletesById: Map<string, AthleteRow>, podiums: SnapshotPodium[]): FinalizeRowInput {
  const { entry, timing, category } = r;
  const members = entry.members.slice().sort((a, b) => a.position - b.position);

  const data: ResultSnapshot = {
    event: { id: event.id, name: event.name, date: event.date },
    race: { id: cls.race.id, name: cls.race.name, team_size: cls.race.team_size },
    bib: entry.bib,
    team_name: entry.team_name,
    members: members.map(m => ({ athlete_id: m.athlete_id, name: athletesById.get(m.athlete_id)?.name ?? m.name ?? '', legs: m.legs })),
    legs: cls.race.legs.map((leg, k) => ({
      leg_index: k, modality: leg.modality, label: leg.label, distance_m: leg.distance_m,
      athlete_id: legAthleteId(entry, k), time_ms: timing.legs[k]?.leg_ms ?? null,
    })),
    category,
    status: timing.status,
    total_ms: timing.total_ms,
    penalty_ms: entry.penalty_ms,
    final_ms: timing.final_ms,
    positions: { overall: r.overall_pos, sex: r.sex_pos, finishers: cls.finishers },
    podiums,
  };

  return {
    entry_id: entry.id,
    athlete_ids: members.map(m => m.athlete_id),
    status: timing.status,
    final_ms: timing.final_ms,
    overall_pos: r.overall_pos,
    data,
  };
}

/**
 * Builds the rows `admin_finalize_race` persists (spec §9): one `FinalizeRowInput` per row of
 * `cls.rows`, ranked and unranked alike, so finalizing a race snapshots the classification exactly
 * as computed instead of leaving results dependent on live timing/config data that can change later.
 */
export function buildFinalizeRows(event: EventRow, cls: RaceClassification, athletesById: Map<string, AthleteRow>): FinalizeRowInput[] {
  const byEntry = podiumsByEntry(cls);
  return cls.rows.map(r => buildRow(event, cls, r, athletesById, byEntry.get(r.entry.id) ?? []));
}

// ---------------------------------------------------------------------------------------------
// Official (finalized) races: `results` carries a frozen `ResultSnapshot` per entry (spec §9,
// `admin_finalize_race`). `classificationFromResults` rebuilds the `RaceClassification` every
// results view already understands (ClassificationTable and PodiumView — Ruling 41 — and the
// workbook's Classificação/Pódios sheets) from those rows alone, so the public page, the
// organizer's results tab and the XLSX all show the same official result (B1-I1/B2-I2).
// `snapshotDrift` says which entries the live computation now disagrees on, i.e. what finalizing
// again would change.
// ---------------------------------------------------------------------------------------------

/** A `Crossing` stub for a snapshot leg: the results views only read `leg_ms`/`official_ms` off
 * it, so the rest is filled with neutral values purely to satisfy the type. */
function stubCrossing(legIndex: number, ms: number | null): Crossing {
  return {
    leg_index: legIndex, candidates: [], duplicates: [],
    median_ms: ms, spread_ms: null, system_ms: ms, system_source: ms !== null ? 'median' : null,
    official_ms: ms, official_source: ms !== null ? 'median' : null,
    resolution: null, divergent: false, chosen_mark_discarded: false,
  };
}

/** The minimal `EntryRow` a snapshot row carries: bib, team name, level, member names and the
 * penalty applied at finalize time. */
function entryFromSnapshot(r: ResultRow): EntryRow {
  return {
    id: r.entry_id, event_id: r.event_id, race_id: r.race_id, wave_id: null,
    bib: r.data.bib, team_name: r.data.team_name, level: r.data.category.level,
    status: 'ok', penalty_ms: r.data.penalty_ms, notes: '',
    members: r.data.members.map((m, i) => ({ athlete_id: m.athlete_id, position: i, legs: m.legs, name: m.name })),
  };
}

function timingFromSnapshot(r: ResultRow): EntryTiming {
  const legs: LegTiming[] = r.data.legs.map(l => ({
    leg_index: l.leg_index, athlete_id: l.athlete_id, crossing: stubCrossing(l.leg_index, l.time_ms), start_ms: null, leg_ms: l.time_ms,
  }));
  return {
    entry_id: r.entry_id, race_id: r.race_id, start_ms: null, legs,
    total_ms: r.data.total_ms, final_ms: r.data.final_ms, status: r.data.status,
    current_leg: null, current_leg_start_ms: null,
  };
}

/** Groups every entry's frozen `data.podiums` places by ranking + group label, resolving the full
 * `RankingDef` from the race's current config when it still has that ranking (a name-only stub
 * otherwise — the config may have changed since finalization). Groups follow the race's ranking
 * order, then the canonical group order `buildPodiums` uses live (`compareGroupOrder`, spec §9). */
function reconstructPodiums(race: RaceRow, results: ResultRow[], rowsByEntry: Map<string, RankedEntry>, levels: string[]): PodiumGroup[] {
  const groups = new Map<string, PodiumGroup>();
  const groupCategory = new Map<string, EntryCategory>();
  for (const r of results) {
    const ranked = rowsByEntry.get(r.entry_id);
    if (!ranked) continue;
    for (const p of r.data.podiums) {
      const key = `${p.ranking_id}::${p.group_label}`;
      let group = groups.get(key);
      if (!group) {
        const rankingDef = race.config.rankings.find(rd => rd.id === p.ranking_id) ?? {
          id: p.ranking_id, name: p.ranking_name, dims: [], size: 3,
        };
        group = { ranking: rankingDef, group_key: key, group_label: p.group_label, places: [] };
        groups.set(key, group);
        groupCategory.set(key, r.data.category);
      }
      group.places.push({ podium_pos: p.podium_pos, ranked });
    }
  }
  const byPlace = (a: PodiumPlace, b: PodiumPlace): number => a.podium_pos - b.podium_pos || compareBib(a.ranked.entry, b.ranked.entry);
  for (const g of groups.values()) g.places.sort(byPlace);
  const order = race.config.rankings.map(rd => rd.id);
  return [...groups.values()].sort((a, b) => {
    const ai = order.indexOf(a.ranking.id);
    const bi = order.indexOf(b.ranking.id);
    const rankingOrder = (ai === -1 ? order.length : ai) - (bi === -1 ? order.length : bi);
    if (rankingOrder !== 0) return rankingOrder;
    return compareGroupOrder(a.ranking.dims, groupCategory.get(a.group_key)!, groupCategory.get(b.group_key)!, race.config.age_groups, levels);
  });
}

/**
 * The official classification of a finalized `race`, rebuilt from its stored `results` (rows of
 * other races are ignored): ranked rows by their frozen `overall_pos` (bib as tie-break), then the
 * unranked ones in the live status order, gaps to the leader, and the frozen podiums — nothing is
 * recomputed from marks, entries or config. `levels`: the event's levels (podium group order).
 */
export function classificationFromResults(race: RaceRow, results: ResultRow[], levels: string[]): RaceClassification {
  const own = results.filter(r => r.race_id === race.id);
  const rowsByEntry = new Map<string, RankedEntry>();
  const built = own.map(r => {
    const ranked: RankedEntry = {
      entry: entryFromSnapshot(r), timing: timingFromSnapshot(r), category: r.data.category,
      overall_pos: r.overall_pos, sex_pos: r.data.positions.sex,
      ranking_pos: Object.fromEntries(race.config.rankings.map(rd => [rd.id, null])),
      gap_ms: null,
    };
    rowsByEntry.set(r.entry_id, ranked);
    return ranked;
  });

  const ranked = built
    .filter(r => r.overall_pos !== null)
    .sort((a, b) => (a.overall_pos as number) - (b.overall_pos as number) || compareBib(a.entry, b.entry));
  const unranked = built
    .filter(r => r.overall_pos === null)
    .sort((a, b) => UNRANKED_STATUS_ORDER[a.timing.status] - UNRANKED_STATUS_ORDER[b.timing.status] || compareBib(a.entry, b.entry));

  const leaderFinal = ranked.length > 0 ? ranked[0].timing.final_ms : null;
  for (const r of ranked) {
    r.gap_ms = leaderFinal !== null && r.timing.final_ms !== null ? r.timing.final_ms - leaderFinal : null;
  }

  return { race, rows: [...ranked, ...unranked], finishers: ranked.length, podiums: reconstructPodiums(race, own, rowsByEntry, levels) };
}

/** What differs for one entry between the live classification and the finalized snapshot. */
export type DriftField = 'status' | 'final_ms' | 'overall_pos' | 'podiums';
export interface EntryDrift {
  entry_id: string;
  bib: string;
  /** `added`: registered after finalization; `removed`: in the snapshot but no longer in the race. */
  change: 'added' | 'removed' | 'changed';
  /** For `changed`, in this order: status, final_ms, overall_pos, podiums (empty otherwise). */
  fields: DriftField[];
}

const podiumSet = (list: SnapshotPodium[]): string =>
  list.map(p => `${p.ranking_id}|${p.group_label}|${p.podium_pos}`).sort().join(';');

/**
 * Per entry of a finalized race, what the live computation (`live`, e.g. EventContext's
 * classification of that race) now disagrees with in the stored snapshot (`results`; other races
 * ignored) — exactly what finalizing again would change: status, final time, overall position and
 * podium places. Live rows first (classification order), then entries only the snapshot has. An
 * empty list means the official result still matches the live data; `.length` is the number of
 * entries with changes ("Há N alterações depois da finalização").
 */
export function snapshotDrift(live: RaceClassification, results: ResultRow[]): EntryDrift[] {
  const stored = new Map(results.filter(r => r.race_id === live.race.id).map(r => [r.entry_id, r] as const));
  const livePodiums = podiumsByEntry(live);
  const drift: EntryDrift[] = [];

  for (const row of live.rows) {
    const snap = stored.get(row.entry.id);
    if (!snap) {
      drift.push({ entry_id: row.entry.id, bib: row.entry.bib, change: 'added', fields: [] });
      continue;
    }
    stored.delete(row.entry.id);
    const fields: DriftField[] = [];
    if (row.timing.status !== snap.status) fields.push('status');
    if (row.timing.final_ms !== snap.final_ms) fields.push('final_ms');
    if (row.overall_pos !== snap.overall_pos) fields.push('overall_pos');
    if (podiumSet(livePodiums.get(row.entry.id) ?? []) !== podiumSet(snap.data.podiums)) fields.push('podiums');
    if (fields.length > 0) drift.push({ entry_id: row.entry.id, bib: row.entry.bib, change: 'changed', fields });
  }
  for (const snap of stored.values()) {
    drift.push({ entry_id: snap.entry_id, bib: snap.data.bib, change: 'removed', fields: [] });
  }
  return drift;
}
