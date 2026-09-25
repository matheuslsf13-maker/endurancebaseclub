import { useState } from 'react';
import { Button, Input } from '../../components/ui';
import { validateAgeGroups } from '../../domain/categories';
import { generateAgeGroups } from '../../domain/presets';
import type { AgeGroup } from '../../lib/types';

function blankGroup(): AgeGroup {
  return { label: '', min: 0, max: null };
}

export interface AgeGroupsEditorProps {
  groups: AgeGroup[];
  onChange(groups: AgeGroup[]): void;
}

/** "Categorias" section's faixa-etária editor: manual rows (label/min/max) plus a generator that
 * fills "de X em X anos a partir de Y até Z" via `generateAgeGroups`, and the domain's overlap
 * validation shown live. */
export function AgeGroupsEditor({ groups, onChange }: AgeGroupsEditorProps) {
  const [genStart, setGenStart] = useState('20');
  const [genStep, setGenStep] = useState('10');
  const [genLast, setGenLast] = useState('60');
  const errors = validateAgeGroups(groups);

  function update(i: number, patch: Partial<AgeGroup>) {
    onChange(groups.map((g, idx) => (idx === i ? { ...g, ...patch } : g)));
  }

  function remove(i: number) {
    onChange(groups.filter((_, idx) => idx !== i));
  }

  function generate() {
    const start = Number(genStart), step = Number(genStep), last = Number(genLast);
    if (!Number.isFinite(start) || !Number.isFinite(step) || !Number.isFinite(last) || step <= 0 || last <= start) return;
    onChange(generateAgeGroups(start, step, last));
  }

  return (
    <div className="flex flex-col gap-3">
      {groups.length === 0 && <p className="text-sm text-muted">Nenhuma faixa etária — a categoria "Idade" fica sem faixas.</p>}
      {groups.map((g, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-xl border border-border p-3 sm:flex-row sm:items-end sm:gap-3">
          <div className="flex-1">
            <Input label="Rótulo" data-testid={`agegroup-label-${i}`} value={g.label} onChange={(e) => update(i, { label: e.target.value })} />
          </div>
          <div className="sm:w-24">
            <Input
              label="Idade mín."
              type="number"
              data-testid={`agegroup-min-${i}`}
              value={g.min}
              onChange={(e) => update(i, { min: Number(e.target.value) })}
            />
          </div>
          <div className="sm:w-24">
            <Input
              label="Idade máx."
              type="number"
              data-testid={`agegroup-max-${i}`}
              placeholder="sem limite"
              value={g.max ?? ''}
              onChange={(e) => update(i, { max: e.target.value === '' ? null : Number(e.target.value) })}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Remover faixa ${g.label || i + 1}`}
            data-testid={`agegroup-remove-${i}`}
            onClick={() => remove(i)}
          >
            Remover
          </Button>
        </div>
      ))}
      <Button type="button" variant="secondary" size="sm" data-testid="agegroup-add" onClick={() => onChange([...groups, blankGroup()])}>
        Adicionar faixa
      </Button>

      {errors.length > 0 && (
        <ul className="flex flex-col gap-1">
          {errors.map((e) => (
            <li key={e} role="alert" className="text-sm text-danger">
              {e}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-dashed border-border p-3">
        <p className="w-full text-sm text-muted">Gerar faixas de X em X anos a partir de Y até Z (substitui a lista acima)</p>
        <div className="w-20">
          <Input label="De X em X" type="number" data-testid="agegroup-gen-step" value={genStep} onChange={(e) => setGenStep(e.target.value)} />
        </div>
        <div className="w-24">
          <Input label="A partir de" type="number" data-testid="agegroup-gen-start" value={genStart} onChange={(e) => setGenStart(e.target.value)} />
        </div>
        <div className="w-20">
          <Input label="Até" type="number" data-testid="agegroup-gen-last" value={genLast} onChange={(e) => setGenLast(e.target.value)} />
        </div>
        <Button type="button" variant="secondary" size="sm" data-testid="agegroup-gen-apply" onClick={generate}>
          Gerar
        </Button>
      </div>
    </div>
  );
}
