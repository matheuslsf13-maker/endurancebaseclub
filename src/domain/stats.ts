import type { Modality, ResultRow, ResultSnapshot, SnapshotStatus } from '../lib/types';
import { formatPace } from '../lib/format';
import { sexLabel } from './categories';

export interface AthleteStats {
  participations: number; finishes: number; dnf: number; dsq: number; dns: number; completion_rate: number | null;
  wins_overall: number; wins_category: number; podiums: number; best_overall_pos: number | null; avg_percentile: number | null;
  records: { modality: Modality; distance_m: number; label: string; time_ms: number; pace: string; event_name: string; event_date: string }[];
  pace_by_modality: { modality: Modality; distance_m: number; time_ms: number; pace: string }[];
  km_by_modality: Partial<Record<Modality, number>>;
  history: { event_name: string; event_date: string; race_name: string; bib: string; team_name: string | null; category: string; status: SnapshotStatus; final_ms: number | null; overall_pos: number | null; finishers: number; podiums: string[]; my_legs: { label: string; time_ms: number | null }[] }[];
  evolution: { modality: Modality; distance_m: number; label: string; points: { date: string; time_ms: number; event_name: string }[] } | null;
  partners: { athlete_id: string; name: string; count: number }[];
}

/** A leg an athlete personally ran with a known time and distance: a "qualifying" leg for the
 * profile's records/pace/km/evolution and for the club records (clubStats.ts). A disqualified
 * result never qualifies, nor does a leg time that is zero or negative (a finalized `order` error)
 * — B1-M3. */
export interface QualifyingLeg { athlete_id: string; modality: Modality; distance_m: number; time_ms: number; label: string; date: string; event_name: string }

export function qualifyingLegs(results: ResultRow[]): QualifyingLeg[] {
  const legs: QualifyingLeg[] = [];
  for (const r of results) {
    if (r.status === 'dsq') continue;
    for (const leg of r.data.legs) {
      if (leg.athlete_id == null) continue;
      if (leg.time_ms == null || leg.time_ms <= 0 || leg.distance_m == null) continue;
      legs.push({
        athlete_id: leg.athlete_id, modality: leg.modality, distance_m: leg.distance_m, time_ms: leg.time_ms,
        label: leg.label, date: r.data.event.date, event_name: r.data.event.name,
      });
    }
  }
  return legs;
}

/** The calendar year of a result (its event date, "AAAA-MM-DD"). */
export function resultYear(r: ResultRow): string {
  return r.data.event.date.slice(0, 4);
}

/** The distinct years with results, newest first (spec 2026-09-28 §5.1). */
export function resultYears(results: ResultRow[]): string[] {
  return [...new Set(results.map(resultYear))].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

/** The results of `year`; null = the whole career. */
export function filterResultsByYear(results: ResultRow[], year: string | null): ResultRow[] {
  return year === null ? results : results.filter(r => resultYear(r) === year);
}

/** Participations per athlete id with §10's rule (every status but DNS / not started counts). */
export function participationCounts(results: ResultRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of results) {
    if (r.status === 'dns' || r.status === 'not_started') continue;
    for (const id of r.athlete_ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** Compact category text for the history table, e.g. "Feminino · 30-39": sex label plus
 * whichever of age group / level are actually set (unlike `groupLabel`, missing dimensions are
 * omitted rather than shown as "Sem faixa"/"Sem nível"). */
function categoryText(cat: ResultSnapshot['category']): string {
  const parts = [sexLabel(cat.sex)];
  if (cat.age_group) parts.push(cat.age_group);
  if (cat.level) parts.push(cat.level);
  return parts.join(' · ');
}

export function computeAthleteStats(athleteId: string, results: ResultRow[]): AthleteStats {
  let participations = 0, finishes = 0, dnf = 0, dns = 0, dsq = 0;
  let wins_overall = 0, wins_category = 0, podiums = 0;
  let best_overall_pos: number | null = null;
  const percentiles: number[] = [];

  for (const r of results) {
    const status = r.status;
    if (status !== 'dns' && status !== 'not_started') participations++;
    if (status === 'finished') finishes++;
    else if (status === 'dnf' || status === 'on_course') dnf++;
    else if (status === 'dns' || status === 'not_started') dns++;
    else if (status === 'dsq') dsq++;

    if (r.overall_pos === 1) wins_overall++;
    if (r.data.podiums.some(p => p.podium_pos === 1)) wins_category++;
    if (r.data.podiums.some(p => p.podium_pos <= 3)) podiums++;

    if (r.overall_pos !== null) {
      best_overall_pos = best_overall_pos === null ? r.overall_pos : Math.min(best_overall_pos, r.overall_pos);
      const finishers = r.data.positions.finishers;
      if (finishers > 0) percentiles.push(r.overall_pos / finishers);
    }
  }

  const completion_rate = participations > 0 ? finishes / participations : null;
  const avg_percentile = percentiles.length > 0 ? percentiles.reduce((sum, v) => sum + v, 0) / percentiles.length : null;

  const legs = qualifyingLegs(results).filter(l => l.athlete_id === athleteId);

  const recordsByKey = new Map<string, AthleteStats['records'][number]>();
  const paceSums = new Map<Modality, { distance_m: number; time_ms: number }>();
  const km_by_modality: Partial<Record<Modality, number>> = {};
  const evoGroups = new Map<string, { modality: Modality; distance_m: number; label: string; points: { date: string; time_ms: number; event_name: string }[] }>();

  for (const leg of legs) {
    const key = `${leg.modality}|${leg.distance_m}`;

    const bestSoFar = recordsByKey.get(key);
    if (!bestSoFar || leg.time_ms < bestSoFar.time_ms) {
      recordsByKey.set(key, {
        modality: leg.modality, distance_m: leg.distance_m, label: leg.label, time_ms: leg.time_ms,
        pace: formatPace(leg.time_ms, leg.distance_m, leg.modality),
        event_name: leg.event_name, event_date: leg.date,
      });
    }

    if (leg.modality !== 'other') {
      const sum = paceSums.get(leg.modality) ?? { distance_m: 0, time_ms: 0 };
      sum.distance_m += leg.distance_m;
      sum.time_ms += leg.time_ms;
      paceSums.set(leg.modality, sum);
    }

    km_by_modality[leg.modality] = (km_by_modality[leg.modality] ?? 0) + leg.distance_m / 1000;

    const group = evoGroups.get(key) ?? { modality: leg.modality, distance_m: leg.distance_m, label: leg.label, points: [] };
    group.points.push({ date: leg.date, time_ms: leg.time_ms, event_name: leg.event_name });
    evoGroups.set(key, group);
  }

  const records = [...recordsByKey.values()];
  const pace_by_modality = [...paceSums.entries()].map(([modality, sum]) => ({
    modality, distance_m: sum.distance_m, time_ms: sum.time_ms, pace: formatPace(sum.time_ms, sum.distance_m, modality),
  }));

  let evolution: AthleteStats['evolution'] = null;
  let bestCount = 1; // need at least 2 points to be worth a trend line
  for (const group of evoGroups.values()) {
    if (group.points.length > bestCount) {
      bestCount = group.points.length;
      evolution = group;
    }
  }
  if (evolution) {
    evolution = { ...evolution, points: [...evolution.points].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)) };
  }

  const history = [...results]
    .sort((a, b) => (a.data.event.date < b.data.event.date ? 1 : a.data.event.date > b.data.event.date ? -1 : 0))
    .map(r => ({
      event_name: r.data.event.name, event_date: r.data.event.date, race_name: r.data.race.name,
      bib: r.data.bib, team_name: r.data.team_name, category: categoryText(r.data.category),
      status: r.status, final_ms: r.final_ms, overall_pos: r.overall_pos, finishers: r.data.positions.finishers,
      podiums: r.data.podiums.map(p => `${p.ranking_name}: ${p.podium_pos}º (${p.group_label})`),
      my_legs: r.data.legs.filter(l => l.athlete_id === athleteId).map(l => ({ label: l.label, time_ms: l.time_ms })),
    }));

  const partnersById = new Map<string, { athlete_id: string; name: string; count: number }>();
  for (const r of results) {
    for (const member of r.data.members) {
      if (member.athlete_id === athleteId) continue;
      const existing = partnersById.get(member.athlete_id);
      if (existing) existing.count++;
      else partnersById.set(member.athlete_id, { athlete_id: member.athlete_id, name: member.name, count: 1 });
    }
  }
  const partners = [...partnersById.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pt-BR'));

  return {
    participations, finishes, dnf, dsq, dns, completion_rate,
    wins_overall, wins_category, podiums, best_overall_pos, avg_percentile,
    records, pace_by_modality, km_by_modality, history, evolution, partners,
  };
}
