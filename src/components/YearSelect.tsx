import { Select } from './ui';

const CAREER = 'carreira';

/** "Período" select: "Carreira" (null) or one of `years` (newest first). */
export function YearSelect({ years, value, onChange }: { years: string[]; value: string | null; onChange(year: string | null): void }) {
  return (
    <div className="w-40">
      <Select
        label="Período"
        data-testid="year-filter"
        value={value ?? CAREER}
        options={[{ value: CAREER, label: 'Carreira' }, ...years.map((y) => ({ value: y, label: y }))]}
        onChange={(e) => onChange(e.target.value === CAREER ? null : e.target.value)}
      />
    </div>
  );
}
