import type { EntryRow, EventAggregate, MarkRow, RaceConfig, RaceRow, ResolutionRow, WaveRow } from '../lib/types';
import { formatClock } from '../lib/format';
import { entryWave, indexEvent, legAthleteId } from './eventModel';

/** One vote for a crossing time: the earliest mark of a timekeeper, or one organization mark. */
export interface Candidate { mark_id: string; timekeeper_id: string | null; ts_ms: number }

/** The consolidated end of leg `leg_index` for one entry (spec §8). */
export interface Crossing {
  leg_index: number; candidates: Candidate[]; duplicates: string[];
  median_ms: number | null; spread_ms: number | null;
  system_ms: number | null; system_source: 'median' | 'reference' | null;
  official_ms: number | null; official_source: 'median' | 'reference' | 'mark' | 'manual' | null;
  resolution: ResolutionRow | null; divergent: boolean; chosen_mark_discarded: boolean;
}
export type TimingStatus = 'not_started' | 'on_course' | 'finished' | 'dnf' | 'dns' | 'dsq';
export interface LegTiming { leg_index: number; athlete_id: string | null; crossing: Crossing; start_ms: number | null; leg_ms: number | null }
export interface EntryTiming {
  entry_id: string; race_id: string; start_ms: number | null; legs: LegTiming[];
  total_ms: number | null; final_ms: number | null; status: TimingStatus;
  current_leg: number | null; current_leg_start_ms: number | null;
}
export type IssueType = 'divergence' | 'missing_crossing' | 'order' | 'duplicate' | 'no_start' | 'unassigned' | 'chosen_mark_discarded' | 'not_finished';
export interface Issue {
  type: IssueType; severity: 'error' | 'warning' | 'info'; message: string;
  entry_id?: string; race_id?: string; leg_index?: number; mark_ids?: string[]; suggested_leg_index?: number;
}
export interface EventTiming { byEntry: Map<string, EntryTiming>; issues: Issue[] }

/** A mark still without an athlete becomes an issue once it is older than this. */
const UNASSIGNED_ISSUE_AFTER_MS = 60_000;

const markMs = (m: MarkRow): number => Date.parse(m.ts);
const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Median of `values`; for an even count, the mean of the two middle values rounded to the ms. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Consolidates the marks of one leg of one entry (callers pass only that entry's marks):
 * one candidate per timekeeper (the earliest mark; later ones are duplicates) and one per
 * organization mark; the system time is the reference timekeeper's candidate under the
 * 'reference' policy (when present), else the median; the organizer's resolution decides the
 * official time, falling back to the system time when the chosen mark is no longer usable.
 */
export function computeCrossing(args: { legIndex: number; marks: MarkRow[]; resolution: ResolutionRow | null; config: RaceConfig }): Crossing {
  const { legIndex, resolution, config } = args;
  const legMarks = args.marks
    .filter(m => !m.discarded && m.leg_index === legIndex)
    .map(mark => ({ mark, ts_ms: markMs(mark) }))
    .sort((a, b) => a.ts_ms - b.ts_ms || compareIds(a.mark.id, b.mark.id));

  const candidates: Candidate[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();
  for (const { mark, ts_ms } of legMarks) {
    const key = mark.timekeeper_id ?? `org:${mark.id}`;
    if (seen.has(key)) {
      duplicates.push(mark.id);
    } else {
      seen.add(key);
      candidates.push({ mark_id: mark.id, timekeeper_id: mark.timekeeper_id, ts_ms });
    }
  }

  const times = candidates.map(c => c.ts_ms);
  const median_ms = median(times);
  const spread_ms = times.length > 0 ? Math.max(...times) - Math.min(...times) : null;

  const referenceId = config.time_source === 'reference' ? config.reference_timekeeper_id : null;
  const reference = referenceId !== null ? candidates.find(c => c.timekeeper_id === referenceId) : undefined;
  const system_ms = reference ? reference.ts_ms : median_ms;
  const system_source = reference ? 'reference' : median_ms !== null ? 'median' : null;

  let official_ms = system_ms;
  let official_source: Crossing['official_source'] = system_source;
  let chosen_mark_discarded = false;
  if (resolution?.mode === 'manual' && resolution.manual_ts !== null) {
    official_ms = Date.parse(resolution.manual_ts);
    official_source = 'manual';
  } else if (resolution?.mode === 'mark') {
    const chosen = legMarks.find(x => x.mark.id === resolution.mark_id);
    if (chosen) {
      official_ms = chosen.ts_ms;
      official_source = 'mark';
    } else {
      chosen_mark_discarded = true;
    }
  }

  return {
    leg_index: legIndex, candidates, duplicates, median_ms, spread_ms, system_ms, system_source,
    official_ms, official_source, resolution,
    divergent: candidates.length >= 2 && spread_ms !== null && spread_ms > config.divergence_threshold_s * 1000,
    chosen_mark_discarded,
  };
}

/**
 * Times one entry: leg k starts at the official crossing of leg k−1 (the wave start for leg 0),
 * which is what hands a relay over to the next athlete automatically.
 */
export function computeEntryTiming(entry: EntryRow, race: RaceRow, wave: WaveRow | null, marks: MarkRow[], resolutions: ResolutionRow[]): EntryTiming {
  const start_ms = wave?.start_at ? Date.parse(wave.start_at) : null;
  const own = marks.filter(m => m.entry_id === entry.id);

  const legs: LegTiming[] = [];
  for (let k = 0; k < race.legs.length; k++) {
    const resolution = resolutions.find(r => r.entry_id === entry.id && r.leg_index === k) ?? null;
    const crossing = computeCrossing({ legIndex: k, marks: own, resolution, config: race.config });
    const legStart = k === 0 ? start_ms : legs[k - 1].crossing.official_ms;
    const end = crossing.official_ms;
    legs.push({ leg_index: k, athlete_id: legAthleteId(entry, k), crossing, start_ms: legStart, leg_ms: end !== null && legStart !== null ? end - legStart : null });
  }

  const finish = legs.length > 0 ? legs[legs.length - 1].crossing.official_ms : null;
  const total_ms = finish !== null && start_ms !== null ? finish - start_ms : null;
  const final_ms = total_ms !== null ? total_ms + entry.penalty_ms : null;
  const lastPassed = lastLegWithCrossing(legs);

  let status: TimingStatus;
  if (entry.status === 'dns' || entry.status === 'dnf' || entry.status === 'dsq') status = entry.status;
  else if (finish !== null) status = 'finished';
  else if (start_ms !== null || lastPassed >= 0) status = 'on_course';
  else status = 'not_started';

  const onCourse = status === 'on_course';
  return {
    entry_id: entry.id, race_id: entry.race_id, start_ms, legs, total_ms, final_ms, status,
    current_leg: onCourse ? lastPassed + 1 : null,
    current_leg_start_ms: onCourse ? (lastPassed >= 0 ? legs[lastPassed].crossing.official_ms : start_ms) : null,
  };
}

/** Timing of every entry of an event plus the pt-BR issue list the organizer reviews. */
export function computeEventTiming(
  agg: Pick<EventAggregate, 'races' | 'waves' | 'entries' | 'athletes' | 'timekeepers' | 'marks' | 'resolutions'>,
  nowMs: number,
): EventTiming {
  const idx = indexEvent(agg);
  const marksByEntry = new Map<string, MarkRow[]>();
  for (const m of agg.marks) if (m.entry_id !== null) pushTo(marksByEntry, m.entry_id, m);
  const resolutionsByEntry = new Map<string, ResolutionRow[]>();
  for (const r of agg.resolutions) pushTo(resolutionsByEntry, r.entry_id, r);

  // Timekeepers registered after the aggregate was loaded are not in the index yet.
  const authorOf = (timekeeperId: string | null): string =>
    timekeeperId === null ? 'Organização' : idx.timekeepersById.get(timekeeperId)?.name ?? 'Cronometrista';

  const byEntry = new Map<string, EntryTiming>();
  const issues: Issue[] = [];
  for (const entry of agg.entries) {
    const race = idx.racesById.get(entry.race_id);
    if (!race) continue;
    const wave = entryWave(entry, idx);
    const marks = marksByEntry.get(entry.id) ?? [];
    const timing = computeEntryTiming(entry, race, wave, marks, resolutionsByEntry.get(entry.id) ?? []);
    byEntry.set(entry.id, timing);
    issues.push(...entryIssues(entry, race, wave, timing, marks, authorOf));
  }

  for (const m of agg.marks) {
    if (m.discarded || m.entry_id !== null) continue;
    const ts = markMs(m);
    if (nowMs - ts > UNASSIGNED_ISSUE_AFTER_MS) {
      issues.push({ type: 'unassigned', severity: 'warning', message: `Marcação ${formatClock(ts, { tenths: true })} (${authorOf(m.timekeeper_id)}) sem atleta`, mark_ids: [m.id] });
    }
  }

  issues.sort(compareIssues);
  return { byEntry, issues };
}

function entryIssues(
  entry: EntryRow, race: RaceRow, wave: WaveRow | null, timing: EntryTiming, marks: MarkRow[],
  authorOf: (timekeeperId: string | null) => string,
): Issue[] {
  const issues: Issue[] = [];
  const refs = { entry_id: entry.id, race_id: race.id };
  const markById = new Map(marks.map((m): [string, MarkRow] => [m.id, m]));
  const lastPassed = lastLegWithCrossing(timing.legs);

  for (const leg of timing.legs) {
    const k = leg.leg_index;
    const c = leg.crossing;
    const where = `Nº ${entry.bib} · Perna ${k + 1} (${race.legs[k].label})`;
    const legRefs = { ...refs, leg_index: k };

    if (c.divergent && !c.resolution) {
      issues.push({ type: 'divergence', severity: 'warning', message: `${where}: divergência de ${formatSeconds(c.spread_ms ?? 0)} s entre cronometristas`, ...legRefs, ...divergenceRefs(c, timing.legs, race.config) });
    }

    const duplicatesByTimekeeper = new Map<string | null, string[]>();
    for (const id of c.duplicates) pushTo(duplicatesByTimekeeper, markById.get(id)?.timekeeper_id ?? null, id);
    for (const [timekeeperId, ids] of duplicatesByTimekeeper) {
      issues.push({ type: 'duplicate', severity: 'info', message: `${where}: ${authorOf(timekeeperId)} marcou mais de uma vez`, ...legRefs, mark_ids: ids });
    }

    if (c.chosen_mark_discarded) {
      issues.push({ type: 'chosen_mark_discarded', severity: 'warning', message: `${where}: a marcação escolhida foi descartada`, ...legRefs });
    }
    if (c.official_ms === null && k < lastPassed) {
      issues.push({ type: 'missing_crossing', severity: 'error', message: `${where}: passagem não registrada (há passagem posterior)`, ...legRefs });
    }
    if (c.official_ms !== null && leg.start_ms !== null && c.official_ms <= leg.start_ms) {
      issues.push({ type: 'order', severity: 'error', message: `${where}: passagem antes da anterior/largada`, ...legRefs });
    }
  }

  if (timing.start_ms === null && marks.some(m => !m.discarded)) {
    const message = wave ? `Nº ${entry.bib}: marcação sem largada registrada (${wave.name})` : `Nº ${entry.bib}: marcação sem largada registrada`;
    issues.push({ type: 'no_start', severity: 'warning', message, ...refs });
  }
  if (timing.status === 'on_course') {
    issues.push({ type: 'not_finished', severity: 'info', message: `Nº ${entry.bib}: ainda em prova`, ...refs });
  }
  return issues;
}

/**
 * The marks that disagree with a divergent crossing (with exactly 2 candidates both do) and,
 * when one of them sits within the same-crossing window of another leg's median, that leg as
 * the suggested destination. The outlier behind the suggestion is listed first because the
 * Review tab moves `mark_ids[0]`. When no candidate is beyond the threshold from the median
 * (e.g. 0 s, 2 s, 4 s), the one farthest from it stands in, so the issue always names a mark
 * (Ruling 11).
 */
function divergenceRefs(c: Crossing, legs: LegTiming[], config: RaceConfig): Pick<Issue, 'mark_ids' | 'suggested_leg_index'> {
  const thresholdMs = config.divergence_threshold_s * 1000;
  const windowMs = config.same_crossing_window_s * 1000;
  const med = c.median_ms ?? 0;
  const beyond = c.candidates.length === 2 ? c.candidates : c.candidates.filter(x => Math.abs(x.ts_ms - med) > thresholdMs);
  const outliers = beyond.length > 0 ? beyond : [farthestFrom(c.candidates, med)];

  const move = findSuggestedMove(outliers, c.leg_index, legs, windowMs);
  const ids = outliers.map(o => o.mark_id);
  if (!move) return { mark_ids: ids };
  return { mark_ids: [move.mark_id, ...ids.filter(id => id !== move.mark_id)], suggested_leg_index: move.leg_index };
}

function findSuggestedMove(outliers: Candidate[], legIndex: number, legs: LegTiming[], windowMs: number): { mark_id: string; leg_index: number } | null {
  for (const o of outliers) {
    for (const other of legs) {
      const med = other.crossing.median_ms;
      if (other.leg_index !== legIndex && med !== null && Math.abs(o.ts_ms - med) <= windowMs) {
        return { mark_id: o.mark_id, leg_index: other.leg_index };
      }
    }
  }
  return null;
}

/** The candidate farthest from `ms`; ties go to the earliest in `candidates` order. Needs ≥ 1 candidate. */
function farthestFrom(candidates: Candidate[], ms: number): Candidate {
  let far = candidates[0];
  for (const x of candidates) if (Math.abs(x.ts_ms - ms) > Math.abs(far.ts_ms - ms)) far = x;
  return far;
}

function lastLegWithCrossing(legs: LegTiming[]): number {
  for (let k = legs.length - 1; k >= 0; k--) if (legs[k].crossing.official_ms !== null) return k;
  return -1;
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

const secondsFormat = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const formatSeconds = (ms: number): string => secondsFormat.format(ms / 1000);

const SEVERITY_RANK: Record<Issue['severity'], number> = { error: 0, warning: 1, info: 2 };
const messageCollator = new Intl.Collator('pt-BR', { numeric: true });
function compareIssues(a: Issue, b: Issue): number {
  return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || messageCollator.compare(a.message, b.message);
}
