import type { ResultRow, SnapshotStatus } from '../lib/types';
import { computeAthleteStats } from './stats';
import type { AthleteStats } from './stats';

export type TogetherSummary = Pick<AthleteStats, 'participations' | 'finishes' | 'wins_overall' | 'wins_category' | 'podiums' | 'best_overall_pos' | 'avg_percentile'>;
export interface TogetherRace {
  race_id: string; entry_id: string; event_name: string; event_date: string; race_name: string;
  team_name: string | null; status: SnapshotStatus; final_ms: number | null; overall_pos: number | null; finishers: number;
  members: { athlete_id: string; name: string; legs: { label: string; time_ms: number | null }[] }[];
}
export interface TogetherStats { summary: TogetherSummary; races: TogetherRace[] }

export interface HeadToHeadSide { entry_id: string; status: SnapshotStatus; final_ms: number | null; overall_pos: number | null }
export interface HeadToHeadRace {
  race_id: string; event_name: string; event_date: string; race_name: string;
  a: HeadToHeadSide; b: HeadToHeadSide; winner: 'a' | 'b' | null; diff_ms: number | null;
}
export interface HeadToHead { a_wins: number; b_wins: number; no_decision: number; races: HeadToHeadRace[] }

/** Newest event first, then race name (pt-BR). */
function byDateDesc(x: { event_date: string; race_name: string }, y: { event_date: string; race_name: string }): number {
  if (x.event_date !== y.event_date) return x.event_date < y.event_date ? 1 : -1;
  return x.race_name.localeCompare(y.race_name, 'pt-BR');
}

/**
 * Spec 2026-09-28 §5.2: the results where `a` and `b` were in the same entry (a team). The summary
 * uses §10's definitions through computeAthleteStats, so it matches the profiles; the numbers are
 * the entry's, identical for both members. null when they never shared an entry.
 */
export function computeTogether(a: string, b: string, results: ResultRow[]): TogetherStats | null {
  const together = results.filter(r => r.athlete_ids.includes(a) && r.athlete_ids.includes(b));
  if (together.length === 0) return null;
  const s = computeAthleteStats(a, together);
  const summary: TogetherSummary = {
    participations: s.participations, finishes: s.finishes, wins_overall: s.wins_overall, wins_category: s.wins_category,
    podiums: s.podiums, best_overall_pos: s.best_overall_pos, avg_percentile: s.avg_percentile,
  };
  const races: TogetherRace[] = together.map(r => ({
    race_id: r.race_id, entry_id: r.entry_id, event_name: r.data.event.name, event_date: r.data.event.date,
    race_name: r.data.race.name, team_name: r.data.team_name, status: r.status, final_ms: r.final_ms,
    overall_pos: r.overall_pos, finishers: r.data.positions.finishers,
    members: r.data.members.map(m => ({
      athlete_id: m.athlete_id, name: m.name,
      legs: r.data.legs.filter(l => l.athlete_id === m.athlete_id).map(l => ({ label: l.label, time_ms: l.time_ms })),
    })),
  }));
  races.sort(byDateDesc);
  return { summary, races };
}

const started = (s: SnapshotStatus): boolean => s !== 'dns' && s !== 'not_started';
const side = (r: ResultRow): HeadToHeadSide => ({ entry_id: r.entry_id, status: r.status, final_ms: r.final_ms, overall_pos: r.overall_pos });

/**
 * Spec 2026-09-28 §5.3: the same race (`race_id`), `a` and `b` each in their own entry, both
 * started (a DNS or not-started side drops the race). Both placed: the better position wins, and a
 * shared position is no decision. Only one placed (the other DNF/DSQ/on course): the placed one
 * wins. Neither placed: no decision. `diff_ms` = b.final_ms − a.final_ms only when both concluded
 * with a position (the approved design's "quando os dois concluíram"): a DSQ side's faster time would
 * otherwise read as the winner's margin.
 * null when there is no such race.
 */
export function computeHeadToHead(a: string, b: string, results: ResultRow[]): HeadToHead | null {
  const aByRace = new Map<string, ResultRow>();
  const bByRace = new Map<string, ResultRow>();
  for (const r of results) {
    const hasA = r.athlete_ids.includes(a);
    const hasB = r.athlete_ids.includes(b);
    if (hasA && !hasB) aByRace.set(r.race_id, r);
    else if (hasB && !hasA) bByRace.set(r.race_id, r);
  }

  const races: HeadToHeadRace[] = [];
  let a_wins = 0, b_wins = 0, no_decision = 0;
  for (const [raceId, ra] of aByRace) {
    const rb = bByRace.get(raceId);
    if (!rb || !started(ra.status) || !started(rb.status)) continue;
    const pa = ra.overall_pos, pb = rb.overall_pos;
    let winner: 'a' | 'b' | null = null;
    if (pa !== null && pb !== null) winner = pa < pb ? 'a' : pb < pa ? 'b' : null;
    else if (pa !== null) winner = 'a';
    else if (pb !== null) winner = 'b';
    if (winner === 'a') a_wins++;
    else if (winner === 'b') b_wins++;
    else no_decision++;
    races.push({
      race_id: raceId, event_name: ra.data.event.name, event_date: ra.data.event.date, race_name: ra.data.race.name,
      a: side(ra), b: side(rb), winner,
      diff_ms: pa !== null && pb !== null && ra.final_ms !== null && rb.final_ms !== null ? rb.final_ms - ra.final_ms : null,
    });
  }
  if (races.length === 0) return null;
  races.sort(byDateDesc);
  return { a_wins, b_wins, no_decision, races };
}
