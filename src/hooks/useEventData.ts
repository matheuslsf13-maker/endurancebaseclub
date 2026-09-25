import { useCallback, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { mergeById } from '../domain/eventModel';
import type { EventAggregate, LiveDelta } from '../lib/types';

/** Poll cadence on the live tabs (timing, review, results) and elsewhere (spec §3). */
const LIVE_POLL_MS = 2_000;
const IDLE_POLL_MS = 15_000;
/** Mark deltas are requested from the last server time minus this overlap (ids deduplicate). */
const OVERLAP_MS = 10_000;

export interface EventData {
  agg: EventAggregate | undefined;
  isLoading: boolean;
  error: Error | null;
  refresh(): Promise<void>;
  patchAgg(fn: (a: EventAggregate) => EventAggregate): void;
}

/** Where the mark delta stream stands: `serverNow` of the last applied delta, valid only while
 * the cached aggregate is still the one fetched with `aggServerNow`. */
interface DeltaCursor {
  eventId: string;
  aggServerNow: string;
  serverNow: string;
}

function applyDelta(agg: EventAggregate, delta: LiveDelta, replaceLists: boolean): EventAggregate {
  const marks = mergeById(agg.marks, delta.marks);
  // Live endpoints return every resolution and wave of the event, so these are replaced
  // wholesale (which also drops deleted resolutions).
  return replaceLists ? { ...agg, marks, resolutions: delta.resolutions, waves: delta.waves } : { ...agg, marks };
}

/**
 * The full event aggregate (TanStack query `['event', eventId]`) kept fresh by polling
 * `admin_live`: marks are merged by id, resolutions and waves replaced, and the aggregate is
 * refetched when the server's event version moves (structural changes). Polling pauses while
 * the page is hidden and catches up as soon as it is visible again.
 */
export function useEventData(eventId: string, opts: { live: boolean }): EventData {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['event', eventId],
    queryFn: () => api.admin.getEvent(eventId),
  });

  const refresh = useCallback(
    () => queryClient.refetchQueries({ queryKey: ['event', eventId], exact: true }),
    [queryClient, eventId],
  );

  // Counts local patches so a poll that was already in flight does not replace the lists with
  // its older copy (the next poll brings the server's view anyway).
  const patches = useRef(0);
  const patchAgg = useCallback(
    (fn: (a: EventAggregate) => EventAggregate) => {
      patches.current += 1;
      queryClient.setQueryData<EventAggregate>(['event', eventId], (a) => (a ? fn(a) : a));
    },
    [queryClient, eventId],
  );

  const cursor = useRef<DeltaCursor | null>(null);
  const loaded = query.data !== undefined;
  const intervalMs = opts.live ? LIVE_POLL_MS : IDLE_POLL_MS;

  useEffect(() => {
    if (!loaded) return;
    const key = ['event', eventId];
    let cancelled = false;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      clearTimeout(timer);
      if (!cancelled) timer = setTimeout(() => void poll(), intervalMs);
    };

    const poll = async () => {
      // While hidden nothing is scheduled; the visibilitychange listener resumes polling.
      if (cancelled || inFlight || document.hidden) return;
      const before = queryClient.getQueryData<EventAggregate>(key);
      if (before) {
        const c = cursor.current;
        const base = c && c.eventId === eventId && c.aggServerNow === before.server_now ? c.serverNow : before.server_now;
        const since = new Date(Date.parse(base) - OVERLAP_MS).toISOString();
        const patchesBefore = patches.current;
        inFlight = true;
        try {
          const delta = await api.admin.live(eventId, since);
          const current = queryClient.getQueryData<EventAggregate>(key);
          if (!cancelled && current) {
            // A full refetch that landed meanwhile may predate this delta: keep the lists it
            // brought and re-read marks from its server time on the next poll.
            const refetched = current.server_now !== before.server_now;
            const replaceLists = !refetched && patches.current === patchesBefore;
            queryClient.setQueryData<EventAggregate>(key, applyDelta(current, delta, replaceLists));
            if (!refetched) cursor.current = { eventId, aggServerNow: current.server_now, serverNow: delta.server_now };
            if (delta.version !== current.version && queryClient.isFetching({ queryKey: key, exact: true }) === 0) {
              void refresh();
            }
          }
        } catch {
          // Offline or a transient failure: keep what we have and try again on the next tick.
        } finally {
          inFlight = false;
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
  }, [loaded, eventId, intervalMs, queryClient, refresh]);

  return { agg: query.data, isLoading: query.isLoading, error: query.error, refresh, patchAgg };
}
