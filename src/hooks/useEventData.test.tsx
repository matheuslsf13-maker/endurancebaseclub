import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type { EventAggregate, LiveDelta } from '../lib/types';
import {
  iso, makeAthlete, makeEntry, makeEvent, makeMark, makeRace, makeResolution, makeTimekeeper, makeWave, SEC, T0,
} from '../domain/testing/fixtures';
import { useEventData } from './useEventData';

const getEvent = vi.hoisted(() => vi.fn<(id: string) => Promise<EventAggregate>>());
const live = vi.hoisted(() => vi.fn<(id: string, since: string | null) => Promise<LiveDelta>>());
vi.mock('../lib/api', () => ({ api: { admin: { getEvent, live } } }));

function makeAgg(p: Partial<EventAggregate> = {}): EventAggregate {
  return {
    event: makeEvent({ id: 'ev1', name: 'Copa EBC' }), races: [makeRace()], waves: [makeWave()], entries: [makeEntry()],
    athletes: [makeAthlete()], timekeepers: [makeTimekeeper()], marks: [], resolutions: [], results: [],
    version: 1, server_now: iso(T0 + 60 * SEC), ...p,
  };
}
function delta(p: Partial<LiveDelta> = {}): LiveDelta {
  return { server_now: iso(T0 + 62 * SEC), version: 1, marks: [], resolutions: [], waves: [makeWave()], ...p };
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

let client: QueryClient;
function renderEventData(initialLive: boolean) {
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(({ isLive }: { isLive: boolean }) => useEventData('ev1', { live: isLive }), {
    wrapper, initialProps: { isLive: initialLive },
  });
}
const cached = () => client.getQueryData<EventAggregate>(['event', 'ev1']);
/** Lets the initial getEvent settle (TanStack notifies through a 0 ms timer). */
const settle = () => act(() => vi.advanceTimersByTimeAsync(5));
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

let hidden = false;
beforeEach(() => {
  vi.useFakeTimers();
  getEvent.mockReset();
  live.mockReset();
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  client.clear();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('useEventData', () => {
  it('loads the aggregate under the query key [event, id]', async () => {
    getEvent.mockResolvedValue(makeAgg());
    const { result } = renderEventData(false);
    expect(result.current.isLoading).toBe(true);

    await settle();

    expect(getEvent).toHaveBeenCalledWith('ev1');
    expect(result.current.agg?.event.name).toBe('Copa EBC');
    expect(cached()).toBe(result.current.agg);
    expect(result.current.isLoading).toBe(false);
  });

  it('polls every 15 s when idle and every 2 s when live, from the last server time − 10 s', async () => {
    const m1 = makeMark({ id: 'm1', at: T0 + 10 * SEC });
    getEvent.mockResolvedValue(makeAgg({ marks: [m1] }));
    const res1 = makeResolution({ entry_id: 'en1', leg_index: 0, mode: 'system' });
    const m1b = { ...m1, entry_id: null, leg_index: null, updated_at: iso(T0 + 61 * SEC) };
    const m2 = makeMark({ id: 'm2', at: T0 + 61 * SEC });
    live.mockResolvedValue(delta({ marks: [m1b, m2], resolutions: [res1] }));
    const { result, rerender } = renderEventData(false);
    await settle();

    await advance(14_990);
    expect(live).not.toHaveBeenCalled();
    await advance(10);
    // First poll: the aggregate's server_now (60 s) − 10 s.
    expect(live).toHaveBeenCalledTimes(1);
    expect(live).toHaveBeenLastCalledWith('ev1', iso(T0 + 50 * SEC));
    // Marks merged by id (m1 updated, m2 added); resolutions replaced.
    expect(cached()?.marks.map((m) => [m.id, m.entry_id])).toEqual([['m1', null], ['m2', 'en1']]);
    expect(cached()?.resolutions).toEqual([res1]);
    await settle();
    expect(result.current.agg?.marks).toHaveLength(2);

    live.mockResolvedValue(delta({ server_now: iso(T0 + 64 * SEC) }));
    rerender({ isLive: true });
    await advance(2_000);
    // Next polls continue from the previous delta's server_now (62 s) − 10 s.
    expect(live).toHaveBeenCalledTimes(2);
    expect(live).toHaveBeenLastCalledWith('ev1', iso(T0 + 52 * SEC));
    expect(cached()?.resolutions).toEqual([]);
    await advance(2_000);
    expect(live).toHaveBeenCalledTimes(3);
    expect(live).toHaveBeenLastCalledWith('ev1', iso(T0 + 54 * SEC));
    expect(getEvent).toHaveBeenCalledTimes(1);
  });

  it('replaces the waves with the server list on every poll', async () => {
    getEvent.mockResolvedValue(makeAgg({ waves: [makeWave({ start_at: null })] }));
    live.mockResolvedValue(delta({ waves: [makeWave({ start_at: iso(T0) })] }));
    renderEventData(true);
    await settle();

    await advance(2_000);

    expect(cached()?.waves).toEqual([makeWave({ start_at: iso(T0) })]);
  });

  it('refetches the aggregate when the version changes, then reads marks from its server_now', async () => {
    getEvent
      .mockResolvedValueOnce(makeAgg())
      .mockResolvedValueOnce(makeAgg({ version: 2, server_now: iso(T0 + 63 * SEC), entries: [] }));
    live.mockResolvedValue(delta({ version: 2 }));
    const { result } = renderEventData(true);
    await settle();

    await advance(2_000);
    expect(live).toHaveBeenCalledTimes(1);
    expect(getEvent).toHaveBeenCalledTimes(2);
    await settle();
    expect(result.current.agg?.version).toBe(2);
    expect(result.current.agg?.entries).toEqual([]);

    await advance(2_000);
    expect(live).toHaveBeenLastCalledWith('ev1', iso(T0 + 53 * SEC));
    expect(getEvent).toHaveBeenCalledTimes(2);
  });

  it('pauses while the page is hidden and polls as soon as it is visible again', async () => {
    getEvent.mockResolvedValue(makeAgg());
    live.mockResolvedValue(delta());
    renderEventData(true);
    await settle();

    hidden = true;
    await advance(20_000);
    expect(live).not.toHaveBeenCalled();

    hidden = false;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(live).toHaveBeenCalledTimes(1);
    await advance(2_000);
    expect(live).toHaveBeenCalledTimes(2);
  });

  it('keeps polling after a failed request', async () => {
    getEvent.mockResolvedValue(makeAgg());
    live.mockRejectedValueOnce(new Error('Sem conexão com o servidor')).mockResolvedValue(delta());
    renderEventData(true);
    await settle();

    await advance(2_000);
    await advance(2_000);

    expect(live).toHaveBeenCalledTimes(2);
    expect(cached()?.marks).toEqual([]);
  });

  it('never overlaps requests: a slow poll delays the next one', async () => {
    getEvent.mockResolvedValue(makeAgg());
    const slow = deferred<LiveDelta>();
    live.mockReturnValueOnce(slow.promise).mockResolvedValue(delta());
    renderEventData(true);
    await settle();

    await advance(2_000);
    expect(live).toHaveBeenCalledTimes(1);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await advance(10_000);
    expect(live).toHaveBeenCalledTimes(1);

    await act(async () => slow.resolve(delta({ marks: [makeMark({ id: 'late', at: T0 })] })));
    expect(cached()?.marks.map((m) => m.id)).toEqual(['late']);
    await advance(2_000);
    expect(live).toHaveBeenCalledTimes(2);
  });

  it('stays single-flight when switching between an idle and a live tab mid-request', async () => {
    getEvent.mockResolvedValue(makeAgg());
    const slow = deferred<LiveDelta>();
    live.mockReturnValueOnce(slow.promise).mockResolvedValue(delta());
    const { rerender } = renderEventData(false);
    await settle();
    await advance(15_000);
    expect(live).toHaveBeenCalledTimes(1);

    rerender({ isLive: true });
    await advance(4_000);
    expect(live).toHaveBeenCalledTimes(1);

    await act(async () => slow.resolve(delta()));
    await advance(2_000);
    expect(live).toHaveBeenCalledTimes(2);
    await advance(2_000);
    expect(live).toHaveBeenCalledTimes(3);
  });

  it('does not let a poll that was in flight overwrite a local patch of the lists', async () => {
    getEvent.mockResolvedValue(makeAgg());
    const slow = deferred<LiveDelta>();
    live.mockReturnValueOnce(slow.promise);
    const { result } = renderEventData(true);
    await settle();
    await advance(2_000);
    expect(live).toHaveBeenCalledTimes(1);

    const res = makeResolution({ entry_id: 'en1', leg_index: 1, mode: 'manual', manual_ts: iso(T0) });
    act(() => result.current.patchAgg((a) => ({ ...a, resolutions: [res] })));
    await act(async () => slow.resolve(delta({ resolutions: [], marks: [makeMark({ id: 'mz', at: T0 })] })));

    expect(cached()?.resolutions).toEqual([res]);
    expect(cached()?.marks.map((m) => m.id)).toEqual(['mz']);
    // The next poll brings the server's view of the lists again.
    live.mockResolvedValue(delta({ resolutions: [] }));
    await advance(2_000);
    expect(cached()?.resolutions).toEqual([]);
  });

  it('refetches the aggregate when a mark comes from a timekeeper it does not know yet', async () => {
    const tk9 = makeTimekeeper({ id: 'tk9', name: 'Bruno' });
    getEvent
      .mockResolvedValueOnce(makeAgg())
      .mockResolvedValueOnce(makeAgg({ timekeepers: [makeTimekeeper(), tk9], server_now: iso(T0 + 63 * SEC) }));
    live
      // Known timekeeper and an organizer mark (no timekeeper): nothing to refetch.
      .mockResolvedValueOnce(delta({ marks: [makeMark({ id: 'k1', at: T0 }), makeMark({ id: 'o1', at: T0, timekeeper_id: null })] }))
      .mockResolvedValueOnce(delta({ marks: [makeMark({ id: 'n1', at: T0 + 61 * SEC, timekeeper_id: 'tk9' })] }))
      .mockResolvedValue(delta());
    renderEventData(true);
    await settle();

    await advance(2_000);
    expect(getEvent).toHaveBeenCalledTimes(1);
    await advance(2_000);
    expect(getEvent).toHaveBeenCalledTimes(2);
    await settle();
    expect(cached()?.timekeepers.map((t) => t.id)).toEqual(['tk1', 'tk9']);
    await advance(2_000);
    expect(getEvent).toHaveBeenCalledTimes(2);
  });

  it('refetches the whole aggregate every 30 s on live tabs, while visible', async () => {
    // Server answers carry the (fake) current time, as the real server_now does.
    vi.setSystemTime(T0 + 60 * SEC);
    const tk9 = makeTimekeeper({ id: 'tk9', name: 'Bruno' });
    getEvent
      .mockResolvedValueOnce(makeAgg())
      .mockImplementation(async () => makeAgg({ timekeepers: [makeTimekeeper(), tk9], server_now: iso(Date.now()) }));
    live.mockImplementation(async () => delta({ server_now: iso(Date.now()) }));
    renderEventData(true);
    await settle();

    await advance(29_990);
    expect(getEvent).toHaveBeenCalledTimes(1);
    await advance(10);
    expect(getEvent).toHaveBeenCalledTimes(2);
    // The delta polls continue from the refetch without undoing its lists.
    await advance(2_000);
    expect(live).toHaveBeenLastCalledWith('ev1', iso(T0 + 80 * SEC));
    await advance(2_000);
    expect(cached()?.timekeepers.map((t) => t.id)).toEqual(['tk1', 'tk9']);

    hidden = true;
    await advance(30_000);
    expect(getEvent).toHaveBeenCalledTimes(2);
  });

  it('does not refetch the whole aggregate on idle tabs', async () => {
    getEvent.mockResolvedValue(makeAgg());
    live.mockResolvedValue(delta());
    renderEventData(false);
    await settle();

    await advance(60_000);

    expect(getEvent).toHaveBeenCalledTimes(1);
  });

  it('refresh() refetches the aggregate', async () => {
    getEvent.mockResolvedValueOnce(makeAgg()).mockResolvedValueOnce(makeAgg({ version: 3 }));
    const { result } = renderEventData(false);
    await settle();

    await act(() => result.current.refresh());

    expect(getEvent).toHaveBeenCalledTimes(2);
    expect(cached()?.version).toBe(3);
    await settle();
    expect(result.current.agg?.version).toBe(3);
  });

  it('stops polling when unmounted', async () => {
    getEvent.mockResolvedValue(makeAgg());
    live.mockResolvedValue(delta());
    const { unmount } = renderEventData(true);
    await settle();
    await advance(2_000);
    expect(live).toHaveBeenCalledTimes(1);

    unmount();
    await advance(10_000);
    document.dispatchEvent(new Event('visibilitychange'));

    expect(live).toHaveBeenCalledTimes(1);
  });

  it('exposes load errors and does not poll without an aggregate', async () => {
    getEvent.mockRejectedValue(new Error('Evento não encontrado'));
    const { result } = renderEventData(true);

    await settle();
    expect(result.current.error?.message).toBe('Evento não encontrado');
    expect(result.current.agg).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    await advance(10_000);
    expect(live).not.toHaveBeenCalled();
  });
});
