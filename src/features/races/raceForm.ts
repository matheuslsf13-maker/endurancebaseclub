import { validateAgeGroups } from '../../domain/categories';
import { defaultRaceConfig, MODALITY_LABEL } from '../../domain/presets';
import type { RacePreset } from '../../domain/presets';
import type { Leg, Modality, RaceConfig, RaceRow, WaveRow } from '../../lib/types';

export type DistanceUnit = 'm' | 'km';

export interface RaceFormLeg {
  modality: Modality;
  label: string;
  distance: string;
  unit: DistanceUnit;
}

export interface RaceFormWave {
  id?: string;
  name: string;
  position: number;
  start_at: string | null;
}

export interface RaceForm {
  id?: string;
  event_id: string;
  name: string;
  position: number;
  team_size: number;
  legs: RaceFormLeg[];
  waves: RaceFormWave[];
  config: RaceConfig;
}

/** What `api.admin.saveRace` expects (mirrors its parameter type in `src/lib/api.ts`). */
export interface RacePayload {
  id?: string;
  event_id: string;
  name: string;
  position: number;
  team_size: number;
  legs: Leg[];
  config: RaceConfig;
  waves: Partial<WaveRow>[];
}

const DEFAULT_WAVE_NAME = 'Largada geral';

function defaultWaveForm(): RaceFormWave {
  return { name: DEFAULT_WAVE_NAME, position: 0, start_at: null };
}

/**
 * Meters → the text/unit pair the legs editor displays: kilometers only when the distance is a
 * whole, non-zero number of them (750 m stays "750 m"; 20000 m becomes "20 km"; a null distance
 * — allowed for `other` legs — becomes an empty meters field).
 */
export function distanceToForm(distance_m: number | null): { distance: string; unit: DistanceUnit } {
  if (distance_m === null) return { distance: '', unit: 'm' };
  if (distance_m >= 1000 && distance_m % 1000 === 0) return { distance: String(distance_m / 1000), unit: 'km' };
  return { distance: String(distance_m), unit: 'm' };
}

/** Parses a distance field's text (comma or dot decimal, `km` or `m`) to whole meters, or `null`
 * for blank/invalid input — the caller decides whether blank is acceptable (only `other` legs). */
export function parseDistance(text: string, unit: DistanceUnit): number | null {
  const t = text.trim();
  if (t === '') return null;
  const n = Number(t.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(unit === 'km' ? n * 1000 : n);
}

function legToForm(leg: Leg): RaceFormLeg {
  return { modality: leg.modality, label: leg.label, ...distanceToForm(leg.distance_m) };
}

function legToPayload(leg: RaceFormLeg): Leg {
  return {
    modality: leg.modality,
    label: leg.label.trim() || MODALITY_LABEL[leg.modality],
    distance_m: parseDistance(leg.distance, leg.unit),
  };
}

function waveToForm(wave: WaveRow): RaceFormWave {
  return { id: wave.id, name: wave.name, position: wave.position, start_at: wave.start_at };
}

/** Builds the editable form from a saved race + the event's waves (filtered to this race, in
 * order); a race somehow left with no wave still edits as one "Largada geral" (the server would
 * recreate it anyway per Ruling 12). */
export function raceToForm(race: RaceRow, waves: WaveRow[]): RaceForm {
  const raceWaves = waves
    .filter((w) => w.race_id === race.id)
    .slice()
    .sort((a, b) => a.position - b.position);
  return {
    id: race.id,
    event_id: race.event_id,
    name: race.name,
    position: race.position,
    team_size: race.team_size,
    legs: race.legs.map(legToForm),
    waves: raceWaves.length > 0 ? raceWaves.map(waveToForm) : [defaultWaveForm()],
    config: race.config,
  };
}

/** Builds a fresh form from a race preset (the "Nova prova" picker). */
export function presetToForm(preset: RacePreset, eventId: string): RaceForm {
  return {
    event_id: eventId,
    name: preset.name,
    position: 0,
    team_size: preset.team_size,
    legs: preset.legs.map(legToForm),
    waves: [defaultWaveForm()],
    config: defaultRaceConfig(preset.team_size),
  };
}

/** pt-BR validation messages for the whole form (empty when it is ready to save). */
export function validateRaceForm(f: RaceForm): string[] {
  const errors: string[] = [];
  if (!f.name.trim()) errors.push('Informe o nome da prova');
  if (f.legs.length === 0) errors.push('Adicione pelo menos uma perna');

  f.legs.forEach((leg, i) => {
    const blank = leg.distance.trim() === '';
    if (blank ? leg.modality !== 'other' : parseDistance(leg.distance, leg.unit) === null) {
      errors.push(`Distância inválida na perna ${i + 1}`);
    }
  });

  errors.push(...validateAgeGroups(f.config.age_groups));

  for (const rd of f.config.rankings) {
    if (rd.size < 1 || rd.size > 10) errors.push(`O pódio "${rd.name}" precisa de tamanho entre 1 e 10`);
  }

  return errors;
}

/** Converts the form to the payload `api.admin.saveRace` expects. Always includes the full
 * `waves` list (Ruling 12: a present array upserts by id and deletes whatever is missing from
 * it) and the full `config` object (Ruling 14: the server merges it with the existing one). */
export function formToPayload(f: RaceForm): RacePayload {
  return {
    ...(f.id ? { id: f.id } : {}),
    event_id: f.event_id,
    name: f.name.trim(),
    position: f.position,
    team_size: f.team_size,
    legs: f.legs.map(legToPayload),
    config: f.config,
    waves: f.waves.map((w, i) => ({
      ...(w.id ? { id: w.id } : {}),
      name: w.name.trim() || DEFAULT_WAVE_NAME,
      position: i,
    })),
  };
}

export function teamSizeLabel(n: number): string {
  if (n === 1) return 'Individual';
  if (n === 2) return 'Dupla';
  if (n === 3) return 'Trio';
  return `Equipe de ${n}`;
}

/** The list's one-line legs summary, e.g. "Natação 750 m → Ciclismo 20 km → Corrida 5 km". */
export function legsSummary(legs: Leg[]): string {
  return legs
    .map((l) => {
      const { distance, unit } = distanceToForm(l.distance_m);
      return distance ? `${l.label} ${distance} ${unit}` : l.label;
    })
    .join(' → ');
}
