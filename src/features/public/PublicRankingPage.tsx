import { useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { EmptyState, Table } from '../../components/ui';
import { YearSelect } from '../../components/YearSelect';
import { computeClubRecords, computeLeaders } from '../../domain/clubStats';
import type { LeaderRow, SexFilter } from '../../domain/clubStats';
import { resultYears } from '../../domain/stats';
import { formatDateBR, formatDuration, formatKm } from '../../lib/format';
import { useYearParam } from '../../lib/useYearParam';
import { PublicShell } from './PublicShell';
import { PublicStatsFallback } from './PublicStatsFallback';
import { SexFilterButtons } from './SexFilterButtons';
import { usePublicStats } from './usePublicStats';

function Board({ title, rows, format }: { title: string; rows: LeaderRow[]; format(value: number): string }) {
  return (
    <section className="rounded-xl border border-border p-4">
      <h3 className="brand-title mb-2 text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Ninguém ainda</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {rows.map((r) => (
            <li key={r.athlete_id} className="flex items-center gap-2 text-sm">
              <span className="w-8 tabular text-muted">{r.pos}º</span>{' '}
              <Link to={`/atleta/${r.athlete_id}`} className="underline-offset-2 hover:underline">{r.name}</Link>{' '}
              <span className="ml-auto tabular font-medium">{format(r.value)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** #/ranking (spec 2026-09-28 §3.5): leader boards and club records, filtered by year and sex. */
export default function PublicRankingPage() {
  const query = usePublicStats();
  const [params, setParams] = useSearchParams();
  const rawSex = params.get('sexo');
  const sex: SexFilter = rawSex === 'M' || rawSex === 'F' ? rawSex : null;
  const setSex = (next: SexFilter) =>
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next === null) p.delete('sexo');
      else p.set('sexo', next);
      return p;
    }, { replace: true });
  const years = useMemo(() => resultYears(query.data?.results ?? []), [query.data]);
  const [year, setYear] = useYearParam(years);
  const leaders = useMemo(() => (query.data ? computeLeaders(query.data.athletes, query.data.results, { year, sex }) : null), [query.data, year, sex]);
  const records = useMemo(() => (query.data ? computeClubRecords(query.data.athletes, query.data.results, { year, sex }) : []), [query.data, year, sex]);

  useEffect(() => {
    document.title = 'Rankings – EnduranceBaseClub';
    return () => { document.title = 'EnduranceBaseClub'; };
  }, []);

  if (!query.data || !leaders) {
    return (
      <PublicShell>
        <PublicStatsFallback query={query} testId="public-ranking" />
      </PublicShell>
    );
  }

  const empty = leaders.wins.length + leaders.podiums.length + leaders.finishes.length + leaders.km.length === 0 && records.length === 0;

  return (
    <PublicShell>
      <div data-testid="public-ranking" className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
        <h1 className="brand-title text-xl font-semibold">Rankings</h1>
        <div className="flex flex-wrap items-end gap-3">
          <YearSelect years={years} value={year} onChange={setYear} />
          <SexFilterButtons value={sex} onChange={setSex} allLabel="Geral" testId="sex-filter" />
        </div>

        {empty ? (
          <EmptyState title="Ainda não há resultados oficiais neste período" />
        ) : (
          <>
            <section className="flex flex-col gap-3">
              <h2 className="brand-title text-lg font-semibold">Líderes</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Board title="Vitórias gerais" rows={leaders.wins} format={String} />
                <Board title="Pódios" rows={leaders.podiums} format={String} />
                <Board title="Provas concluídas" rows={leaders.finishes} format={String} />
                <Board title="Km em prova" rows={leaders.km} format={formatKm} />
              </div>
            </section>

            <section className="flex flex-col gap-3">
              <h2 className="brand-title text-lg font-semibold">Recordes do clube</h2>
              {records.length === 0 ? (
                <p className="text-sm text-muted">Sem recordes neste período</p>
              ) : (
                records.map((g) => (
                  <section key={`${g.modality}|${g.distance_m}`} className="rounded-xl border border-border p-4">
                    <h3 className="brand-title mb-2 text-sm font-semibold">{g.title}</h3>
                    <Table>
                      <thead>
                        <tr>
                          <th className="px-3 py-2" scope="col">#</th>
                          <th className="px-3 py-2" scope="col">Atleta</th>
                          <th className="px-3 py-2" scope="col">Tempo</th>
                          <th className="px-3 py-2" scope="col">Ritmo</th>
                          <th className="px-3 py-2" scope="col">Evento</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.entries.map((e, i) => (
                          <tr key={e.athlete_id} className="border-t border-border">
                            <td className="px-3 py-2 tabular">{i + 1}º</td>
                            <td className="px-3 py-2"><Link to={`/atleta/${e.athlete_id}`} className="hover:underline">{e.name}</Link></td>
                            <td className="px-3 py-2 tabular">{formatDuration(e.time_ms)}</td>
                            <td className="px-3 py-2 tabular">{e.pace || '—'}</td>
                            <td className="px-3 py-2">{e.event_name} · {formatDateBR(e.event_date)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </section>
                ))
              )}
            </section>
          </>
        )}
      </div>
    </PublicShell>
  );
}
