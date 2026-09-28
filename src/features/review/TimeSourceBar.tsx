import { useState } from 'react';
import { Select, useToast } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import type { RaceConfig, RaceRow, TimekeeperRow, TimeSource } from '../../lib/types';

export interface TimeSourceBarProps {
  races: RaceRow[];
  timekeepers: TimekeeperRow[];
  /** Reloads the event aggregate, which recalculates every crossing with the new source. */
  onSaved(): Promise<void>;
}

const METHOD_OPTIONS: { value: TimeSource; label: string }[] = [
  { value: 'median', label: 'Mediana' },
  { value: 'mean', label: 'Média' },
];

/**
 * 0009 "Fonte do tempo": each race's system method (median/mean) and optional priority timekeeper,
 * switchable in the Review tab while looking at the times. A change saves the race through
 * `admin_save_race` with its own fields and no `waves` key (Ruling 12: waves untouched; Ruling 14:
 * the config merges), then reloads the aggregate. A finalized race is read-only here: its official
 * results are a snapshot, so the source changes only after reopening it in Resultados.
 */
export function TimeSourceBar({ races, timekeepers, onSaved }: TimeSourceBarProps) {
  const toast = useToast();
  const [savingId, setSavingId] = useState<string | null>(null);

  async function save(race: RaceRow, patch: Partial<Pick<RaceConfig, 'time_source' | 'reference_timekeeper_id'>>) {
    setSavingId(race.id);
    try {
      await api.admin.saveRace({
        id: race.id, event_id: race.event_id, name: race.name, position: race.position,
        team_size: race.team_size, legs: race.legs, config: { ...race.config, ...patch },
      });
      await onSaved();
    } catch (err) {
      toast.show({ message: err instanceof ApiError ? err.message : 'Erro inesperado', tone: 'danger' });
    } finally {
      setSavingId(null);
    }
  }

  const priorityOptions = [{ value: '', label: 'Nenhum' }, ...timekeepers.map((t) => ({ value: t.id, label: t.name }))];

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="brand-title text-lg font-semibold">Fonte do tempo</h2>
        <p className="text-sm text-muted">
          Onde o cronometrista prioritário marcou, vale a marcação dele; onde não marcou, vale o tempo do sistema. Uma
          escolha feita numa passagem (marcação ou hora manual) sempre vence.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {[...races].sort((a, b) => a.position - b.position).map((race) => {
          const finalized = race.finalized_at !== null;
          const disabled = finalized || savingId === race.id;
          return (
            <div
              key={race.id}
              data-testid={`time-source-${race.id}`}
              className="flex flex-col gap-2 rounded-xl border border-border p-3 sm:flex-row sm:items-end sm:gap-4"
            >
              <p className="font-medium sm:w-64 sm:shrink-0 sm:pb-3">{race.name}</p>
              <div className="sm:w-40">
                <Select
                  label="Tempo do sistema"
                  data-testid={`time-source-method-${race.id}`}
                  options={METHOD_OPTIONS}
                  value={race.config.time_source}
                  disabled={disabled}
                  onChange={(e) => void save(race, { time_source: e.target.value as TimeSource })}
                />
              </div>
              <div className="sm:w-56">
                <Select
                  label="Cronometrista prioritário"
                  data-testid={`time-source-priority-${race.id}`}
                  options={priorityOptions}
                  value={race.config.reference_timekeeper_id ?? ''}
                  disabled={disabled}
                  onChange={(e) => void save(race, { reference_timekeeper_id: e.target.value || null })}
                />
              </div>
              {finalized && (
                <p className="text-sm text-muted sm:pb-3">Prova finalizada: para trocar, reabra a prova em Resultados.</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
