import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';

import { renderWithProviders } from '../../test/renderWithProviders';
import { EventContext } from '../events/EventContext';
import type { EventContextValue } from '../events/EventContext';
import { indexEvent } from '../../domain/eventModel';
import { computeEventTiming } from '../../domain/consolidation';
import { classifyRace } from '../../domain/ranking';
import type { RaceClassification } from '../../domain/ranking';
import { workbookFileName } from '../../domain/workbook';
import { formatDuration, formatGap } from '../../lib/format';
import type { ClockSync } from '../../lib/clock';
import type { EventAggregate, RaceRow } from '../../lib/types';
import {
  iso, makeAthlete, makeEntry, makeEvent, makeMark, makeRace, makeTimekeeper, makeWave, MIN, T0,
} from '../../domain/testing/fixtures';

import ResultsTab from './ResultsTab';
import { ClassificationTable } from './ClassificationTable';
import { PodiumView } from './PodiumView';
import { exportWorkbook } from './exportWorkbook';

const mocks = vi.hoisted(() => ({
  finalizeRace: vi.fn(),
  unfinalizeRace: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  api: { admin: { finalizeRace: mocks.finalizeRace, unfinalizeRace: mocks.unfinalizeRace } },
}));

// ---------------------------------------------------------------------------
// Fixture: an individual (team_size 1) single-leg race with 3 finishers (25/26/27 min) plus one
// DNF entry — the exact context the brief's Step 1 calls for.
// ---------------------------------------------------------------------------
const NOW = T0 + 40 * MIN;

function buildIndividualRaceFixture() {
  const event = makeEvent();
  const race = makeRace({ legs: [{ modality: 'run', label: 'Corrida', distance_m: 5000 }] });
  const wave = makeWave();
  const athletes = [
    makeAthlete({ id: 'a1', name: 'Ana Souza' }),
    makeAthlete({ id: 'a2', name: 'Beto Lima', sex: 'M' }),
    makeAthlete({ id: 'a3', name: 'Carla Dias' }),
    makeAthlete({ id: 'a4', name: 'Duda Reis', sex: 'M' }),
  ];
  const entries = [
    makeEntry({ id: 'en1', bib: '101', members: [{ athlete_id: 'a1', position: 0, legs: [0] }] }),
    makeEntry({ id: 'en2', bib: '102', members: [{ athlete_id: 'a2', position: 0, legs: [0] }] }),
    makeEntry({ id: 'en3', bib: '103', members: [{ athlete_id: 'a3', position: 0, legs: [0] }] }),
    makeEntry({ id: 'en4', bib: '104', status: 'dnf', members: [{ athlete_id: 'a4', position: 0, legs: [0] }] }),
  ];
  const marks = [
    makeMark({ entry_id: 'en1', leg_index: 0, at: T0 + 25 * MIN }),
    makeMark({ entry_id: 'en2', leg_index: 0, at: T0 + 26 * MIN }),
    makeMark({ entry_id: 'en3', leg_index: 0, at: T0 + 27 * MIN }),
  ];
  const agg: EventAggregate = {
    event, races: [race], waves: [wave], entries, athletes, timekeepers: [makeTimekeeper()],
    marks, resolutions: [], results: [], version: 1, server_now: iso(NOW),
  };
  const index = indexEvent(agg);
  const timing = computeEventTiming(agg, NOW);
  const classifications = new Map([[race.id, classifyRace(race, entries, timing.byEntry, index.athletesById, event)]]);
  return { event, race, agg, index, timing, classifications };
}

type Fixture = ReturnType<typeof buildIndividualRaceFixture>;

function contextValue(fx: Fixture, overrides: Partial<EventContextValue> = {}): EventContextValue {
  return {
    eventId: fx.event.id, agg: fx.agg, index: fx.index, timing: fx.timing, classifications: fx.classifications,
    nowMs: NOW, refresh: vi.fn(async () => {}), patchAgg: vi.fn(), clock: {} as ClockSync,
    ...overrides,
  };
}

function renderResultsTab(fx: Fixture, overrides: Partial<EventContextValue> = {}) {
  const ctx = contextValue(fx, overrides);
  const utils = renderWithProviders(
    <EventContext.Provider value={ctx}>
      <ResultsTab />
    </EventContext.Provider>,
  );
  return { ...utils, ctx };
}

beforeEach(() => {
  mocks.finalizeRace.mockReset().mockResolvedValue({ finalized_at: iso(NOW), count: 4 });
  mocks.unfinalizeRace.mockReset().mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------

describe('ClassificationTable', () => {
  it('lists rows in classification order with positions, gaps, status and podium highlight', () => {
    const fx = buildIndividualRaceFixture();
    const cls = fx.classifications.get(fx.race.id) as RaceClassification;

    renderWithProviders(
      <ClassificationTable race={fx.race} cls={cls} athletesById={fx.index.athletesById} />,
    );

    const table = screen.getByTestId('classification-table');
    const rows = within(table).getAllByTestId('classification-row');
    expect(rows).toHaveLength(4);

    // 1st: Ana, no gap, podium highlight (Total and Final both read 25:00 — no penalty).
    expect(within(rows[0]).getByText('1')).toBeInTheDocument();
    expect(within(rows[0]).getByText('101')).toBeInTheDocument();
    expect(within(rows[0]).getAllByText(formatDuration(25 * MIN))).toHaveLength(2);
    expect(rows[0].className).toContain('bg-warning/10');

    // 2nd/3rd: gaps to the leader.
    expect(within(rows[1]).getByText('2')).toBeInTheDocument();
    expect(within(rows[1]).getByText(formatGap(1 * MIN))).toBeInTheDocument();
    expect(within(rows[2]).getByText('3')).toBeInTheDocument();
    expect(within(rows[2]).getByText(formatGap(2 * MIN))).toBeInTheDocument();

    // 4th: the DNF, unranked (no position), not highlighted.
    expect(within(rows[3]).getByText('104')).toBeInTheDocument();
    expect(within(rows[3]).getByText('DNF')).toBeInTheDocument();
    expect(rows[3].className).not.toContain('bg-warning/10');
  });

  it('Ruling 9: a finish with no wave start is unranked, listed first among the unranked, with a "sem largada" hint', () => {
    const race = makeRace({ id: 'rns', legs: [{ modality: 'run', label: 'Corrida', distance_m: 5000 }] });
    const wave = makeWave({ id: 'wns', race_id: 'rns', start_at: null });
    const finisher = makeEntry({ id: 'e-fin', race_id: 'rns', wave_id: 'wns', bib: '9' });
    const onCourse = makeEntry({ id: 'e-oc', race_id: 'rns', wave_id: 'wns', bib: '10', members: [{ athlete_id: 'a1', position: 0, legs: [0] }] });
    const athletes = [makeAthlete({ id: 'a1' })];
    const marks = [makeMark({ entry_id: 'e-fin', leg_index: 0, at: T0 + 20 * MIN })];
    const event = makeEvent();
    const agg: EventAggregate = {
      event, races: [race], waves: [wave], entries: [finisher, onCourse], athletes, timekeepers: [makeTimekeeper()],
      marks, resolutions: [], results: [], version: 1, server_now: iso(NOW),
    };
    const index = indexEvent(agg);
    const timing = computeEventTiming(agg, NOW);
    const cls = classifyRace(race, [finisher, onCourse], timing.byEntry, index.athletesById, event);

    // Sanity: the finisher really is the Ruling 9 case (finished, no resolvable final time).
    expect(timing.byEntry.get('e-fin')?.status).toBe('finished');
    expect(timing.byEntry.get('e-fin')?.final_ms).toBeNull();

    renderWithProviders(<ClassificationTable race={race} cls={cls} athletesById={index.athletesById} />);

    const rows = within(screen.getByTestId('classification-table')).getAllByTestId('classification-row');
    // Both unranked; the finish-with-no-start row comes first (before on_course).
    expect(within(rows[0]).getByText('9')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Concluiu (sem largada)')).toBeInTheDocument();
    expect(within(rows[1]).getByText('10')).toBeInTheDocument();
  });

  it('shows a team entry\'s members with their leg — "Nome (Perna) · Nome (Perna)"', () => {
    const race = makeRace({
      id: 'rt', team_size: 2,
      legs: [{ modality: 'swim', label: 'Natação', distance_m: 750 }, { modality: 'run', label: 'Corrida', distance_m: 5000 }],
    });
    const wave = makeWave({ id: 'wt', race_id: 'rt' });
    const athletes = [makeAthlete({ id: 'ta1', name: 'Ana' }), makeAthlete({ id: 'ta2', name: 'Beto', sex: 'M' })];
    const entry = makeEntry({
      id: 'te1', race_id: 'rt', wave_id: 'wt', bib: '1', team_name: 'Tubarões',
      members: [{ athlete_id: 'ta1', position: 0, legs: [0] }, { athlete_id: 'ta2', position: 1, legs: [1] }],
    });
    const marks = [makeMark({ entry_id: 'te1', leg_index: 0, at: T0 + 10 * MIN }), makeMark({ entry_id: 'te1', leg_index: 1, at: T0 + 40 * MIN })];
    const event = makeEvent();
    const agg: EventAggregate = {
      event, races: [race], waves: [wave], entries: [entry], athletes, timekeepers: [makeTimekeeper()],
      marks, resolutions: [], results: [], version: 1, server_now: iso(NOW),
    };
    const index = indexEvent(agg);
    const timing = computeEventTiming(agg, NOW);
    const cls = classifyRace(race, [entry], timing.byEntry, index.athletesById, event);

    renderWithProviders(<ClassificationTable race={race} cls={cls} athletesById={index.athletesById} />);

    expect(screen.getByText('Ana (Natação) · Beto (Corrida)')).toBeInTheDocument();
  });

  it('shows a "Perna k (label)" column with the split time for each leg when showLegs is true', () => {
    const race = makeRace({
      id: 'rt2', team_size: 2,
      legs: [{ modality: 'swim', label: 'Natação', distance_m: 750 }, { modality: 'run', label: 'Corrida', distance_m: 5000 }],
    });
    const wave = makeWave({ id: 'wt2', race_id: 'rt2' });
    const athletes = [makeAthlete({ id: 'ta1', name: 'Ana' }), makeAthlete({ id: 'ta2', name: 'Beto', sex: 'M' })];
    const entry = makeEntry({
      id: 'te2', race_id: 'rt2', wave_id: 'wt2', bib: '1',
      members: [{ athlete_id: 'ta1', position: 0, legs: [0] }, { athlete_id: 'ta2', position: 1, legs: [1] }],
    });
    // leg 0: T0 -> T0+10min (10:00 split); leg 1: T0+10min -> T0+40min (30:00 split).
    const marks = [makeMark({ entry_id: 'te2', leg_index: 0, at: T0 + 10 * MIN }), makeMark({ entry_id: 'te2', leg_index: 1, at: T0 + 40 * MIN })];
    const event = makeEvent();
    const agg: EventAggregate = {
      event, races: [race], waves: [wave], entries: [entry], athletes, timekeepers: [makeTimekeeper()],
      marks, resolutions: [], results: [], version: 1, server_now: iso(NOW),
    };
    const index = indexEvent(agg);
    const timing = computeEventTiming(agg, NOW);
    const cls = classifyRace(race, [entry], timing.byEntry, index.athletesById, event);

    renderWithProviders(<ClassificationTable race={race} cls={cls} athletesById={index.athletesById} showLegs />);

    expect(screen.getByText('Perna 1 (Natação)')).toBeInTheDocument();
    expect(screen.getByText('Perna 2 (Corrida)')).toBeInTheDocument();
    expect(screen.getByText(formatDuration(10 * MIN))).toBeInTheDocument();
    expect(screen.getByText(formatDuration(30 * MIN))).toBeInTheDocument();
  });
});

describe('PodiumView', () => {
  it('renders group cards with 1º/2º/3º name, bib and time', () => {
    const fx = buildIndividualRaceFixture();
    const cls = fx.classifications.get(fx.race.id) as RaceClassification;

    renderWithProviders(<PodiumView cls={cls} athletesById={fx.index.athletesById} />);

    const podiums = screen.getByTestId('podiums');
    expect(within(podiums).getAllByText('1º').length).toBeGreaterThan(0);
    expect(within(podiums).getAllByText('Ana Souza').length).toBeGreaterThan(0);
    expect(within(podiums).getAllByText('Nº 101').length).toBeGreaterThan(0);
    expect(within(podiums).getAllByText(formatDuration(25 * MIN)).length).toBeGreaterThan(0);
  });
});

describe('exportWorkbook', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let capturedDownload: string | undefined;

  beforeEach(() => {
    capturedDownload = undefined;
    createObjectURL = vi.fn(() => 'blob:mock-url');
    revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      capturedDownload = this.download;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('downloads a Blob with the XLSX MIME type, the exact filename, and revokes the URL afterwards', () => {
    const fx = buildIndividualRaceFixture();

    exportWorkbook(fx.agg, fx.timing, [...fx.classifications.values()]);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(capturedDownload).toBe(workbookFileName(fx.event));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });
});

describe('ResultsTab', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createObjectURL = vi.fn(() => 'blob:mock-url');
    revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.spyOn(window, 'print').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the race selector, the "Parcial (ao vivo)" badge and the classification table', () => {
    const fx = buildIndividualRaceFixture();
    renderResultsTab(fx);

    expect(screen.getByTestId('race-select')).toHaveValue(fx.race.id);
    expect(screen.getByText('Parcial (ao vivo)')).toBeInTheDocument();
    expect(screen.getByTestId('classification-table')).toBeInTheDocument();
    expect(screen.getByTestId('podiums')).toBeInTheDocument();
  });

  it('shows the "Oficial" badge with the finalized timestamp when the race is finalized', () => {
    const fx = buildIndividualRaceFixture();
    fx.race.finalized_at = iso(NOW);
    renderResultsTab(fx);

    expect(screen.getByText(/^Oficial · finalizada em/)).toBeInTheDocument();
    expect(screen.getByTestId('unfinalize-race')).toBeInTheDocument();
    expect(screen.queryByTestId('finalize-race')).not.toBeInTheDocument();
  });

  it('finalize-race + confirm-ok calls finalizeRace(raceId, rows) with every row and overall_pos 1 for the winner', async () => {
    const fx = buildIndividualRaceFixture();
    renderResultsTab(fx);

    fireEvent.click(screen.getByTestId('finalize-race'));
    fireEvent.click(await screen.findByTestId('confirm-ok'));

    await vi.waitFor(() => expect(mocks.finalizeRace).toHaveBeenCalledTimes(1));
    const [raceIdArg, rowsArg] = mocks.finalizeRace.mock.calls[0];
    expect(raceIdArg).toBe(fx.race.id);
    expect(rowsArg).toHaveLength(4);
    const winner = rowsArg.find((r: { entry_id: string }) => r.entry_id === 'en1');
    expect(winner?.overall_pos).toBe(1);

    expect(await screen.findByText('Prova finalizada.')).toBeInTheDocument();
  });

  it('cancelling the finalize confirmation does not call finalizeRace', async () => {
    const fx = buildIndividualRaceFixture();
    renderResultsTab(fx);

    fireEvent.click(screen.getByTestId('finalize-race'));
    fireEvent.click(await screen.findByTestId('confirm-cancel'));

    expect(mocks.finalizeRace).not.toHaveBeenCalled();
  });

  it('unfinalize-race + confirm-ok calls unfinalizeRace(raceId)', async () => {
    const fx = buildIndividualRaceFixture();
    fx.race.finalized_at = iso(NOW);
    renderResultsTab(fx);

    fireEvent.click(screen.getByTestId('unfinalize-race'));
    fireEvent.click(await screen.findByTestId('confirm-ok'));

    await vi.waitFor(() => expect(mocks.unfinalizeRace).toHaveBeenCalledWith(fx.race.id));
  });

  it('export-xlsx downloads the workbook with the exact filename and MIME type', () => {
    const fx = buildIndividualRaceFixture();
    renderResultsTab(fx);

    fireEvent.click(screen.getByTestId('export-xlsx'));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('print calls window.print()', () => {
    const fx = buildIndividualRaceFixture();
    renderResultsTab(fx);

    fireEvent.click(screen.getByTestId('print'));

    expect(window.print).toHaveBeenCalledTimes(1);
  });

  it('shows a link to Revisão with the pending-issue count when there are open issues', () => {
    const race: RaceRow = makeRace({ id: 'rp', legs: [{ modality: 'run', label: 'Corrida', distance_m: 5000 }] });
    const wave = makeWave({ id: 'wp', race_id: 'rp' });
    const entry = makeEntry({ id: 'ep', race_id: 'rp', wave_id: 'wp', bib: '9', members: [{ athlete_id: 'a1', position: 0, legs: [0] }] });
    const athletes = [makeAthlete({ id: 'a1' })];
    // Two timekeepers marking the same leg 10 s apart (> divergence_threshold_s 3) with no
    // resolution yet — a race-scoped 'divergence' warning (spec §8), unlike an unassigned mark
    // (which carries no `race_id` at all, so it never shows under a specific race here).
    const marks = [
      makeMark({ id: 'm1', entry_id: 'ep', leg_index: 0, timekeeper_id: 'tk1', at: T0 + 25 * MIN }),
      makeMark({ id: 'm2', entry_id: 'ep', leg_index: 0, timekeeper_id: 'tk2', at: T0 + 25 * MIN + 10_000 }),
    ];
    const event = makeEvent();
    const agg: EventAggregate = {
      event, races: [race], waves: [wave], entries: [entry], athletes, timekeepers: [makeTimekeeper({ id: 'tk1' }), makeTimekeeper({ id: 'tk2', name: 'Bia' })],
      marks, resolutions: [], results: [], version: 1, server_now: iso(NOW),
    };
    const index = indexEvent(agg);
    const timing = computeEventTiming(agg, NOW);
    expect(timing.issues.some(i => i.type === 'divergence' && i.race_id === race.id)).toBe(true);
    const classifications = new Map([[race.id, classifyRace(race, [entry], timing.byEntry, index.athletesById, event)]]);

    renderResultsTab({ event, race, agg, index, timing, classifications });

    expect(screen.getByText(/pendência\(s\) — ver Revisão/)).toBeInTheDocument();
  });
});
