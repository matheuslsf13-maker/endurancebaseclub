import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { sexLabel } from '../../domain/categories';
import { Card, Spinner } from '../../components/ui';
import { StatsView } from '../athletes/StatsView';
import { PublicShell } from './PublicHome';

/**
 * Public athlete profile (spec §6/§12): `pub_athlete` only returns an athlete when
 * `public_profile` is true, and only `{id,name,sex,city,team_club}` — no birth date, no
 * `public_profile` flag itself (Controller note), so this page never reads either. `StatsView` is
 * reused as-is in `publicMode` (Task 20): it only needs the athlete's id and the results.
 */
export default function PublicAthletePage() {
  const { athleteId } = useParams<{ athleteId: string }>();
  const query = useQuery({
    queryKey: ['pub-athlete', athleteId],
    queryFn: () => api.pub.athlete(athleteId as string),
    enabled: athleteId !== undefined,
  });

  useEffect(() => {
    document.title = query.data ? `${query.data.athlete.name} – EnduranceBaseClub` : 'EnduranceBaseClub';
  }, [query.data]);

  if (query.isLoading) {
    return (
      <PublicShell>
        <div data-testid="public-athlete" className="flex justify-center px-4 py-16">
          <Spinner size={32} />
        </div>
      </PublicShell>
    );
  }

  if (query.error || !query.data) {
    return (
      <PublicShell>
        <div data-testid="public-athlete" className="mx-auto w-full max-w-md px-4 py-12">
          <Card className="flex flex-col gap-4">
            <p role="alert" className="text-sm text-danger">
              {query.error instanceof Error ? query.error.message : 'Atleta não encontrado ou perfil privado'}
            </p>
            <Link to="/" className="text-sm text-muted underline underline-offset-2 hover:text-fg">
              Voltar aos eventos públicos
            </Link>
          </Card>
        </div>
      </PublicShell>
    );
  }

  const { athlete, results } = query.data;

  return (
    <PublicShell>
      <div data-testid="public-athlete" className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <Link to="/" className="text-sm text-muted underline underline-offset-2 hover:text-fg">
          ← Eventos públicos
        </Link>

        <Card className="mt-4 flex flex-col gap-1">
          <h1 className="brand-title text-xl font-semibold">{athlete.name}</h1>
          <p className="text-sm text-muted">
            {sexLabel(athlete.sex)}
            {athlete.city ? ` · ${athlete.city}` : ''}
            {athlete.team_club ? ` · ${athlete.team_club}` : ''}
          </p>
        </Card>

        <div className="mt-6">
          <StatsView athlete={athlete} results={results} publicMode />
        </div>
      </div>
    </PublicShell>
  );
}
