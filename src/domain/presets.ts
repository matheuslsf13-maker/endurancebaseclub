import type { AgeGroup, Leg, Modality, RaceConfig, RankingDef } from '../lib/types';

export const MODALITY_LABEL: Record<Modality, string> = {
  swim: 'Natação',
  bike: 'Ciclismo',
  run: 'Corrida',
  other: 'Outro',
};

/**
 * Builds the age-group ladder used by default race configs and by the age-groups editor:
 * an open-ended "até <start-1>" bucket, then `step`-wide buckets from `start` up to (but not
 * including) `last`, then an open-ended "<last>+" bucket.
 */
export function generateAgeGroups(start: number, step: number, last: number): AgeGroup[] {
  const groups: AgeGroup[] = [{ label: `até ${start - 1}`, min: 0, max: start - 1 }];
  for (let a = start; a < last; a += step) {
    const max = a + step - 1;
    groups.push({ label: `${a}-${max}`, min: a, max });
  }
  groups.push({ label: `${last}+`, min: last, max: null });
  return groups;
}

export function defaultRaceConfig(teamSize: number): RaceConfig {
  const isTeam = teamSize > 1;
  const rankings: RankingDef[] = isTeam
    ? [{ id: 'geral', name: 'Geral', dims: ['sex'], size: 3 }]
    : [
        { id: 'geral', name: 'Geral', dims: ['sex'], size: 3 },
        { id: 'faixa', name: 'Faixa etária', dims: ['sex', 'age'], size: 3 },
      ];
  return {
    age_rule: 'year_end',
    team_age_rule: 'sum',
    age_groups: isTeam ? [] : generateAgeGroups(20, 10, 60),
    rankings,
    cumulative: false,
    same_crossing_window_s: 30,
    divergence_threshold_s: 3,
    time_source: 'median',
    reference_timekeeper_id: null,
  };
}

export interface RacePreset { id: string; name: string; team_size: number; legs: Leg[] }

function leg(modality: Modality, distance_m: number | null): Leg {
  return { modality, label: MODALITY_LABEL[modality], distance_m };
}

export const RACE_PRESETS: RacePreset[] = [
  { id: 'corrida-5k', name: 'Corrida 5 km', team_size: 1, legs: [leg('run', 5000)] },
  { id: 'corrida-10k', name: 'Corrida 10 km', team_size: 1, legs: [leg('run', 10000)] },
  { id: 'natacao-1500', name: 'Natação 1.500 m', team_size: 1, legs: [leg('swim', 1500)] },
  { id: 'ciclismo-20k', name: 'Ciclismo 20 km', team_size: 1, legs: [leg('bike', 20000)] },
  { id: 'duathlon', name: 'Duathlon', team_size: 1, legs: [leg('run', 5000), leg('bike', 20000), leg('run', 2500)] },
  { id: 'aquathlon', name: 'Aquathlon', team_size: 1, legs: [leg('swim', 750), leg('run', 5000)] },
  { id: 'triathlon-sprint', name: 'Triathlon Sprint', team_size: 1, legs: [leg('swim', 750), leg('bike', 20000), leg('run', 5000)] },
  { id: 'triathlon-olimpico', name: 'Triathlon Olímpico', team_size: 1, legs: [leg('swim', 1500), leg('bike', 40000), leg('run', 10000)] },
  { id: 'revezamento-dupla-aquathlon', name: 'Revezamento em dupla (natação + corrida)', team_size: 2, legs: [leg('swim', 750), leg('run', 5000)] },
  { id: 'revezamento-trio-triathlon', name: 'Revezamento em trio (triathlon sprint)', team_size: 3, legs: [leg('swim', 750), leg('bike', 20000), leg('run', 5000)] },
  { id: 'personalizada', name: 'Personalizada', team_size: 1, legs: [leg('run', 5000)] },
];

/**
 * Starts from `defaultRaceConfig(teamSize)` and overlays each field of `partial` only when it
 * is individually well-formed, so a malformed or missing field silently falls back to the
 * default instead of producing an invalid RaceConfig.
 */
export function normalizeRaceConfig(partial: Partial<RaceConfig> | null | undefined, teamSize: number): RaceConfig {
  const base = defaultRaceConfig(teamSize);
  if (!partial) return base;
  const out: RaceConfig = { ...base };

  if (partial.age_rule === 'year_end' || partial.age_rule === 'event_date') out.age_rule = partial.age_rule;
  if (partial.team_age_rule === 'sum' || partial.team_age_rule === 'oldest' || partial.team_age_rule === 'youngest') {
    out.team_age_rule = partial.team_age_rule;
  }
  if (Array.isArray(partial.age_groups)) out.age_groups = partial.age_groups;
  if (Array.isArray(partial.rankings)) out.rankings = partial.rankings;
  if (typeof partial.cumulative === 'boolean') out.cumulative = partial.cumulative;
  if (isFinitePositive(partial.same_crossing_window_s)) out.same_crossing_window_s = partial.same_crossing_window_s;
  if (isFinitePositive(partial.divergence_threshold_s)) out.divergence_threshold_s = partial.divergence_threshold_s;
  if (partial.time_source === 'median' || partial.time_source === 'reference') out.time_source = partial.time_source;
  if (typeof partial.reference_timekeeper_id === 'string' || partial.reference_timekeeper_id === null) {
    out.reference_timekeeper_id = partial.reference_timekeeper_id;
  }

  return out;
}

function isFinitePositive(n: number | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}
