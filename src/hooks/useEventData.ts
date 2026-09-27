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
/** Live tabs also refetch the whole aggregate this often: admin_live carries no timekeepers, and
 * their registrations / last_seen_at do not bump the event version (Ruling 33). */
const LIVE_FULL_REFRESH_MS = 30_000;

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

/** A mark from a timekeeper the aggregate does not list yet (registered after it was fetched). */
function hasUnknownTimekeeper(agg: EventAggregate, delta: LiveDelta): boolean {
  if (!delta.marks.some((m) => m.timekeeper_id !== null)) return false;
  const known = new Set(agg.timekeepers.map((t) => t.id));
  return delta.marks.some((m) => m.timekeeper_id !== null && !known.has(m.timekeeper_id));
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
 * refetched when the server's event version moves (structural changes) or a mark names a
 * timekeeper it does not know; live tabs also refetch it every 30 s. Polling pauses while the page
 * is hidden and catches up as soon as it is visible again.
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
  // Single-flight across effect runs too: switching between a live and an idle tab restarts the
  // effect, and a slow request from the previous run must not overlap with the next one.
  const inFlight = useRef(false);
  const loaded = query.data !== undefined;
  const intervalMs = opts.live ? LIVE_POLL_MS : IDLE_POLL_MS;

  useEffect(() => {
    if (!loaded) return;
    const key = ['event', eventId];
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      clearTimeout(timer);
      if (!cancelled) timer = setTimeout(() => void poll(), intervalMs);
    };

    const poll = async () => {
      // While hidden nothing is scheduled; the visibilitychange listener resumes polling.
      if (cancelled || document.hidden) return;
      // A request is still out (possibly from the previous run): try again one interval later.
      if (inFlight.current) {
        schedule();
        return;
      }
      const before = queryClient.getQueryData<EventAggregate>(key);
      if (before) {
        const c = cursor.current;
        const base = c && c.eventId === eventId && c.aggServerNow === before.server_now ? c.serverNow : before.server_now;
        const since = new Date(Date.parse(base) - OVERLAP_MS).toISOString();
        const patchesBefore = patches.current;
        inFlight.current = true;
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
            const stale = delta.version !== current.version || hasUnknownTimekeeper(current, delta);
            if (stale && queryClient.isFetching({ queryKey: key, exact: true }) === 0) void refresh();
          }
        } catch {
          // Offline or a transient failure: keep what we have and try again on the next tick.
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
  }, [loaded, eventId, intervalMs, queryClient, refresh]);

  // Periodic full refetch on live tabs. Not TanStack's `refetchInterval`: its timer restarts on
  // every cache update, so the 2 s delta poll would keep postponing it forever. A delta poll that
  // overlaps this refetch is reconciled by the `refetched` check above.
  const live = opts.live;
  useEffect(() => {
    if (!loaded || !live) return;
    const timer = setInterval(() => {
      if (!document.hidden && queryClient.isFetching({ queryKey: ['event', eventId], exact: true }) === 0) void refresh();
    }, LIVE_FULL_REFRESH_MS);
    return () => clearInterval(timer);
  }, [loaded, live, eventId, queryClient, refresh]);

  return { agg: query.data, isLoading: query.isLoading, error: query.error, refresh, patchAgg };
}
