import type { AgeGroup, AthleteRow, EntryRow, EntrySex, RaceRow, RankingDef, RankingDim } from '../lib/types';
import type { EntryTiming } from './consolidation';
import { entryCategory, groupKey, groupLabel, type EntryCategory } from './categories';

export interface RankedEntry {
  entry: EntryRow; timing: EntryTiming; category: EntryCategory;
  overall_pos: number | null; sex_pos: number | null;
  ranking_pos: Record<string, number | null>; gap_ms: number | null;
}
export interface PodiumPlace { podium_pos: number; ranked: RankedEntry }
export interface PodiumGroup { ranking: RankingDef; group_key: string; group_label: string; places: PodiumPlace[] }
export interface RaceClassification { race: RaceRow; rows: RankedEntry[]; finishers: number; podiums: PodiumGroup[] }

/**
 * A row counts as "ranked" only once it has actually finished with a resolvable final time (spec
 * §9). Controller Ruling 9: a `finished` crossing with a null `final_ms` (a finish mark recorded
 * with no wave start to compute a total from) does NOT count as ranked — it is listed among the
 * unranked rows instead, first among them (see `UNRANKED_STATUS_ORDER`).
 */
function isRanked(timing: EntryTiming): boolean {
  return timing.status === 'finished' && timing.final_ms !== null;
}

/** Numeric-aware bib compare, used as the display tie-break wherever two rows are otherwise equal. */
const bibCollator = new Intl.Collator('pt-BR', { numeric: true });
const compareBib = (a: EntryRow, b: EntryRow): number => bibCollator.compare(a.bib, b.bib);

/**
 * Status order for the unranked rows that follow the ranked ones (spec §9 + Controller Ruling 9):
 * a finish recorded with no resolvable final time sorts first (the entry did cross the line —
 * closest to being ranked), then on_course, not_started, dnf, dns, dsq.
 */
const UNRANKED_STATUS_ORDER: Record<EntryTiming['status'], number> = {
  finished: 0, on_course: 1, not_started: 2, dnf: 3, dns: 4, dsq: 5,
};

/**
 * Competition ("1224") ranking of pre-sorted ascending `values`: tied values share the lower
 * position and the next distinct value resumes at its own 1-based rank (e.g. 18,18,19 → 1,1,3).
 */
function competitionRanks(values: number[]): number[] {
  const ranks: number[] = [];
  for (let i = 0; i < values.length; i++) {
    ranks.push(i > 0 && values[i] === values[i - 1] ? ranks[i - 1] : i + 1);
  }
  return ranks;
}

interface Built { entry: EntryRow; timing: EntryTiming; category: EntryCategory }
interface RankedBuilt extends Built { final: number }

/** A fallback timing for an entry the caller's `timings` map has no entry for (defensive — the
 * real `computeEventTiming` always produces one for every entry of a known race). */
function fallbackTiming(entry: EntryRow, raceId: string): EntryTiming {
  const status = entry.status === 'ok' ? 'not_started' : entry.status;
  return { entry_id: entry.id, race_id: raceId, start_ms: null, legs: [], total_ms: null, final_ms: null, status, current_leg: null, current_leg_start_ms: null };
}

/** Competition rank of each entry within its own group of `sortedRanked` (already ascending by
 * final time/bib), grouped by `keyOf`. */
function groupedPositions(sortedRanked: RankedBuilt[], keyOf: (b: RankedBuilt) => string): Map<string, number> {
  const byGroup = new Map<string, RankedBuilt[]>();
  for (const b of sortedRanked) {
    const k = keyOf(b);
    const list = byGroup.get(k);
    if (list) list.push(b); else byGroup.set(k, [b]);
  }
  const positions = new Map<string, number>();
  for (const list of byGroup.values()) {
    const ranks = competitionRanks(list.map(b => b.final));
    list.forEach((b, i) => positions.set(b.entry.id, ranks[i]));
  }
  return positions;
}

const SEX_ORDER: Record<EntrySex, number> = { M: 0, F: 1, MISTO: 2 };

/** Sort key for an age group label: its configured `min`, or `Infinity` so a missing group
 * ("Sem faixa", `age_group === null`) always sorts last. */
function ageGroupMin(groups: AgeGroup[], label: string | null): number {
  if (label === null) return Infinity;
  return groups.find(g => g.label === label)?.min ?? Infinity;
}

/** Sort key for a level: its index in `event.levels`, or `Infinity` so a missing level
 * ("Sem nível", `level === null`) always sorts last. */
function levelIndex(levels: string[], level: string | null): number {
  if (level === null) return Infinity;
  const i = levels.indexOf(level);
  return i === -1 ? Infinity : i;
}

/**
 * Orders podium groups within one ranking (spec §9): sex M, F, MISTO; then age group by `min`
 * ("Sem faixa" last); then level in `event.levels` order ("Sem nível" last) — only for the
 * dimensions that ranking actually groups by (a dimension absent from `dims` never splits the
 * group, so it plays no part in ordering it).
 */
function compareGroupOrder(dims: RankingDim[], a: EntryCategory, b: EntryCategory, ageGroups: AgeGroup[], levels: string[]): number {
  if (dims.includes('sex')) {
    const c = SEX_ORDER[a.sex] - SEX_ORDER[b.sex];
    if (c !== 0) return c;
  }
  if (dims.includes('age')) {
    const c = ageGroupMin(ageGroups, a.age_group) - ageGroupMin(ageGroups, b.age_group);
    if (c !== 0) return c;
  }
  if (dims.includes('level')) {
    const c = levelIndex(levels, a.level) - levelIndex(levels, b.level);
    if (c !== 0) return c;
  }
  return 0;
}

/** `r.timing.final_ms` for a row known to be ranked — every caller in this module only reaches it
 * through `rankedRows`, where `isRanked` already guarantees a non-null value. */
function finalOf(r: RankedEntry): number {
  return r.timing.final_ms as number;
}

/**
 * Builds the podiums for `race.config.rankings`, in config order (spec §9): for each ranking, the
 * still-eligible ranked rows (all of them when `cumulative`, otherwise excluding anyone already
 * awarded a place in an earlier ranking) are grouped by that ranking's dimensions, the groups are
 * ordered (`compareGroupOrder`), and within each group competition positions are recomputed from
 * scratch and trimmed to `size`; a group left with no places (everyone in it already awarded
 * elsewhere) is omitted entirely.
 */
function buildPodiums(race: RaceRow, rankedRows: RankedEntry[], event: { levels: string[] }): PodiumGroup[] {
  const placedElsewhere = new Set<string>();
  const podiums: PodiumGroup[] = [];

  for (const rd of race.config.rankings) {
    const candidates = race.config.cumulative ? rankedRows : rankedRows.filter(r => !placedElsewhere.has(r.entry.id));

    const groups = new Map<string, RankedEntry[]>();
    for (const r of candidates) {
      const key = groupKey(rd.dims, r.category);
      const list = groups.get(key);
      if (list) list.push(r); else groups.set(key, [r]);
    }

    const orderedGroups = [...groups.entries()]
      .sort((a, b) => compareGroupOrder(rd.dims, a[1][0].category, b[1][0].category, race.config.age_groups, event.levels));

    for (const [key, members] of orderedGroups) {
      const ranks = competitionRanks(members.map(finalOf));
      const places: PodiumPlace[] = [];
      members.forEach((r, i) => {
        if (ranks[i] <= rd.size) places.push({ podium_pos: ranks[i], ranked: r });
      });
      if (places.length === 0) continue;
      podiums.push({ ranking: rd, group_key: key, group_label: groupLabel(rd.dims, members[0].category), places });
      if (!race.config.cumulative) for (const p of places) placedElsewhere.add(p.ranked.entry.id);
    }
  }

  return podiums;
}

/**
 * Classifies one race (spec §9): ranked rows — finished with a resolved `final_ms` — ordered by
 * time with shared competition positions on ties, followed by the unranked rows in status order
 * (`UNRANKED_STATUS_ORDER`); both blocks use a numeric-aware bib as the display tie-break.
 * Computes each ranked row's overall/sex/per-ranking positions and its gap to the leader, then
 * builds the podiums for `race.config.rankings`.
 */
export function classifyRace(
  race: RaceRow,
  entries: EntryRow[],
  timings: Map<string, EntryTiming>,
  athletesById: Map<string, AthleteRow>,
  event: { date: string; levels: string[] },
): RaceClassification {
  const built: Built[] = entries.map(entry => ({
    entry,
    timing: timings.get(entry.id) ?? fallbackTiming(entry, race.id),
    category: entryCategory(entry, athletesById, race, event),
  }));

  const ranked: RankedBuilt[] = built
    .filter(b => isRanked(b.timing))
    .map(b => ({ ...b, final: b.timing.final_ms as number }))
    .sort((a, b) => a.final - b.final || compareBib(a.entry, b.entry));

  const unranked = built
    .filter(b => !isRanked(b.timing))
    .sort((a, b) => UNRANKED_STATUS_ORDER[a.timing.status] - UNRANKED_STATUS_ORDER[b.timing.status] || compareBib(a.entry, b.entry));

  const overallPos = competitionRanks(ranked.map(b => b.final));
  const sexPos = groupedPositions(ranked, b => b.category.sex);
  const rankingPosByRanking = new Map(race.config.rankings.map(rd => [rd.id, groupedPositions(ranked, b => groupKey(rd.dims, b.category))] as const));
  const leaderFinal: number | null = ranked.length > 0 ? ranked[0].final : null;

  const rankedRows: RankedEntry[] = ranked.map((b, i) => ({
    entry: b.entry, timing: b.timing, category: b.category,
    overall_pos: overallPos[i],
    sex_pos: sexPos.get(b.entry.id) ?? null,
    ranking_pos: Object.fromEntries(race.config.rankings.map(rd => [rd.id, rankingPosByRanking.get(rd.id)!.get(b.entry.id) ?? null])),
    gap_ms: leaderFinal !== null ? b.final - leaderFinal : null,
  }));
  const unrankedRows: RankedEntry[] = unranked.map(b => ({
    entry: b.entry, timing: b.timing, category: b.category,
    overall_pos: null, sex_pos: null,
    ranking_pos: Object.fromEntries(race.config.rankings.map(rd => [rd.id, null])),
    gap_ms: null,
  }));

  return {
    race,
    rows: [...rankedRows, ...unrankedRows],
    finishers: rankedRows.length,
    podiums: buildPodiums(race, rankedRows, event),
  };
}
