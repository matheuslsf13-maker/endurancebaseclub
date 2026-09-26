import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ApiError } from '../../lib/api';
import { ClockSync } from '../../lib/clock';
import { formatClock, formatDuration } from '../../lib/format';
import { safeLocalStorage } from '../../lib/storage';
import type { EntryMember, EntryRow, MarkRow, TkMarkInput, TkRegistration, TkSession, TkSyncResult } from '../../lib/types';
import { iso, makeEntry, makeMark, makeRace, makeWave, MIN, SEC, T0 } from '../../domain/testing/fixtures';
import { renderWithProviders } from '../../test/renderWithProviders';
import TimekeeperPage from './TimekeeperPage';

const mocks = vi.hoisted(() => ({
  open: vi.fn<(token: string) => Promise<TkSession>>(),
  register: vi.fn<(token: string, name: string, deviceLabel: string) => Promise<TkRegistration>>(),
  sync: vi.fn<(token: string, tkId: string, secret: string, marks: TkMarkInput[], since: string | null) => Promise<TkSyncResult>>(),
  serverTime: vi.fn<() => Promise<number>>(),
  clock: { current: null as ClockSync | null },
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  api: { serverTime: mocks.serverTime, tk: { open: mocks.open, register: mocks.register, sync: mocks.sync } },
}));
// The app-wide clock singleton (useClock) is covered by its own tests; here each test gets a
// fresh clock that runs on the fake timers and sits OFFSET ms ahead of the device.
vi.mock('../../hooks/useClock', () => ({ useClock: () => mocks.clock.current }));

const TOKEN = 'tok123';
const OFFSET = 1_500;
const NOW0 = T0 + 10 * MIN; // both waves started at T0
const REG = { timekeeper_id: 'tk-me', secret: 's3cret', name: 'Ana TK' };
const REG_KEY = `ebc.tk.reg.${TOKEN}`;
const SESSION_KEY = `ebc.tk.session.${TOKEN}`;
const OUTBOX_KEY = 'ebc.tk.e1.tk-me';

function entry(id: string, bib: string, race: string, teamName: string | null, members: [string, string, number[]][]): EntryRow {
  const m: EntryMember[] = members.map(([athlete_id, name, legs], position) => ({ athlete_id, name, legs, position }));
  return makeEntry({ id, bib, race_id: race, wave_id: race === 'r1' ? 'w1' : 'w2', team_name: teamName, members: m });
}
const ENTRIES = [
  entry('en1', '101', 'r1', null, [['a1', 'Matheus', [0, 1]]]),
  entry('en2', '202', 'r2', 'Tubarões', [['a2', 'Ana', [0]], ['a3', 'Beto', [1]]]),
  entry('en3', '303', 'r1', null, [['a4', 'Caio', [0, 1]]]),
];
function session(p: Partial<TkSession> = {}): TkSession {
  return {
    event: { id: 'e1', name: 'Desafio EBC', date: '2026-10-11', location: 'Vila Velha' },
    races: [makeRace({ id: 'r1', name: 'Aquathlon' }), makeRace({ id: 'r2', name: 'Revezamento', team_size: 2, position: 1 })],
    waves: [makeWave({ id: 'w1', race_id: 'r1' }), makeWave({ id: 'w2', race_id: 'r2' })],
    entries: ENTRIES, timekeepers: [], version: 1, server_now: iso(NOW0), ...p,
  };
}

const okSync = (p: Partial<TkSyncResult> = {}) =>
  async (_t: string, _id: string, _s: string, marks: TkMarkInput[]): Promise<TkSyncResult> => ({
    accepted: marks.map(m => m.id), rejected: [], server_now: iso(Date.now() + OFFSET), version: 1, marks: [], waves: [], ...p,
  });
const networkError = () => new ApiError('Sem conexão com o servidor', 'network');

let visibility: DocumentVisibilityState;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW0);
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  const clock = new ClockSync({ now: () => Date.now() });
  clock.addSample({ t0: NOW0, t1: NOW0 + 100, server: NOW0 + 50 + OFFSET }); // offset 1.5 s, ±0,05 s
  mocks.clock.current = clock;
  mocks.open.mockReset().mockResolvedValue(session());
  mocks.register.mockReset().mockResolvedValue({ timekeeper_id: 'tk-me', secret: 's3cret' });
  mocks.sync.mockReset().mockImplementation(okSync());
  mocks.serverTime.mockReset().mockImplementation(async () => Date.now() + OFFSET);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (navigator as { locks?: unknown }).locks;
});

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
function renderPage() {
  return renderWithProviders(<TimekeeperPage />, { route: `/c/${TOKEN}`, path: '/c/:token' });
}
async function renderMain() {
  window.localStorage.setItem(REG_KEY, JSON.stringify(REG));
  const r = renderPage();
  await flush();
  expect(screen.getByTestId('mark-button')).toBeInTheDocument();
  return r;
}
type StoredItem = { mark: TkMarkInput & { local_updated_at: number }; state: string; reason?: string };
function storedItems(key = OUTBOX_KEY): StoredItem[] {
  const raw = window.localStorage.getItem(key);
  const items = raw ? Object.values((JSON.parse(raw) as { items: Record<string, StoredItem> }).items) : [];
  return items.sort((a, b) => (a.mark.ts < b.mark.ts ? -1 : a.mark.ts > b.mark.ts ? 1 : 0));
}
const stored = () => storedItems().map(i => i.mark);
const status = () => screen.getByTestId('tk-sync-status');
const unassignedRows = () => within(screen.getByTestId('unassigned-list')).queryAllByRole('listitem');
const onCourseRows = () => within(screen.getByTestId('oncourse-list')).queryAllByRole('listitem');
const rowFor = (bib: string) => onCourseRows().find(r => r.textContent?.includes(`Nº ${bib}`))!;
const tapMark = () => fireEvent.click(screen.getByTestId('mark-button'));
const typeBib = (value: string) => fireEvent.change(screen.getByTestId('bib-input'), { target: { value } });
const submitBib = () => fireEvent.click(screen.getByTestId('bib-submit'));
const at = (ms: number) => formatClock(ms, { tenths: true });
const markButtonOf = (row: HTMLElement) => within(row).getAllByRole('button')[0];

/**
 * A Web Locks stand-in shared by the "tabs" of one test: exclusive names, `ifAvailable`, waiting
 * requests granted in order when the holder lets go, and `signal` aborts (Ruling 45).
 */
function installLocks() {
  const held = new Set<string>();
  const waiting: { name: string; grant: () => void }[] = [];
  const letGo = (name: string) => {
    held.delete(name);
    const i = waiting.findIndex(w => w.name === name);
    if (i >= 0) waiting.splice(i, 1)[0].grant();
  };
  const run = (name: string, cb: LockGrantedCallback<unknown>): Promise<unknown> => {
    held.add(name);
    return Promise.resolve().then(() => cb({ name, mode: 'exclusive' } as Lock)).finally(() => letGo(name));
  };
  const request = vi.fn((name: string, options: LockOptions, cb: LockGrantedCallback<unknown>): Promise<unknown> => {
    if (!held.has(name)) return run(name, cb);
    if (options.ifAvailable) return Promise.resolve().then(() => cb(null));
    return new Promise((resolve, reject) => {
      const entry = { name, grant: () => void run(name, cb).then(resolve, reject) };
      waiting.push(entry);
      options.signal?.addEventListener('abort', () => {
        const i = waiting.indexOf(entry);
        if (i >= 0) waiting.splice(i, 1);
        reject(new DOMException('Aborted', 'AbortError'));
      });
    });
  });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
  return {
    request, held,
    /** Another tab of this device holds `name` until the returned function is called. */
    otherTab(name: string): () => void {
      let free: () => void = () => {};
      void run(name, () => new Promise<void>(resolve => { free = resolve; }));
      return () => free();
    },
  };
}

describe('registration', () => {
  it('asks for the name once and opens the main screen', async () => {
    renderPage();
    await flush();
    expect(screen.getByText('Desafio EBC')).toBeInTheDocument();
    expect(screen.queryByTestId('mark-button')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('tk-name'), { target: { value: '  Ana TK ' } });
    fireEvent.click(screen.getByTestId('tk-register'));
    await flush();

    expect(mocks.register).toHaveBeenCalledWith(TOKEN, 'Ana TK', expect.any(String));
    expect(screen.getByTestId('mark-button')).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(REG_KEY)!)).toEqual(REG);
    expect(JSON.parse(window.localStorage.getItem(SESSION_KEY)!)).toMatchObject({ event: { id: 'e1' } });
  });

  it('requires a name and shows server errors next to the button', async () => {
    renderPage();
    await flush();
    fireEvent.click(screen.getByTestId('tk-register'));
    expect(screen.getByRole('alert')).toHaveTextContent('Informe seu nome');
    expect(mocks.register).not.toHaveBeenCalled();

    mocks.register.mockRejectedValueOnce(networkError());
    fireEvent.change(screen.getByTestId('tk-name'), { target: { value: 'Ana' } });
    fireEvent.click(screen.getByTestId('tk-register'));
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('Sem conexão com o servidor');
  });

  it('shows the invalid-link message when tk_open refuses the token', async () => {
    mocks.open.mockRejectedValue(new ApiError('Link de cronometragem inválido ou desativado', 'P0001'));
    renderPage();
    await flush();
    expect(screen.getByText('Link de cronometragem inválido ou desativado. Peça um novo link à organização.')).toBeInTheDocument();
  });

  it('keeps retrying while offline without a cached session', async () => {
    mocks.open.mockRejectedValueOnce(networkError());
    renderPage();
    await flush();
    expect(screen.getByText(/Sem conexão com o servidor/)).toBeInTheDocument();
    await flush(5 * SEC);
    expect(mocks.open).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('tk-register')).toBeInTheDocument();
  });

  it('opens straight from the cache while offline and keeps marking', async () => {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session()));
    window.localStorage.setItem(REG_KEY, JSON.stringify(REG));
    mocks.open.mockRejectedValue(networkError());
    mocks.sync.mockRejectedValue(networkError());
    renderPage();
    await flush();
    expect(status()).toHaveTextContent('Sem internet · 0 marcações guardadas no aparelho');
    tapMark();
    expect(status()).toHaveTextContent('Sem internet · 1 marcação guardada no aparelho');
    expect(unassignedRows()).toHaveLength(1);
  });
});

describe('marking', () => {
  it('adds an unassigned row stamped with the synced clock', async () => {
    await renderMain();
    tapMark();
    expect(unassignedRows()).toHaveLength(1);
    expect(unassignedRows()[0]).toHaveTextContent(at(NOW0 + OFFSET));
    expect(stored()).toEqual([expect.objectContaining({
      ts: iso(NOW0 + OFFSET), device_ts: iso(NOW0), clock_offset_ms: OFFSET, clock_rtt_ms: 100,
      entry_id: null, leg_index: null, athlete_id: null, discarded: false,
    })]);
  });

  it('assigns the typed bib, and Desfazer sends the mark back to "Sem atleta"', async () => {
    await renderMain();
    tapMark();
    typeBib('101');
    submitBib();

    expect(screen.getByTestId('assign-toast')).toHaveTextContent('✓ Nº 101 · Matheus · fim da perna 1/2 (Natação)');
    expect(unassignedRows()).toHaveLength(0);
    expect(stored()[0]).toMatchObject({ entry_id: 'en1', leg_index: 0, athlete_id: 'a1' });
    expect(screen.getByTestId('bib-input')).toHaveValue('');

    fireEvent.click(screen.getByTestId('toast-undo'));
    expect(unassignedRows()).toHaveLength(1);
    expect(stored()[0]).toMatchObject({ entry_id: null, leg_index: null, athlete_id: null });
  });

  it('with a bib already typed, MARCAR marks and assigns at once', async () => {
    await renderMain();
    typeBib('202');
    tapMark();
    expect(screen.getByTestId('assign-toast')).toHaveTextContent('✓ Nº 202 · Ana · fim da perna 1/2 (Natação)');
    expect(unassignedRows()).toHaveLength(0);
    expect(stored()[0]).toMatchObject({ ts: iso(NOW0 + OFFSET), entry_id: 'en2', leg_index: 0, athlete_id: 'a2' });
  });

  it('keeps the mark in "Sem atleta" when the typed bib does not resolve', async () => {
    await renderMain();
    typeBib('999');
    tapMark();
    expect(screen.getByRole('alert')).toHaveTextContent('Nº 999 não encontrado');
    expect(unassignedRows()).toHaveLength(1);
    expect(screen.getByTestId('bib-input')).toHaveValue('999');
  });

  it('after a mistyped bib, the corrected bib goes to that mark and not to an older one', async () => {
    await renderMain();
    tapMark(); // an earlier arrival still waiting
    await flush(3 * SEC);
    typeBib('999');
    tapMark();
    typeBib('303');
    submitBib();
    expect(stored().map(m => [m.ts, m.entry_id])).toEqual([
      [iso(NOW0 + OFFSET), null],
      [iso(NOW0 + OFFSET + 3 * SEC), 'en3'],
    ]);
  });

  it('adds the DNS/DSQ warning of the bib to the assignment toast', async () => {
    mocks.open.mockResolvedValue(session({ entries: ENTRIES.map(e => (e.bib === '303' ? { ...e, status: 'dns' as const } : e)) }));
    await renderMain();
    typeBib('303');
    tapMark();
    const toast = screen.getByTestId('assign-toast');
    expect(toast).toHaveTextContent('✓ Nº 303 · Caio · fim da perna 1/2 (Natação)');
    expect(toast).toHaveTextContent('Nº 303 está marcado como DNS');
  });

  it('asks for a mark first when a bib is submitted with nothing to assign', async () => {
    await renderMain();
    typeBib('101');
    submitBib();
    expect(screen.getByText('Toque em MARCAR primeiro')).toBeInTheDocument();
    expect(stored()).toEqual([]);
  });

  it('stays responsive under rapid taps: 4 arrivals → 4 rows, oldest first and selected', async () => {
    await renderMain();
    const button = screen.getByTestId('mark-button');
    for (let i = 0; i < 4; i++) {
      fireEvent.pointerDown(button, { button: 0, pointerType: 'touch' });
      fireEvent.click(button, { detail: 1 }); // the click that follows the touch must not mark again
      await flush(100);
    }
    const rows = unassignedRows();
    expect(rows).toHaveLength(4);
    rows.forEach((row, i) => expect(row).toHaveTextContent(at(NOW0 + OFFSET + i * 100)));
    expect(within(rows[0]).getByRole('button', { pressed: true })).toBeInTheDocument();

    typeBib('303');
    submitBib();
    expect(stored().map(m => m.entry_id)).toEqual(['en3', null, null, null]);
  });

  it('records one mark per real click and per keyboard press', async () => {
    // Testing Library's async wrapper waits on a real setTimeout(0): let fake time follow real time.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW0);
    await renderMain();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByTestId('mark-button'));
    expect(stored()).toHaveLength(1);
    screen.getByTestId('mark-button').focus();
    await user.keyboard('{Enter}');
    expect(stored()).toHaveLength(2);
  });

  it('a mark left without athlete for 2 min does not take the next identification (review Important 1)', async () => {
    await renderMain();
    tapMark(); // never identified
    await flush(2 * MIN);
    tapMark(); // the next arrival
    typeBib('101');
    submitBib();
    expect(stored().map(m => [m.ts, m.entry_id])).toEqual([
      [iso(NOW0 + OFFSET), null],
      [iso(NOW0 + OFFSET + 2 * MIN), 'en1'],
    ]);
  });

  it('a bib with only stale marks waiting asks for MARCAR or an explicit pick, and the picked stale mark takes it', async () => {
    await renderMain();
    tapMark();
    await flush(2 * MIN);
    typeBib('101');
    submitBib();
    expect(screen.getByText('Toque em MARCAR primeiro, ou selecione a marcação em "Sem atleta"')).toBeInTheDocument();
    expect(stored()[0].entry_id).toBeNull();

    fireEvent.click(markButtonOf(unassignedRows()[0])); // older marks are chosen explicitly
    expect(within(unassignedRows()[0]).getByRole('button', { pressed: true })).toBeInTheDocument();
    submitBib();
    expect(stored()[0]).toMatchObject({ ts: iso(NOW0 + OFFSET), entry_id: 'en1' });
  });

  it('MARCAR selects the new mark when the chosen one was tapped before its burst', async () => {
    await renderMain();
    tapMark();
    await flush(2 * MIN);
    fireEvent.click(markButtonOf(unassignedRows()[0]));
    expect(within(unassignedRows()[0]).getByRole('button', { pressed: true })).toBeInTheDocument();
    tapMark();
    expect(within(unassignedRows()[1]).getByRole('button', { pressed: true })).toBeInTheDocument();
    typeBib('303');
    submitBib();
    expect(stored().map(m => m.entry_id)).toEqual([null, 'en3']);
  });

  it('a pack identified slowly lands bib by bib while it is fresh, then asks for a pick instead of misfiling (Ruling 53)', async () => {
    const pack = Array.from({ length: 10 }, (_, i) => entry(`p${i + 1}`, String(i + 1), 'r1', null, [[`pa${i + 1}`, `Atleta ${i + 1}`, [0, 1]]]));
    mocks.open.mockResolvedValue(session({ entries: pack }));
    await renderMain();
    tapMark(); // 10 arrivals, 3 s apart
    for (let k = 1; k < 10; k++) {
      await flush(3 * SEC);
      tapMark();
    }
    // Identified at ~8 s per bib: from the 7th bib on the head is over 60 s old (the age rule of round 1
    // misfiled it one arrival late), but the newest only turns stale after the 7th.
    for (let i = 0; i < 7; i++) {
      await flush(8 * SEC);
      typeBib(String(i + 1));
      submitBib();
    }
    const filed = () => stored().map(m => [m.ts, m.entry_id]);
    expect(filed()).toEqual(Array.from({ length: 10 }, (_, k) => [iso(NOW0 + OFFSET + k * 3 * SEC), k < 7 ? `p${k + 1}` : null]));

    await flush(8 * SEC); // the newest mark is now 64 s old: no automatic target
    typeBib('8');
    submitBib();
    expect(screen.getByText('Toque em MARCAR primeiro, ou selecione a marcação em "Sem atleta"')).toBeInTheDocument();
    expect(filed().slice(7).map(([, e]) => e)).toEqual([null, null, null]);
    fireEvent.click(markButtonOf(unassignedRows()[0])); // picked explicitly, it takes the bib
    submitBib();
    expect(filed()[7]).toEqual([iso(NOW0 + OFFSET + 21 * SEC), 'p8']);
  });

  it('a corrected bib reaches the mark whose bib failed, even after 60 s (Ruling 53)', async () => {
    await renderMain();
    typeBib('999');
    tapMark(); // not found: the mark stays in "Sem atleta", selected for the correction
    await flush(70 * SEC);
    expect(within(unassignedRows()[0]).getByRole('button', { pressed: true })).toBeInTheDocument();
    typeBib('303');
    submitBib();
    expect(stored()).toEqual([expect.objectContaining({ ts: iso(NOW0 + OFFSET), entry_id: 'en3' })]);
  });

  it('a press that slid off MARCAR does not swallow a later screen-reader activation (Ruling 44 M2)', async () => {
    await renderMain();
    const button = screen.getByTestId('mark-button');
    fireEvent.pointerDown(button, { button: 0, pointerType: 'touch' }); // the finger slides off: no click
    expect(stored()).toHaveLength(1);
    await flush(2 * SEC);
    fireEvent.click(button, { detail: 1 }); // VoiceOver/TalkBack activation: a click without a pointerdown
    expect(stored()).toHaveLength(2);
  });

  it('a long press on MARCAR records one mark', async () => {
    await renderMain();
    const button = screen.getByTestId('mark-button');
    fireEvent.pointerDown(button, { button: 0, pointerType: 'mouse' });
    await flush(1_500);
    fireEvent.pointerUp(button, { button: 0, pointerType: 'mouse' });
    fireEvent.click(button, { detail: 1 });
    expect(stored()).toHaveLength(1);
    expect(stored()[0].ts).toBe(iso(NOW0 + OFFSET));
  });

  it('Space marks once and holding Enter does not repeat marks (Ruling 44 M2)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW0);
    await renderMain();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    screen.getByTestId('mark-button').focus();
    await user.keyboard(' ');
    expect(stored()).toHaveLength(1);
    await user.keyboard('{Enter>4/}'); // key held: 1 press + 3 auto-repeats
    expect(stored()).toHaveLength(2);
  });

  it('MARCAR keeps the focus (and the phone keyboard) in the bib field (Ruling 44 M10)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW0);
    await renderMain();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const input = screen.getByTestId('bib-input');
    await user.click(input);
    await user.click(screen.getByTestId('mark-button'));
    expect(stored()).toHaveLength(1);
    expect(input).toHaveFocus();
    await user.keyboard('303');
    await user.click(screen.getByTestId('mark-button'));
    expect(stored().map(m => m.entry_id)).toEqual([null, 'en3']);
    expect(input).toHaveFocus();
  });

  it('vibrates for 50 ms when the device can', async () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
    try {
      await renderMain();
      tapMark();
      expect(vibrate).toHaveBeenCalledWith(50);
    } finally {
      delete (navigator as { vibrate?: unknown }).vibrate;
    }
  });

  it('stamps the mark at the tap even while a slow sync is in flight, and never overlaps requests', async () => {
    let release: (r: TkSyncResult) => void = () => {};
    mocks.sync.mockImplementationOnce(() => new Promise<TkSyncResult>(resolve => { release = resolve; }));
    await renderMain();
    expect(mocks.sync).toHaveBeenCalledTimes(1);

    await flush(3 * SEC);
    const tappedAt = Date.now();
    tapMark();
    expect(stored()[0].ts).toBe(iso(tappedAt + OFFSET));

    // Events that normally trigger an immediate sync must not start a second request.
    act(() => { window.dispatchEvent(new Event('online')); });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await flush(10 * SEC);
    expect(mocks.sync).toHaveBeenCalledTimes(1);
    await act(async () => {
      release({ accepted: [], rejected: [], server_now: iso(Date.now()), version: 1, marks: [], waves: [] });
    });
    await flush(2 * SEC);
    expect(mocks.sync).toHaveBeenCalledTimes(2);
    expect(mocks.sync.mock.calls[1][3]).toEqual([expect.objectContaining({ ts: iso(tappedAt + OFFSET), entry_id: null })]);
  });

  it('discards a mark with ×, and Desfazer restores it', async () => {
    await renderMain();
    tapMark();
    fireEvent.click(within(unassignedRows()[0]).getByRole('button', { name: /Descartar/ }));
    expect(unassignedRows()).toHaveLength(0);
    expect(stored()[0].discarded).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }));
    expect(unassignedRows()).toHaveLength(1);
    expect(stored()[0].discarded).toBe(false);
  });

  it('changes the leg from the assignment toast', async () => {
    await renderMain();
    typeBib('101');
    tapMark();
    fireEvent.click(screen.getByRole('button', { name: 'Trocar perna' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Perna 2\/2 · Corrida/ }));
    expect(stored()[0]).toMatchObject({ entry_id: 'en1', leg_index: 1, athlete_id: 'a1' });
    expect(screen.getByTestId('assign-toast')).toHaveTextContent('✓ Nº 101 · Matheus · fim da perna 2/2 (Corrida)');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('"Em prova" list', () => {
  const handoffAt = NOW0 + OFFSET - 5 * SEC; // another timekeeper marked the relay handoff 5 s ago
  const otherMark = () => makeMark({ id: 'other', at: handoffAt, timekeeper_id: 'tk2', entry_id: 'en2', leg_index: 0, athlete_id: 'a2' });

  it('lists entries on course with the current athlete, leg and leg timer', async () => {
    await renderMain();
    expect(onCourseRows()).toHaveLength(3);
    const row = rowFor('101');
    expect(row).toHaveTextContent('Matheus');
    expect(row).toHaveTextContent('Perna 1/2 · Natação');
    expect(row).toHaveTextContent(formatDuration(NOW0 + OFFSET - T0));
  });

  it('an arrival tap without a selected mark marks now and assigns it', async () => {
    await renderMain();
    await flush(4 * SEC);
    const tappedAt = Date.now();
    fireEvent.click(within(rowFor('303')).getByRole('button'));
    expect(stored()).toEqual([expect.objectContaining({ ts: iso(tappedAt + OFFSET), entry_id: 'en3', leg_index: 0 })]);
    expect(screen.getByTestId('assign-toast')).toHaveTextContent('✓ Nº 303 · Caio · fim da perna 1/2 (Natação)');
  });

  it('a tap assigns the selected mark instead of creating a new one', async () => {
    await renderMain();
    tapMark();
    await flush(6 * SEC);
    fireEvent.click(within(rowFor('101')).getByRole('button'));
    expect(stored()).toEqual([expect.objectContaining({ ts: iso(NOW0 + OFFSET), entry_id: 'en1', leg_index: 0 })]);
  });

  it('an arrival tap marks now instead of using a mark left without athlete for 2 min', async () => {
    await renderMain();
    tapMark();
    await flush(2 * MIN);
    const tappedAt = Date.now();
    fireEvent.click(within(rowFor('303')).getByRole('button'));
    expect(stored().map(m => [m.ts, m.entry_id])).toEqual([
      [iso(NOW0 + OFFSET), null],
      [iso(tappedAt + OFFSET), 'en3'],
    ]);
  });

  it('an arrival tap is stamped when the finger lands and recorded when it lifts (Ruling 44 M1)', async () => {
    await renderMain();
    const pressedAt = Date.now();
    const target = within(rowFor('303')).getByRole('button');
    fireEvent.pointerDown(target, { pointerId: 1, pointerType: 'touch', clientX: 50, clientY: 300 });
    await flush(120);
    expect(stored()).toEqual([]);
    fireEvent.pointerUp(target, { pointerId: 1, pointerType: 'touch', clientX: 53, clientY: 304 });
    fireEvent.click(target, { detail: 1 }); // the click of the same press
    expect(stored()).toEqual([expect.objectContaining({ ts: iso(pressedAt + OFFSET), entry_id: 'en3', leg_index: 0 })]);
    expect(screen.getByTestId('assign-toast')).toHaveTextContent('Nº 303');
  });

  it('a row that moves under the finger still gets the tap it was pressed for (Ruling 44 M1)', async () => {
    await renderMain();
    await flush(1_900); // the next sync lands in the middle of the press
    mocks.sync.mockImplementationOnce(okSync({ marks: [otherMark()] }));
    const bibsInOrder = () => onCourseRows().map(r => ['101', '202', '303'].find(b => r.textContent?.includes(`Nº ${b}`)));
    expect(bibsInOrder()).toEqual(['101', '202', '303']);
    const pressedAt = Date.now();
    fireEvent.pointerDown(within(rowFor('202')).getByRole('button'), { pointerId: 4, pointerType: 'touch', clientX: 80, clientY: 400 });
    await flush(200);
    expect(bibsInOrder()).toEqual(['202', '101', '303']); // pinned on top: 101 is now under the finger
    const underFinger = within(onCourseRows()[1]).getByRole('button');
    fireEvent.pointerUp(underFinger, { pointerId: 4, pointerType: 'touch', clientX: 81, clientY: 402 });
    fireEvent.click(screen.getByTestId('oncourse-list'), { detail: 1 }); // down and up on different rows
    expect(stored()).toEqual([expect.objectContaining({ ts: iso(pressedAt + OFFSET), entry_id: 'en2', leg_index: 0 })]);
  });

  it('a press that turns into a scroll or is cancelled records nothing', async () => {
    await renderMain();
    const target = within(rowFor('303')).getByRole('button');
    fireEvent.pointerDown(target, { pointerId: 2, pointerType: 'mouse', button: 0, clientX: 50, clientY: 300 });
    fireEvent.pointerUp(target, { pointerId: 2, pointerType: 'mouse', button: 0, clientX: 50, clientY: 360 });
    fireEvent.click(target, { detail: 1 });
    fireEvent.pointerDown(target, { pointerId: 3, pointerType: 'touch', clientX: 50, clientY: 300 });
    fireEvent.pointerCancel(target, { pointerId: 3, pointerType: 'touch' });
    expect(stored()).toEqual([]);
  });

  it('an "Em prova" tap keeps the focus (and the phone keyboard) in the bib field (Ruling 53)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW0);
    await renderMain();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const input = screen.getByTestId('bib-input');
    await user.click(input);
    await user.click(within(rowFor('303')).getByRole('button'));
    expect(stored()).toEqual([expect.objectContaining({ entry_id: 'en3', leg_index: 0 })]);
    expect(input).toHaveFocus();
  });

  it('a crossing this device already marked says so instead of inviting a confirmation (Ruling 44 M8)', async () => {
    await renderMain();
    fireEvent.click(within(rowFor('303')).getByRole('button'));
    const top = onCourseRows()[0];
    expect(top).toHaveTextContent('Nº 303');
    expect(top).toHaveTextContent('✓ marcada por você');
    expect(top).not.toHaveTextContent('toque para confirmar');
  });

  it('pins a fresh relay handoff on top to confirm, on the same leg (Rulings 22 and 10)', async () => {
    mocks.sync.mockImplementationOnce(okSync({ marks: [otherMark()] }));
    await renderMain();
    const top = onCourseRows()[0];
    expect(top).toHaveTextContent('Nº 202');
    expect(top).toHaveTextContent(`✓ Natação ${formatDuration(handoffAt - T0)} — toque para confirmar (25s)`);
    expect(top).toHaveTextContent('Beto'); // who is running now
    expect(top).toHaveTextContent('Perna 2/2 · Corrida');

    await flush(10 * SEC);
    expect(onCourseRows()[0]).toHaveTextContent('toque para confirmar (15s)');

    // Confirming 15 s after the handoff: no mark selected → a new mark now, filed on the handoff
    // leg (same crossing) even though the row shows Beto running leg 2.
    const tappedAt = Date.now();
    fireEvent.click(within(onCourseRows()[0]).getByRole('button'));
    expect(stored()).toEqual([expect.objectContaining({ ts: iso(tappedAt + OFFSET), entry_id: 'en2', leg_index: 0, athlete_id: 'a2' })]);
    expect(screen.getByTestId('assign-toast')).toHaveTextContent('✓ Nº 202 · Ana · fim da perna 1/2 (Natação)');

    // Still pinned, but it no longer invites this device to confirm its own crossing (Ruling 44 M8).
    expect(onCourseRows()[0]).toHaveTextContent('✓ marcada por você · Natação');
    expect(onCourseRows()[0]).not.toHaveTextContent('toque para confirmar');
    // The median is now 7.5 s after the first mark: the window closes 37.5 s after it.
    await flush(22 * SEC);
    expect(onCourseRows()[0]).toHaveTextContent('✓ marcada por você');
    await flush(1 * SEC);
    expect(screen.getByTestId('oncourse-list')).not.toHaveTextContent('marcada por você');
  });

  it('keeps a finished entry listed until its finish can no longer be confirmed', async () => {
    const finishAt = NOW0 + OFFSET - 2 * SEC;
    mocks.sync.mockImplementationOnce(okSync({
      marks: [
        makeMark({ id: 'f0', at: T0 + 5 * MIN, timekeeper_id: 'tk2', entry_id: 'en1', leg_index: 0 }),
        makeMark({ id: 'f1', at: finishAt, timekeeper_id: 'tk2', entry_id: 'en1', leg_index: 1 }),
      ],
    }));
    await renderMain();
    expect(onCourseRows()[0]).toHaveTextContent('Nº 101');
    expect(onCourseRows()[0]).toHaveTextContent('✓ Corrida');
    await flush(29 * SEC);
    expect(rowFor('101')).toBeUndefined();
  });

  it('filters by bib/name and by race', async () => {
    await renderMain();
    fireEvent.change(screen.getByRole('searchbox', { name: /Buscar/ }), { target: { value: 'caio' } });
    expect(onCourseRows().map(r => r.textContent)).toEqual([expect.stringContaining('Nº 303')]);
    fireEvent.change(screen.getByRole('searchbox', { name: /Buscar/ }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Revezamento' }));
    expect(onCourseRows().map(r => r.textContent)).toEqual([expect.stringContaining('Nº 202')]);
  });
});

describe('sync loop', () => {
  it('sends pending marks every 2 s and reports "tudo sincronizado"', async () => {
    await renderMain();
    expect(status()).toHaveTextContent('Online · tudo sincronizado');
    const firstServerNow = iso(NOW0 + OFFSET);
    expect(mocks.sync).toHaveBeenLastCalledWith(TOKEN, 'tk-me', 's3cret', [], null);

    tapMark();
    expect(status()).toHaveTextContent('Sincronizando 1…');
    await flush(2 * SEC);
    expect(mocks.sync).toHaveBeenCalledTimes(2);
    expect(mocks.sync.mock.calls[1][3]).toEqual([expect.objectContaining({ ts: iso(NOW0 + OFFSET) })]);
    expect(mocks.sync.mock.calls[1][4]).toBe(iso(Date.parse(firstServerNow) - 10 * SEC));
    expect(status()).toHaveTextContent('Online · tudo sincronizado');
    expect(storedItems()[0].state).toBe('synced');
  });

  it('sends at most 200 pending marks per request, oldest first', async () => {
    const items: Record<string, StoredItem> = {};
    for (let i = 0; i < 205; i++) {
      const id = `m${String(i).padStart(3, '0')}`;
      const ts = iso(T0 + i * SEC);
      items[id] = {
        state: 'pending',
        mark: { id, ts, device_ts: ts, clock_offset_ms: 0, clock_rtt_ms: 80, entry_id: null, leg_index: null, athlete_id: null, discarded: false, local_updated_at: T0 },
      };
    }
    window.localStorage.setItem(OUTBOX_KEY, JSON.stringify({ items }));
    await renderMain();
    expect(mocks.sync.mock.calls[0][3]).toHaveLength(200);
    expect(mocks.sync.mock.calls[0][3][0]).toEqual({
      id: 'm000', ts: iso(T0), device_ts: iso(T0), clock_offset_ms: 0, clock_rtt_ms: 80,
      entry_id: null, leg_index: null, athlete_id: null, discarded: false,
    });
    await flush(2 * SEC);
    expect(mocks.sync.mock.calls[1][3].map(m => m.id)).toEqual(['m200', 'm201', 'm202', 'm203', 'm204']);
    expect(status()).toHaveTextContent('Online · tudo sincronizado');
  });

  it('shows "Sem internet" and backs off ×2 up to 10 s on network errors, then recovers', async () => {
    mocks.sync.mockRejectedValue(networkError());
    await renderMain();
    expect(status()).toHaveTextContent('Sem internet');
    expect(mocks.sync).toHaveBeenCalledTimes(1);
    await flush(4 * SEC - 1);
    expect(mocks.sync).toHaveBeenCalledTimes(1);
    await flush(1);
    expect(mocks.sync).toHaveBeenCalledTimes(2);
    await flush(8 * SEC);
    expect(mocks.sync).toHaveBeenCalledTimes(3);
    await flush(10 * SEC);
    expect(mocks.sync).toHaveBeenCalledTimes(4);

    mocks.sync.mockImplementation(okSync());
    await flush(10 * SEC);
    expect(mocks.sync).toHaveBeenCalledTimes(5);
    expect(status()).toHaveTextContent('Online · tudo sincronizado');
    await flush(2 * SEC);
    expect(mocks.sync).toHaveBeenCalledTimes(6);
  });

  it('goes offline at once on the browser "offline" event and retries on "online"', async () => {
    await renderMain();
    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(status()).toHaveTextContent('Sem internet');
    act(() => { window.dispatchEvent(new Event('online')); });
    await flush();
    expect(mocks.sync).toHaveBeenCalledTimes(2);
    expect(status()).toHaveTextContent('Online · tudo sincronizado');
  });

  it('shows a mark the organization changed as rejected, with the server copy winning (Ruling 27)', async () => {
    await renderMain();
    typeBib('101');
    tapMark();
    const id = stored()[0].id;
    const moved: MarkRow = {
      ...makeMark({ id, at: NOW0 + OFFSET, timekeeper_id: 'tk-me', entry_id: 'en3', leg_index: 1, athlete_id: 'a4' }),
      updated_at: iso(NOW0 + 20 * SEC),
    };
    mocks.sync.mockImplementationOnce(okSync({ accepted: [], rejected: [{ id, reason: 'Alterada pela organização' }], marks: [moved] }));
    await flush(2 * SEC);

    const mine = within(screen.getByTestId('my-marks')).getAllByRole('listitem');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toHaveTextContent('⚠');
    expect(mine[0]).toHaveTextContent('Alterada pela organização');
    expect(mine[0]).toHaveTextContent('Nº 303');
    expect(status()).toHaveTextContent('Online · tudo sincronizado');
  });

  it.each([
    ['accepted', (id: string) => ({ accepted: [id], rejected: [] })],
    ['rejected', (id: string) => ({ accepted: [], rejected: [{ id, reason: 'Alterada pela organização' }] })],
  ])('an edit made while its mark is in flight stays pending when the old version is %s (Ruling 44 M3)', async (_label, answerFor) => {
    await renderMain();
    tapMark();
    const id = stored()[0].id;
    let answer: (r: TkSyncResult) => void = () => {};
    mocks.sync.mockImplementationOnce(() => new Promise<TkSyncResult>(resolve => { answer = resolve; }));
    await flush(2 * SEC);
    expect(mocks.sync.mock.calls[1][3]).toEqual([expect.objectContaining({ id, entry_id: null })]);

    typeBib('101');
    submitBib(); // identified while the unassigned version is on its way
    await act(async () => {
      answer({ ...answerFor(id), server_now: iso(Date.now() + OFFSET), version: 1, marks: [], waves: [] });
    });
    expect(storedItems()[0]).toMatchObject({ state: 'pending', mark: { entry_id: 'en1' } });
    const row = within(screen.getByTestId('my-marks')).getByRole('listitem');
    expect(row).toHaveTextContent('⏳');
    expect(row).not.toHaveTextContent('Alterada');

    await flush(2 * SEC);
    expect(mocks.sync.mock.calls[2][3]).toEqual([expect.objectContaining({ id, entry_id: 'en1' })]);
    expect(within(screen.getByTestId('my-marks')).getByRole('listitem')).toHaveTextContent('✓');
  });

  it('warns in the header when the marks cannot be kept on the device (Ruling 44 M5)', async () => {
    await renderMain();
    expect(screen.queryByText(/Não foi possível guardar as marcações/)).not.toBeInTheDocument();
    const setItem = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === OUTBOX_KEY) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      setItem.call(this, key, value);
    });
    try {
      tapMark();
      expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível guardar as marcações neste aparelho');
      expect(unassignedRows()).toHaveLength(1); // marking goes on, in memory
    } finally {
      spy.mockRestore();
      safeLocalStorage().removeItem(OUTBOX_KEY); // leave the in-memory fallback for the next tests
    }
  });

  it('the invalid-link screen says the marks stay on the device (Ruling 44 M6)', async () => {
    await renderMain();
    tapMark();
    mocks.sync.mockRejectedValueOnce(new ApiError('Link de cronometragem inválido ou desativado', 'P0001'));
    await flush(2 * SEC);
    expect(screen.getByText('Link de cronometragem inválido ou desativado. Peça um novo link à organização.')).toBeInTheDocument();
    expect(screen.getByText(/Suas marcações continuam guardadas neste aparelho/)).toBeInTheDocument();
    expect(stored()).toHaveLength(1);
  });

  it('offers Reatribuir on a rejected mark whose entry is gone (Ruling 44 M7)', async () => {
    const ts = iso(NOW0 - 5 * MIN);
    const lost = { id: 'lost', ts, device_ts: ts, clock_offset_ms: 0, clock_rtt_ms: 80, entry_id: 'gone', leg_index: 0, athlete_id: null, discarded: false, local_updated_at: NOW0 - 5 * MIN };
    window.localStorage.setItem(OUTBOX_KEY, JSON.stringify({ items: { lost: { mark: lost, state: 'pending' } } }));
    mocks.sync.mockImplementationOnce(okSync({ accepted: [], rejected: [{ id: 'lost', reason: 'Inscrição não encontrada' }] }));
    await renderMain();
    const row = within(screen.getByTestId('my-marks')).getByRole('listitem');
    expect(row).toHaveTextContent('Inscrição não encontrada');
    expect(unassignedRows()).toHaveLength(0);

    fireEvent.click(within(row).getByRole('button', { name: /Reatribuir/ }));
    expect(unassignedRows()).toHaveLength(1);
    expect(within(unassignedRows()[0]).getByRole('button', { pressed: true })).toBeInTheDocument();
    typeBib('303');
    submitBib();
    expect(storedItems()[0]).toMatchObject({ state: 'pending', mark: { id: 'lost', entry_id: 'en3', leg_index: 0 } });
  });

  it('keeps marks the server neither accepted nor rejected pending and re-sends them (Ruling 28)', async () => {
    await renderMain();
    tapMark();
    const id = stored()[0].id;
    mocks.sync.mockImplementationOnce(okSync({ accepted: [] }));
    await flush(2 * SEC);
    expect(status()).toHaveTextContent('Sincronizando 1…');
    expect(within(screen.getByTestId('my-marks')).getByRole('listitem')).toHaveTextContent('⏳');
    await flush(2 * SEC);
    expect(mocks.sync.mock.calls[2][3]).toEqual([expect.objectContaining({ id })]);
    expect(within(screen.getByTestId('my-marks')).getByRole('listitem')).toHaveTextContent('✓');
  });

  it('pauses while the page is hidden and resumes as soon as it is visible', async () => {
    await renderMain();
    visibility = 'hidden';
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await flush(20 * SEC);
    expect(mocks.sync).toHaveBeenCalledTimes(1);
    visibility = 'visible';
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await flush();
    expect(mocks.sync).toHaveBeenCalledTimes(2);
  });

  it('re-opens the session when the event version changes and applies wave starts', async () => {
    const waiting = session({ waves: [makeWave({ id: 'w1', race_id: 'r1' }), makeWave({ id: 'w2', race_id: 'r2', start_at: null })] });
    mocks.open.mockResolvedValue(waiting);
    await renderMain();
    expect(rowFor('202')).toBeUndefined();

    mocks.sync.mockImplementationOnce(okSync({ waves: [{ id: 'w1', start_at: iso(T0) }, { id: 'w2', start_at: iso(T0) }] }));
    await flush(2 * SEC);
    expect(rowFor('202')).toBeDefined();
    expect(mocks.open).toHaveBeenCalledTimes(1);

    const extra = entry('en4', '404', 'r1', null, [['a5', 'Duda', [0, 1]]]);
    mocks.open.mockResolvedValue(session({ version: 2, entries: [...ENTRIES, extra] }));
    mocks.sync.mockImplementation(okSync({ version: 2 }));
    await flush(2 * SEC);
    expect(mocks.open).toHaveBeenCalledTimes(2);
    expect(rowFor('404')).toBeDefined();
    expect(JSON.parse(window.localStorage.getItem(SESSION_KEY)!).version).toBe(2);
  });

  it('shows the disabled message when the organization turned this timekeeper off', async () => {
    mocks.sync.mockRejectedValue(new ApiError('Seu acesso foi desativado pela organização', 'P0001'));
    window.localStorage.setItem(REG_KEY, JSON.stringify(REG));
    renderPage();
    await flush();
    expect(screen.getByText('Seu acesso foi desativado pela organização.')).toBeInTheDocument();
    expect(screen.queryByTestId('mark-button')).not.toBeInTheDocument();
  });

  it('drops an unknown registration, and the new one sends the marks still pending', async () => {
    await renderMain();
    tapMark();
    const id = stored()[0].id;
    mocks.sync.mockRejectedValueOnce(new ApiError('Cronometrista não autorizado', 'P0001'));
    await flush(2 * SEC);
    expect(screen.getByTestId('tk-register')).toBeInTheDocument();
    expect(window.localStorage.getItem(REG_KEY)).toBeNull();

    mocks.register.mockResolvedValueOnce({ timekeeper_id: 'tk-new', secret: 'n3w' });
    fireEvent.change(screen.getByTestId('tk-name'), { target: { value: 'Ana TK' } });
    fireEvent.click(screen.getByTestId('tk-register'));
    await flush();
    const last = mocks.sync.mock.calls.at(-1)!;
    expect(last[1]).toBe('tk-new');
    expect(last[3]).toEqual([expect.objectContaining({ id, ts: iso(NOW0 + OFFSET) })]);
    expect(unassignedRows()).toHaveLength(1);
  });
});

describe('one active tab per link and device (Ruling 45)', () => {
  it('holds the Web Lock while open and lets it go when closed', async () => {
    const locks = installLocks();
    const { unmount } = await renderMain();
    expect(locks.request).toHaveBeenCalledWith('ebc.tk.e1', { ifAvailable: true }, expect.any(Function));
    expect(locks.held.has('ebc.tk.e1')).toBe(true);
    unmount();
    await flush();
    expect(locks.held.has('ebc.tk.e1')).toBe(false);
  });

  it('does not mark in a second tab, and takes over with what the first one saved when it closes', async () => {
    const locks = installLocks();
    const closeOther = locks.otherTab('ebc.tk.e1');
    window.localStorage.setItem(REG_KEY, JSON.stringify(REG));
    renderPage();
    await flush();
    expect(screen.getByText('Este link já está aberto em outra aba deste aparelho — use aquela aba')).toBeInTheDocument();
    expect(screen.queryByTestId('mark-button')).not.toBeInTheDocument();
    await flush(10 * SEC);
    expect(mocks.sync).not.toHaveBeenCalled();

    // The other tab marked meanwhile, then was closed.
    const ts = iso(NOW0 + OFFSET + 3 * SEC);
    const theirs = { id: 'theirs', ts, device_ts: ts, clock_offset_ms: OFFSET, clock_rtt_ms: 100, entry_id: null, leg_index: null, athlete_id: null, discarded: false, local_updated_at: NOW0 + 3 * SEC };
    window.localStorage.setItem(OUTBOX_KEY, JSON.stringify({ items: { theirs: { mark: theirs, state: 'pending' } } }));
    closeOther();
    await flush();
    expect(screen.getByTestId('mark-button')).toBeInTheDocument();
    expect(unassignedRows()).toHaveLength(1);
    expect(mocks.sync.mock.calls[0][3]).toEqual([expect.objectContaining({ id: 'theirs' })]);
  });
});

describe('clock and screen', () => {
  it('shows the synced Brasília time with tenths and its uncertainty', async () => {
    await renderMain();
    expect(screen.getByTestId('tk-clock')).toHaveTextContent(at(NOW0 + OFFSET));
    await flush(300);
    expect(screen.getByTestId('tk-clock')).toHaveTextContent(at(NOW0 + OFFSET + 300));
    expect(screen.getByText(/±0,05 s/)).toBeInTheDocument();
  });

  it('warns when the clock never synced', async () => {
    mocks.clock.current = new ClockSync({ now: () => Date.now() });
    await renderMain();
    expect(screen.getByText('Relógio não sincronizado')).toBeInTheDocument();
    expect(screen.getByTestId('tk-clock')).toHaveTextContent(at(NOW0));
  });

  it('keeps the screen awake and ignores wake-lock failures', async () => {
    const request = vi.fn().mockResolvedValue({ release: vi.fn().mockResolvedValue(undefined) });
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
    try {
      await renderMain();
      expect(request).toHaveBeenCalledWith('screen');
      request.mockRejectedValueOnce(new Error('NotAllowedError'));
      visibility = 'visible';
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      await flush();
      expect(request).toHaveBeenCalledTimes(2);
    } finally {
      delete (navigator as { wakeLock?: unknown }).wakeLock;
    }
  });

  it('opens in the light theme unless a theme was chosen on this device (Ruling 21)', async () => {
    await renderMain();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('keeps a theme saved on this device', async () => {
    window.localStorage.setItem('ebc.theme', 'dark');
    document.documentElement.dataset.theme = 'dark';
    await renderMain();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('index.html theme bootstrap (Ruling 21)', () => {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1];
  const boot = (hash: string, saved: string | null) => {
    window.location.hash = hash;
    if (saved) window.localStorage.setItem('ebc.theme', saved);
    delete document.documentElement.dataset.theme;
    new Function(script)();
    return document.documentElement.dataset.theme;
  };
  afterEach(() => {
    window.location.hash = '';
  });

  it('uses light on the timekeeper link and dark elsewhere when nothing is saved', () => {
    expect(boot('#/c/abc', null)).toBe('light');
    expect(boot('#/eventos', null)).toBe('dark');
    expect(boot('', null)).toBe('dark');
  });

  it('always honors a saved choice', () => {
    expect(boot('#/c/abc', 'dark')).toBe('dark');
    window.localStorage.clear();
    expect(boot('#/eventos', 'light')).toBe('light');
  });
});
