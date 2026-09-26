import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';

import { renderWithProviders } from '../../test/renderWithProviders';
import {
  iso, makeAthlete, makeEntry, makeEvent, makeMark, makeRace, makeTimekeeper, makeWave, MIN, T0,
} from '../../domain/testing/fixtures';
import type {
  AthleteProfile, EventAggregate, LiveDelta, PubEventListItem, PubEventPayload, ResultRow, ResultSnapshot,
} from '../../lib/types';

import PublicHome from './PublicHome';
import PublicEventPage from './PublicEventPage';
import PublicAthletePage from './PublicAthletePage';

const mocks = vi.hoisted(() => ({
  events: vi.fn<() => Promise<PubEventListItem[]>>(),
  event: vi.fn<(slug: string) => Promise<PubEventPayload>>(),
  live: vi.fn<(slug: string, since: string | null) => Promise<LiveDelta>>(),
  athlete: vi.fn<(id: string) => Promise<AthleteProfile>>(),
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  api: { pub: { events: mocks.events, event: mocks.event, live: mocks.live, athlete: mocks.athlete } },
}));

const NOW = T0 + 40 * MIN;

beforeEach(() => {
  mocks.events.mockReset();
  mocks.event.mockReset();
  mocks.live.mockReset().mockResolvedValue({ server_now: iso(NOW), version: 1, marks: [], resolutions: [], waves: [] });
  mocks.athlete.mockReset();
});

// ---------------------------------------------------------------------------

describe('PublicHome', () => {
  it('lists public events with a link to #/p/<slug> and highlights "Ao vivo"', async () => {
    const events: PubEventListItem[] = [
      { id: 'e1', public_slug: 'copa-ebc', name: 'Copa EBC', date: '2026-10-11', location: 'Vila Velha', status: 'ao_vivo' },
      { id: 'e2', public_slug: 'copa-antiga', name: 'Copa Antiga', date: '2026-01-05', location: 'Vitória', status: 'encerrado' },
    ];
    mocks.events.mockResolvedValue(events);

    renderWithProviders(<PublicHome />);

    expect(await screen.findByText('Copa EBC')).toBeInTheDocument();
    const list = screen.getByTestId('public-events');
    const link = within(list).getByRole('link', { name: 'Copa EBC' });
    expect(link).toHaveAttribute('href', '/p/copa-ebc');
    expect(within(list).getByText('Ao vivo')).toBeInTheDocument();
    expect(within(list).getByText('Encerrado')).toBeInTheDocument();
  });

  it('shows a friendly empty state when there are no public events', async () => {
    mocks.events.mockResolvedValue([]);

    renderWithProviders(<PublicHome />);

    expect(await screen.findByText('Nenhum evento público no momento')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------

function buildLivePayload() {
  const event = makeEvent({ status: 'ao_vivo', public_slug: 'evento-teste' });
  const race = makeRace({ legs: [{ modality: 'run', label: 'Corrida', distance_m: 5000 }] });
  const wave = makeWave();
  const athletes = [
    makeAthlete({ id: 'a1', name: 'Ana Souza', public_profile: true }),
    makeAthlete({ id: 'a2', name: 'Beto Lima', sex: 'M', public_profile: false }),
  ];
  const entries = [
    makeEntry({ id: 'en1', bib: '101', members: [{ athlete_id: 'a1', position: 0, legs: [0] }] }),
    makeEntry({ id: 'en2', bib: '102', members: [{ athlete_id: 'a2', position: 0, legs: [0] }] }),
  ];
  const m1 = makeMark({ id: 'm1', entry_id: 'en1', leg_index: 0, at: T0 + 25 * MIN });
  const m2 = makeMark({ id: 'm2', entry_id: 'en2', leg_index: 0, at: T0 + 26 * MIN });
  const payload: PubEventPayload = {
    event, races: [race], waves: [wave], entries, athletes, timekeepers: [makeTimekeeper()],
    marks: [m1, m2], resolutions: [], results: [], version: 1, server_now: iso(NOW),
  };
  return { event, race, m1, m2, payload };
}

function makeResultRow(p: {
  entry_id: string; bib: string; athlete_id: string; name: string; overall_pos: number | null;
  final_ms: number | null; podiums?: ResultSnapshot['podiums'];
}): ResultRow {
  const data: ResultSnapshot = {
    event: { id: 'e1', name: 'Evento Teste', date: '2026-10-11' },
    race: { id: 'r1', name: 'Aquathlon', team_size: 1 },
    bib: p.bib, team_name: null,
    members: [{ athlete_id: p.athlete_id, name: p.name, legs: [0] }],
    legs: [{ leg_index: 0, modality: 'run', label: 'Corrida', distance_m: 5000, athlete_id: p.athlete_id, time_ms: p.final_ms }],
    category: { sex: 'F', age: 30, age_group: '20-29', level: null },
    status: p.final_ms !== null ? 'finished' : 'dnf',
    total_ms: p.final_ms, penalty_ms: 0, final_ms: p.final_ms,
    positions: { overall: p.overall_pos, sex: p.overall_pos, finishers: 2 },
    podiums: p.podiums ?? [],
  };
  return {
    race_id: 'r1', entry_id: p.entry_id, event_id: 'e1', athlete_ids: [p.athlete_id],
    status: data.status, final_ms: p.final_ms, overall_pos: p.overall_pos, data, finalized_at: iso(NOW),
  };
}

function renderEventPage(slug = 'evento-teste') {
  return renderWithProviders(<PublicEventPage />, { route: `/p/${slug}`, path: '/p/:slug' });
}

// ---------------------------------------------------------------------------
// Podium group order (spec §9: sex M, F, MISTO; age groups by `min`). Six single-leg entries,
// M/F crossed with three age brackets ("até 19", "20-29", "60+" — the default race config's
// youngest and oldest buckets), all finishing at distinct times so every (sex, age) combination
// in the "faixa" ranking has exactly one member (podium position 1) and the "geral" ranking has
// three men and three women (positions 1-3 each).
// ---------------------------------------------------------------------------

const GROUP_ORDER_PEOPLE = [
  { id: 'a1', sex: 'F' as const, birth: '2008-01-01', name: 'Ana Jovem', age: 18, age_group: 'até 19', at: T0 + 21 * MIN },
  { id: 'a2', sex: 'F' as const, birth: '2000-01-01', name: 'Ana Adulta', age: 26, age_group: '20-29', at: T0 + 23 * MIN },
  { id: 'a3', sex: 'F' as const, birth: '1960-01-01', name: 'Ana Veterana', age: 66, age_group: '60+', at: T0 + 25 * MIN },
  { id: 'a4', sex: 'M' as const, birth: '2008-01-01', name: 'Bruno Jovem', age: 18, age_group: 'até 19', at: T0 + 20 * MIN },
  { id: 'a5', sex: 'M' as const, birth: '2000-01-01', name: 'Bruno Adulto', age: 26, age_group: '20-29', at: T0 + 22 * MIN },
  { id: 'a6', sex: 'M' as const, birth: '1960-01-01', name: 'Bruno Veterano', age: 66, age_group: '60+', at: T0 + 24 * MIN },
];

const GROUP_ORDER_EXPECTED = [
  'Masculino', 'Feminino',
  'Masculino · até 19', 'Masculino · 20-29', 'Masculino · 60+',
  'Feminino · até 19', 'Feminino · 20-29', 'Feminino · 60+',
];

function makeGroupResultRow(p: {
  entry_id: string; bib: string; athlete_id: string; name: string;
  sex: 'M' | 'F'; age: number; age_group: string;
  final_ms: number; overall_pos: number; sex_pos: number;
  podiums: ResultSnapshot['podiums'];
}): ResultRow {
  const data: ResultSnapshot = {
    event: { id: 'e1', name: 'Evento Teste', date: '2026-10-11' },
    race: { id: 'r1', name: 'Aquathlon', team_size: 1 },
    bib: p.bib, team_name: null,
    members: [{ athlete_id: p.athlete_id, name: p.name, legs: [0] }],
    legs: [{ leg_index: 0, modality: 'run', label: 'Corrida', distance_m: 5000, athlete_id: p.athlete_id, time_ms: p.final_ms }],
    category: { sex: p.sex, age: p.age, age_group: p.age_group, level: null },
    status: 'finished',
    total_ms: p.final_ms, penalty_ms: 0, final_ms: p.final_ms,
    positions: { overall: p.overall_pos, sex: p.sex_pos, finishers: 6 },
    podiums: p.podiums,
  };
  return {
    race_id: 'r1', entry_id: p.entry_id, event_id: 'e1', athlete_ids: [p.athlete_id],
    status: 'finished', final_ms: p.final_ms, overall_pos: p.overall_pos, data, finalized_at: iso(NOW),
  };
}

function buildGroupOrderPayload(finalized: boolean): PubEventPayload {
  const event = makeEvent({ status: finalized ? 'encerrado' : 'ao_vivo', public_slug: 'evento-teste' });
  const race = makeRace({
    legs: [{ modality: 'run', label: 'Corrida', distance_m: 5000 }],
    finalized_at: finalized ? iso(NOW) : null,
    // Cumulative so every athlete can place in both "geral" and "faixa" (each has exactly 3
    // finishers per sex, so all naturally podium in "geral" too) — this test is about group
    // ORDER, not the separate non-cumulative "already awarded" exclusion (covered elsewhere).
    configPatch: { cumulative: true },
  });
  const wave = makeWave();
  const athletes = GROUP_ORDER_PEOPLE.map((p) =>
    makeAthlete({ id: p.id, name: p.name, sex: p.sex, birth_date: p.birth, public_profile: false }));
  const entries = GROUP_ORDER_PEOPLE.map((p, i) =>
    makeEntry({ id: `en${i + 1}`, bib: String(i + 1), members: [{ athlete_id: p.id, position: 0, legs: [0] }] }));
  const marks = GROUP_ORDER_PEOPLE.map((p, i) =>
    makeMark({ id: `gm${i + 1}`, entry_id: `en${i + 1}`, leg_index: 0, at: p.at }));

  // Global finish order (ascending): a4(20), a1(21), a5(22), a2(23), a6(24), a3(25).
  const results: ResultRow[] = finalized
    ? [
        makeGroupResultRow({
          entry_id: 'en4', bib: '4', athlete_id: 'a4', name: 'Bruno Jovem', sex: 'M', age: 18, age_group: 'até 19',
          final_ms: 20 * MIN, overall_pos: 1, sex_pos: 1,
          podiums: [
            { ranking_id: 'geral', ranking_name: 'Geral', group_label: 'Masculino', podium_pos: 1 },
            { ranking_id: 'faixa', ranking_name: 'Faixa etária', group_label: 'Masculino · até 19', podium_pos: 1 },
          ],
        }),
        makeGroupResultRow({
          entry_id: 'en1', bib: '1', athlete_id: 'a1', name: 'Ana Jovem', sex: 'F', age: 18, age_group: 'até 19',
          final_ms: 21 * MIN, overall_pos: 2, sex_pos: 1,
          podiums: [
            { ranking_id: 'geral', ranking_name: 'Geral', group_label: 'Feminino', podium_pos: 1 },
            { ranking_id: 'faixa', ranking_name: 'Faixa etária', group_label: 'Feminino · até 19', podium_pos: 1 },
          ],
        }),
        makeGroupResultRow({
          entry_id: 'en5', bib: '5', athlete_id: 'a5', name: 'Bruno Adulto', sex: 'M', age: 26, age_group: '20-29',
          final_ms: 22 * MIN, overall_pos: 3, sex_pos: 2,
          podiums: [
            { ranking_id: 'geral', ranking_name: 'Geral', group_label: 'Masculino', podium_pos: 2 },
            { ranking_id: 'faixa', ranking_name: 'Faixa etária', group_label: 'Masculino · 20-29', podium_pos: 1 },
          ],
        }),
        makeGroupResultRow({
          entry_id: 'en2', bib: '2', athlete_id: 'a2', name: 'Ana Adulta', sex: 'F', age: 26, age_group: '20-29',
          final_ms: 23 * MIN, overall_pos: 4, sex_pos: 2,
          podiums: [
            { ranking_id: 'geral', ranking_name: 'Geral', group_label: 'Feminino', podium_pos: 2 },
            { ranking_id: 'faixa', ranking_name: 'Faixa etária', group_label: 'Feminino · 20-29', podium_pos: 1 },
          ],
        }),
        makeGroupResultRow({
          entry_id: 'en6', bib: '6', athlete_id: 'a6', name: 'Bruno Veterano', sex: 'M', age: 66, age_group: '60+',
          final_ms: 24 * MIN, overall_pos: 5, sex_pos: 3,
          podiums: [
            { ranking_id: 'geral', ranking_name: 'Geral', group_label: 'Masculino', podium_pos: 3 },
            { ranking_id: 'faixa', ranking_name: 'Faixa etária', group_label: 'Masculino · 60+', podium_pos: 1 },
          ],
        }),
        makeGroupResultRow({
          entry_id: 'en3', bib: '3', athlete_id: 'a3', name: 'Ana Veterana', sex: 'F', age: 66, age_group: '60+',
          final_ms: 25 * MIN, overall_pos: 6, sex_pos: 3,
          podiums: [
            { ranking_id: 'geral', ranking_name: 'Geral', group_label: 'Feminino', podium_pos: 3 },
            { ranking_id: 'faixa', ranking_name: 'Faixa etária', group_label: 'Feminino · 60+', podium_pos: 1 },
          ],
        }),
      ]
    : [];

  return {
    event, races: [race], waves: [wave], entries, athletes, timekeepers: [makeTimekeeper()],
    marks: finalized ? [] : marks, resolutions: [], results, version: 1, server_now: iso(NOW),
  };
}

describe('PublicEventPage', () => {
  it('renders classification rows from the live payload with the "Parcial – ao vivo" badge, linking only public athletes', async () => {
    const { payload } = buildLivePayload();
    mocks.event.mockResolvedValue(payload);

    renderEventPage();

    const table = await screen.findByTestId('classification-table');
    const rows = within(table).getAllByTestId('classification-row');
    expect(rows).toHaveLength(2);
    // Ana (25 min) beats Beto (26 min).
    expect(within(rows[0]).getByText('101')).toBeInTheDocument();
    expect(within(rows[1]).getByText('102')).toBeInTheDocument();

    expect(screen.getByText('Parcial – ao vivo')).toBeInTheDocument();
    expect(screen.queryByText('Resultado oficial')).not.toBeInTheDocument();

    // public_profile athlete links to the public profile; the private one does not (scoped to the
    // classification table — Beto, the lone male finisher, also shows up plainly in the podiums,
    // which never link names regardless of `public_profile`).
    expect(within(table).getByRole('link', { name: 'Ana Souza' })).toHaveAttribute('href', '/atleta/a1');
    expect(within(table).getByText('Beto Lima')).toBeInTheDocument();
    expect(within(table).queryByRole('link', { name: 'Beto Lima' })).not.toBeInTheDocument();
  });

  it('shows "Resultado oficial" and rows ordered by the snapshot\'s overall_pos when the race is finalized', async () => {
    const { payload, race } = buildLivePayload();
    race.finalized_at = iso(NOW);
    // Snapshot order is deliberately reversed vs. overall_pos to prove the page sorts by it.
    const results = [
      makeResultRow({
        entry_id: 'en2', bib: '102', athlete_id: 'a2', name: 'Beto Lima', overall_pos: 2, final_ms: 26 * MIN,
      }),
      makeResultRow({
        entry_id: 'en1', bib: '101', athlete_id: 'a1', name: 'Ana Souza', overall_pos: 1, final_ms: 25 * MIN,
        podiums: [{ ranking_id: 'geral', ranking_name: 'Geral', group_label: 'Feminino', podium_pos: 1 }],
      }),
    ];
    mocks.event.mockResolvedValue({ ...payload, results });

    renderEventPage();

    const table = await screen.findByTestId('classification-table');
    const rows = within(table).getAllByTestId('classification-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('101')).toBeInTheDocument();
    expect(within(rows[1]).getByText('102')).toBeInTheDocument();

    expect(screen.getByText('Resultado oficial')).toBeInTheDocument();
    expect(screen.queryByText('Parcial – ao vivo')).not.toBeInTheDocument();

    const podiums = screen.getByTestId('podiums');
    expect(within(podiums).getByText('1º')).toBeInTheDocument();
    expect(within(podiums).getByText('Feminino')).toBeInTheDocument();
  });

  it('shows a friendly not-found message for an unknown slug', async () => {
    mocks.event.mockRejectedValue(new Error('Evento não encontrado'));

    renderEventPage('nao-existe');

    expect(await screen.findByText('Evento não encontrado')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Voltar aos eventos/ })).toBeInTheDocument();
  });

  it('polls pub.live every 10 s and merges an updated mark into the live classification', async () => {
    // Fake timers *before* rendering (as in useEventData.test.tsx): a brief advance lets the
    // initial query settle without `findBy*`'s own real-timer polling, which would otherwise
    // deadlock against faked timers.
    vi.useFakeTimers();
    try {
      const { payload, m2 } = buildLivePayload();
      mocks.event.mockResolvedValue(payload);
      // Beto's mark is corrected to finish 2 min earlier than originally recorded — now ahead of Ana.
      const updatedM2 = { ...m2, ts: iso(T0 + 24 * MIN), device_ts: iso(T0 + 24 * MIN), updated_at: iso(NOW + 1000) };
      // Live endpoints always return every wave of the event, not just changed ones — an empty
      // list here would (correctly) wipe out the wave start and make everyone "sem largada".
      mocks.live.mockResolvedValue({ server_now: iso(NOW + 10_000), version: 1, marks: [updatedM2], resolutions: [], waves: payload.waves });

      renderEventPage();
      await act(() => vi.advanceTimersByTimeAsync(5));
      expect(screen.getByTestId('classification-table')).toBeInTheDocument();

      expect(mocks.live).not.toHaveBeenCalled();
      await act(() => vi.advanceTimersByTimeAsync(10_000));

      expect(mocks.live).toHaveBeenCalledTimes(1);
      expect(mocks.live).toHaveBeenCalledWith('evento-teste', iso(Date.parse(payload.server_now) - 10_000));

      const rows = within(screen.getByTestId('classification-table')).getAllByTestId('classification-row');
      expect(within(rows[0]).getByText('102')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('orders a finalized race\'s podium groups per spec §9 (sex M, F; age by min) and matches the live view\'s order for the same data', async () => {
    const official = renderEventPage.bind(null, 'evento-teste');

    mocks.event.mockResolvedValue(buildGroupOrderPayload(true));
    const officialRender = official();
    const officialPodiums = await within(officialRender.container).findByTestId('podiums');
    const officialLabels = [...officialPodiums.querySelectorAll('p')].map((el) => el.textContent);
    expect(officialLabels).toEqual(GROUP_ORDER_EXPECTED);

    // Same entries/categories, but not finalized: the live view (computeEventTiming + classifyRace)
    // must group and order the podiums identically to the frozen, reconstructed official view.
    mocks.event.mockResolvedValue(buildGroupOrderPayload(false));
    const liveRender = official();
    const livePodiums = await within(liveRender.container).findByTestId('podiums');
    const liveLabels = [...livePodiums.querySelectorAll('p')].map((el) => el.textContent);
    expect(liveLabels).toEqual(GROUP_ORDER_EXPECTED);
  });
});

// ---------------------------------------------------------------------------

function renderAthletePage(athleteId = 'a1') {
  return renderWithProviders(<PublicAthletePage />, { route: `/atleta/${athleteId}`, path: '/atleta/:athleteId' });
}

describe('PublicAthletePage', () => {
  it('renders the athlete header and StatsView ("Participações") from pub.athlete', async () => {
    const finished = makeResultRow({ entry_id: 'en1', bib: '101', athlete_id: 'a1', name: 'Ana Souza', overall_pos: 1, final_ms: 25 * MIN });
    mocks.athlete.mockResolvedValue({
      athlete: { id: 'a1', name: 'Ana Souza', sex: 'F', city: 'Vila Velha', team_club: 'Tubarões' } as AthleteProfile['athlete'],
      results: [finished],
    });

    renderAthletePage();

    expect(await screen.findByText('Ana Souza')).toBeInTheDocument();
    expect(screen.getByTestId('public-athlete')).toBeInTheDocument();
    expect(screen.getByText(/Vila Velha/)).toBeInTheDocument();
    expect(screen.getByText('Participações')).toBeInTheDocument();
  });

  it('shows a friendly message when the athlete is private or missing', async () => {
    mocks.athlete.mockRejectedValue(new Error('Atleta não encontrado'));

    renderAthletePage('desconhecido');

    expect(await screen.findByText('Atleta não encontrado')).toBeInTheDocument();
  });
});
