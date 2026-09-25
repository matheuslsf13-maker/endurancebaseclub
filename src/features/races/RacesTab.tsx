import { useState } from 'react';
import { Badge, Button, Card, EmptyState, Select, Table, useConfirm, useToast } from '../../components/ui';
import { RACE_PRESETS } from '../../domain/presets';
import { api, ApiError } from '../../lib/api';
import type { RaceRow } from '../../lib/types';
import { useEventContext } from '../events/EventContext';
import { RaceEditor } from './RaceEditor';
import { legsSummary, presetToForm, raceToForm, teamSizeLabel } from './raceForm';
import type { RaceForm } from './raceForm';

const PRESET_OPTIONS = [{ value: '', label: 'Selecione um modelo' }, ...RACE_PRESETS.map((p) => ({ value: p.id, label: p.name }))];

type View = { mode: 'list' } | { mode: 'preset' } | { mode: 'edit'; form: RaceForm };

/** Aba Provas: lista as provas do evento e abre o `RaceEditor` para criar (a partir de um modelo
 * de `RACE_PRESETS`) ou editar uma existente. */
export default function RacesTab() {
  const { agg, refresh } = useEventContext();
  const toast = useToast();
  const confirm = useConfirm();
  const [view, setView] = useState<View>({ mode: 'list' });

  function startFromPreset(presetId: string) {
    const preset = RACE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const form = { ...presetToForm(preset, agg.event.id), position: agg.races.length };
    setView({ mode: 'edit', form });
  }

  function startEdit(race: RaceRow) {
    setView({ mode: 'edit', form: raceToForm(race, agg.waves) });
  }

  async function handleDelete(race: RaceRow) {
    const ok = await confirm({
      title: 'Excluir prova',
      message: `Excluir a prova "${race.name}"? As inscrições e marcações associadas também são removidas.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.admin.deleteRace(race.id);
      await refresh();
      toast.show({ message: 'Prova excluída', tone: 'success' });
    } catch (e) {
      toast.show({ message: e instanceof ApiError ? e.message : 'Não foi possível excluir a prova', tone: 'danger' });
    }
  }

  if (view.mode === 'edit') {
    return <RaceEditor initial={view.form} onDone={() => setView({ mode: 'list' })} />;
  }

  const races = agg.races.slice().sort((a, b) => a.position - b.position);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="brand-title text-lg font-semibold">Provas</h1>
        {view.mode === 'list' && (
          <Button data-testid="new-race" onClick={() => setView({ mode: 'preset' })}>
            Nova prova
          </Button>
        )}
      </div>

      {view.mode === 'preset' && (
        <Card>
          <div className="flex flex-wrap items-end gap-3">
            <div className="sm:w-80">
              <Select
                label="Modelo da prova"
                data-testid="race-preset"
                options={PRESET_OPTIONS}
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) startFromPreset(e.target.value);
                }}
              />
            </div>
            <Button variant="ghost" size="sm" onClick={() => setView({ mode: 'list' })}>
              Cancelar
            </Button>
          </div>
        </Card>
      )}

      {races.length === 0 ? (
        <EmptyState title="Nenhuma prova cadastrada">Crie a primeira prova a partir de um modelo.</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <th className="px-3 py-2">Prova</th>
              <th className="px-3 py-2">Equipe</th>
              <th className="px-3 py-2">Pernas</th>
              <th className="px-3 py-2">Inscrições</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {races.map((race) => {
              const count = agg.entries.filter((e) => e.race_id === race.id).length;
              return (
                <tr key={race.id} className="border-t border-border align-top">
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{race.name}</span>
                      {race.finalized_at && <Badge tone="success">Finalizada</Badge>}
                    </div>
                  </td>
                  <td className="px-3 py-2">{teamSizeLabel(race.team_size)}</td>
                  <td className="px-3 py-2">{legsSummary(race.legs)}</td>
                  <td className="px-3 py-2 tabular">{count} inscrição{count === 1 ? '' : 's'}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-2">
                      <Button variant="secondary" size="sm" data-testid={`race-edit-${race.id}`} onClick={() => startEdit(race)}>
                        Editar
                      </Button>
                      <Button variant="danger" size="sm" data-testid={`race-delete-${race.id}`} onClick={() => void handleDelete(race)}>
                        Excluir
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}
