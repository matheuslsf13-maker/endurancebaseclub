// TEMPORARY verification of Task 17 hooks/layout/routes — not committed.
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { api } from './lib/api';
import type { EventAggregate, LiveDelta } from './lib/types';
import { useEventData } from './hooks/useEventData';
import { SessionContext } from './features/auth/session';
import type { SessionValue } from './features/auth/session';
import { routes } from './App';
import { ConfirmProvider, ToastProvider } from './components/ui';
import { makeAthlete, makeEntry, makeEvent, makeMark, makeRace, makeResolution, makeTimekeeper, makeWave, iso, T0, SEC } from './domain/testing/fixtures';

vi.mock('./lib/supabase', () => ({ supabase: { rpc: vi.fn(), auth: {} } }));
vi.mock('./lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/api')>();
  return {
    ...actual,
    api: {
      serverTime: vi.fn(),
      admin: { getEvent: vi.fn(), live: vi.fn(), me: vi.fn() },
      tk: {}, pub: {},
    },
  };
});

const getEvent = vi.mocked(api.admin.getEvent);
const live = vi.mocked(api.admin.live);
const serverTime = vi.mocked(api.serverTime);

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

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

let hidden = false;
beforeEach(() => {
  vi.clearAllMocks();
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
  serverTime.mockImplementation(async () => Date.now());
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useEventData', () => {
  it('polls every 15 s when idle and 2 s when live, since = server_now − 10 s, merging marks and replacing lists', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const m1 = makeMark({ id: 'm1', at: T0 + 10 * SEC });
    getEvent.mockResolvedValue(makeAgg({ marks: [m1] }));
    const res1 = makeResolution({ entry_id: 'en1', leg_index: 0, mode: 'system' });
    const m1b = { ...m1, entry_id: null, leg_index: null, updated_at: iso(T0 + 61 * SEC) };
    const m2 = makeMark({ id: 'm2', at: T0 + 61 * SEC });
    live.mockResolvedValue(delta({ marks: [m1b, m2], resolutions: [res1] }));

    const client = newClient();
    const { result, rerender } = renderHook(({ isLive }) => useEventData('ev1', { live: isLive }), {
      wrapper: wrapper(client), initialProps: { isLive: false },
    });
    await act(() => vi.advanceTimersByTimeAsync(5));
    expect(result.current.agg?.event.name).toBe('Copa EBC');

    await act(() => vi.advanceTimersByTimeAsync(14_000));
    expect(live).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(live).toHaveBeenCalledTimes(1);
    expect(live).toHaveBeenLastCalledWith('ev1', iso(T0 + 50 * SEC));
    const cached = () => client.getQueryData<EventAggregate>(['event', 'ev1']);
    expect(cached()?.marks.map((m) => [m.id, m.entry_id])).toEqual([['m1', null], ['m2', 'en1']]);
    expect(cached()?.resolutions).toEqual([res1]);
    await act(() => vi.advanceTimersByTimeAsync(5));
    expect(result.current.agg?.marks).toHaveLength(2);

    // switch to live → 2 s cadence; cursor continues from last delta server_now (62 s) − 10 s
    live.mockResolvedValue(delta({ server_now: iso(T0 + 64 * SEC) }));
    rerender({ isLive: true });
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(live).toHaveBeenCalledTimes(2);
    expect(live).toHaveBeenLastCalledWith('ev1', iso(T0 + 52 * SEC));
    expect(cached()?.resolutions).toEqual([]);   // replaced wholesale
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(live).toHaveBeenCalledTimes(3);
    expect(live).toHaveBeenLastCalledWith('ev1', iso(T0 + 54 * SEC));
    expect(getEvent).toHaveBeenCalledTimes(1);
  });

  it('refetches the aggregate when the version changes, then reads marks from its server_now', async () => {
    vi.useFakeTimers();
    getEvent.mockResolvedValueOnce(makeAgg()).mockResolvedValueOnce(makeAgg({ version: 2, server_now: iso(T0 + 63 * SEC), entries: [] }));
    live.mockResolvedValue(delta({ version: 2 }));
    const client = newClient();
    const { result } = renderHook(() => useEventData('ev1', { live: true }), { wrapper: wrapper(client) });
    await act(() => vi.advanceTimersByTimeAsync(5));
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(live).toHaveBeenCalledTimes(1);
    expect(getEvent).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(5));
    expect(result.current.agg?.version).toBe(2);
    expect(result.current.agg?.entries).toEqual([]);
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    // cursor: aggregate was refetched → base is its server_now (63 s)
    expect(live).toHaveBeenLastCalledWith('ev1', iso(T0 + 53 * SEC));
    expect(getEvent).toHaveBeenCalledTimes(2);
  });

  it('pauses while hidden and polls immediately when visible again', async () => {
    vi.useFakeTimers();
    getEvent.mockResolvedValue(makeAgg());
    live.mockResolvedValue(delta());
    const client = newClient();
    renderHook(() => useEventData('ev1', { live: true }), { wrapper: wrapper(client) });
    await act(() => vi.advanceTimersByTimeAsync(5));
    hidden = true;
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(live).not.toHaveBeenCalled();
    hidden = false;
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await act(() => vi.advanceTimersByTimeAsync(5));
    expect(live).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(live).toHaveBeenCalledTimes(2);
  });

  it('keeps polling after a network failure', async () => {
    vi.useFakeTimers();
    getEvent.mockResolvedValue(makeAgg());
    live.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(delta());
    renderHook(() => useEventData('ev1', { live: true }), { wrapper: wrapper(newClient()) });
    await act(() => vi.advanceTimersByTimeAsync(5));
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(live).toHaveBeenCalledTimes(2);
  });

  it('does not let an in-flight poll overwrite a local patch of the lists', async () => {
    vi.useFakeTimers();
    getEvent.mockResolvedValue(makeAgg());
    let resolveLive!: (d: LiveDelta) => void;
    live.mockImplementationOnce(() => new Promise<LiveDelta>((r) => { resolveLive = r; }));
    const client = newClient();
    const { result } = renderHook(() => useEventData('ev1', { live: true }), { wrapper: wrapper(client) });
    await act(() => vi.advanceTimersByTimeAsync(5));
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(live).toHaveBeenCalledTimes(1);
    const res = makeResolution({ entry_id: 'en1', leg_index: 1, mode: 'manual', manual_ts: iso(T0) });
    act(() => result.current.patchAgg((a) => ({ ...a, resolutions: [res] })));
    await act(async () => { resolveLive(delta({ resolutions: [], marks: [makeMark({ id: 'mz', at: T0 })] })); });
    const agg = client.getQueryData<EventAggregate>(['event', 'ev1']);
    expect(agg?.resolutions).toEqual([res]);
    expect(agg?.marks.map((m) => m.id)).toEqual(['mz']);   // marks still merged
    // next poll replaces lists again with the server view
    live.mockResolvedValue(delta({ resolutions: [] }));
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(client.getQueryData<EventAggregate>(['event', 'ev1'])?.resolutions).toEqual([]);
  });

  it('exposes load errors', async () => {
    getEvent.mockRejectedValue(new Error('Evento não encontrado'));
    const { result } = renderHook(() => useEventData('ev1', { live: false }), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.error?.message).toBe('Evento não encontrado'));
    expect(result.current.agg).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });
});

function fakeSession(p: Partial<SessionValue> = {}): SessionValue {
  return { status: 'anon', me: null, signIn: vi.fn(), signOut: vi.fn(), changePassword: vi.fn(), refreshMe: vi.fn(), ...p };
}
const ORG = { status: 'organizer' as const, me: { user_id: 'u1', email: 'a@b.c', name: 'Ana', role: 'owner' as const, must_change_password: false } };

function renderApp(path: string, session: SessionValue) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={newClient()}>
      <SessionContext.Provider value={session}>
        <ToastProvider><ConfirmProvider><RouterProvider router={router} /></ConfirmProvider></ToastProvider>
      </SessionContext.Provider>
    </QueryClientProvider>,
  );
  return router;
}

describe('routes', () => {
  it('/ shows the public home for visitors', () => {
    renderApp('/', fakeSession());
    expect(screen.getByText('PublicHome')).toBeInTheDocument();
  });
  it('/ sends organizers to /eventos inside the layout', async () => {
    const router = renderApp('/', fakeSession(ORG));
    expect(await screen.findByText('EventsPage')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/eventos');
    expect(screen.getByTestId('logout')).toBeInTheDocument();
  });
  it('admin routes redirect visitors to /entrar', async () => {
    const router = renderApp('/atletas/a1', fakeSession());
    expect(await screen.findByTestId('login-email')).toBeInTheDocument();
    expect(router.state.location.state).toEqual({ from: '/atletas/a1' });
  });
  it.each([
    ['/atletas', 'AthletesPage'], ['/atletas/a1', 'AthleteProfilePage'], ['/ajuda', 'HelpPage'], ['/config', 'SettingsPage'],
  ])('%s renders %s for organizers', (path, text) => {
    renderApp(path, fakeSession(ORG));
    expect(screen.getByText(text)).toBeInTheDocument();
  });
  it.each([
    ['/c/tok123', 'TimekeeperPage'], ['/p/copa', 'PublicEventPage'], ['/atleta/a1', 'PublicAthletePage'],
  ])('%s renders %s without a session', (path, text) => {
    renderApp(path, fakeSession());
    expect(screen.getByText(text)).toBeInTheDocument();
  });
  it('unknown paths render NotFound', () => {
    renderApp('/nada/aqui', fakeSession());
    expect(screen.getByText('Página não encontrada')).toBeInTheDocument();
  });
  it('/trocar-senha renders the change-password page', () => {
    renderApp('/trocar-senha', fakeSession({ ...ORG, me: { ...ORG.me, must_change_password: true } }));
    expect(screen.getByTestId('newpass-1')).toBeInTheDocument();
  });

  it('/eventos/:id redirects to geral, shows the event header, tabs and the review badge', async () => {
    const at = T0 + 30 * SEC;
    // two timekeepers diverging by 10 s on leg 0 → divergence warning; plus an unassigned mark > 60 s old
    const marks = [
      makeMark({ id: 'x1', at, timekeeper_id: 'tk1' }),
      makeMark({ id: 'x2', at: at + 10 * SEC, timekeeper_id: 'tk2' }),
      makeMark({ id: 'x3', at: Date.now() - 5 * 60 * SEC, entry_id: null, leg_index: null }),
    ];
    getEvent.mockResolvedValue(makeAgg({ marks }));
    live.mockResolvedValue(delta());
    const router = renderApp('/eventos/ev1', fakeSession(ORG));
    expect(await screen.findByText('EventGeneralTab')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/eventos/ev1/geral');
    expect(screen.getByRole('heading', { name: 'Copa EBC' })).toBeInTheDocument();
    expect(screen.getByText('11/10/2026 · Vila Velha')).toBeInTheDocument();
    expect(screen.getByText('Ao vivo')).toBeInTheDocument();
    for (const id of ['geral', 'provas', 'inscricoes', 'cronometragem', 'revisao', 'resultados']) {
      expect(screen.getByTestId(`tab-${id}`)).toHaveAttribute('href', `/eventos/ev1/${id}`);
    }
    expect(screen.getByTestId('tab-revisao')).toHaveTextContent('Revisão2');
    expect(serverTime).toHaveBeenCalled();
  });

  it('each event tab renders its page', async () => {
    getEvent.mockResolvedValue(makeAgg());
    live.mockResolvedValue(delta());
    const pages: [string, string][] = [['provas', 'RacesTab'], ['inscricoes', 'EntriesTab'], ['cronometragem', 'TimingTab'], ['revisao', 'ReviewTab'], ['resultados', 'ResultsTab']];
    for (const [tab, text] of pages) {
      renderApp(`/eventos/ev1/${tab}`, fakeSession(ORG));
      expect(await screen.findByText(text)).toBeInTheDocument();
    }
  });

  it('shows the load error with a retry', async () => {
    getEvent.mockRejectedValueOnce(new Error('Evento não encontrado')).mockResolvedValue(makeAgg());
    live.mockResolvedValue(delta());
    renderApp('/eventos/ev1/geral', fakeSession(ORG));
    expect(await screen.findByText('Evento não encontrado')).toBeInTheDocument();
    screen.getByRole('button', { name: 'Tentar novamente' }).click();
    expect(await screen.findByText('EventGeneralTab')).toBeInTheDocument();
  });
});
