import type { AthleteRow, EventRow, FinalizeRowInput, ResultSnapshot } from '../lib/types';
import { legAthleteId } from './eventModel';
import type { RaceClassification, RankedEntry } from './ranking';

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
