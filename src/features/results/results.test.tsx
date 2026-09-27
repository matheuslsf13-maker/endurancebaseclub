import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';

import { renderWithProviders } from '../../test/renderWithProviders';
import { EventContext } from '../events/EventContext';
import type { EventContextValue } from '../events/EventContext';
import { indexEvent } from '../../domain/eventModel';
import { computeEventTiming } from '../../domain/consolidation';
import { classifyRace } from '../../domain/ranking';
import type { RaceClassification } from '../../domain/ranking';
import { buildFinalizeRows } from '../../domain/snapshot';
import { workbookFileName } from '../../domain/workbook';
import { formatDuration, formatGap } from '../../lib/format';
import type { ClockSync } from '../../lib/clock';
import type { EventAggregate, FinalizeRowInput, RaceRow, ResultRow } from '../../lib/types';
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
  updateEntryStatus: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  api: { admin: { finalizeRace: mocks.finalizeRace, unfinalizeRace: mocks.unfinalizeRace, updateEntryStatus: mocks.updateEntryStatus } },
}));

// ---------------------------------------------------------------------------
// Fixture: an individual (team_size 1) single-leg race with 3 finishers (25/26/27 min) plus one
// DNF entry — the exact context the brief's Step 1 calls for.
// ---------------------------------------------------------------------------
const NOW = T0 + 40 * MIN;

function buildIndividualRaceFixture(opts: { finishes?: number[] } = {}) {
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
  const finishes = opts.finishes ?? [25, 26, 27];
  const marks = finishes.map((min, i) => makeMark({ entry_id: `en${i + 1}`, leg_index: 0, at: T0 + min * MIN }));
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

/** The fixture after `change` (new marks, entries…), with timing and classification recomputed. */
function recompute(fx: Fixture, change: Partial<EventAggregate>): Fixture {
  const agg = { ...fx.agg, ...change };
  const race = agg.races[0];
  const index = indexEvent(agg);
  const timing = computeEventTiming(agg, NOW);
  const classifications = new Map([[race.id, classifyRace(race, index.entriesByRace.get(race.id) ?? [], timing.byEntry, index.athletesById, agg.event)]]);
  return { event: agg.event, race, agg, index, timing, classifications };
}

/** The rows `admin_finalize_race` stores for the fixture's race as it is now. */
function storedResults(fx: Fixture): ResultRow[] {
  const cls = fx.classifications.get(fx.race.id) as RaceClassification;
  return buildFinalizeRows(fx.event, cls, fx.index.athletesById).map(r => ({
    ...r, race_id: fx.race.id, event_id: fx.event.id, finalized_at: iso(NOW),
  }));
}

/** The fixture's race finalized with `results`, over live data `fx`. */
function finalized(fx: Fixture, results: ResultRow[]): Fixture {
  const race = { ...fx.race, finalized_at: iso(NOW) };
  return recompute(fx, { races: [race], results });
}

/** Renders the tab over a context the test can swap later (new data arriving by polling). */
function renderResultsLive(fx: Fixture) {
  let setCtx: (c: EventContextValue) => void = () => {};
  const first = contextValue(fx);
  function Harness() {
    const [ctx, set] = useState(first);
    setCtx = set;
    return (
      <EventContext.Provider value={ctx}>
        <ResultsTab />
      </EventContext.Provider>
    );
  }
  const utils = renderWithProviders(<Harness />);
  return {
    ...utils, ctx: first,
    update: (next: Fixture) => act(() => setCtx(contextValue(next, { refresh: first.refresh, patchAgg: first.patchAgg }))),
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
  mocks.updateEntryStatus.mockReset().mockImplementation(async (id: string, status: string) => ({ ...makeEntry({ id }), status }));
});

// ---------------------------------------------------------------------------

/** A finished relay pair (swim 10 min, run 30 min) entered as team "Tubarões". */
function buildTeamFixture() {
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
  return { race, cls, index };
}

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

  it('a finish whose total is zero or negative is unranked, says "sem tempo válido" and shows no time (item 18)', () => {
    const race = makeRace({ id: 'rneg', legs: [{ modality: 'run', label: 'Corrida', distance_m: 5000 }] });
    // The wave start was recorded 10 min after the finish mark.
    const wave = makeWave({ id: 'wneg', race_id: 'rneg', start_at: iso(T0 + 30 * MIN) });
    const entry = makeEntry({ id: 'e-neg', race_id: 'rneg', wave_id: 'wneg', bib: '7', members: [{ athlete_id: 'a1', position: 0, legs: [0] }] });
    const agg: EventAggregate = {
      event: makeEvent(), races: [race], waves: [wave], entries: [entry], athletes: [makeAthlete({ id: 'a1' })],
      timekeepers: [makeTimekeeper()], marks: [makeMark({ entry_id: 'e-neg', leg_index: 0, at: T0 + 20 * MIN })],
      resolutions: [], results: [], version: 1, server_now: iso(NOW),
    };
    const index = indexEvent(agg);
    const timing = computeEventTiming(agg, NOW);
    expect(timing.byEntry.get('e-neg')?.final_ms).toBe(-10 * MIN);
    const cls = classifyRace(race, [entry], timing.byEntry, index.athletesById, agg.event);

    renderWithProviders(<ClassificationTable race={race} cls={cls} athletesById={index.athletesById} showLegs />);

    const row = within(screen.getByTestId('classification-table')).getByTestId('classification-row');
    expect(row.firstElementChild).toHaveTextContent('—'); // unranked
    expect(within(row).getByText('Concluiu (sem tempo válido)')).toBeInTheDocument();
    expect(row).not.toHaveTextContent(formatDuration(-10 * MIN));
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

  it('names a team entry by its team name, above its members (admin and public links) — Task 28 E2E', () => {
    const { race, cls, index } = buildTeamFixture();

    for (const linkAthletes of ['admin', 'public', false] as const) {
      const { unmount } = renderWithProviders(
        <ClassificationTable race={race} cls={cls} athletesById={index.athletesById} linkAthletes={linkAthletes} />,
      );
      const row = screen.getByTestId('classification-row');
      expect(within(row).getByText('Tubarões')).toBeInTheDocument();
      expect(row).toHaveTextContent('Ana (Natação) · Beto (Corrida)');
      unmount();
    }
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

  it('names a team by its team name, with its members — Task 28 E2E', () => {
    const { cls, index } = buildTeamFixture();

    renderWithProviders(<PodiumView cls={cls} athletesById={index.athletesById} />);

    const podiums = screen.getByTestId('podiums');
    expect(within(podiums).getByText('Tubarões')).toBeInTheDocument();
    expect(podiums).toHaveTextContent('Ana (Natação) · Beto (Corrida)');
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

  it('downloads a Blob with the XLSX MIME type and the exact filename, and revokes the URL only later (B2-m13)', () => {
    vi.useFakeTimers();
    try {
      const fx = buildIndividualRaceFixture();

      exportWorkbook(fx.agg, fx.timing, [...fx.classifications.values()]);

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      const blob = createObjectURL.mock.calls[0][0] as Blob;
      expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(capturedDownload).toBe(workbookFileName(fx.event));
      // Some iOS Safari versions abort a download whose URL is revoked right after the click.
      expect(revokeObjectURL).not.toHaveBeenCalled();
      vi.advanceTimersByTime(10_000);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    } finally {
      vi.useRealTimers();
    }
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

    expect(screen.getByText('1 pendência — ver Revisão')).toBeInTheDocument();
  });

  it('finalize: the confirm counts pending issues without "(s)" plurals and no longer promises the results never change', async () => {
    const fx = buildIndividualRaceFixture();
    renderResultsTab(fx);

    fireEvent.click(screen.getByTestId('finalize-race'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Pendências em Revisão: 0 erros e 0 avisos.');
    expect(dialog).not.toHaveTextContent('(s)');
    expect(dialog).not.toHaveTextContent('não mudam mais sozinhos');
    expect(dialog).toHaveTextContent('reabrir e finalizar de novo');
  });

  it('finalize: the rows come from the data current when the organizer confirms, not when the dialog opened (B2-I2)', async () => {
    // Carla (en3) has not finished when the dialog opens; her finish syncs while it is open.
    const before = buildIndividualRaceFixture({ finishes: [25, 26] });
    const { update } = renderResultsLive(before);

    fireEvent.click(screen.getByTestId('finalize-race'));
    await screen.findByTestId('confirm-ok');
    update(buildIndividualRaceFixture());
    fireEvent.click(screen.getByTestId('confirm-ok'));

    await vi.waitFor(() => expect(mocks.finalizeRace).toHaveBeenCalledTimes(1));
    const rows = mocks.finalizeRace.mock.calls[0][1] as FinalizeRowInput[];
    expect(rows.find(r => r.entry_id === 'en3')).toMatchObject({ status: 'finished', overall_pos: 3, final_ms: 27 * MIN });
  });

  it('finalize: offers to mark the entries still on course as DNF (B2-m11, spec §8)', async () => {
    const fx = buildIndividualRaceFixture({ finishes: [25, 26] }); // Carla (en3) still on course
    const { ctx } = renderResultsTab(fx);

    fireEvent.click(screen.getByTestId('finalize-race'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Ainda há 1 inscrição em prova');
    fireEvent.click(within(dialog).getByLabelText('Marcar 1 como DNF'));
    fireEvent.click(screen.getByTestId('confirm-ok'));

    await vi.waitFor(() => expect(mocks.finalizeRace).toHaveBeenCalledTimes(1));
    expect(mocks.updateEntryStatus).toHaveBeenCalledWith('en3', 'dnf', 0, '');
    expect(mocks.updateEntryStatus).toHaveBeenCalledTimes(1);
    const rows = mocks.finalizeRace.mock.calls[0][1] as FinalizeRowInput[];
    expect(rows.find(r => r.entry_id === 'en3')).toMatchObject({ status: 'dnf', overall_pos: null });
    expect(ctx.patchAgg).toHaveBeenCalled();
  });

  it('finalize: without ticking the DNF option, entries on course stay as they are', async () => {
    const fx = buildIndividualRaceFixture({ finishes: [25, 26] });
    renderResultsTab(fx);

    fireEvent.click(screen.getByTestId('finalize-race'));
    fireEvent.click(await screen.findByTestId('confirm-ok'));

    await vi.waitFor(() => expect(mocks.finalizeRace).toHaveBeenCalledTimes(1));
    expect(mocks.updateEntryStatus).not.toHaveBeenCalled();
    const rows = mocks.finalizeRace.mock.calls[0][1] as FinalizeRowInput[];
    expect(rows.find(r => r.entry_id === 'en3')).toMatchObject({ status: 'on_course' });
  });
});

describe('ResultsTab: a finalized race shows its official snapshot (B2-I2)', () => {
  it('renders the stored classification, not the live one, and says how many entries changed since', () => {
    const results = storedResults(buildIndividualRaceFixture());
    // After finalizing, Beto's finish is corrected to 24 min: live, he would now win.
    const live = finalized(buildIndividualRaceFixture({ finishes: [25, 24, 27] }), results);
    renderResultsTab(live);

    const rows = within(screen.getByTestId('classification-table')).getAllByTestId('classification-row');
    expect(within(rows[0]).getByText('101')).toBeInTheDocument();
    expect(within(rows[1]).getByText('102')).toBeInTheDocument();
    expect(within(rows[1]).getAllByText(formatDuration(26 * MIN)).length).toBeGreaterThan(0);
    expect(screen.getByText('Há 2 alterações depois da finalização — reabra e finalize de novo para oficializá-las.')).toBeInTheDocument();
  });

  it('shows no drift banner while the live data still matches the snapshot', () => {
    const fx = buildIndividualRaceFixture();
    renderResultsTab(finalized(fx, storedResults(fx)));
    expect(screen.queryByText(/depois da finalização/)).not.toBeInTheDocument();
    expect(screen.getByText(/^Oficial · finalizada em/)).toBeInTheDocument();
  });

  it('names members from the snapshot when the athlete is no longer registered', () => {
    const fx = buildIndividualRaceFixture();
    const live = finalized(fx, storedResults(fx));
    const gone = recompute(live, { athletes: live.agg.athletes.filter(a => a.id !== 'a1') });
    renderResultsTab(gone);
    const rows = within(screen.getByTestId('classification-table')).getAllByTestId('classification-row');
    expect(rows[0]).toHaveTextContent('Ana Souza');
  });
});
