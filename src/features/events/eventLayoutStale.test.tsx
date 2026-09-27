import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';

import { renderWithProviders } from '../../test/renderWithProviders';
import { formatClock } from '../../lib/format';
import type { EventAggregate, LiveDelta } from '../../lib/types';
import { iso, makeAthlete, makeEntry, makeEvent, makeRace, makeTimekeeper, makeWave, SEC, T0 } from '../../domain/testing/fixtures';
import EventLayout from './EventLayout';

const mocks = vi.hoisted(() => ({
  serverTime: vi.fn<() => Promise<number>>(),
  getEvent: vi.fn<(id: string) => Promise<EventAggregate>>(),
  live: vi.fn<(id: string, since: string | null) => Promise<LiveDelta>>(),
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  api: { serverTime: mocks.serverTime, admin: { getEvent: mocks.getEvent, live: mocks.live } },
}));

function makeAgg(): EventAggregate {
  return {
    event: makeEvent({ id: 'ev1', name: 'Copa EBC' }), races: [makeRace()], waves: [makeWave()], entries: [makeEntry()],
    athletes: [makeAthlete()], timekeepers: [makeTimekeeper()], marks: [], resolutions: [], results: [],
    version: 1, server_now: iso(T0 + 60 * SEC),
  };
}

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers({ now: T0 + 60 * SEC });
  mocks.serverTime.mockReset().mockImplementation(async () => Date.now());
  mocks.getEvent.mockReset().mockResolvedValue(makeAgg());
  mocks.live.mockReset().mockRejectedValue(new Error('Sem conexão com o servidor'));
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('EventLayout: stale organizer data (B2-m8)', () => {
  it('says the live view has no connection and how old its data is once the polls fail for more than 10 s', async () => {
    renderWithProviders(<EventLayout />, { route: '/eventos/ev1/cronometragem', path: '/eventos/:eventId/*' });
    await advance(5);
    const loadedAt = Date.now();
    expect(screen.getByText('Copa EBC')).toBeInTheDocument();
    expect(screen.queryByText(/Sem conexão/)).not.toBeInTheDocument();

    await advance(12_000);
    expect(screen.getByRole('status')).toHaveTextContent(`Sem conexão · dados de ${formatClock(loadedAt)}`);

    mocks.live.mockResolvedValue({ server_now: iso(Date.now()), version: 1, marks: [], resolutions: [], waves: [makeWave()] });
    await advance(2_100);
    expect(screen.queryByText(/Sem conexão/)).not.toBeInTheDocument();
  });
});
