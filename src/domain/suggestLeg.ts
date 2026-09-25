import type { EntryRow, MarkRow, RaceRow } from '../lib/types';
import { resolveBib } from './bib';
import { median } from './consolidation';
import { legAthleteId } from './eventModel';

export interface LegSuggestion { leg_index: number; athlete_id: string | null; reason: 'same_crossing' | 'next'; warning: 'already_finished' | null }

/**
 * Suggests which leg a new mark at `tsMs` ends for `entry` (spec §7.5): the leg of a crossing
 * already marked within the same-crossing window (another timekeeper confirming it), otherwise
 * the first leg after the last crossing that is clearly behind. Only the selected athlete's legs
 * are candidates when `athleteId` is a member with legs; otherwise every leg is.
 */
export function suggestLeg(args: { entry: EntryRow; race: RaceRow; marks: MarkRow[]; tsMs: number; athleteId?: string | null }): LegSuggestion {
  const { entry, race, tsMs, athleteId } = args;
  const windowMs = race.config.same_crossing_window_s * 1000;
  const allLegs = race.legs.map((_, k) => k);

  const timesByLeg = new Map<number, number[]>();
  for (const m of args.marks) {
    if (m.entry_id !== entry.id || m.discarded || m.leg_index === null) continue;
    const list = timesByLeg.get(m.leg_index);
    if (list) list.push(Date.parse(m.ts));
    else timesByLeg.set(m.leg_index, [Date.parse(m.ts)]);
  }
  const crossingAt = new Map<number, number>();
  for (const k of allLegs) {
    const at = median(timesByLeg.get(k) ?? []);
    if (at !== null) crossingAt.set(k, at);
  }

  const memberLegs = athleteId ? (entry.members.find(m => m.athlete_id === athleteId)?.legs ?? []) : [];
  const candidateLegs = memberLegs.length > 0 ? [...memberLegs].sort((a, b) => a - b) : allLegs;
  const suggest = (leg: number, reason: LegSuggestion['reason'], warning: LegSuggestion['warning'] = null): LegSuggestion =>
    ({ leg_index: leg, athlete_id: legAthleteId(entry, leg), reason, warning });

  let closest: number | null = null;
  let closestGap = Infinity;
  for (const k of candidateLegs) {
    const at = crossingAt.get(k);
    if (at === undefined) continue;
    const gap = Math.abs(tsMs - at);
    if (gap <= windowMs && gap < closestGap) {
      closest = k;
      closestGap = gap;
    }
  }
  if (closest !== null) return suggest(closest, 'same_crossing');

  let last = -1;
  for (const [k, at] of crossingAt) if (at < tsMs - windowMs && k > last) last = k;
  const next = candidateLegs.find(k => k > last);
  if (next !== undefined) return suggest(next, 'next');
  return suggest(candidateLegs[candidateLegs.length - 1], 'next', 'already_finished');
}

export type AssignmentPlan =
  | { entry: EntryRow; race: RaceRow; suggestion: LegSuggestion; warning: string | null }
  | { error: string };

/**
 * Shared "bib typed for a mark" flow (timekeeper app, live board, review): resolves the bib,
 * finds the entry's race and suggests the leg from the other known marks — the mark being
 * (re)assigned, `markId`, is left out so it cannot confirm its own crossing. The warning is the
 * bib warning (DNS/DSQ) or, failing that, a notice that the entry had already finished.
 */
export function planBibAssignment(args: {
  entries: EntryRow[]; racesById: Map<string, RaceRow>; marks: MarkRow[];
  markId: string | null; tsMs: number; bibText: string; athleteId?: string | null;
}): AssignmentPlan {
  const resolved = resolveBib(args.entries, args.bibText);
  if ('error' in resolved) return { error: resolved.error };
  const { entry } = resolved;
  const race = args.racesById.get(entry.race_id);
  if (!race) return { error: 'Prova da inscrição não encontrada' };

  const others = args.markId === null ? args.marks : args.marks.filter(m => m.id !== args.markId);
  const suggestion = suggestLeg({ entry, race, marks: others, tsMs: args.tsMs, athleteId: args.athleteId });
  const finishedWarning = suggestion.warning === 'already_finished'
    ? `Nº ${entry.bib} já concluiu — registrada como fim da ${race.legs[suggestion.leg_index].label} (${suggestion.leg_index + 1}/${race.legs.length})`
    : null;
  return { entry, race, suggestion, warning: resolved.warning ?? finishedWarning };
}
