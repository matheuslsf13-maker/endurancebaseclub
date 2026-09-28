import type { Modality, PublicAthleteRow, ResultRow } from '../lib/types';
import { formatDistance, formatPace } from '../lib/format';
import { MODALITY_LABEL } from './presets';
import { computeAthleteStats, filterResultsByYear, qualifyingLegs } from './stats';
import type { QualifyingLeg } from './stats';

export type SexFilter = 'M' | 'F' | null;
export interface ClubFilter { year: string | null; sex: SexFilter }
export interface LeaderRow { athlete_id: string; name: string; value: number; pos: number }
export interface Leaders { wins: LeaderRow[]; podiums: LeaderRow[]; finishes: LeaderRow[]; km: LeaderRow[] }
export interface ClubRecordEntry { athlete_id: string; name: string; time_ms: number; pace: string; event_name: string; event_date: string }
export interface ClubRecordGroup { modality: Modality; distance_m: number; title: string; entries: ClubRecordEntry[] }

export const LEADERS_CUTOFF = 10;
export const RECORDS_PER_GROUP = 3;
export const MODALITY_ORDER: Modality[] = ['run', 'swim', 'bike', 'other'];

function eligible(athletes: PublicAthleteRow[], sex: SexFilter): PublicAthleteRow[] {
  return sex === null ? athletes : athletes.filter(a => a.sex === sex);
}

/** Competition ranking by value (desc; ties share the position: 1, 1, 3), names A→Z (pt-BR) inside
 * a tie; zero values left out; cut at position LEADERS_CUTOFF, so everyone tied with the 10th stays. */
export function rankLeaders(rows: { athlete_id: string; name: string; value: number }[]): LeaderRow[] {
  const sorted = rows.filter(r => r.value > 0).sort((x, y) => y.value - x.value || x.name.localeCompare(y.name, 'pt-BR'));
  const out: LeaderRow[] = [];
  sorted.forEach((r, i) => {
    const pos = i > 0 && r.value === sorted[i - 1].value ? out[i - 1].pos : i + 1;
    out.push({ ...r, pos });
  });
  return out.filter(r => r.pos <= LEADERS_CUTOFF);
}

/**
 * Spec 2026-09-28 §5.4: per public athlete (optionally one registered sex), over the year's
 * results, with §10's definitions — computeAthleteStats, the same function behind the profile, so a
 * board never disagrees with a profile (a team win counts for every member). km comes from the
 * athlete's own qualifying legs, summed in integer meters, so equal totals tie exactly.
 */
export function computeLeaders(athletes: PublicAthleteRow[], results: ResultRow[], filter: ClubFilter): Leaders {
  const inYear = filterResultsByYear(results, filter.year);
  const rows = eligible(athletes, filter.sex).map(a => {
    const mine = inYear.filter(r => r.athlete_ids.includes(a.id));
    const s = computeAthleteStats(a.id, mine);
    const meters = qualifyingLegs(mine).filter(l => l.athlete_id === a.id).reduce((sum, l) => sum + l.distance_m, 0);
    return { athlete_id: a.id, name: a.name, wins: s.wins_overall, podiums: s.podiums, finishes: s.finishes, meters };
  });
  const board = (pick: (r: (typeof rows)[number]) => number) => rankLeaders(rows.map(r => ({ athlete_id: r.athlete_id, name: r.name, value: pick(r) })));
  return {
    wins: board(r => r.wins),
    podiums: board(r => r.podiums),
    finishes: board(r => r.finishes),
    km: board(r => r.meters).map(r => ({ ...r, value: r.value / 1000 })),
  };
}

/** Spec 2026-09-28 §5.5: the best qualifying leg of each public athlete (optionally one sex) per
 * (modality, distance) over the year; the RECORDS_PER_GROUP best athletes of each group. A time tie
 * goes to the earlier date (who did it first holds the record), then to the name. Groups by
 * MODALITY_ORDER, then distance ascending. */
export function computeClubRecords(athletes: PublicAthleteRow[], results: ResultRow[], filter: ClubFilter): ClubRecordGroup[] {
  const byId = new Map(eligible(athletes, filter.sex).map(a => [a.id, a]));
  const best = new Map<string, Map<string, QualifyingLeg>>(); // "modality|distance" -> athlete id -> best leg
  for (const leg of qualifyingLegs(filterResultsByYear(results, filter.year))) {
    if (!byId.has(leg.athlete_id)) continue;
    const key = `${leg.modality}|${leg.distance_m}`;
    const group = best.get(key) ?? new Map<string, QualifyingLeg>();
    const current = group.get(leg.athlete_id);
    if (!current || leg.time_ms < current.time_ms || (leg.time_ms === current.time_ms && leg.date < current.date)) {
      group.set(leg.athlete_id, leg);
    }
    best.set(key, group);
  }

  const nameOf = (id: string) => byId.get(id)!.name;
  const groups: ClubRecordGroup[] = [];
  for (const group of best.values()) {
    const legs = [...group.values()].sort((x, y) =>
      x.time_ms - y.time_ms || (x.date < y.date ? -1 : x.date > y.date ? 1 : 0) || nameOf(x.athlete_id).localeCompare(nameOf(y.athlete_id), 'pt-BR'));
    const { modality, distance_m } = legs[0];
    groups.push({
      modality, distance_m, title: `${MODALITY_LABEL[modality]} ${formatDistance(distance_m)}`,
      entries: legs.slice(0, RECORDS_PER_GROUP).map(l => ({
        athlete_id: l.athlete_id, name: nameOf(l.athlete_id), time_ms: l.time_ms,
        pace: formatPace(l.time_ms, l.distance_m, l.modality), event_name: l.event_name, event_date: l.date,
      })),
    });
  }
  return groups.sort((x, y) => MODALITY_ORDER.indexOf(x.modality) - MODALITY_ORDER.indexOf(y.modality) || x.distance_m - y.distance_m);
}
