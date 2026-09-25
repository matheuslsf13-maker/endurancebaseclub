import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { indexEvent, mergeById } from '../../domain/eventModel';
import { computeEventTiming } from '../../domain/consolidation';
import type { Crossing, EntryTiming, LegTiming } from '../../domain/consolidation';
import { classifyRace, compareGroupOrder } from '../../domain/ranking';
import type { PodiumGroup, PodiumPlace, RaceClassification, RankedEntry } from '../../domain/ranking';
import type { EntryCategory } from '../../domain/categories';
import { formatDateBR } from '../../lib/format';
import { Badge, Card, EmptyState, Spinner } from '../../components/ui';
import { ClassificationTable } from '../results/ClassificationTable';
import { PodiumView } from '../results/PodiumView';
import { EVENT_STATUS_LABEL, PublicShell } from './PublicHome';
import type { AthleteRow, EntryRow, PubEventPayload, RaceRow, ResultRow } from '../../lib/types';

/** Cadence for `pub_live` while the tab is visible (spec §12, Global Constraints "público 10 s");
 * the overlap below re-reads the same window every poll (spec "sobreposição de fetch 10 s"). */
const PUBLIC_POLL_MS = 10_000;
const FETCH_OVERLAP_MS = 10_000;

// ---------------------------------------------------------------------------
// Official (finalized) races: `results` already carries a frozen `ResultSnapshot` per entry (spec
// §9, `admin_finalize_race`). Task 25's `ClassificationTable`/`PodiumView` only understand a live
// `RaceClassification` (built from `EntryRow` + `EntryTiming`), so this section adapts the
// snapshot rows into the same shape — reusing the two components (Ruling 41) for both the live and
// the official view instead of a second, parallel results table.
// ---------------------------------------------------------------------------

const bibCollator = new Intl.Collator('pt-BR', { numeric: true });
const compareBib = (a: EntryRow, b: EntryRow): number => bibCollator.compare(a.bib, b.bib);

/** Same unranked ordering as `domain/ranking.ts` (not exported there): a finish with no
 * resolvable time first, then on_course, not_started, dnf, dns, dsq. */
const UNRANKED_STATUS_ORDER: Record<EntryTiming['status'], number> = {
  finished: 0, on_course: 1, not_started: 2, dnf: 3, dns: 4, dsq: 5,
};

/** A `Crossing` stub for a snapshot leg: `ClassificationTable` only reads `leg_ms` off it, so the
 * rest is filled with neutral values purely to satisfy the type. */
function stubCrossing(legIndex: number, ms: number | null): Crossing {
  return {
    leg_index: legIndex, candidates: [], duplicates: [],
    median_ms: ms, spread_ms: null, system_ms: ms, system_source: ms !== null ? 'median' : null,
    official_ms: ms, official_source: ms !== null ? 'median' : null,
    resolution: null, divergent: false, chosen_mark_discarded: false,
  };
}

/** Rebuilds the minimal `EntryRow` a snapshot row needs so `ClassificationTable`/`PodiumView` can
 * render it (member names, bib, team name, the penalty applied at finalize time). */
function entryFromSnapshot(r: ResultRow): EntryRow {
  return {
    id: r.entry_id, event_id: r.event_id, race_id: r.race_id, wave_id: null,
    bib: r.data.bib, team_name: r.data.team_name, level: r.data.category.level,
    status: 'ok', penalty_ms: r.data.penalty_ms, notes: '',
    members: r.data.members.map((m, i) => ({ athlete_id: m.athlete_id, position: i, legs: m.legs, name: m.name })),
  };
}

function timingFromSnapshot(r: ResultRow): EntryTiming {
  const legs: LegTiming[] = r.data.legs.map((l) => ({
    leg_index: l.leg_index, athlete_id: l.athlete_id, crossing: stubCrossing(l.leg_index, l.time_ms), start_ms: null, leg_ms: l.time_ms,
  }));
  return {
    entry_id: r.entry_id, race_id: r.race_id, start_ms: null, legs,
    total_ms: r.data.total_ms, final_ms: r.data.final_ms, status: r.data.status,
    current_leg: null, current_leg_start_ms: null,
  };
}

/** Groups every entry's frozen `data.podiums` places by ranking + group label, resolving the full
 * `RankingDef` from the race's current config when it still has that ranking (falls back to a
 * name-only stub otherwise — the config could have changed since the race was finalized). Orders
 * groups by the race's ranking order, then within a ranking by the same canonical group order
 * (`compareGroupOrder`, spec §9: sex M, F, MISTO; age groups by `min`; levels in event order) that
 * `domain/ranking.ts`'s `buildPodiums` uses for the live view — reused here instead of an ad-hoc
 * alphabetical sort so a finalized race's podiums match the order shown before it was finalized. */
function reconstructPodiums(race: RaceRow, results: ResultRow[], rowsByEntry: Map<string, RankedEntry>, levels: string[]): PodiumGroup[] {
  const groups = new Map<string, PodiumGroup>();
  const groupCategory = new Map<string, EntryCategory>();
  for (const r of results) {
    const ranked = rowsByEntry.get(r.entry_id);
    if (!ranked) continue;
    for (const p of r.data.podiums) {
      const key = `${p.ranking_id}::${p.group_label}`;
      let group = groups.get(key);
      if (!group) {
        const rankingDef = race.config.rankings.find((rd) => rd.id === p.ranking_id) ?? {
          id: p.ranking_id, name: p.ranking_name, dims: [], size: 3,
        };
        group = { ranking: rankingDef, group_key: key, group_label: p.group_label, places: [] };
        groups.set(key, group);
        groupCategory.set(key, r.data.category);
      }
      group.places.push({ podium_pos: p.podium_pos, ranked });
    }
  }
  for (const g of groups.values()) g.places.sort((a: PodiumPlace, b: PodiumPlace) => a.podium_pos - b.podium_pos);
  const order = race.config.rankings.map((rd) => rd.id);
  return [...groups.values()].sort((a, b) => {
    const ai = order.indexOf(a.ranking.id);
    const bi = order.indexOf(b.ranking.id);
    const rankingOrder = (ai === -1 ? order.length : ai) - (bi === -1 ? order.length : bi);
    if (rankingOrder !== 0) return rankingOrder;
    return compareGroupOrder(a.ranking.dims, groupCategory.get(a.group_key)!, groupCategory.get(b.group_key)!, race.config.age_groups, levels);
  });
}

/** Rebuilds the `RaceClassification` `ClassificationTable`/`PodiumView` expect from a finalized
 * race's stored `results`, ordering rows by their frozen `overall_pos` (spec: "ordenados por
 * overall_pos, a partir dos snapshots") instead of recomputing anything from live marks. */
function classificationFromResults(race: RaceRow, results: ResultRow[], athletesById: Map<string, AthleteRow>, levels: string[]): RaceClassification {
  const rowsByEntry = new Map<string, RankedEntry>();
  const built = results.map((r) => {
    const entry = entryFromSnapshot(r);
    const timing = timingFromSnapshot(r);
    const ranked: RankedEntry = {
      entry, timing, category: r.data.category,
      overall_pos: r.overall_pos, sex_pos: r.data.positions.sex,
      ranking_pos: Object.fromEntries(race.config.rankings.map((rd) => [rd.id, null])),
      gap_ms: null,
    };
    rowsByEntry.set(r.entry_id, ranked);
    return ranked;
  });

  const ranked = built
    .filter((r) => r.overall_pos !== null)
    .sort((a, b) => (a.overall_pos as number) - (b.overall_pos as number) || compareBib(a.entry, b.entry));
  const unranked = built
    .filter((r) => r.overall_pos === null)
    .sort((a, b) => UNRANKED_STATUS_ORDER[a.timing.status] - UNRANKED_STATUS_ORDER[b.timing.status] || compareBib(a.entry, b.entry));

  const leaderFinal = ranked.length > 0 ? ranked[0].timing.final_ms : null;
  for (const r of ranked) {
    r.gap_ms = leaderFinal !== null && r.timing.final_ms !== null ? r.timing.final_ms - leaderFinal : null;
  }

  const rows = [...ranked, ...unranked];
  return { race, rows, finishers: ranked.length, podiums: reconstructPodiums(race, results, rowsByEntry, levels) };
}

// ---------------------------------------------------------------------------
// Live polling: `pub_live` every 10 s while the tab is visible, merging marks by id like the
// admin's `useEventData` (Ruling 43: discarded marks are included too — the domain ignores them),
// replacing resolutions/waves, and refetching the whole payload when the version moves.
// ---------------------------------------------------------------------------

function usePublicLivePoll(slug: string | undefined, enabled: boolean) {
  const queryClient = useQueryClient();
  const inFlight = useRef(false);

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
        } catch {
          // Offline or a transient failure: keep the last known state and retry on the next tick.
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
}

// ---------------------------------------------------------------------------

export default function PublicEventPage() {
  const { slug } = useParams<{ slug: string }>();
  const query = useQuery({
    queryKey: ['pub-event', slug],
    queryFn: () => api.pub.event(slug as string),
    enabled: slug !== undefined,
  });
  const payload = query.data;

  usePublicLivePoll(slug, payload !== undefined);

  useEffect(() => {
    document.title = payload ? `${payload.event.name} – Resultados` : 'EnduranceBaseClub';
  }, [payload]);

  const index = useMemo(() => (payload ? indexEvent(payload) : null), [payload]);
  const races = useMemo(() => (payload ? [...payload.races].sort((a, b) => a.position - b.position) : []), [payload]);
  const [selectedRaceId, setSelectedRaceId] = useState('');
  const activeRaceId = races.some((r) => r.id === selectedRaceId) ? selectedRaceId : (races[0]?.id ?? '');
  const race = races.find((r) => r.id === activeRaceId) ?? null;

  const liveTiming = useMemo(() => (payload ? computeEventTiming(payload, Date.now()) : null), [payload]);

  const isOfficial = useMemo(
    () => (payload && race ? payload.results.some((r) => r.race_id === race.id) : false),
    [payload, race],
  );

  const cls = useMemo(() => {
    if (!payload || !index || !race) return null;
    if (isOfficial) {
      const raceResults = payload.results.filter((r) => r.race_id === race.id);
      return classificationFromResults(race, raceResults, index.athletesById, payload.event.levels);
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
            <p role="alert" className="text-sm text-danger">
              {query.error instanceof Error ? query.error.message : 'Evento não encontrado'}
            </p>
            <Link to="/" className="text-sm text-muted underline underline-offset-2 hover:text-fg">
              Voltar aos eventos públicos
            </Link>
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
            <div role="tablist" aria-label="Provas" className="mt-6 flex gap-1 overflow-x-auto border-b border-border">
              {races.map((r) => (
                <button
                  key={r.id}
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
