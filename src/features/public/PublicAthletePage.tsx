import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button, Card } from '../../components/ui';
import { YearSelect } from '../../components/YearSelect';
import { sexLabel } from '../../domain/categories';
import { filterResultsByYear, resultYears } from '../../domain/stats';
import { useYearParam } from '../../lib/useYearParam';
import { StatsView } from '../athletes/StatsView';
import { AthletePicker } from './AthletePicker';
import { PublicShell } from './PublicShell';
import { PublicStatsFallback } from './PublicStatsFallback';
import { usePublicStats } from './usePublicStats';

/**
 * Public athlete profile (spec §6/§12; 2026-09-28 §3.3). Built on the pub_stats bundle, so it only
 * ever sees `{id,name,sex,city,team_club}` of public athletes (pub_athlete stays in the database
 * for older app builds, Ruling 26). Year filter in `?ano`, team partners with a public profile link
 * to "Nós dois", and "Comparar com…" picks anyone else.
 */
export default function PublicAthletePage() {
  const { athleteId } = useParams<{ athleteId: string }>();
  const navigate = useNavigate();
  const query = usePublicStats();
  const [picking, setPicking] = useState(false);
  const athlete = query.data?.athletes.find((a) => a.id === athleteId);
  const mine = useMemo(
    () => (athlete && query.data ? query.data.results.filter((r) => r.athlete_ids.includes(athlete.id)) : []),
    [athlete, query.data],
  );
  const years = useMemo(() => resultYears(mine), [mine]);
  const [year, setYear] = useYearParam(years);
  const shown = useMemo(() => filterResultsByYear(mine, year), [mine, year]);
  const publicIds = useMemo(() => new Set((query.data?.athletes ?? []).map((a) => a.id)), [query.data]);

  useEffect(() => {
    document.title = athlete ? `${athlete.name} – EnduranceBaseClub` : 'EnduranceBaseClub';
  }, [athlete]);
  // C-Minor-15: reset on unmount only.
  useEffect(() => () => { document.title = 'EnduranceBaseClub'; }, []);

  if (!query.data) {
    return (
      <PublicShell>
        <PublicStatsFallback query={query} testId="public-athlete" />
      </PublicShell>
    );
  }

  if (!athlete) {
    return (
      <PublicShell>
        <div data-testid="public-athlete" className="mx-auto w-full max-w-md px-4 py-12">
          <Card className="flex flex-col gap-4">
            <p role="alert" className="text-sm text-danger-text">Atleta não encontrado ou perfil privado</p>
            <Link to="/perfis" className="text-sm text-muted underline underline-offset-2 hover:text-fg">Ver todos os atletas</Link>
          </Card>
        </div>
      </PublicShell>
    );
  }

  const search = year ? `?ano=${year}` : '';
  const compareHref = (otherId: string) => `/comparar/${athlete.id}/${otherId}${search}`;

  return (
    <PublicShell>
      <div data-testid="public-athlete" className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <Link to="/perfis" className="text-sm text-muted underline underline-offset-2 hover:text-fg">← Atletas</Link>

        <Card className="mt-4 flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="brand-title text-xl font-semibold">{athlete.name}</h1>
            <p className="text-sm text-muted">
              {sexLabel(athlete.sex)}
              {athlete.city ? ` · ${athlete.city}` : ''}
              {athlete.team_club ? ` · ${athlete.team_club}` : ''}
            </p>
          </div>
          <Button variant="secondary" data-testid="compare-with" onClick={() => setPicking(true)}>
            Comparar com…
          </Button>
        </Card>

        <div className="mt-4">
          <YearSelect years={years} value={year} onChange={setYear} />
        </div>

        <div className="mt-6">
          <StatsView
            athlete={athlete}
            results={shown}
            publicMode
            partnerLink={(id) => (publicIds.has(id) ? compareHref(id) : null)}
          />
        </div>

        <AthletePicker
          open={picking}
          athletes={query.data.athletes}
          excludeId={athlete.id}
          onClose={() => setPicking(false)}
          onPick={(id) => navigate(compareHref(id))}
        />
      </div>
    </PublicShell>
  );
}
