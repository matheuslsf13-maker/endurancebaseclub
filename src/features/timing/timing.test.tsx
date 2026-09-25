import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { ConfirmProvider } from '../../components/ui/Confirm';
import { ToastProvider } from '../../components/ui/Toast';
import { ClockSync } from '../../lib/clock';
import type { EventAggregate } from '../../lib/types';
import { indexEvent } from '../../domain/eventModel';
import { computeEventTiming } from '../../domain/consolidation';
import {
  iso, makeAthlete, makeEntry, makeEvent, makeMark, makeRace, makeTimekeeper, makeWave, MIN, SEC, T0,
} from '../../domain/testing/fixtures';
import { EventContext } from '../events/EventContext';
import type { EventContextValue } from '../events/EventContext';
import TimingTab from './TimingTab';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

const mocks = vi.hoisted(() => ({
  saveEvent: vi.fn(),
  rotateTkToken: vi.fn(),
  updateTimekeeper: vi.fn(),
  setWaveStart: vi.fn(),
  updateMark: vi.fn(),
}));
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  api: {
    admin: {
      saveEvent: mocks.saveEvent,
      rotateTkToken: mocks.rotateTkToken,
      updateTimekeeper: mocks.updateTimekeeper,
      setWaveStart: mocks.setWaveStart,
      updateMark: mocks.updateMark,
    },
  },
}));

function makeAgg(p: Partial<EventAggregate> = {}): EventAggregate {
  return {
    event: makeEvent(), races: [makeRace()], waves: [makeWave()], entries: [], athletes: [makeAthlete()],
    timekeepers: [makeTimekeeper()], marks: [], resolutions: [], results: [],
    version: 1, server_now: iso(T0 + 60 * SEC), ...p,
  };
}

function buildCtx(agg: EventAggregate, overrides: Partial<EventContextValue> = {}): EventContextValue {
  const index = indexEvent(agg);
  const nowMs = overrides.nowMs ?? T0 + 5 * MIN;
  const timing = overrides.timing ?? computeEventTiming(agg, nowMs);
  return {
    eventId: agg.event.id,
    agg,
    index,
    timing,
    classifications: new Map(),
    nowMs,
    refresh: vi.fn(async () => {}),
    patchAgg: vi.fn(),
    clock: new ClockSync({ now: () => nowMs }),
    ...overrides,
  };
}

function renderTab(ctx: EventContextValue) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      {
        path: '/eventos/:eventId/cronometragem',
        element: (
          <QueryClientProvider client={queryClient}>
            <ToastProvider>
              <ConfirmProvider>
                <EventContext.Provider value={ctx}>
                  <TimingTab />
                </EventContext.Provider>
              </ConfirmProvider>
            </ToastProvider>
          </QueryClientProvider>
        ),
      },
    ],
    { initialEntries: [`/eventos/${ctx.eventId}/cronometragem`] },
  );
  return render(<RouterProvider router={router} />);
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('link dos cronometristas', () => {
  it('shows the link with the current token', () => {
    const agg = makeAgg({ event: makeEvent({ tk_token: 'abc123XYZ' }) });
    renderTab(buildCtx(agg));

    const link = screen.getByTestId('tk-link') as HTMLInputElement;
    expect(link.value).toBe(`${location.origin}${location.pathname}#/c/abc123XYZ`);
    expect(link.value).toContain('#/c/abc123XYZ');
    expect(link).toHaveAttribute('readonly');
  });

  it('renders the QR code for the link', async () => {
    const agg = makeAgg({ event: makeEvent({ tk_token: 'abc123XYZ' }) });
    renderTab(buildCtx(agg));
    const img = await screen.findByTestId('tk-qr');
    expect(img.tagName).toBe('IMG');
  });

  it('copies the link to the clipboard and shows a toast', async () => {
    const user = userEvent.setup({ delay: null });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const agg = makeAgg({ event: makeEvent({ tk_token: 'tok1' }) });
    renderTab(buildCtx(agg));

    await user.click(screen.getByTestId('tk-copy'));

    expect(writeText).toHaveBeenCalledWith(`${location.origin}${location.pathname}#/c/tok1`);
    expect(await screen.findByText('Link copiado')).toBeInTheDocument();
  });

  it('toggles the link on and off through saveEvent', async () => {
    const user = userEvent.setup({ delay: null });
    const agg = makeAgg({ event: makeEvent({ tk_enabled: true }) });
    const ctx = buildCtx(agg);
    mocks.saveEvent.mockResolvedValue({ ...agg.event, tk_enabled: false });
    renderTab(ctx);

    await user.click(screen.getByLabelText('Link ativo'));

    await waitFor(() => expect(mocks.saveEvent).toHaveBeenCalledWith({ ...agg.event, tk_enabled: false }));
    expect(ctx.refresh).toHaveBeenCalled();
  });

  it('rotates the token after confirmation', async () => {
    const user = userEvent.setup({ delay: null });
    const agg = makeAgg({ event: makeEvent({ tk_token: 'old-token' }) });
    const ctx = buildCtx(agg);
    mocks.rotateTkToken.mockResolvedValue('new-token');
    renderTab(ctx);

    await user.click(screen.getByRole('button', { name: 'Gerar novo link' }));
    await user.click(screen.getByTestId('confirm-ok'));

    await waitFor(() => expect(mocks.rotateTkToken).toHaveBeenCalledWith(agg.event.id));
    expect(ctx.refresh).toHaveBeenCalled();
  });

  it('does not rotate the token when the organizer cancels', async () => {
    const user = userEvent.setup({ delay: null });
    const agg = makeAgg({ event: makeEvent({ tk_token: 'old-token' }) });
    renderTab(buildCtx(agg));

    await user.click(screen.getByRole('button', { name: 'Gerar novo link' }));
    await user.click(screen.getByTestId('confirm-cancel'));

    expect(mocks.rotateTkToken).not.toHaveBeenCalled();
  });
});

describe('cronometristas', () => {
  it('shows relative activity computed from now, and the mark count from agg.marks (not the possibly-stale marks_count field)', () => {
    const tk = makeTimekeeper({ id: 'tk1', name: 'Bia', last_seen_at: iso(T0 + 5 * MIN - 12 * SEC), marks_count: 999 });
    const agg = makeAgg({
      timekeepers: [tk],
      marks: [
        makeMark({ id: 'm1', at: T0 + MIN, timekeeper_id: 'tk1' }),
        makeMark({ id: 'm2', at: T0 + 2 * MIN, timekeeper_id: 'tk1' }),
        makeMark({ id: 'm3', at: T0 + 3 * MIN, timekeeper_id: 'tk1', discarded: true }),
        makeMark({ id: 'm4', at: T0 + 3 * MIN, timekeeper_id: 'tk2' }),
      ],
    });
    renderTab(buildCtx(agg, { nowMs: T0 + 5 * MIN }));

    // The Cronometristas panel renders before the live marks feed, which also names its author;
    // the first "Bia" in the document is the panel's own row.
    const row = screen.getAllByText('Bia')[0].closest('tr') as HTMLElement;
    expect(within(row).getByText('há 12 s')).toBeInTheDocument();
    expect(within(row).getByText('2')).toBeInTheDocument();
  });

  it('shows "nunca" for a timekeeper that never synced', () => {
    const agg = makeAgg({ timekeepers: [makeTimekeeper({ id: 'tk1', name: 'Caio', last_seen_at: null })] });
    renderTab(buildCtx(agg));
    expect(screen.getByText('nunca')).toBeInTheDocument();
  });

  it('marks the reference timekeeper per race', () => {
    const race = makeRace({ configPatch: { time_source: 'reference', reference_timekeeper_id: 'tk1' } });
    const agg = makeAgg({ races: [race], timekeepers: [makeTimekeeper({ id: 'tk1', name: 'Ana' })] });
    renderTab(buildCtx(agg));
    expect(screen.getByText(`Referência · ${race.name}`)).toBeInTheDocument();
  });

  it('toggles a timekeeper active state', async () => {
    const user = userEvent.setup({ delay: null });
    const tk = makeTimekeeper({ id: 'tk1', name: 'Bia', active: true });
    const agg = makeAgg({ timekeepers: [tk] });
    const ctx = buildCtx(agg);
    mocks.updateTimekeeper.mockResolvedValue({ ...tk, active: false });
    renderTab(ctx);

    await user.click(screen.getByLabelText('Ativo'));

    await waitFor(() => expect(mocks.updateTimekeeper).toHaveBeenCalledWith('tk1', { active: false }));
    expect(ctx.refresh).toHaveBeenCalled();
  });
});

describe('largadas', () => {
  it('captures clock.now() at the moment confirm-ok is pressed, not when the dialog opens', async () => {
    const user = userEvent.setup({ delay: null });
    let currentNow = T0 + 5 * MIN;
    const clock = new ClockSync({ now: () => currentNow });
    const wave = makeWave({ id: 'w1', race_id: 'r1', start_at: null });
    const agg = makeAgg({ waves: [wave] });
    const ctx = buildCtx(agg, { clock });
    mocks.setWaveStart.mockResolvedValue({ ...wave, start_at: iso(currentNow) });
    renderTab(ctx);

    await user.click(screen.getAllByTestId('wave-start')[0]);
    // Time moves on while the confirm dialog is open; the captured instant must reflect this.
    currentNow = T0 + 6 * MIN;
    await user.click(screen.getByTestId('confirm-ok'));

    await waitFor(() => expect(mocks.setWaveStart).toHaveBeenCalledWith('w1', iso(currentNow)));
    expect(ctx.patchAgg).toHaveBeenCalled();
    expect(ctx.refresh).toHaveBeenCalled();
  });

  it('does not start the wave when the organizer cancels', async () => {
    const user = userEvent.setup({ delay: null });
    const wave = makeWave({ id: 'w1', start_at: null });
    renderTab(buildCtx(makeAgg({ waves: [wave] })));

    await user.click(screen.getAllByTestId('wave-start')[0]);
    await user.click(screen.getByTestId('confirm-cancel'));

    expect(mocks.setWaveStart).not.toHaveBeenCalled();
  });

  it('typing a Brasília time and saving converts it to UTC for the event date', async () => {
    const user = userEvent.setup({ delay: null });
    const wave = makeWave({ id: 'w1', start_at: null });
    const agg = makeAgg({ event: makeEvent({ date: '2026-10-11' }), waves: [wave] });
    const ctx = buildCtx(agg);
    mocks.setWaveStart.mockResolvedValue({ ...wave, start_at: '2026-10-11T11:00:05.300Z' });
    renderTab(ctx);

    const input = screen.getAllByTestId('wave-time-input')[0];
    await user.type(input, '08:00:05.3');
    await user.click(screen.getAllByTestId('wave-time-save')[0]);

    await waitFor(() =>
      expect(mocks.setWaveStart).toHaveBeenCalledWith('w1', '2026-10-11T11:00:05.300Z'),
    );
    expect(ctx.refresh).toHaveBeenCalled();
  });

  it('shows an inline error for an invalid time and does not call setWaveStart', async () => {
    const user = userEvent.setup({ delay: null });
    const wave = makeWave({ id: 'w1', start_at: null });
    renderTab(buildCtx(makeAgg({ waves: [wave] })));

    const input = screen.getAllByTestId('wave-time-input')[0];
    await user.type(input, 'não é hora');
    await user.click(screen.getAllByTestId('wave-time-save')[0]);

    expect(await screen.findByRole('alert')).toHaveTextContent('Horário inválido');
    expect(mocks.setWaveStart).not.toHaveBeenCalled();
  });

  it('clears a wave start after confirmation', async () => {
    const user = userEvent.setup({ delay: null });
    const wave = makeWave({ id: 'w1', start_at: iso(T0) });
    const ctx = buildCtx(makeAgg({ waves: [wave] }));
    mocks.setWaveStart.mockResolvedValue({ ...wave, start_at: null });
    renderTab(ctx);

    await user.click(screen.getByRole('button', { name: 'Limpar' }));
    await user.click(screen.getByTestId('confirm-ok'));

    await waitFor(() => expect(mocks.setWaveStart).toHaveBeenCalledWith('w1', null));
  });

  it('disables Limpar when the wave has not started', () => {
    const wave = makeWave({ id: 'w1', start_at: null });
    renderTab(buildCtx(makeAgg({ waves: [wave] })));
    expect(screen.getByRole('button', { name: 'Limpar' })).toBeDisabled();
  });

  it('lists waves in race, then wave, position order', () => {
    const raceA = makeRace({ id: 'rA', name: 'Aquathlon', position: 0 });
    const raceB = makeRace({ id: 'rB', name: 'Corrida', position: 1 });
    const waves = [
      makeWave({ id: 'wA2', race_id: 'rA', name: 'Onda 2', position: 1, start_at: null }),
      makeWave({ id: 'wB1', race_id: 'rB', name: 'Onda única', position: 0, start_at: null }),
      makeWave({ id: 'wA1', race_id: 'rA', name: 'Onda 1', position: 0, start_at: null }),
    ];
    renderTab(buildCtx(makeAgg({ races: [raceA, raceB], waves })));

    const rows = screen.getAllByTestId('wave-start').map((btn) => btn.closest('tr')?.textContent ?? '');
    expect(rows[0]).toContain('Onda 1');
    expect(rows[1]).toContain('Onda 2');
    expect(rows[2]).toContain('Onda única');
  });
});

describe('painel ao vivo', () => {
  it('shows the status counters and links pendências to the review tab', () => {
    // "notStarted" sits on its own wave that never got a "Largar agora" (a started wave makes
    // every one of its entries at least on_course, even with zero marks).
    const entries = [
      makeEntry({ id: 'finished', bib: '1', status: 'ok', wave_id: 'w1' }),
      makeEntry({ id: 'onCourse', bib: '2', status: 'ok', wave_id: 'w1' }),
      makeEntry({ id: 'notStarted', bib: '3', status: 'ok', wave_id: 'w2' }),
    ];
    const waves = [makeWave({ id: 'w1', start_at: iso(T0) }), makeWave({ id: 'w2', position: 1, start_at: null })];
    const marks = [
      makeMark({ id: 'f1', at: T0 + MIN, entry_id: 'finished', leg_index: 0 }),
      makeMark({ id: 'f2', at: T0 + 2 * MIN, entry_id: 'finished', leg_index: 1 }),
      makeMark({ id: 'o1', at: T0 + MIN, entry_id: 'onCourse', leg_index: 0 }),
      // A mark left unassigned for a while: an "unassigned" warning issue → counted in pendências.
      makeMark({ id: 'u1', at: T0, entry_id: null, leg_index: null }),
    ];
    const agg = makeAgg({ entries, waves, marks });
    renderTab(buildCtx(agg, { nowMs: T0 + 10 * MIN }));

    expect(screen.getByText('Em prova').nextSibling).toHaveTextContent('1');
    expect(screen.getByText('Concluídos').nextSibling).toHaveTextContent('1');
    expect(screen.getByText('Não largaram').nextSibling).toHaveTextContent('1');
    const pendLink = screen.getByRole('link', { name: /Pendências/ });
    expect(pendLink).toHaveAttribute('href', `/eventos/${agg.event.id}/revisao`);
    expect(within(pendLink).getByText('1')).toBeInTheDocument();
  });

  it('shows an on-course entry with its current athlete, leg and a live leg timer', async () => {
    vi.useFakeTimers({ now: T0 + 65 * SEC });
    const race = makeRace({
      id: 'r1',
      legs: [{ modality: 'swim', label: 'Natação', distance_m: 750 }, { modality: 'run', label: 'Corrida', distance_m: 5000 }],
    });
    const entry = makeEntry({
      id: 'en1', bib: '7', race_id: 'r1', wave_id: 'w1',
      members: [{ athlete_id: 'a1', position: 0, legs: [0, 1] }],
    });
    const wave = makeWave({ id: 'w1', race_id: 'r1', start_at: iso(T0) });
    // The swim leg finished at T0 + 30s; the runner has been on the run leg for 35 s.
    const marks = [makeMark({ id: 'm1', at: T0 + 30 * SEC, entry_id: 'en1', leg_index: 0 })];
    const agg = makeAgg({ races: [race], entries: [entry], waves: [wave], marks, athletes: [makeAthlete({ id: 'a1', name: 'Ana Souza' })] });
    renderTab(buildCtx(agg, { nowMs: T0 + 65 * SEC }));

    // The same mark also appears in the "Últimas marcações" feed below, so scope to the
    // on-course table (the entry's bib alone is not unique across both).
    const onCourseTable = screen.getByTestId('on-course-table-r1');
    const row = within(onCourseTable).getByText('7').closest('tr') as HTMLElement;
    expect(row).toHaveTextContent('Ana Souza');
    expect(within(row).getByText('Perna 2 · Corrida')).toBeInTheDocument();
    expect(within(row).getByText('0:35.0')).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(within(row).getByText('0:36.0')).toBeInTheDocument();
  });

  it('lists recent marks with hour, timekeeper, bib, leg and situation', () => {
    const entry = makeEntry({ id: 'en1', bib: '9' });
    const agg = makeAgg({
      entries: [entry],
      marks: [
        makeMark({ id: 'm1', at: T0 + MIN, entry_id: 'en1', leg_index: 0, timekeeper_id: 'tk1' }),
        makeMark({ id: 'm2', at: T0 + 2 * MIN, entry_id: null, leg_index: null, timekeeper_id: 'ghost-tk' }),
      ],
      timekeepers: [makeTimekeeper({ id: 'tk1', name: 'Bia' })],
    });
    renderTab(buildCtx(agg, { nowMs: T0 + 5 * MIN }));

    // The assigned mark's entry also shows up in the on-course table above (it now has an
    // open crossing); scope to the marks feed itself, where "9" and "Bia" are unambiguous.
    const feed = screen.getByTestId('recent-marks-table');
    const row1 = within(feed).getByText('9').closest('tr') as HTMLElement;
    expect(within(row1).getByText('Bia')).toBeInTheDocument();
    expect(within(row1).getByText('1')).toBeInTheDocument();
    // Unknown timekeeper id in the feed: labeled generically, never crashes.
    const row2 = within(feed).getByText('Sem atleta').closest('tr') as HTMLElement;
    expect(within(row2).getByText('Cronometrista')).toBeInTheDocument();
  });

  it('assigns an unassigned mark to a typed bib via planBibAssignment, then refreshes', async () => {
    const user = userEvent.setup({ delay: null });
    const entry = makeEntry({ id: 'en1', bib: '101', race_id: 'r1', members: [{ athlete_id: 'a1', position: 0, legs: [0, 1] }] });
    const mark = makeMark({ id: 'm1', at: T0 + 10 * MIN, entry_id: null, leg_index: null, timekeeper_id: null });
    const agg = makeAgg({ entries: [entry], marks: [mark] });
    const ctx = buildCtx(agg, { nowMs: T0 + 10 * MIN });
    mocks.updateMark.mockResolvedValue({ ...mark, entry_id: 'en1', leg_index: 0 });
    renderTab(ctx);

    await user.type(screen.getByTestId('live-assign-bib'), '101');
    await user.click(screen.getByTestId('live-assign-submit'));

    await waitFor(() => expect(mocks.updateMark).toHaveBeenCalledWith('m1', { entry_id: 'en1', leg_index: 0 }));
    expect(ctx.refresh).toHaveBeenCalled();
  });

  it('shows an inline pt-BR error for an unknown bib and does not call updateMark', async () => {
    const user = userEvent.setup({ delay: null });
    const mark = makeMark({ id: 'm1', at: T0 + 10 * MIN, entry_id: null, leg_index: null });
    renderTab(buildCtx(makeAgg({ entries: [makeEntry()], marks: [mark] })));

    await user.type(screen.getByTestId('live-assign-bib'), '999');
    await user.click(screen.getByTestId('live-assign-submit'));

    expect(await screen.findByText('Nº 999 não encontrado')).toBeInTheDocument();
    expect(mocks.updateMark).not.toHaveBeenCalled();
  });
});
