import type { EntrySex, Modality, ResultRow, ResultSnapshot, SnapshotStatus } from '../../lib/types';

export interface ResultLegSpec { athlete_id: string | null; modality?: Modality; label?: string; distance_m?: number | null; time_ms: number | null }
export interface ResultSpec {
  race_id: string; entry_id: string; date: string;
  members: { athlete_id: string; name: string }[];
  event?: string; race?: string; team_name?: string | null; sex?: EntrySex;
  legs?: ResultLegSpec[]; status?: SnapshotStatus; final_ms?: number | null; overall_pos?: number | null;
  finishers?: number; podiums?: ResultSnapshot['podiums'];
}

/**
 * A finalized result row (spec §10 snapshot) for domain and UI tests. Defaults: event
 * "Evento <date>", race "Corrida 5 km", one run 5 km leg by the first member timed at `final_ms`,
 * status finished when `final_ms` is set (else dnf), 10 finishers, no podium, team name "Equipe"
 * for more than one member.
 */
export function makeResult(s: ResultSpec): ResultRow {
  const final_ms = s.final_ms ?? null;
  const status: SnapshotStatus = s.status ?? (final_ms !== null ? 'finished' : 'dnf');
  const legs = (s.legs ?? [{ athlete_id: s.members[0]?.athlete_id ?? null, time_ms: final_ms }]).map((l, i) => ({
    leg_index: i,
    modality: l.modality ?? 'run',
    label: l.label ?? 'Corrida',
    distance_m: l.distance_m === undefined ? 5000 : l.distance_m,
    athlete_id: l.athlete_id,
    time_ms: l.time_ms,
  }));
  const data: ResultSnapshot = {
    event: { id: `ev-${s.date}`, name: s.event ?? `Evento ${s.date}`, date: s.date },
    race: { id: s.race_id, name: s.race ?? 'Corrida 5 km', team_size: s.members.length },
    bib: '1',
    team_name: s.team_name ?? (s.members.length > 1 ? 'Equipe' : null),
    members: s.members.map((m) => ({
      athlete_id: m.athlete_id, name: m.name,
      legs: legs.filter((l) => l.athlete_id === m.athlete_id).map((l) => l.leg_index),
    })),
    legs,
    category: { sex: s.sex ?? 'F', age: null, age_group: null, level: null },
    status, total_ms: final_ms, penalty_ms: 0, final_ms,
    positions: { overall: s.overall_pos ?? null, sex: null, finishers: s.finishers ?? 10 },
    podiums: s.podiums ?? [],
  };
  return {
    race_id: s.race_id, entry_id: s.entry_id, event_id: data.event.id, athlete_ids: s.members.map((m) => m.athlete_id),
    status, final_ms, overall_pos: s.overall_pos ?? null, data, finalized_at: `${s.date}T20:00:00Z`,
  };
}
