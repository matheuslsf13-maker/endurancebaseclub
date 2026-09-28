import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { formatDateBR } from '../../lib/format';
import { safeLocalStorage } from '../../lib/storage';
import { Logo } from '../../components/Logo';
import { ThemeToggle } from '../../components/ThemeToggle';
import { Badge, Button, Card, EmptyState, Spinner } from '../../components/ui';
import type { BadgeTone } from '../../components/ui';
import type { EventStatus } from '../../lib/types';

// C-Minor-7: must match App.tsx's `LAST_TIMEKEEPER_TOKEN_KEY` (its `/c/:token` route wrapper
// writes it). Duplicated as a literal, not a shared import, so this route stays a small,
// independent chunk (Ruling 30) instead of statically pulling in the app shell.
const LAST_TIMEKEEPER_TOKEN_KEY = 'ebc.lastTkToken';

/** pt-BR label + tone for an event's public status (same wording as the organizer's list, spec
 * §12); shared with `PublicEventPage`. */
export const EVENT_STATUS_LABEL: Record<EventStatus, { label: string; tone: BadgeTone }> = {
  planejado: { label: 'Planejado', tone: 'neutral' },
  ao_vivo: { label: 'Ao vivo', tone: 'success' },
  encerrado: { label: 'Encerrado', tone: 'info' },
};

/**
 * Shell for every public page (spec §6/§12): logo + brand name, theme toggle, and a link back to
 * the organizer login — no admin navigation. Shared by `PublicHome`, `PublicEventPage` and
 * `PublicAthletePage` (all owned by this task).
 */
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col bg-bg text-fg">
      <header className="border-b border-border">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <Link to="/" className="flex shrink-0 items-center gap-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            <Logo size={32} />
            <span className="brand-title text-sm font-semibold sm:text-base">ENDURANCE BASE CLUB</span>
          </Link>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <ThemeToggle />
            <Link
              to="/entrar"
              className="inline-flex min-h-11 items-center rounded-xl border border-border px-3 text-sm font-medium text-fg hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Área da organização
            </Link>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}

export default function PublicHome() {
  useEffect(() => {
    document.title = 'EnduranceBaseClub';
  }, []);

  // C-Minor-7: a volunteer's phone that has a timekeeper link offers a way back to it from the
  // plain public home — the PWA's home-screen icon (`start_url: '/'`) has no other path there,
  // and it works offline too (no query involved). Read once; a new link overwrites the stored
  // token via the App.tsx route wrapper the next time it's opened.
  const [lastTkToken] = useState(() => safeLocalStorage().getItem(LAST_TIMEKEEPER_TOKEN_KEY));

  const { data: events, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['pub-events'],
    queryFn: () => api.pub.events(),
  });

  const sorted = [...(events ?? [])].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return (
    <PublicShell>
      <div data-testid="public-events" className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <h1 className="brand-title text-xl font-semibold">Eventos</h1>

        {lastTkToken && (
          <Card className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-fg">Este aparelho tem um link de cronometragem salvo.</p>
            <Link
              to={`/c/${lastTkToken}`}
              data-testid="back-to-timekeeper"
              className="inline-flex min-h-11 items-center rounded-xl border border-border bg-surface-2 px-3 text-sm font-medium text-fg hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Voltar à cronometragem
            </Link>
          </Card>
        )}

        <div className="mt-6">
          {isLoading && (
            <div className="flex justify-center py-16">
              <Spinner size={32} />
            </div>
          )}
          {error && (
            <div className="flex flex-col items-start gap-3">
              <p role="alert" className="text-sm text-danger-text">
                {error instanceof ApiError ? error.message : 'Não foi possível carregar os eventos.'}
              </p>
              {/* Round 2 item 18: the load error had no way to recover short of a manual reload. */}
              <Button size="sm" onClick={() => void refetch()} loading={isFetching}>
                Tentar novamente
              </Button>
            </div>
          )}
          {!isLoading && !error && sorted.length === 0 && (
            <EmptyState title="Nenhum evento público no momento">
              Volte mais tarde para ver os próximos eventos do EnduranceBaseClub.
            </EmptyState>
          )}
          {!isLoading && sorted.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {sorted.map((ev) => {
                const status = EVENT_STATUS_LABEL[ev.status];
                return (
                  <Card key={ev.id} className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        to={`/p/${ev.public_slug}`}
                        className="font-semibold break-words hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      >
                        {ev.name}
                      </Link>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </div>
                    <p className="text-sm text-muted tabular">
                      {formatDateBR(ev.date)}
                      {ev.location ? ` · ${ev.location}` : ''}
                    </p>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </PublicShell>
  );
}
