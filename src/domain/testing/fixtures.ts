import type { AthleteRow, EntryRow, EventRow, MarkRow, RaceConfig, RaceRow, ResolutionRow, TimekeeperRow, WaveRow } from '../../lib/types';
import { defaultRaceConfig } from '../presets';

export const T0 = Date.parse('2026-10-11T11:00:00.000Z'); // 08:00:00 in Brasília
export const SEC = 1000;
export const MIN = 60_000;
export const iso = (ms: number) => new Date(ms).toISOString();
let seq = 0;
export const nextId = (p: string) => `${p}${++seq}`;

export function makeEvent(p: Partial<EventRow> = {}): EventRow {
  return { id: 'e1', name: 'Evento Teste', date: '2026-10-11', location: 'Vila Velha', description: '', levels: [], status: 'ao_vivo', is_public: true, public_slug: 'evento-teste', version: 1, ...p };
}
export function makeRace(p: Partial<RaceRow> & { configPatch?: Partial<RaceConfig> } = {}): RaceRow {
  const { configPatch, ...rest } = p;
  const team_size = rest.team_size ?? 1;
  return {
    id: 'r1', event_id: 'e1', name: 'Aquathlon', position: 0, team_size,
    legs: [{ modality: 'swim', label: 'Natação', distance_m: 750 }, { modality: 'run', label: 'Corrida', distance_m: 5000 }],
    config: { ...defaultRaceConfig(team_size), ...(configPatch ?? {}) }, finalized_at: null, ...rest,
  };
}
export function makeWave(p: Partial<WaveRow> = {}): WaveRow {
  return { id: 'w1', race_id: 'r1', name: 'Largada geral', position: 0, start_at: iso(T0), ...p };
}
export function makeAthlete(p: Partial<AthleteRow> = {}): AthleteRow {
  return { id: 'a1', name: 'Ana Souza', sex: 'F', birth_date: '1990-06-15', city: null, team_club: null, public_profile: true, ...p };
}
export function makeEntry(p: Partial<EntryRow> = {}): EntryRow {
  return { id: 'en1', event_id: 'e1', race_id: 'r1', wave_id: 'w1', bib: '101', team_name: null, level: null, status: 'ok', penalty_ms: 0, notes: '', members: [{ athlete_id: 'a1', position: 0, legs: [0, 1] }], ...p };
}
export function makeMark(p: Partial<MarkRow> & { at: number }): MarkRow {
  const { at, ...rest } = p;
  return { id: nextId('m'), event_id: 'e1', timekeeper_id: 'tk1', ts: iso(at), device_ts: iso(at), clock_offset_ms: 0, clock_rtt_ms: 80, entry_id: 'en1', leg_index: 0, athlete_id: null, discarded: false, discarded_by: null, created_at: iso(at), updated_at: iso(at), ...rest };
}
export function makeResolution(p: Partial<ResolutionRow> & Pick<ResolutionRow, 'entry_id' | 'leg_index' | 'mode'>): ResolutionRow {
  return { event_id: 'e1', mark_id: null, manual_ts: null, note: '', updated_at: iso(T0), ...p };
}
export function makeTimekeeper(p: Partial<TimekeeperRow> = {}): TimekeeperRow {
  return { id: 'tk1', name: 'Ana', active: true, ...p };
}
