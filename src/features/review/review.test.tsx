import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import { renderWithProviders } from '../../test/renderWithProviders';
import { formatClock } from '../../lib/format';
import type { EventAggregate, ResultRow } from '../../lib/types';
import { computeEventTiming } from '../../domain/consolidation';
import { indexEvent } from '../../domain/eventModel';
import { classifyRace } from '../../domain/ranking';
import { buildFinalizeRows } from '../../domain/snapshot';
import {
  iso, makeAthlete, makeEntry, makeEvent, makeMark, makeRace, makeResolution, makeTimekeeper, makeWave,
  MIN, SEC, T0,
} from '../../domain/testing/fixtures';
import { EventProvider } from '../events/EventContext';
import ReviewTab from './ReviewTab';

const L0 = T0 + 10 * MIN;

const mocks = vi.hoisted(() => ({
  serverTime: vi.fn<() => Promise<number>>(),
  updateMark: vi.fn(),
  setResolution: vi.fn(),
  clearResolution: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  ApiError: class ApiError extends Error {
    code: string | null = null;
  },
  api: {
    serverTime: mocks.serverTime,
    admin: {
      updateMark: mocks.updateMark,
      setResolution: mocks.setResolution,
      clearResolution: mocks.clearResolution,
    },
  },
}));

function makeAgg(p: Partial<EventAggregate> = {}): EventAggregate {
  return {
    event: makeEvent(), races: [makeRace()], waves: [makeWave()], entries: [makeEntry()],
    athletes: [makeAthlete()], timekeepers: [makeTimekeeper({ id: 'tk1', name: 'Ana' }), makeTimekeeper({ id: 'tk2', name: 'Bia' })],
    marks: [], resolutions: [], results: [], version: 1, server_now: iso(T0), ...p,
  };
}

/** Renders the tab over an aggregate the test can replace later (a poll bringing new data). */
function renderReviewLive(initial: EventAggregate) {
  let setAgg: (a: EventAggregate) => void = () => {};
  function Harness() {
    const [agg, set] = useState(initial);
    setAgg = set;
    return (
      <EventProvider eventId="e1" agg={agg} refresh={vi.fn(async () => {})} patchAgg={vi.fn()}>
        <ReviewTab />
      </EventProvider>
    );
  }
  const utils = renderWithProviders(<Harness />);
  return { ...utils, update: (a: EventAggregate) => act(() => setAgg(a)) };
}

/** The stored results `admin_finalize_race` would keep for `agg`'s race r1 right now. */
function snapshotOf(agg: EventAggregate, nowMs = Date.now()): ResultRow[] {
  const index = indexEvent(agg);
  const timing = computeEventTiming(agg, nowMs);
  const race = agg.races[0];
  const cls = classifyRace(race, index.entriesByRace.get(race.id) ?? [], timing.byEntry, index.athletesById, agg.event);
  return buildFinalizeRows(agg.event, cls, index.athletesById).map((r) => ({
    ...r, race_id: race.id, event_id: agg.event.id, finalized_at: iso(nowMs),
  }));
}

function renderReview(agg: EventAggregate) {
  const refresh = vi.fn(async () => {});
  const patchAgg = vi.fn();
  return renderWithProviders(
    <EventProvider eventId="e1" agg={agg} refresh={refresh} patchAgg={patchAgg}>
      <ReviewTab />
    </EventProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.serverTime.mockResolvedValue(Date.now());
  mocks.updateMark.mockResolvedValue({});
  mocks.setResolution.mockResolvedValue({});
  mocks.clearResolution.mockResolvedValue(undefined);
});

describe('ReviewTab: issues list', () => {
  it('shows the divergence message', () => {
    const marks = [
      makeMark({ at: L0, timekeeper_id: 'tk1' }),
      makeMark({ at: L0 + 14 * SEC, timekeeper_id: 'tk2' }),
      makeMark({ at: T0 + 30 * MIN, leg_index: 1 }),
    ];
    renderReview(makeAgg({ marks }));
    expect(screen.getByTestId('issues-list')).toHaveTextContent('divergência de 14,0 s');
  });

  it('groups issues by severity and keeps Info collapsed by default', async () => {
    const user = userEvent.setup();
    // Same timekeeper marks the leg twice: a 'duplicate' (info) issue, plus the finish so the entry is 'finished'.
    const marks = [makeMark({ at: L0 }), makeMark({ at: L0 + 200 }), makeMark({ at: T0 + 30 * MIN, leg_index: 1 })];
    renderReview(makeAgg({ marks }));

    expect(screen.getByText('Avisos (0)')).toBeInTheDocument();
    expect(screen.getByText('Info (1)')).toBeInTheDocument();
    expect(screen.queryByText(/marcou mais de uma vez/)).not.toBeInTheDocument();

    await user.click(screen.getByText('Info (1)'));
    expect(screen.getByText(/marcou mais de uma vez/)).toBeInTheDocument();
  });

  it('filters the issues by type', async () => {
    const user = userEvent.setup();
    const marks = [
      makeMark({ at: L0, timekeeper_id: 'tk1' }),
      makeMark({ at: L0 + 14 * SEC, timekeeper_id: 'tk2' }),
      makeMark({ at: L0 + 200, timekeeper_id: 'tk1' }),
      makeMark({ at: T0 + 30 * MIN, leg_index: 1 }),
    ];
    renderReview(makeAgg({ marks }));
    expect(screen.getByText('Avisos (1)')).toBeInTheDocument();
    expect(screen.getByText('Info (1)')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Tipo'), 'duplicate');
    expect(screen.getByText('Avisos (0)')).toBeInTheDocument();
    expect(screen.getByText('Info (1)')).toBeInTheDocument();
  });
});

describe('ReviewTab: resolving a divergence', () => {
  function divergenceAgg() {
    const a = makeMark({ at: L0, timekeeper_id: 'tk1' });
    const b = makeMark({ at: L0 + 14 * SEC, timekeeper_id: 'tk2' });
    const finish = makeMark({ at: T0 + 30 * MIN, leg_index: 1 });
    return { agg: makeAgg({ marks: [a, b, finish] }), a, b };
  }

  it('choosing a candidate mark and saving calls setResolution with that mark', async () => {
    const user = userEvent.setup();
    const { agg, b } = divergenceAgg();
    renderReview(agg);

    await user.click(screen.getByRole('button', { name: 'Resolver' }));
    await user.click(screen.getByTestId(`resolution-mark-${b.id}`));
    await user.click(screen.getByTestId('resolution-save'));

    expect(mocks.setResolution).toHaveBeenCalledWith('en1', 0, 'mark', b.id, null, '');
  });

  it('shows the system (median) time by default', async () => {
    const user = userEvent.setup();
    const { agg } = divergenceAgg();
    renderReview(agg);

    await user.click(screen.getByRole('button', { name: 'Resolver' }));
    expect(screen.getByTestId('resolution-system')).toBeChecked();
    expect(screen.getByText(/08:10:07\.000/)).toBeInTheDocument();
  });

  it('typing a manual time and saving calls setResolution with the parsed instant', async () => {
    const user = userEvent.setup();
    const { agg } = divergenceAgg();
    renderReview(agg);

    await user.click(screen.getByRole('button', { name: 'Resolver' }));
    await user.type(screen.getByTestId('resolution-manual-input'), '08:10:02.5');
    await user.click(screen.getByTestId('resolution-save'));

    expect(mocks.setResolution).toHaveBeenCalledWith('en1', 0, 'manual', null, '2026-10-11T11:10:02.500Z', '');
  });

  it('removes an existing decision via "Remover decisão"', async () => {
    const user = userEvent.setup();
    const { agg, a } = divergenceAgg();
    // A resolved crossing is no longer a pending issue, so it is opened from "Todas as
    // passagens" instead of the issues list's "Resolver" button.
    agg.resolutions = [makeResolution({ entry_id: 'en1', leg_index: 0, mode: 'mark', mark_id: a.id })];
    renderReview(agg);

    await user.click(screen.getAllByTestId('crossing-row')[0]);
    await user.click(screen.getByRole('button', { name: 'Remover decisão' }));

    expect(mocks.clearResolution).toHaveBeenCalledWith('en1', 0);
  });

  it('recovers when the chosen mark has since been discarded: warns, pre-selects system, saves system', async () => {
    const user = userEvent.setup();
    const a = makeMark({ at: L0, timekeeper_id: 'tk1' });
    const b = makeMark({ at: L0 + 14 * SEC, timekeeper_id: 'tk2', discarded: true, discarded_by: 'organizer' });
    const finish = makeMark({ at: T0 + 30 * MIN, leg_index: 1 });
    const agg = makeAgg({
      marks: [a, b, finish],
      resolutions: [makeResolution({ entry_id: 'en1', leg_index: 0, mode: 'mark', mark_id: b.id })],
    });
    renderReview(agg);

    await user.click(screen.getByRole('button', { name: 'Resolver' }));
    expect(screen.getByText('A marcação escolhida foi descartada ou movida — escolha outra decisão.')).toBeInTheDocument();
    expect(screen.getByTestId('resolution-system')).toBeChecked();
    // The discarded mark is still listed, with its badge and a way back.
    expect(screen.getByText('Descartada')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restaurar' })).toBeInTheDocument();
    // No radio exists for the discarded mark (computeCrossing excludes it from `candidates`).
    expect(screen.queryByTestId(`resolution-mark-${b.id}`)).not.toBeInTheDocument();

    await user.click(screen.getByTestId('resolution-save'));
    expect(mocks.setResolution).toHaveBeenCalledWith('en1', 0, 'system', null, null, '');
  });

  it('gives the manual time input its own accessible name', async () => {
    const user = userEvent.setup();
    const { agg } = divergenceAgg();
    renderReview(agg);

    await user.click(screen.getByRole('button', { name: 'Resolver' }));
    expect(screen.getByLabelText('Hora manual')).toBe(screen.getByTestId('resolution-manual-input'));
  });

  it('discarding a candidate mark calls updateMark', async () => {
    const user = userEvent.setup();
    const { agg, a } = divergenceAgg();
    renderReview(agg);

    await user.click(screen.getByRole('button', { name: 'Resolver' }));
    await user.click(screen.getAllByRole('button', { name: 'Descartar' })[0]);

    expect(mocks.updateMark).toHaveBeenCalledWith(a.id, { discarded: true });
  });
});

describe('ReviewTab: suggested move (Review Focus 1)', () => {
  it('the suggested-move button moves the misassigned mark to the suggested leg', async () => {
    const user = userEvent.setup();
    const swim = makeMark({ at: L0, timekeeper_id: 'tk1', leg_index: 0 });
    const wrong = makeMark({ at: T0 + 30 * MIN + SEC, timekeeper_id: 'tk2', leg_index: 0 });
    const finish = makeMark({ at: T0 + 30 * MIN, timekeeper_id: 'tk1', leg_index: 1 });
    renderReview(makeAgg({ marks: [swim, wrong, finish] }));

    await user.click(screen.getByTestId('move-mark-suggested'));

    expect(mocks.updateMark).toHaveBeenCalledWith(wrong.id, { leg_index: 1 });
  });
});

describe('ReviewTab: unassigned marks', () => {
  it('assigns an unassigned mark to a typed bib', async () => {
    const user = userEvent.setup();
    const swim = makeMark({ at: L0, leg_index: 0 });
    const finish = makeMark({ at: T0 + 30 * MIN, leg_index: 1 });
    const stray = makeMark({ at: Date.now() - 5 * MIN, entry_id: null, leg_index: null });
    renderReview(makeAgg({ marks: [swim, finish, stray] }));

    expect(screen.getByText(/sem atleta/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Nº de peito'), '101');
    await user.click(screen.getByRole('button', { name: 'Atribuir' }));

    expect(mocks.updateMark).toHaveBeenCalledWith(stray.id, { entry_id: 'en1', leg_index: 0 });
  });
});

describe('ReviewTab: todas as passagens', () => {
  it('renders a crossing-row per leg and opens the editor on click', async () => {
    const user = userEvent.setup();
    const marks = [makeMark({ at: L0 }), makeMark({ at: T0 + 30 * MIN, leg_index: 1 })];
    renderReview(makeAgg({ marks }));

    const rows = screen.getAllByTestId('crossing-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Nº 101');

    await user.click(rows[0]);
    expect(screen.getByTestId('resolution-system')).toBeInTheDocument();
  });

  it('filters the list by search term', async () => {
    const user = userEvent.setup();
    renderReview(makeAgg());
    await user.type(screen.getByLabelText('Buscar'), 'nada-encontra-isso');
    expect(screen.queryAllByTestId('crossing-row')).toHaveLength(0);
  });
});

describe('ReviewTab: issue rows keep their own state (B2-I1)', () => {
  it('a bib typed in an unassigned issue stays with its mark when the list shifts', async () => {
    const user = userEvent.setup();
    const now = Date.now();
    const u1 = makeMark({ id: 'u1', at: now - 5 * MIN, entry_id: null, leg_index: null });
    const u2 = makeMark({ id: 'u2', at: now - 4 * MIN, entry_id: null, leg_index: null });
    const u3 = makeMark({ id: 'u3', at: now - 3 * MIN, entry_id: null, leg_index: null });
    const { update } = renderReviewLive(makeAgg({ marks: [u1, u2, u3] }));

    // The organizer types 101 in the row of the second mark…
    const rowAt = (at: number) =>
      within(screen.getByTestId('issues-list')).getAllByRole('listitem')
        .find((li) => li.textContent?.includes(formatClock(at, { tenths: true }))) as HTMLElement;
    await user.type(within(rowAt(now - 4 * MIN)).getByLabelText('Nº de peito'), '101');

    // …while a timekeeper identifies the first one: the next poll drops its issue.
    update(makeAgg({ marks: [{ ...u1, entry_id: 'en1', leg_index: 0 }, u2, u3] }));

    const typed = screen.getAllByLabelText('Nº de peito').filter((i) => (i as HTMLInputElement).value === '101');
    expect(typed).toHaveLength(1);
    const row = typed[0].closest('li') as HTMLElement;
    expect(row).toHaveTextContent(formatClock(now - 4 * MIN, { tenths: true }));
    await user.click(within(row).getByRole('button', { name: 'Atribuir' }));
    expect(mocks.updateMark).toHaveBeenCalledWith('u2', expect.objectContaining({ entry_id: 'en1' }));
  });
});

describe('ReviewTab: pt-BR numbers and the reference timekeeper (B2-m12, Ruling 59 entry)', () => {
  it('shows the spread with a decimal comma', () => {
    const marks = [
      makeMark({ at: L0, timekeeper_id: 'tk1' }),
      makeMark({ at: L0 + 3500, timekeeper_id: 'tk2' }),
      makeMark({ at: T0 + 30 * MIN, leg_index: 1 }),
    ];
    renderReview(makeAgg({ marks }));
    expect(screen.getAllByTestId('crossing-row')[0]).toHaveTextContent('3,5 s');
    expect(screen.getAllByTestId('crossing-row')[0]).not.toHaveTextContent('3.5 s');
  });

  it("shows each mark's distance to the median with a sign and a decimal comma", async () => {
    const user = userEvent.setup();
    const marks = [
      makeMark({ at: L0, timekeeper_id: 'tk1' }),
      makeMark({ at: L0 + 600, timekeeper_id: 'tk2' }),
      makeMark({ at: T0 + 30 * MIN, leg_index: 1 }),
    ];
    renderReview(makeAgg({ marks }));
    await user.click(screen.getAllByTestId('crossing-row')[0]);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('-0,3 s');
    expect(dialog).toHaveTextContent('+0,3 s');
  });

  it('names the configured reference timekeeper even when another one marked the same instant', () => {
    const race = makeRace({ configPatch: { time_source: 'reference', reference_timekeeper_id: 'tk2' } });
    const marks = [
      makeMark({ at: L0, timekeeper_id: 'tk1' }),
      makeMark({ at: L0, timekeeper_id: 'tk2' }),
      makeMark({ at: T0 + 30 * MIN, leg_index: 1, timekeeper_id: 'tk2' }),
    ];
    renderReview(makeAgg({ races: [race], marks }));
    expect(screen.getAllByTestId('crossing-row')[0]).toHaveTextContent('Cronometrista de referência (Bia)');
  });
});

describe('CrossingEditor: moving a mark (B2-m10) and layout (T28 minors)', () => {
  const twoEntries = () => [
    makeEntry(),
    makeEntry({ id: 'en2', bib: '102', members: [{ athlete_id: 'a2', position: 0, legs: [0, 1] }] }),
  ];
  const athletes = () => [makeAthlete(), makeAthlete({ id: 'a2', name: 'Beto Lima', sex: 'M' })];

  async function openFirstCrossing(user: ReturnType<typeof userEvent.setup>, agg: EventAggregate) {
    renderReview(agg);
    await user.click(screen.getAllByTestId('crossing-row')[0]);
    return screen.getByRole('dialog');
  }

  it('with a bib and an explicitly chosen leg, moves the mark to that leg of that bib and says where it went', async () => {
    const user = userEvent.setup();
    const m = makeMark({ id: 'mv1', at: L0 });
    const dialog = await openFirstCrossing(user, makeAgg({ entries: twoEntries(), athletes: athletes(), marks: [m] }));

    await user.selectOptions(within(dialog).getByLabelText('Mover para'), '1');
    await user.type(within(dialog).getByLabelText('Nº (opcional)'), '102');
    await user.click(within(dialog).getByRole('button', { name: 'Mover' }));

    expect(mocks.updateMark).toHaveBeenCalledWith('mv1', { entry_id: 'en2', leg_index: 1 });
    expect(await screen.findByText('Marcação movida para Nº 102 · perna 2/2 (Corrida)')).toBeInTheDocument();
  });

  it('with a bib and no leg chosen, follows the suggested leg and says where it went', async () => {
    const user = userEvent.setup();
    const m = makeMark({ id: 'mv2', at: L0 });
    const dialog = await openFirstCrossing(user, makeAgg({ entries: twoEntries(), athletes: athletes(), marks: [m] }));

    await user.type(within(dialog).getByLabelText('Nº (opcional)'), '102');
    await user.click(within(dialog).getByRole('button', { name: 'Mover' }));

    expect(mocks.updateMark).toHaveBeenCalledWith('mv2', { entry_id: 'en2', leg_index: 0 });
    expect(await screen.findByText('Marcação movida para Nº 102 · perna 1/2 (Natação)')).toBeInTheDocument();
  });

  it('without a bib, moves to the chosen leg of the same entry and says so', async () => {
    const user = userEvent.setup();
    const m = makeMark({ id: 'mv3', at: L0 });
    const dialog = await openFirstCrossing(user, makeAgg({ marks: [m] }));

    await user.selectOptions(within(dialog).getByLabelText('Mover para'), '1');
    await user.click(within(dialog).getByRole('button', { name: 'Mover' }));

    expect(mocks.updateMark).toHaveBeenCalledWith('mv3', { leg_index: 1 });
    expect(await screen.findByText('Marcação movida para Nº 101 · perna 2/2 (Corrida)')).toBeInTheDocument();
  });

  it("refuses a chosen leg the bib's race does not have", async () => {
    const user = userEvent.setup();
    const solo = makeRace({ id: 'r2', name: 'Corrida', position: 1, legs: [{ modality: 'run', label: 'Corrida', distance_m: 5000 }] });
    const m = makeMark({ id: 'mv4', at: L0 });
    const agg = makeAgg({
      races: [makeRace(), solo],
      waves: [makeWave(), makeWave({ id: 'w2', race_id: 'r2' })],
      entries: [makeEntry(), makeEntry({ id: 'en9', bib: '900', race_id: 'r2', wave_id: 'w2', members: [{ athlete_id: 'a2', position: 0, legs: [0] }] })],
      athletes: athletes(),
      marks: [m],
    });
    const dialog = await openFirstCrossing(user, agg);

    await user.selectOptions(within(dialog).getByLabelText('Mover para'), '1');
    await user.type(within(dialog).getByLabelText('Nº (opcional)'), '900');
    await user.click(within(dialog).getByRole('button', { name: 'Mover' }));

    expect(mocks.updateMark).not.toHaveBeenCalled();
    expect(await screen.findByText('A prova do Nº 900 não tem a perna 2')).toBeInTheDocument();
  });

  it('does not repeat the athlete of an individual entry in the subtitle, and is wide enough for the move controls', async () => {
    const user = userEvent.setup();
    const dialog = await openFirstCrossing(user, makeAgg({ marks: [makeMark({ at: L0 })] }));
    expect(within(dialog).queryByText('Ana Souza · Ana Souza')).not.toBeInTheDocument();
    expect(within(dialog).getByText('Ana Souza')).toBeInTheDocument();
    // The widest kit dialog, and the move controls on their own line under each mark, so the
    // "Mover para" select is reachable at 1280 px without scrolling the table sideways.
    expect(dialog.className).toContain('max-w-4xl');
    const moveSelect = within(dialog).getByLabelText('Mover para');
    const timeCell = within(dialog).getByText(formatClock(L0, { millis: true }), { selector: 'td' });
    expect(moveSelect.closest('tr')).not.toBe(timeCell.closest('tr'));
  });
});

describe('ReviewTab: finalized races (B2-I2)', () => {
  it('says how many entries changed since the race was finalized', () => {
    const swim = makeMark({ at: L0 });
    const finish = makeMark({ at: T0 + 30 * MIN, leg_index: 1 });
    const results = snapshotOf(makeAgg({ marks: [swim, finish] }));
    // A late correction: the finish moves by a minute after finalizing.
    renderReview(makeAgg({
      races: [makeRace({ finalized_at: iso(T0 + 40 * MIN) })],
      marks: [swim, { ...finish, ts: iso(T0 + 31 * MIN) }],
      results,
    }));
    expect(screen.getByText(/Há 1 alteração depois da finalização — reabra e finalize de novo para oficializá-la/)).toBeInTheDocument();
  });

  it('reminds that a finalized race only changes officially when finalized again', () => {
    const agg = makeAgg({ marks: [makeMark({ at: L0 }), makeMark({ at: T0 + 30 * MIN, leg_index: 1 })] });
    renderReview({ ...agg, races: [makeRace({ finalized_at: iso(T0 + 40 * MIN) })], results: snapshotOf(agg) });
    expect(screen.getByText(/Aquathlon está finalizada/)).toBeInTheDocument();
    expect(screen.queryByText(/depois da finalização/)).not.toBeInTheDocument();
  });
});
