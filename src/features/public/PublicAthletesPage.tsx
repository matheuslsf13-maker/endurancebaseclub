import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { EmptyState, Input } from '../../components/ui';
import type { SexFilter } from '../../domain/clubStats';
import { participationCounts } from '../../domain/stats';
import { searchAthletes } from './athleteSearch';
import { PublicShell } from './PublicShell';
import { PublicStatsFallback } from './PublicStatsFallback';
import { SexFilterButtons } from './SexFilterButtons';
import { usePublicStats } from './usePublicStats';

const races = (n: number) => (n === 1 ? '1 prova' : `${n} provas`);

/** #/perfis (spec 2026-09-28 §3.2): every public athlete, A→Z, with name search and a sex filter. */
export default function PublicAthletesPage() {
  const query = usePublicStats();
  const [term, setTerm] = useState('');
  const [sex, setSex] = useState<SexFilter>(null);
  const counts = useMemo(() => participationCounts(query.data?.results ?? []), [query.data]);

  useEffect(() => {
    document.title = 'Atletas – EnduranceBaseClub';
    return () => { document.title = 'EnduranceBaseClub'; };
  }, []);

  if (!query.data) {
    return (
      <PublicShell>
        <PublicStatsFallback query={query} testId="public-athletes" />
      </PublicShell>
    );
  }

  const { athletes } = query.data;
  const shown = searchAthletes(sex === null ? athletes : athletes.filter((a) => a.sex === sex), term)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  return (
    <PublicShell>
      <div data-testid="public-athletes" className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6 sm:px-6">
        <h1 className="brand-title text-xl font-semibold">Atletas</h1>
        {athletes.length === 0 ? (
          <EmptyState title="Nenhum atleta com perfil público ainda" />
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="sm:w-80">
                <Input label="Buscar por nome" type="search" data-testid="athlete-search" value={term} onChange={(e) => setTerm(e.target.value)} />
              </div>
              <SexFilterButtons value={sex} onChange={setSex} allLabel="Todos" />
            </div>
            {shown.length === 0 ? (
              <EmptyState title="Nenhum atleta encontrado" />
            ) : (
              <ul className="flex flex-col gap-2">
                {shown.map((a) => (
                  <li key={a.id}>
                    <Link
                      to={`/atleta/${a.id}`}
                      data-testid="athlete-row"
                      className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-border px-4 py-3 hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    >
                      <span className="font-medium">{a.name}</span>
                      <span className="text-sm text-muted">{[a.city, a.team_club].filter(Boolean).join(' · ')}</span>
                      <span className="ml-auto text-sm text-muted tabular">{races(counts.get(a.id) ?? 0)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </PublicShell>
  );
}
