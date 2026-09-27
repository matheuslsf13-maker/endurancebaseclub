import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '../../test/renderWithProviders';
import type { EventAggregate } from '../../lib/types';
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
    expect(screen.getByText('A marcação escolhida foi descartada — escolha outra decisão.')).toBeInTheDocument();
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
