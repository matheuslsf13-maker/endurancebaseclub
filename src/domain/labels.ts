import type { EntryStatus, MarkRow, TimekeeperRow } from '../lib/types';
import type { Crossing, Issue, IssueType, TimingStatus } from './consolidation';

/**
 * pt-BR label for an entry's computed timing status (spec §8): what the consolidation engine
 * derived for a leg-by-leg entry (finished/on course/not started, or a status the master set).
 * Used in the Tempos/Classificação sheets and anywhere a computed timing state is shown.
 */
export const STATUS_LABEL: Record<TimingStatus, string> = {
  finished: 'Concluiu',
  on_course: 'Em prova',
  not_started: 'Não largou',
  dnf: 'DNF',
  dns: 'DNS',
  dsq: 'DSQ',
};

/**
 * pt-BR label for an entry's registration status — independent of computed timing (an entry can
 * be `ok` and still show `not_started`/`on_course` in `STATUS_LABEL`). Used in the Inscritos sheet
 * and entry-status pickers.
 */
export const ENTRY_STATUS_LABEL: Record<EntryStatus, string> = {
  ok: 'Normal',
  dns: 'DNS – não largou',
  dnf: 'DNF – abandonou',
  dsq: 'DSQ – desclassificado',
};

export const SEVERITY_LABEL: Record<Issue['severity'], string> = {
  error: 'Erro',
  warning: 'Aviso',
  info: 'Info',
};

export const ISSUE_LABEL: Record<IssueType, string> = {
  divergence: 'Divergência',
  missing_crossing: 'Passagem faltando',
  order: 'Ordem inválida',
  duplicate: 'Marcação duplicada',
  no_start: 'Sem largada',
  unassigned: 'Sem atleta',
  chosen_mark_discarded: 'Escolha descartada',
  not_finished: 'Em prova',
};

/** The name of the timekeeper `id` resolves to, or undefined for `null`/an unknown id. */
function timekeeperName(id: string | null, tkById: Map<string, TimekeeperRow>): string | undefined {
  return id === null ? undefined : tkById.get(id)?.name;
}

/**
 * pt-BR description of what decided a crossing's official time (spec §8, "Fonte" column of the
 * Tempos sheet, §11): the system median, the configured reference timekeeper, a specific mark the
 * organizer chose (by timekeeper name, or "Organização" for an organization mark), a manually
 * typed time, or '' when there is no official time at all.
 */
export function crossingSourceLabel(c: Crossing, tkById: Map<string, TimekeeperRow>, marks: MarkRow[]): string {
  if (c.official_source === null) return '';
  if (c.official_source === 'manual') return 'Manual';
  if (c.official_source === 'mark') {
    const mark = marks.find(m => m.id === c.resolution?.mark_id);
    return `Marcação de ${timekeeperName(mark?.timekeeper_id ?? null, tkById) ?? 'Organização'}`;
  }
  if (c.official_source === 'reference') {
    const candidate = c.candidates.find(x => x.ts_ms === c.official_ms);
    return `Cronometrista de referência (${timekeeperName(candidate?.timekeeper_id ?? null, tkById) ?? 'Cronometrista'})`;
  }
  return 'Sistema (mediana)'; // official_source === 'median'
}
