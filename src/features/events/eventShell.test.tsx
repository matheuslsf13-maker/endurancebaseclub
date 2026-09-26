import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { routes } from '../../App';
import { ConfirmProvider, ToastProvider } from '../../components/ui';
import { ClockSync } from '../../lib/clock';
import { useClock } from '../../hooks/useClock';
import type { EventAggregate, LiveDelta } from '../../lib/types';
import {
  iso, makeAthlete, makeEntry, makeEvent, makeMark, makeRace, makeTimekeeper, makeWave, MIN, SEC, T0,
} from '../../domain/testing/fixtures';
import { SessionContext } from '../auth/session';
import type { SessionValue } from '../auth/session';
import { EventProvider, useEventContext } from './EventContext';
import type { EventContextValue } from './EventContext';

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
const { getEvent, live } = mocks;

// Ruling 36: these tests check routing and outlet wiring, not the pages themselves, so each page
// the routes lead to is replaced by a marker that later screen tasks cannot change.
const marker = vi.hoisted(() => async (id: string) => {
  const { createElement } = await import('react');
  return { default: () => createElement('div', { 'data-testid': `page-${id}` }) };
});
vi.mock('../public/PublicHome', () => marker('public-home'));
vi.mock('./EventsPage', () => marker('events'));
vi.mock('../races/RacesTab', () => marker('races'));
vi.mock('../entries/EntriesTab', () => marker('entries'));
vi.mock('../timing/TimingTab', () => marker('timing'));
vi.mock('../review/ReviewTab', () => marker('review'));
vi.mock('../results/ResultsTab', () => marker('results'));
vi.mock('../athletes/AthletesPage', () => marker('athletes'));
vi.mock('../athletes/AthleteProfilePage', () => marker('athlete-profile'));
vi.mock('../help/HelpPage', () => marker('help'));
vi.mock('../settings/SettingsPage', () => marker('settings'));
vi.mock('../timekeeper/TimekeeperPage', () => marker('timekeeper'));
vi.mock('../public/PublicEventPage', () => marker('public-event'));
vi.mock('../public/PublicAthletePage', () => marker('public-athlete'));
// The Geral marker also proves the tabs render inside the event's context.
vi.mock('./EventGeneralTab', async () => {
  const { createElement } = await import('react');
  const { useEventContext } = await import('./EventContext');
  return {
    default: function EventGeneralMarker() {
      return createElement('div', { 'data-testid': 'page-event-general' }, useEventContext().agg.event.name);
    },
  };
});

function makeAgg(p: Partial<EventAggregate> = {}): EventAggregate {
  return {
    event: makeEvent({ id: 'ev1', name: 'Copa EBC' }), races: [makeRace()], waves: [makeWave()], entries: [makeEntry()],
    athletes: [makeAthlete()], timekeepers: [makeTimekeeper()], marks: [], resolutions: [], results: [],
    version: 1, server_now: iso(T0 + 60 * SEC), ...p,
  };
}
function delta(): LiveDelta {
  return { server_now: iso(T0 + 62 * SEC), version: 1, marks: [], resolutions: [], waves: [makeWave()] };
}

function fakeSession(p: Partial<SessionValue> = {}): SessionValue {
  return {
    status: 'anon', me: null, signIn: vi.fn(), signOut: vi.fn().mockResolvedValue(undefined),
    changePassword: vi.fn(), refreshMe: vi.fn(), ...p,
  };
}
const ME = { user_id: 'u1', email: 'ana@ebc.test', name: 'Ana', role: 'owner' as const, must_change_password: false };
const organizer = (p: Partial<SessionValue> = {}) => fakeSession({ status: 'organizer', me: ME, ...p });

function renderApp(path: string, session: SessionValue) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SessionContext.Provider value={session}>
        <ToastProvider>
          <ConfirmProvider>
            <RouterProvider router={router} />
          </ConfirmProvider>
        </ToastProvider>
      </SessionContext.Provider>
    </QueryClientProvider>,
  );
  return router;
}

const TABS: [string, string][] = [
  ['geral', 'Geral'], ['provas', 'Provas'], ['inscricoes', 'Inscrições'],
  ['cronometragem', 'Cronometragem'], ['revisao', 'Revisão'], ['resultados', 'Resultados'],
];

let hidden = false;
beforeEach(() => {
  vi.clearAllMocks();
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  mocks.serverTime.mockImplementation(async () => Date.now());
  live.mockResolvedValue(delta());
});
afterEach(() => {
  vi.useRealTimers();
});

describe('routes', () => {
  it('/ shows the public home to visitors', async () => {
    renderApp('/', fakeSession());
    expect(await screen.findByTestId('page-public-home')).toBeInTheDocument();
  });

  it('/ waits for the session before choosing', () => {
    renderApp('/', fakeSession({ status: 'loading' }));
    expect(screen.getByRole('status', { name: 'Carregando' })).toBeInTheDocument();
    expect(screen.queryByTestId('page-public-home')).not.toBeInTheDocument();
  });

  it('/ sends organizers to /eventos inside the organizer layout', async () => {
    const session = organizer();
    const router = renderApp('/', session);

    expect(await screen.findByTestId('page-events')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/eventos');
    await userEvent.click(screen.getByTestId('logout'));
    expect(session.signOut).toHaveBeenCalledTimes(1);
  });

  it('/entrar renders the login page', async () => {
    renderApp('/entrar', fakeSession());
    expect(await screen.findByTestId('login-email')).toBeInTheDocument();
  });

  it('/trocar-senha renders the change-password page', async () => {
    renderApp('/trocar-senha', organizer({ me: { ...ME, must_change_password: true } }));
    expect(await screen.findByTestId('newpass-1')).toBeInTheDocument();
  });

  it('admin routes send visitors to /entrar, remembering where they were going', async () => {
    const router = renderApp('/atletas/a1', fakeSession());
    expect(await screen.findByTestId('login-email')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/entrar');
    expect(router.state.location.state).toEqual({ from: '/atletas/a1' });
  });

  it('admin routes explain when the account is not an organizer', () => {
    renderApp('/eventos', fakeSession({ status: 'forbidden' }));
    expect(screen.getByText('Esta conta não tem acesso de organização')).toBeInTheDocument();
    expect(screen.queryByTestId('page-events')).not.toBeInTheDocument();
  });

  it.each([
    ['/eventos', 'events'], ['/atletas', 'athletes'], ['/atletas/a1', 'athlete-profile'],
    ['/ajuda', 'help'], ['/config', 'settings'],
  ])('%s renders the %s page for organizers, inside the layout', async (path, page) => {
    renderApp(path, organizer());
    expect(await screen.findByTestId(`page-${page}`)).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Principal' })).toBeInTheDocument();
  });

  it.each([
    ['/c/tok123', 'timekeeper'], ['/p/copa-ebc', 'public-event'], ['/atleta/a1', 'public-athlete'],
  ])('%s renders the %s page without a session', async (path, page) => {
    renderApp(path, fakeSession());
    expect(await screen.findByTestId(`page-${page}`)).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Principal' })).not.toBeInTheDocument();
  });

  it('unknown paths render NotFound', async () => {
    renderApp('/nada/aqui', fakeSession());
    expect(await screen.findByText('Página não encontrada')).toBeInTheDocument();
  });
});

describe('EventLayout', () => {
  it('opens the Geral tab and shows the event header, the tabs and the review badge', async () => {
    const at = T0 + 30 * SEC;
    getEvent.mockResolvedValue(makeAgg({
      marks: [
        // Two timekeepers 10 s apart on leg 0: divergence (warning); the entry is still
        // on course: not_finished (info, not counted); a mark left without athlete: unassigned (warning).
        makeMark({ id: 'x1', at, timekeeper_id: 'tk1' }),
        makeMark({ id: 'x2', at: at + 10 * SEC, timekeeper_id: 'tk2' }),
        makeMark({ id: 'x3', at: Date.now() - 5 * MIN, entry_id: null, leg_index: null }),
      ],
    }));
    const router = renderApp('/eventos/ev1', organizer());

    expect(await screen.findByTestId('page-event-general')).toHaveTextContent('Copa EBC');
    expect(router.state.location.pathname).toBe('/eventos/ev1/geral');
    expect(getEvent).toHaveBeenCalledWith('ev1');
    expect(screen.getByRole('heading', { name: 'Copa EBC' })).toBeInTheDocument();
    expect(screen.getByText('11/10/2026 · Vila Velha')).toBeInTheDocument();
    expect(screen.getByText('Ao vivo')).toBeInTheDocument();
    for (const [id, label] of TABS) {
      expect(screen.getByTestId(`tab-${id}`)).toHaveAttribute('href', `/eventos/ev1/${id}`);
      expect(screen.getByTestId(`tab-${id}`)).toHaveTextContent(id === 'revisao' ? 'Revisão2' : label);
    }
    expect(screen.getByTestId('tab-revisao').querySelector('span')).toHaveClass('text-warning');
  });

  it('colors the review badge as an error when a crossing is missing', async () => {
    // Leg 1 marked but leg 0 never was: missing_crossing (error).
    getEvent.mockResolvedValue(makeAgg({ marks: [makeMark({ id: 'y1', at: T0 + 20 * MIN, leg_index: 1 })] }));
    renderApp('/eventos/ev1/geral', organizer());

    expect(await screen.findByTestId('page-event-general')).toBeInTheDocument();
    expect(screen.getByTestId('tab-revisao')).toHaveTextContent('Revisão1');
    expect(screen.getByTestId('tab-revisao').querySelector('span')).toHaveClass('text-danger');
  });

  it('shows no review badge when nothing is pending', async () => {
    getEvent.mockResolvedValue(makeAgg());
    renderApp('/eventos/ev1/geral', organizer());

    expect(await screen.findByTestId('page-event-general')).toBeInTheDocument();
    expect(screen.getByTestId('tab-revisao')).toHaveTextContent(/^Revisão$/);
  });

  it.each([
    ['provas', 'races'], ['inscricoes', 'entries'], ['cronometragem', 'timing'],
    ['revisao', 'review'], ['resultados', 'results'],
  ])('renders the %s tab (%s page) under the event header', async (tab, page) => {
    getEvent.mockResolvedValue(makeAgg());
    renderApp(`/eventos/ev1/${tab}`, organizer());
    expect(await screen.findByTestId(`page-${page}`)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Copa EBC' })).toBeInTheDocument();
  });

  it('polls every 2 s only on the timing, review and results tabs', async () => {
    vi.useFakeTimers();
    getEvent.mockResolvedValue(makeAgg());
    const router = renderApp('/eventos/ev1/geral', organizer());
    // `/eventos/ev1/geral` renders through two nested lazy() boundaries (EventLayout, then
    // EventGeneralTab inside it). React.lazy() memoizes each page's dynamic import for the lifetime
    // of this module, so once any earlier test in this file has rendered a given lazy page, a later
    // render of it resolves synchronously — but in an isolated run (`vitest -t "polls every 2 s"`)
    // this is the first time either resolves. `useEventData`'s polling effect must see the *fake*
    // clock from its very first run (it arms its own `setTimeout` on mount), so timers cannot be
    // switched to real just for this render the way the other, data-free lazy tests do it: instead,
    // settle each pending `import()` on the real clock via `vi.dynamicImportSettled()` (it uses
    // Vitest's own un-faked timers internally) and force a fresh render pass with `router.navigate`
    // so `lazy()` picks up the now-resolved module directly, without depending on React's automatic
    // retry ping — which in this environment does not reliably fire while timers are faked.
    await vi.dynamicImportSettled();
    await act(async () => router.navigate('/eventos/ev1/geral'));
    await vi.dynamicImportSettled();
    await act(async () => router.navigate('/eventos/ev1/geral'));
    await act(() => vi.advanceTimersByTimeAsync(5));
    expect(screen.getByTestId('page-event-general')).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(14_000));
    expect(live).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(live).toHaveBeenCalledTimes(1);

    let calls = 1;
    for (const tab of ['cronometragem', 'revisao', 'resultados']) {
      await act(() => router.navigate(`/eventos/ev1/${tab}`));
      await act(() => vi.advanceTimersByTimeAsync(2_000));
      expect(live).toHaveBeenCalledTimes(++calls);
    }

    await act(() => router.navigate('/eventos/ev1/provas'));
    await act(() => vi.advanceTimersByTimeAsync(14_000));
    expect(live).toHaveBeenCalledTimes(calls);
    expect(getEvent).toHaveBeenCalledTimes(1);
  });

  it('shows the load error and retries', async () => {
    getEvent.mockRejectedValueOnce(new Error('Evento não encontrado')).mockResolvedValue(makeAgg());
    renderApp('/eventos/ev1/geral', organizer());

    expect(await screen.findByText('Evento não encontrado')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar para eventos' })).toHaveAttribute('href', '/eventos');
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByTestId('page-event-general')).toBeInTheDocument();
  });
});

describe('EventProvider', () => {
  let ctx: EventContextValue;
  function Probe() {
    ctx = useEventContext();
    return <p>{ctx.timing.issues.map((i) => i.type).join(',') || 'sem pendências'}</p>;
  }
  const refresh = vi.fn(async () => {});
  const patchAgg = vi.fn();
  const renderProvider = (agg: EventAggregate) =>
    render(<EventProvider eventId="ev1" agg={agg} refresh={refresh} patchAgg={patchAgg}><Probe /></EventProvider>);

  it('derives the index, timing and classifications from the aggregate', () => {
    const agg = makeAgg({ marks: [makeMark({ id: 'z1', at: T0 + 10 * MIN }), makeMark({ id: 'z2', at: T0 + 30 * MIN, leg_index: 1 })] });
    renderProvider(agg);

    expect(ctx.eventId).toBe('ev1');
    expect(ctx.agg).toBe(agg);
    expect(ctx.index.entriesById.get('en1')).toBe(agg.entries[0]);
    expect(ctx.timing.byEntry.get('en1')).toMatchObject({ status: 'finished', total_ms: 30 * MIN });
    expect(ctx.classifications.get('r1')).toMatchObject({ race: agg.races[0], finishers: 1 });
    expect(ctx.clock).toBeInstanceOf(ClockSync);
    expect(ctx.clock).toBe(renderHook(() => useClock()).result.current);
    expect(Math.abs(ctx.nowMs - ctx.clock.now())).toBeLessThan(1_000);
    expect(ctx.refresh).toBe(refresh);
    expect(ctx.patchAgg).toBe(patchAgg);
  });

  it('recomputes only when the aggregate changes or every 10 s', async () => {
    vi.useFakeTimers({ now: T0 + 10 * MIN });
    // A mark without athlete becomes an issue once it is 60 s old: 55 s now, 65 s after the tick.
    const agg = makeAgg({ marks: [makeMark({ id: 'u1', at: Date.now() - 55 * SEC, entry_id: null, leg_index: null })] });
    const { rerender } = renderProvider(agg);
    const first = ctx;
    expect(screen.queryByText(/unassigned/)).not.toBeInTheDocument();

    rerender(<EventProvider eventId="ev1" agg={agg} refresh={refresh} patchAgg={patchAgg}><Probe /></EventProvider>);
    expect(ctx).toBe(first);

    await act(() => vi.advanceTimersByTimeAsync(10_000));
    // One tick later (a clock re-sync in between may move the offset by a millisecond).
    expect(Math.abs(ctx.nowMs - first.nowMs - 10_000)).toBeLessThanOrEqual(5);
    expect(ctx.timing).not.toBe(first.timing);
    expect(screen.getByText(/unassigned/)).toBeInTheDocument();

    const next = { ...agg, entries: [] };
    rerender(<EventProvider eventId="ev1" agg={next} refresh={refresh} patchAgg={patchAgg}><Probe /></EventProvider>);
    expect(ctx.agg).toBe(next);
    expect(ctx.index.entriesById.size).toBe(0);
  });

  it('refuses to be used outside an event', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow('useEventContext must be used within an EventProvider');
    spy.mockRestore();
  });
});
