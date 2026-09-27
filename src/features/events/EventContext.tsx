import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { indexEvent } from '../../domain/eventModel';
import type { EventIndex } from '../../domain/eventModel';
import { computeEventTiming } from '../../domain/consolidation';
import type { EventTiming } from '../../domain/consolidation';
import { classifyRace } from '../../domain/ranking';
import type { RaceClassification } from '../../domain/ranking';
import type { ClockSync } from '../../lib/clock';
import type { EventAggregate } from '../../lib/types';
import { useClock } from '../../hooks/useClock';
import { useNow } from '../../hooks/useNow';

export interface EventContextValue {
  eventId: string;
  agg: EventAggregate;
  index: EventIndex;
  timing: EventTiming;
  /** Classification of each race, by race id. */
  classifications: Map<string, RaceClassification>;
  /** Synced time the timing was computed at (advances every TIMING_TICK_MS). */
  nowMs: number;
  refresh(): Promise<void>;
  patchAgg(fn: (a: EventAggregate) => EventAggregate): void;
  clock: ClockSync;
}

/** Exported so screen tests can provide a fixture value directly. */
export const EventContext = createContext<EventContextValue | null>(null);

/** Some issues depend on the time alone (a mark left without athlete for > 60 s). */
const TIMING_TICK_MS = 10_000;

export interface EventProviderProps {
  eventId: string;
  agg: EventAggregate;
  refresh(): Promise<void>;
  patchAgg(fn: (a: EventAggregate) => EventAggregate): void;
  children: ReactNode;
}

/** Computes the event's derived data once for every tab: index, timing and classifications. */
export function EventProvider({ eventId, agg, refresh, patchAgg, children }: EventProviderProps) {
  const clock = useClock();
  const tickMs = useNow(TIMING_TICK_MS);
  // Sampled once per tick, so a clock re-sync alone does not recompute everything.
  const nowMs = useMemo(() => tickMs + (clock.offsetMs ?? 0), [tickMs, clock]);

  const index = useMemo(() => indexEvent(agg), [agg]);
  const timing = useMemo(() => computeEventTiming(agg, nowMs), [agg, nowMs]);
  const classifications = useMemo(() => {
    const byRace = new Map<string, RaceClassification>();
    for (const race of agg.races) {
      byRace.set(race.id, classifyRace(race, index.entriesByRace.get(race.id) ?? [], timing.byEntry, index.athletesById, agg.event));
    }
    return byRace;
  }, [agg, index, timing]);

  const value = useMemo<EventContextValue>(
    () => ({ eventId, agg, index, timing, classifications, nowMs, refresh, patchAgg, clock }),
    [eventId, agg, index, timing, classifications, nowMs, refresh, patchAgg, clock],
  );
  return <EventContext.Provider value={value}>{children}</EventContext.Provider>;
}

export function useEventContext(): EventContextValue {
  const ctx = useContext(EventContext);
  if (!ctx) throw new Error('useEventContext must be used within an EventProvider');
  return ctx;
}
