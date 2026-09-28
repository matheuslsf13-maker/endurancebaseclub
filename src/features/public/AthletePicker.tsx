import { useMemo, useState } from 'react';
import { Input, Modal } from '../../components/ui';
import type { PublicAthleteRow } from '../../lib/types';
import { searchAthletes } from './athleteSearch';

export interface AthletePickerProps {
  open: boolean;
  athletes: PublicAthleteRow[];
  excludeId: string;
  onPick(athleteId: string): void;
  onClose(): void;
}

/** "Comparar com…" (spec 2026-09-28 §3.3): search another public athlete, never the current one. */
export function AthletePicker({ open, athletes, excludeId, onPick, onClose }: AthletePickerProps) {
  const [term, setTerm] = useState('');
  const matches = useMemo(() => searchAthletes(athletes.filter((a) => a.id !== excludeId), term), [athletes, excludeId, term]);
  return (
    <Modal open={open} onClose={onClose} title="Comparar com…">
      <div data-testid="compare-picker" className="flex flex-col gap-3">
        <Input label="Buscar atleta" type="search" value={term} onChange={(e) => setTerm(e.target.value)} autoFocus />
        {matches.length === 0 ? (
          <p className="text-sm text-muted">Nenhum atleta encontrado</p>
        ) : (
          <ul className="flex max-h-80 flex-col overflow-y-auto">
            {matches.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  onClick={() => onPick(a.id)}
                >
                  {a.name}
                  {a.city ? <span className="text-muted">{a.city}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
