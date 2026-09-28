// The official result of a finalized race on the organizer's screens (B2-I2): what the public page,
// the athletes' statistics and the workbook show is the snapshot stored at finalization
// (`classificationFromResults`), and `snapshotDrift` tells how much the live data moved since.

import type { RaceClassification } from '../../domain/ranking';
import type { AthleteRow } from '../../lib/types';

/** `Há N alterações depois da finalização — reabra e finalize de novo para oficializá-las.` */
export function driftMessage(n: number): string {
  return n === 1
    ? 'Há 1 alteração depois da finalização — reabra e finalize de novo para oficializá-la.'
    : `Há ${n} alterações depois da finalização — reabra e finalize de novo para oficializá-las.`;
}

/** `1 erro` / `2 erros`: a count with its word in the right number (no "(s)" plurals, B2-m12). */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The athletes the results views name members from, plus the names frozen in a snapshot for
 * athletes no longer registered (deleted after finalizing) — so an official row never shows "?".
 */
export function withSnapshotNames(athletesById: Map<string, AthleteRow>, cls: RaceClassification): Map<string, AthleteRow> {
  let merged: Map<string, AthleteRow> | null = null;
  for (const row of cls.rows) {
    for (const m of row.entry.members) {
      if (athletesById.has(m.athlete_id) || !m.name) continue;
      merged ??= new Map(athletesById);
      merged.set(m.athlete_id, {
        id: m.athlete_id, name: m.name, sex: 'M', birth_date: null, city: null, team_club: null, public_profile: false,
      });
    }
  }
  return merged ?? athletesById;
}
