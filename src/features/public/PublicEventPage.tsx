import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { indexEvent, mergeById } from '../../domain/eventModel';
import { computeEventTiming } from '../../domain/consolidation';
import { classifyRace } from '../../domain/ranking';
import { classificationFromResults } from '../../domain/snapshot';
import { formatDateBR } from '../../lib/format';
import { Badge, Button, Card, EmptyState, Select, Spinner } from '../../components/ui';
import { ClassificationTable } from '../results/ClassificationTable';
import { PodiumView } from '../results/PodiumView';
import { EVENT_STATUS_LABEL, PublicShell } from './PublicHome';
import type { PubEventPayload } from '../../lib/types';

/** Cadence for `pub_live` while the tab is visible (spec §12, Global Constraints "público 10 s");
 * the overlap below re-reads the same window every poll (spec "sobreposição de fetch 10 s"). */
const PUBLIC_POLL_MS = 10_000;
const FETCH_OVERLAP_MS = 10_000;

// ---------------------------------------------------------------------------
// Live polling: `pub_live` every 10 s while the tab is visible, merging marks by id like the
// admin's `useEventData` (Ruling 43: discarded marks are included too — the domain ignores them),
// replacing resolutions/waves, and refetching the whole payload when the version moves.
// ---------------------------------------------------------------------------

/** C-Minor-14: `pub_live` failures used to be silent (kept the last known state forever, with no
 * sign anything was wrong) — returns whether the *most recent* poll failed, so the page can show
 * a small "não foi possível atualizar" hint instead of looking merely stale. Clears again as soon
 * as a poll succeeds. */
function usePublicLivePoll(slug: string | undefined, enabled: boolean): { lastPollFailed: boolean } {
  const queryClient = useQueryClient();
  const inFlight = useRef(false);
  const [lastPollFailed, setLastPollFailed] = useState(false);

  useEffect(() => {
    if (!slug || !enabled) return undefined;
    const key = ['pub-event', slug];
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      clearTimeout(timer);
      if (!cancelled) timer = setTimeout(() => void poll(), PUBLIC_POLL_MS);
    };

    const poll = async () => {
      if (cancelled || document.hidden) return;
      if (inFlight.current) {
        schedule();
        return;
      }
      const current = queryClient.getQueryData<PubEventPayload>(key);
      if (current) {
        const since = new Date(Date.parse(current.server_now) - FETCH_OVERLAP_MS).toISOString();
        inFlight.current = true;
        try {
          const delta = await api.pub.live(slug, since);
          const before = queryClient.getQueryData<PubEventPayload>(key);
          if (!cancelled && before) {
            const marks = mergeById(before.marks, delta.marks);
            queryClient.setQueryData<PubEventPayload>(key, {
              ...before, marks, resolutions: delta.resolutions, waves: delta.waves, server_now: delta.server_now,
            });
            if (delta.version !== before.version && queryClient.isFetching({ queryKey: key, exact: true }) === 0) {
              void queryClient.refetchQueries({ queryKey: key, exact: true });
            }
          }
          if (!cancelled) setLastPollFailed(false);
        } catch {
          // Offline or a transient failure: keep the last known state and retry on the next tick,
          // but say so (C-Minor-14) instead of looking silently stale.
          if (!cancelled) setLastPollFailed(true);
        } finally {
          inFlight.current = false;
        }
      }
      schedule();
    };

    const onVisibilityChange = () => {
      if (!document.hidden) void poll();
    };

    schedule();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [slug, enabled, queryClient]);

  return { lastPollFailed };
}

// ---------------------------------------------------------------------------

export default function PublicEventPage() {
  const { slug } = useParams<{ slug: string }>();
  const query = useQuery({
    queryKey: ['pub-event', slug],
    queryFn: () => api.pub.event(slug as string),
    enabled: slug !== undefined,
    // C-Minor-14: the 10 s delta poll (usePublicLivePoll) already resumes the moment the tab
    // becomes visible again, so re-downloading the whole payload on every window focus only
    // costs bandwidth on a spectator's phone for no fresher data.
    refetchOnWindowFocus: false,
  });
  const payload = query.data;

  const { lastPollFailed } = usePublicLivePoll(slug, payload !== undefined);

  useEffect(() => {
    document.title = payload ? `${payload.event.name} – Resultados` : 'EnduranceBaseClub';
  }, [payload]);

  // C-Minor-15: reset on unmount only (not on every `payload` change, which would flash the
  // default title while the page stays open) — otherwise an admin tab reached by following a
  // public link keeps "… – Resultados" forever.
  useEffect(() => () => { document.title = 'EnduranceBaseClub'; }, []);

  const index = useMemo(() => (payload ? indexEvent(payload) : null), [payload]);
  const races = useMemo(() => (payload ? [...payload.races].sort((a, b) => a.position - b.position) : []), [payload]);
  const [selectedRaceId, setSelectedRaceId] = useState('');
  const activeRaceId = races.some((r) => r.id === selectedRaceId) ? selectedRaceId : (races[0]?.id ?? '');
  const race = races.find((r) => r.id === activeRaceId) ?? null;
  const activeTabRef = useRef<HTMLButtonElement | null>(null);

  // C-Minor-8: scroll the active race tab into view whenever it changes — a public event with
  // several races can push later tabs off-screen at 390 px with no other affordance.
  useEffect(() => {
    activeTabRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeRaceId]);

  const liveTiming = useMemo(() => (payload ? computeEventTiming(payload, Date.now()) : null), [payload]);

  const isOfficial = useMemo(
    () => (payload && race ? payload.results.some((r) => r.race_id === race.id) : false),
    [payload, race],
  );

  const cls = useMemo(() => {
    if (!payload || !index || !race) return null;
    if (isOfficial) {
      const raceResults = payload.results.filter((r) => r.race_id === race.id);
      return classificationFromResults(race, raceResults, payload.event.levels);
    }
    if (!liveTiming) return null;
    const entries = payload.entries.filter((e) => e.race_id === race.id);
    return classifyRace(race, entries, liveTiming.byEntry, index.athletesById, payload.event);
  }, [payload, index, race, isOfficial, liveTiming]);

  if (query.isLoading) {
    return (
      <PublicShell>
        <div data-testid="public-results" className="flex justify-center px-4 py-16">
          <Spinner size={32} />
        </div>
      </PublicShell>
    );
  }

  if (query.error || !payload) {
    return (
      <PublicShell>
        <div data-testid="public-results" className="mx-auto w-full max-w-md px-4 py-12">
          <Card className="flex flex-col gap-4">
            <p role="alert" className="text-sm text-danger-text">
              {query.error instanceof Error ? query.error.message : 'Evento não encontrado'}
            </p>
            {/* C-Minor-14: the load error had no way to recover short of a manual reload. */}
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" onClick={() => void query.refetch()} loading={query.isFetching}>
                Tentar novamente
              </Button>
              <Link to="/" className="text-sm text-muted underline underline-offset-2 hover:text-fg">
                Voltar aos eventos públicos
              </Link>
            </div>
          </Card>
        </div>
      </PublicShell>
    );
  }

  const eventStatus = EVENT_STATUS_LABEL[payload.event.status];

  return (
    <PublicShell>
      <div data-testid="public-results" className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <Link to="/" className="text-sm text-muted underline underline-offset-2 hover:text-fg">
          ← Eventos públicos
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="brand-title text-xl font-semibold">{payload.event.name}</h1>
            <p className="mt-1 text-sm text-muted tabular">
              {formatDateBR(payload.event.date)}
              {payload.event.location ? ` · ${payload.event.location}` : ''}
            </p>
          </div>
          <Badge tone={eventStatus.tone}>{eventStatus.label}</Badge>
        </div>

        {races.length === 0 && (
          <div className="mt-6">
            <EmptyState title="Nenhuma prova cadastrada" />
          </div>
        )}

        {races.length > 0 && (
          <>
            {/* Round 2 item 12: even with scroll-into-view + a fade cue (C-Minor-8), a horizontal
                tab strip at 390 px starts with any race past the first entirely off-screen and no
                affordance actually got it noticed in review. Below `sm`, a plain <select> replaces
                the tablist outright — it has no overflow at all, for any number of races. `sm:` and
                up keep the tablist (there's room to see every tab at a glance there). */}
            <div className="mt-6 sm:hidden">
              <Select
                label="Prova"
                data-testid="public-race-select"
                value={activeRaceId}
                onChange={(e) => setSelectedRaceId(e.target.value)}
                options={races.map((r) => ({ value: r.id, label: r.name }))}
              />
            </div>
            <div className="relative mt-6 hidden sm:block">
              <div role="tablist" aria-label="Provas" className="flex gap-1 overflow-x-auto border-b border-border">
                {races.map((r) => (
                  <button
                    key={r.id}
                    ref={r.id === activeRaceId ? activeTabRef : undefined}
                    type="button"
                    role="tab"
                    aria-selected={r.id === activeRaceId}
                    onClick={() => setSelectedRaceId(r.id)}
                    className={`inline-flex min-h-11 shrink-0 items-center whitespace-nowrap border-b-2 px-4 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                      r.id === activeRaceId ? 'border-fg text-fg' : 'border-transparent text-muted hover:text-fg'
                    }`}
                  >
                    {r.name}
                  </button>
                ))}
              </div>
              <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-bg to-transparent" />
              <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-bg to-transparent" />
            </div>

            {race && cls && index && (
              <div className="mt-4 flex flex-col gap-6">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-lg font-semibold">{race.name}</h2>
                  {isOfficial ? (
                    <Badge tone="info">Resultado oficial</Badge>
                  ) : (
                    <>
                      <Badge tone="warning">Parcial – ao vivo</Badge>
                      <span className="text-xs text-muted">Atualiza automaticamente a cada 10 segundos.</span>
                      {/* C-Minor-14: pub_live failures used to be silent; the classification just
                          quietly stopped updating. */}
                      {lastPollFailed && (
                        <span role="status" className="text-xs text-warning-text">
                          Não foi possível atualizar agora — tentando de novo.
                        </span>
                      )}
                    </>
                  )}
                </div>

                <ClassificationTable
                  race={race}
                  cls={cls}
                  showLegs={race.legs.length > 1}
                  linkAthletes="public"
                  athletesById={index.athletesById}
                />

                <PodiumView cls={cls} athletesById={index.athletesById} />
              </div>
            )}
          </>
        )}
      </div>
    </PublicShell>
  );
}
