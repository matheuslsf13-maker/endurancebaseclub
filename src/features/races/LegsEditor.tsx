import { Button, Input, Select } from '../../components/ui';
import { MODALITY_LABEL } from '../../domain/presets';
import type { Modality } from '../../lib/types';
import { moveItem } from './raceForm';
import type { DistanceUnit, RaceFormLeg } from './raceForm';

const MODALITY_OPTIONS = (Object.keys(MODALITY_LABEL) as Modality[]).map((m) => ({ value: m, label: MODALITY_LABEL[m] }));
const UNIT_OPTIONS: { value: DistanceUnit; label: string }[] = [
  { value: 'm', label: 'm' },
  { value: 'km', label: 'km' },
];

function newLeg(): RaceFormLeg {
  return { modality: 'run', label: MODALITY_LABEL.run, distance: '', unit: 'm' };
}

export interface LegsEditorProps {
  legs: RaceFormLeg[];
  onChange(legs: RaceFormLeg[]): void;
}

/** "Pernas" section: an ordered list of legs (modality, label, distance/unit), with add, remove
 * (kept to at least one) and reorder — the prova's list of `Trecho`s (CLAUDE.md). */
export function LegsEditor({ legs, onChange }: LegsEditorProps) {
  function update(i: number, patch: Partial<RaceFormLeg>) {
    onChange(legs.map((leg, idx) => (idx === i ? { ...leg, ...patch } : leg)));
  }

  function onModalityChange(i: number, modality: Modality) {
    const leg = legs[i];
    // Only replace the label when it still matched the old modality's default — a custom label
    // the organizer typed in is left alone.
    const label = leg.label === MODALITY_LABEL[leg.modality] ? MODALITY_LABEL[modality] : leg.label;
    update(i, { modality, label });
  }

  function move(i: number, dir: -1 | 1) {
    const next = moveItem(legs, i, dir);
    if (next !== legs) onChange(next);
  }

  function remove(i: number) {
    if (legs.length <= 1) return;
    onChange(legs.filter((_, idx) => idx !== i));
  }

  return (
    <div className="flex flex-col gap-3">
      {legs.map((leg, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-xl border border-border p-3 sm:flex-row sm:items-end sm:gap-3">
          <div className="text-sm font-medium text-muted sm:pb-2.5">Perna {i + 1}</div>
          <div className="sm:w-40">
            <Select
              label="Modalidade"
              data-testid={`leg-modality-${i}`}
              options={MODALITY_OPTIONS}
              value={leg.modality}
              onChange={(e) => onModalityChange(i, e.target.value as Modality)}
            />
          </div>
          <div className="flex-1">
            <Input
              label="Rótulo"
              data-testid={`leg-label-${i}`}
              value={leg.label}
              onChange={(e) => update(i, { label: e.target.value })}
            />
          </div>
          <div className="sm:w-28">
            <Input
              label="Distância"
              data-testid={`leg-distance-${i}`}
              inputMode="decimal"
              placeholder={leg.modality === 'other' ? 'opcional' : undefined}
              value={leg.distance}
              onChange={(e) => update(i, { distance: e.target.value })}
            />
          </div>
          <div className="sm:w-24">
            <Select
              label="Unidade"
              data-testid={`leg-unit-${i}`}
              options={UNIT_OPTIONS}
              value={leg.unit}
              onChange={(e) => update(i, { unit: e.target.value as DistanceUnit })}
            />
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label={`Mover perna ${i + 1} para cima`}
              data-testid={`leg-move-up-${i}`}
              disabled={i === 0}
              onClick={() => move(i, -1)}
            >
              ↑
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label={`Mover perna ${i + 1} para baixo`}
              data-testid={`leg-move-down-${i}`}
              disabled={i === legs.length - 1}
              onClick={() => move(i, 1)}
            >
              ↓
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Remover perna ${i + 1}`}
              data-testid={`leg-remove-${i}`}
              disabled={legs.length <= 1}
              onClick={() => remove(i)}
            >
              Remover
            </Button>
          </div>
        </div>
      ))}
      <Button type="button" variant="secondary" size="sm" data-testid="leg-add" onClick={() => onChange([...legs, newLeg()])}>
        Adicionar perna
      </Button>
    </div>
  );
}
