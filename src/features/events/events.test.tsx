import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router';
import type { RouteObject } from 'react-router';

import { ConfirmProvider, ToastProvider } from '../../components/ui';
import { ApiError } from '../../lib/api';
import type { AdminMe, EventAggregate, EventSummary, OrganizerRow } from '../../lib/types';
import { makeEvent } from '../../domain/testing/fixtures';
import { SessionContext } from '../auth/session';
import type { SessionValue } from '../auth/session';
import { EventContext } from './EventContext';
import type { EventContextValue } from './EventContext';
import EventsPage from './EventsPage';
import EventGeneralTab from './EventGeneralTab';
import SettingsPage from '../settings/SettingsPage';
import HelpPage from '../help/HelpPage';

// This task only reaches lib/supabase transitively (through session.tsx and lib/api's own
// import), and importing the real client throws outside a browser env with no VITE_SUPABASE_URL.
// Keep every test isolated from it: supabase is a bare stub, and `api` is fully replaced.
vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe() {} } } })),
    },
  },
}));

const mocks = vi.hoisted(() => ({
  listEvents: vi.fn(),
  saveEvent: vi.fn(),
  deleteEvent: vi.fn(),
  duplicateEvent: vi.fn(),
  listOrganizers: vi.fn(),
  createOrganizer: vi.fn(),
  deleteOrganizer: vi.fn(),
}));
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  api: {
    admin: {
      listEvents: mocks.listEvents,
      saveEvent: mocks.saveEvent,
      deleteEvent: mocks.deleteEvent,
      duplicateEvent: mocks.duplicateEvent,
      listOrganizers: mocks.listOrganizers,
      createOrganizer: mocks.createOrganizer,
      deleteOrganizer: mocks.deleteOrganizer,
    },
  },
}));

function makeSummary(p: Partial<EventSummary> = {}): EventSummary {
  return { ...makeEvent(), races_count: 0, entries_count: 0, ...p };
}

function makeAgg(p: Partial<EventAggregate> = {}): EventAggregate {
  return {
    event: makeEvent(), races: [], waves: [], entries: [], athletes: [], timekeepers: [],
    marks: [], resolutions: [], results: [], version: 1, server_now: new Date().toISOString(),
    ...p,
  };
}

function fakeContext(agg: EventAggregate, overrides: Partial<EventContextValue> = {}): EventContextValue {
  return {
    eventId: agg.event.id,
    agg,
    index: {
      racesById: new Map(), wavesById: new Map(), wavesByRace: new Map(),
      entriesById: new Map(), entriesByRace: new Map(), athletesById: new Map(), timekeepersById: new Map(),
    },
    timing: { byEntry: new Map(), issues: [] },
    classifications: new Map(),
    nowMs: Date.now(),
    refresh: vi.fn().mockResolvedValue(undefined),
    patchAgg: vi.fn(),
    clock: {} as EventContextValue['clock'],
    ...overrides,
  };
}

function fakeSession(me: AdminMe | null, overrides: Partial<SessionValue> = {}): SessionValue {
  return {
    status: me ? 'organizer' : 'anon', me,
    signIn: vi.fn(), signOut: vi.fn().mockResolvedValue(undefined),
    changePassword: vi.fn().mockResolvedValue(undefined), refreshMe: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const OWNER: AdminMe = { user_id: 'u1', email: 'ana@ebc.test', name: 'Ana', role: 'owner', must_change_password: false };
const NON_OWNER: AdminMe = { user_id: 'u2', email: 'bea@ebc.test', name: 'Bea', role: 'admin', must_change_password: false };

function renderRoutes(initialPath: string, routes: RouteObject[], session: SessionValue = fakeSession(OWNER)) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  const result = render(
    <SessionContext.Provider value={session}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <ConfirmProvider>
            <RouterProvider router={router} />
          </ConfirmProvider>
        </ToastProvider>
      </QueryClientProvider>
    </SessionContext.Provider>,
  );
  return { ...result, router };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
  // jsdom has no Clipboard API; tests that stub `navigator.clipboard` must not leak it further.
  Reflect.deleteProperty(window.navigator, 'clipboard');
});

describe('EventsPage', () => {
  const ROUTES: RouteObject[] = [
    { path: '/eventos', element: <EventsPage /> },
    { path: '/eventos/:id', element: <p>Detalhe do evento</p> },
    { path: '/eventos/:id/provas', element: <p>Provas do evento</p> },
  ];

  it('lists events sorted by date desc, with name, date, location, status and counts', async () => {
    mocks.listEvents.mockResolvedValue([
      makeSummary({ id: 'e1', name: 'Corrida de Janeiro', date: '2026-01-10', location: 'Vitória', status: 'encerrado', races_count: 1, entries_count: 20 }),
      makeSummary({ id: 'e2', name: 'Corrida de Março', date: '2026-03-05', location: 'Vila Velha', status: 'planejado', races_count: 2, entries_count: 5 }),
    ]);
    renderRoutes('/eventos', ROUTES);

    const headings = await screen.findAllByRole('link', { name: /Corrida de/ });
    expect(headings.map((h) => h.textContent)).toEqual(['Corrida de Março', 'Corrida de Janeiro']);
    expect(screen.getByText('05/03/2026 · Vila Velha')).toBeInTheDocument();
    expect(screen.getByText('2 provas · 5 inscrições')).toBeInTheDocument();
    expect(screen.getByText('1 prova · 20 inscrições')).toBeInTheDocument();
    expect(screen.getByText('Planejado')).toBeInTheDocument();
    expect(screen.getByText('Encerrado')).toBeInTheDocument();
  });

  it('creates an event from the modal and navigates to its provas tab', async () => {
    const user = userEvent.setup();
    mocks.listEvents.mockResolvedValue([]);
    mocks.saveEvent.mockResolvedValue({ ...makeEvent(), id: 'new1' });
    const { router } = renderRoutes('/eventos', ROUTES);

    await user.click(await screen.findByTestId('new-event'));
    await user.type(screen.getByTestId('event-name'), 'Aquathlon de Verão');
    await user.type(screen.getByTestId('event-date'), '2027-02-20');
    await user.type(screen.getByTestId('event-location'), 'Praia da Costa');
    await user.type(screen.getByTestId('event-levels'), 'Elite, Base, Elite');
    await user.click(screen.getByTestId('event-create-submit'));

    await waitFor(() =>
      expect(mocks.saveEvent).toHaveBeenCalledWith({
        name: 'Aquathlon de Verão', date: '2027-02-20', location: 'Praia da Costa', levels: ['Elite', 'Base'],
      }),
    );
    expect(await screen.findByText('Provas do evento')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/eventos/new1/provas');
  });

  it('duplicates an event and navigates to it', async () => {
    const user = userEvent.setup();
    mocks.listEvents.mockResolvedValue([makeSummary({ id: 'e1', name: 'Copa EBC', date: '2026-10-11' })]);
    mocks.duplicateEvent.mockResolvedValue('copy1');
    const { router } = renderRoutes('/eventos', ROUTES);

    await user.click(await screen.findByRole('button', { name: 'Duplicar' }));
    await user.clear(screen.getByTestId('duplicate-date'));
    await user.type(screen.getByTestId('duplicate-date'), '2026-11-01');
    await user.click(screen.getByTestId('event-duplicate-submit'));

    await waitFor(() =>
      expect(mocks.duplicateEvent).toHaveBeenCalledWith('e1', 'Copa EBC (cópia)', '2026-11-01'),
    );
    expect(await screen.findByText('Detalhe do evento')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/eventos/copy1');
  });

  it('deletes an event after the danger confirmation', async () => {
    const user = userEvent.setup();
    mocks.listEvents.mockResolvedValue([makeSummary({ id: 'e1', name: 'Copa EBC' })]);
    mocks.deleteEvent.mockResolvedValue(undefined);
    renderRoutes('/eventos', ROUTES);

    await user.click(await screen.findByRole('button', { name: 'Excluir' }));
    await user.click(screen.getByTestId('confirm-ok'));

    await waitFor(() => expect(mocks.deleteEvent).toHaveBeenCalledWith('e1'));
  });
});

describe('EventGeneralTab', () => {
  function renderTab(ctx: EventContextValue) {
    const routes: RouteObject[] = [
      { path: '/eventos/:id/geral', element: <EventContext.Provider value={ctx}><EventGeneralTab /></EventContext.Provider> },
      { path: '/eventos', element: <p>Lista de eventos</p> },
    ];
    return renderRoutes(`/eventos/${ctx.eventId}/geral`, routes);
  }

  // A stable `MemoryRouter` (unlike swapping `createMemoryRouter` instances) lets `rerender` feed
  // a new context value while keeping `EventGeneralTab`'s own component instance — and therefore
  // its `useState` — exactly as a real `agg` update from EventProvider would.
  function renderTabDirect(ctx: EventContextValue) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const tree = (c: EventContextValue) => (
      <SessionContext.Provider value={fakeSession(OWNER)}>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <ConfirmProvider>
              <MemoryRouter initialEntries={[`/eventos/${c.eventId}/geral`]}>
                <EventContext.Provider value={c}>
                  <EventGeneralTab />
                </EventContext.Provider>
              </MemoryRouter>
            </ConfirmProvider>
          </ToastProvider>
        </QueryClientProvider>
      </SessionContext.Provider>
    );
    const result = render(tree(ctx));
    return { ...result, rerenderWithContext: (next: EventContextValue) => result.rerender(tree(next)) };
  }

  it("shows the event's current data, including the public link preview", () => {
    const agg = makeAgg({ event: makeEvent({ id: 'e1', name: 'Copa EBC', date: '2026-10-11', location: 'Vila Velha', levels: ['Elite', 'Base'], is_public: true, public_slug: 'copa-ebc' }) });
    renderTab(fakeContext(agg));

    expect(screen.getByTestId('event-name')).toHaveValue('Copa EBC');
    expect(screen.getByTestId('event-date')).toHaveValue('2026-10-11');
    expect(screen.getByTestId('event-location')).toHaveValue('Vila Velha');
    expect(screen.getByTestId('event-levels')).toHaveValue('Elite, Base');
    expect(screen.getByTestId('event-public')).toBeChecked();
    expect(screen.getByText('…/#/p/copa-ebc')).toBeInTheDocument();
  });

  it('saves the edited fields and refreshes the event data', async () => {
    const user = userEvent.setup();
    mocks.saveEvent.mockResolvedValue(makeEvent());
    const agg = makeAgg({ event: makeEvent({ id: 'e1', status: 'planejado' }) });
    const ctx = fakeContext(agg);
    renderTab(ctx);

    await user.clear(screen.getByTestId('event-name'));
    await user.type(screen.getByTestId('event-name'), 'Copa EBC 2027');
    await user.click(screen.getByTestId('event-save'));

    await waitFor(() =>
      expect(mocks.saveEvent).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'e1', name: 'Copa EBC 2027', status: 'planejado' }),
      ),
    );
    expect(ctx.refresh).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Evento salvo')).toBeInTheDocument();
  });

  it('copies the public link once "Resultados públicos" reveals it', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    const agg = makeAgg({ event: makeEvent({ is_public: true, public_slug: 'copa-ebc' }) });
    renderTab(fakeContext(agg));

    await user.click(screen.getByRole('button', { name: 'Copiar link' }));

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/#/p/copa-ebc'));
    expect(await screen.findByText('Link copiado')).toBeInTheDocument();
  });

  it('deletes the event after confirmation and returns to the events list', async () => {
    const user = userEvent.setup();
    mocks.deleteEvent.mockResolvedValue(undefined);
    const agg = makeAgg({ event: makeEvent({ id: 'e1', name: 'Copa EBC' }) });
    const { router } = renderTab(fakeContext(agg));

    await user.click(screen.getByRole('button', { name: 'Excluir evento' }));
    await user.click(screen.getByTestId('confirm-ok'));

    await waitFor(() => expect(mocks.deleteEvent).toHaveBeenCalledWith('e1'));
    expect(await screen.findByText('Lista de eventos')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/eventos');
  });

  it('keeps unsaved edits when the event changes elsewhere, and offers to reload (Ruling 40)', async () => {
    const user = userEvent.setup();
    const agg1 = makeAgg({ event: makeEvent({ id: 'e1', name: 'Copa EBC' }) });
    const { rerenderWithContext } = renderTabDirect(fakeContext(agg1));

    await user.clear(screen.getByTestId('event-name'));
    await user.type(screen.getByTestId('event-name'), 'Nome em edição');
    expect(screen.queryByText(/Os dados do evento mudaram em outro lugar/)).not.toBeInTheDocument();

    // Someone else (another tab, another organizer, a live poll) saved over the same event.
    const agg2 = makeAgg({ event: makeEvent({ id: 'e1', name: 'Copa EBC (renomeada em outro lugar)' }) });
    rerenderWithContext(fakeContext(agg2));

    expect(screen.getByTestId('event-name')).toHaveValue('Nome em edição');
    expect(screen.getByText(/Os dados do evento mudaram em outro lugar/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Recarregar' }));

    expect(screen.getByTestId('event-name')).toHaveValue('Copa EBC (renomeada em outro lugar)');
    expect(screen.queryByText(/Os dados do evento mudaram em outro lugar/)).not.toBeInTheDocument();
  });

  it('re-seeds freely from a fresh event while the form is untouched', () => {
    const agg1 = makeAgg({ event: makeEvent({ id: 'e1', name: 'Copa EBC' }) });
    const { rerenderWithContext } = renderTabDirect(fakeContext(agg1));

    const agg2 = makeAgg({ event: makeEvent({ id: 'e1', name: 'Copa EBC (atualizada)' }) });
    rerenderWithContext(fakeContext(agg2));

    expect(screen.getByTestId('event-name')).toHaveValue('Copa EBC (atualizada)');
    expect(screen.queryByText(/Os dados do evento mudaram em outro lugar/)).not.toBeInTheDocument();
  });

  it('does not warn about its own save landing', async () => {
    const user = userEvent.setup();
    mocks.saveEvent.mockResolvedValue(makeEvent());
    const agg = makeAgg({ event: makeEvent({ id: 'e1', name: 'Copa EBC' }) });
    const { rerenderWithContext } = renderTabDirect(fakeContext(agg));

    await user.clear(screen.getByTestId('event-name'));
    await user.type(screen.getByTestId('event-name'), 'Copa EBC 2027');
    await user.click(screen.getByTestId('event-save'));
    await waitFor(() => expect(mocks.saveEvent).toHaveBeenCalled());

    // `refresh()` on this fixture is a no-op mock, so simulate the aggregate it would normally
    // bring back: the same event, saved, as a fresh object.
    const savedAgg = makeAgg({ event: makeEvent({ id: 'e1', name: 'Copa EBC 2027' }) });
    rerenderWithContext(fakeContext(savedAgg));

    expect(screen.getByTestId('event-name')).toHaveValue('Copa EBC 2027');
    expect(screen.queryByText(/Os dados do evento mudaram em outro lugar/)).not.toBeInTheDocument();
  });
});

describe('SettingsPage', () => {
  function renderSettings(session: SessionValue) {
    return renderRoutes('/config', [{ path: '/config', element: <SettingsPage /> }], session);
  }

  it('shows "Adicionar organizador" for the owner', async () => {
    mocks.listOrganizers.mockResolvedValue([]);
    renderSettings(fakeSession(OWNER));
    expect(await screen.findByTestId('add-organizer')).toBeInTheDocument();
  });

  it('hides "Adicionar organizador" for a non-owner organizer', async () => {
    mocks.listOrganizers.mockResolvedValue([]);
    renderSettings(fakeSession(NON_OWNER));
    await screen.findByText('Organizadores');
    expect(screen.queryByTestId('add-organizer')).not.toBeInTheDocument();
  });

  it('generates a 12-char password from the unambiguous alphabet via crypto.getRandomValues, then creates the organizer and shows the credentials once', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(crypto, 'getRandomValues');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    mocks.listOrganizers.mockResolvedValue([]);
    const createdOrganizer: OrganizerRow = { user_id: 'u3', email: 'nova@ebc.test', name: 'Nova', role: 'admin', created_at: new Date().toISOString() };
    mocks.createOrganizer.mockResolvedValue(createdOrganizer);
    renderSettings(fakeSession(OWNER));

    await user.click(await screen.findByTestId('add-organizer'));
    await user.type(screen.getByTestId('organizer-name'), 'Nova');
    await user.type(screen.getByTestId('organizer-email'), 'nova@ebc.test');
    await user.click(screen.getByTestId('organizer-generate-password'));

    expect(spy).toHaveBeenCalled();
    const password = (screen.getByTestId('organizer-password') as HTMLInputElement).value;
    expect(password).toHaveLength(12);
    expect(password).toMatch(/^[A-HJ-NP-Za-km-z2-9]{12}$/);

    await user.click(screen.getByTestId('organizer-save'));

    await waitFor(() => expect(mocks.createOrganizer).toHaveBeenCalledWith('nova@ebc.test', password, 'Nova'));
    expect(await screen.findByTestId('organizer-credentials')).toBeInTheDocument();
    expect(screen.getByText(password)).toBeInTheDocument();

    await user.click(screen.getByTestId('organizer-copy-credentials'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(password));
    expect(await screen.findByText('Credenciais copiadas')).toBeInTheDocument();
  });

  it('removes an organizer after confirmation', async () => {
    const user = userEvent.setup();
    mocks.listOrganizers.mockResolvedValue([
      { user_id: 'u2', email: 'bea@ebc.test', name: 'Bea', role: 'admin', created_at: new Date().toISOString() },
    ]);
    mocks.deleteOrganizer.mockResolvedValue(undefined);
    renderSettings(fakeSession(OWNER));

    await user.click(await screen.findByTestId('organizer-remove-u2'));
    await user.click(screen.getByTestId('confirm-ok'));

    await waitFor(() => expect(mocks.deleteOrganizer).toHaveBeenCalledWith('u2'));
    expect(await screen.findByText('Organizador removido')).toBeInTheDocument();
  });

  it("shows the server's pt-BR message in a toast when an owner-only action is refused (42501)", async () => {
    const user = userEvent.setup();
    mocks.listOrganizers.mockResolvedValue([]);
    mocks.createOrganizer.mockRejectedValue(new ApiError('Somente o dono pode criar organizadores', '42501'));
    renderSettings(fakeSession(OWNER));

    await user.click(await screen.findByTestId('add-organizer'));
    await user.type(screen.getByTestId('organizer-name'), 'Nova');
    await user.type(screen.getByTestId('organizer-email'), 'nova@ebc.test');
    await user.click(screen.getByTestId('organizer-generate-password'));
    await user.click(screen.getByTestId('organizer-save'));

    expect(await screen.findByText('Somente o dono pode criar organizadores')).toBeInTheDocument();
    expect(screen.queryByTestId('organizer-credentials')).not.toBeInTheDocument();
  });

  it('changes the account password through useSession().changePassword', async () => {
    const user = userEvent.setup();
    mocks.listOrganizers.mockResolvedValue([]);
    const session = fakeSession(OWNER);
    renderSettings(session);

    await screen.findByText('ana@ebc.test');
    await user.type(screen.getByTestId('newpass-1'), 'nova-senha-123');
    await user.type(screen.getByTestId('newpass-2'), 'nova-senha-123');
    await user.click(screen.getByTestId('newpass-submit'));

    await waitFor(() => expect(session.changePassword).toHaveBeenCalledWith('nova-senha-123'));
    expect(await screen.findByText('Senha alterada')).toBeInTheDocument();
  });
});

describe('HelpPage', () => {
  function renderHelp() {
    return renderRoutes('/ajuda', [{ path: '/ajuda', element: <HelpPage /> }]);
  }

  it('renders the before/during/after sections and the closing checklist', () => {
    renderHelp();

    expect(screen.getByRole('heading', { name: 'Antes do evento' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Durante o evento' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Depois do evento' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Como o tempo oficial é escolhido' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Checklist do dia do evento' })).toBeInTheDocument();

    expect(screen.getByText(/reative o projeto se ele estiver/)).toBeInTheDocument();
    expect(screen.getByText(/cerca de 7 dias sem uso/)).toBeInTheDocument();
    expect(screen.getByText(/Teste o link do cronometrista no local da prova/)).toBeInTheDocument();
    expect(screen.getByText(/Confira que as largadas estão sem horário/)).toBeInTheDocument();
    expect(screen.getByText(/exporte a planilha e desative o link/)).toBeInTheDocument();
  });

  it('explains the median with the worked example', () => {
    renderHelp();
    expect(screen.getByText(/10:00:05/)).toBeInTheDocument();
    expect(screen.getAllByText(/10:00:06/).length).toBeGreaterThan(0);
    expect(screen.getByText(/10:00:19/)).toBeInTheDocument();
    expect(screen.getByText(/10:00:10/)).toBeInTheDocument();
  });
});
