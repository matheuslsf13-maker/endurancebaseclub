import type { SnapshotStatus } from '../../lib/types';

export const STATUS_LABEL: Record<SnapshotStatus, string> = {
  finished: 'Concluído', on_course: 'Em prova', not_started: 'Não iniciado', dnf: 'DNF', dns: 'DNS', dsq: 'DSQ',
};
export const STATUS_TONE: Record<SnapshotStatus, 'success' | 'danger' | 'neutral'> = {
  finished: 'success', dnf: 'danger', dsq: 'danger', on_course: 'neutral', not_started: 'neutral', dns: 'neutral',
};

export function ordinal(pos: number | null): string {
  return pos === null ? '—' : `${pos}º`;
}

export function percent(v: number | null): string {
  return v === null ? '—' : `${Math.round(v * 100)}%`;
}
