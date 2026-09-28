import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { makeResult } from '../../domain/testing/results';
import type { PubStatsPayload, PublicAthleteRow } from '../../lib/types';
import PublicRankingPage from './PublicRankingPage';

const mocks = vi.hoisted(() => ({ stats: vi.fn<() => Promise<PubStatsPayload>>() }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  api: { pub: { stats: mocks.stats } },
}));

const ana: PublicAthleteRow = { id: 'an', name: 'Ana Souza', sex: 'F', city: null, team_club: null };
const bia: PublicAthleteRow = { id: 'bi', name: 'Bia Lima', sex: 'F', city: null, team_club: null };
const carlos: PublicAthleteRow = { id: 'ca', name: 'Carlos Dias', sex: 'M', city: null, team_club: null };
const m = (a: PublicAthleteRow) => ({ athlete_id: a.id, name: a.name });
const podium = (pos: number) => [{ ranking_id: 'geral', ranking_name: 'Geral', group_label: 'Geral', podium_pos: pos }];
const results = [
  makeResult({ race_id: 'r1', entry_id: 'e1', date: '2026-03-10', members: [m(ana)], final_ms: 1_500_000, overall_pos: 1, podiums: podium(1) }),
  makeResult({
    race_id: 'r2', entry_id: 'e2', date: '2026-05-01', members: [m(ana), m(carlos)], final_ms: 2_200_000, overall_pos: 1,
    legs: [{ athlete_id: 'an', modality: 'swim', label: 'Natação', distance_m: 750, time_ms: 800_000 }, { athlete_id: 'ca', time_ms: 1_400_000 }],
  }),
  makeResult({ race_id: 'r3', entry_id: 'e3', date: '2025-10-05', members: [m(bia)], final_ms: 1_450_000, overall_pos: 1 }),
  makeResult({ race_id: 'r3', entry_id: 'e4', date: '2025-10-05', members: [m(ana)], final_ms: 1_550_000, overall_pos: 2, podiums: podium(2) }),
  makeResult({
    race_id: 'r5', entry_id: 'e5', date: '2026-06-01', members: [m(carlos)], final_ms: 300_000, overall_pos: 1,
    legs: [{ athlete_id: 'ca', modality: 'other', label: 'Outro', distance_m: 1000, time_ms: 300_000 }],
  }),
];

beforeEach(() => {
  mocks.stats.mockReset().mockResolvedValue({ athletes: [ana, bia, carlos], results });
});

const renderRanking = (route = '/ranking') => renderWithProviders(<PublicRankingPage />, { route, path: '/ranking' });
const board = (title: string) => screen.getByRole('heading', { name: title }).closest('section')!;
const lines = (title: string) => within(board(title)).queryAllByRole('listitem').map((li) => li.textContent);

describe('PublicRankingPage (#/ranking)', () => {
  it('shows the four leader boards with shared positions and profile links', async () => {
    renderRanking();
    await screen.findByRole('heading', { name: 'Vitórias gerais' });
    expect(lines('Vitórias gerais')).toEqual(['1º Ana Souza 2', '1º Carlos Dias 2', '3º Bia Lima 1']);
    expect(lines('Pódios')).toEqual(['1º Ana Souza 2']);
    expect(lines('Provas concluídas')).toEqual(['1º Ana Souza 3', '2º Carlos Dias 2', '3º Bia Lima 1']);
    expect(lines('Km em prova')).toEqual(['1º Ana Souza 10,75 km', '2º Carlos Dias 6 km', '3º Bia Lima 5 km']);
    expect(within(board('Vitórias gerais')).getByRole('link', { name: 'Bia Lima' })).toHaveAttribute('href', '/atleta/bi');
  });

  it('filters by sex (buttons write ?sexo) and by year (?ano)', async () => {
    const user = userEvent.setup();
    const { router } = renderRanking();
    await screen.findByRole('heading', { name: 'Vitórias gerais' });
    await user.click(within(screen.getByTestId('sex-filter')).getByRole('button', { name: 'Feminino' }));
    expect(router.state.location.search).toBe('?sexo=F');
    expect(lines('Vitórias gerais')).toEqual(['1º Ana Souza 2', '2º Bia Lima 1']);
  });

  it('?ano=2025 shows only that year, and its profile links keep the year', async () => {
    renderRanking('/ranking?ano=2025');
    await screen.findByRole('heading', { name: 'Vitórias gerais' });
    expect(lines('Vitórias gerais')).toEqual(['1º Bia Lima 1']);
    expect(within(board('Vitórias gerais')).getByRole('link', { name: 'Bia Lima' })).toHaveAttribute('href', '/atleta/bi?ano=2025');
    const run = screen.getByRole('heading', { name: 'Corrida 5 km' }).closest('section')!;
    expect(within(run).getByRole('link', { name: 'Bia Lima' })).toHaveAttribute('href', '/atleta/bi?ano=2025');
  });

  it('lists the club records per modality and distance with the 3 best athletes', async () => {
    renderRanking();
    const run = (await screen.findByRole('heading', { name: 'Corrida 5 km' })).closest('section')!;
    const rows = within(run).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getByRole('link').textContent)).toEqual(['Carlos Dias', 'Bia Lima', 'Ana Souza']);
    expect(rows[0]).toHaveTextContent('23:20');
    expect(rows[0]).toHaveTextContent('4:40 /km');
    const other = within(screen.getByRole('heading', { name: 'Outro 1 km' }).closest('section')!).getAllByRole('row')[1];
    expect(other).toHaveTextContent('—');
  });

  it('says when the period has no official result', async () => {
    mocks.stats.mockResolvedValue({ athletes: [ana], results: [] });
    renderRanking();
    expect(await screen.findByText('Ainda não há resultados oficiais neste período')).toBeInTheDocument();
  });

  it('sets and resets the page title', async () => {
    const { unmount } = renderRanking();
    await screen.findByRole('heading', { name: 'Vitórias gerais' });
    expect(document.title).toBe('Rankings – EnduranceBaseClub');
    unmount();
    expect(document.title).toBe('EnduranceBaseClub');
  });

  it('two distances that read the same (21 097 m and 21 100 m) stay separate groups without clashing keys', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const long = (a: PublicAthleteRow, race: string, d: number, t: number) =>
      makeResult({ race_id: race, entry_id: `${race}-${a.id}`, date: '2026-09-01', members: [m(a)], final_ms: t, overall_pos: 1, legs: [{ athlete_id: a.id, distance_m: d, time_ms: t }] });
    mocks.stats.mockResolvedValue({ athletes: [ana, bia], results: [long(ana, 'h1', 21_097, 5_400_000), long(bia, 'h2', 21_100, 5_500_000)] });
    renderRanking();
    expect(await screen.findByRole('heading', { name: 'Corrida 21,097 km' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Corrida 21,1 km' })).toBeInTheDocument();
    expect(errors.mock.calls.some((c) => String(c[0]).includes('same key'))).toBe(false);
    errors.mockRestore();
  });
});
