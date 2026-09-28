import type { SexFilter } from '../../domain/clubStats';

/** Segmented Todos/Geral · Masculino · Feminino buttons (aria-pressed marks the current one). */
export function SexFilterButtons({ value, onChange, allLabel, testId }: { value: SexFilter; onChange(v: SexFilter): void; allLabel: string; testId?: string }) {
  const options: { v: SexFilter; label: string }[] = [{ v: null, label: allLabel }, { v: 'M', label: 'Masculino' }, { v: 'F', label: 'Feminino' }];
  return (
    <div role="group" aria-label="Sexo" data-testid={testId} className="inline-flex gap-1 rounded-xl border border-border p-1">
      {options.map((o) => (
        <button
          key={o.label}
          type="button"
          aria-pressed={value === o.v}
          onClick={() => onChange(o.v)}
          className={`min-h-11 rounded-lg px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${value === o.v ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
