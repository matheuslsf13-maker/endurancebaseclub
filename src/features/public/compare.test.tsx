import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import { makeResult } from '../../domain/testing/results';
import type { PubStatsPayload, PublicAthleteRow } from '../../lib/types';
import PublicComparePage from './PublicComparePage';

const mocks = vi.hoisted(() => ({ stats: vi.fn<() => Promise<PubStatsPayload>>() }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  api: { pub: { stats: mocks.stats } },
}));

const ana: PublicAthleteRow = { id: 'an', name: 'Ana Souza', sex: 'F', city: null, team_club: null };
const beto: PublicAthleteRow = { id: 'be', name: 'Beto Alves', sex: 'M', city: null, team_club: null };
const caio: PublicAthleteRow = { id: 'ca', name: 'Caio Dias', sex: 'M', city: null, team_club: null };
const A = { athlete_id: 'an', name: 'Ana Souza' };
const B = { athlete_id: 'be', name: 'Beto Alves' };
const results = [
  // together: relay Ana (swim) + Beto (run), 1st of 6
  makeResult({
    race_id: 'r1', entry_id: 'e1', date: '2026-03-10', race: 'Revezamento', team_name: 'Tubarões', members: [A, B],
    final_ms: 2_400_000, overall_pos: 1, finishers: 6,
    legs: [{ athlete_id: 'an', modality: 'swim', label: 'Natação', distance_m: 750, time_ms: 800_000 }, { athlete_id: 'be', time_ms: 1_600_000 }],
  }),
  // head-to-head: r2 Ana 2nd vs Beto 5th (Ana by 0:30); r3 Ana DNF vs Beto 3rd; r4 both DNF
  makeResult({ race_id: 'r2', entry_id: 'e2a', date: '2026-05-01', members: [A], final_ms: 1_500_000, overall_pos: 2 }),
  makeResult({ race_id: 'r2', entry_id: 'e2b', date: '2026-05-01', members: [B], final_ms: 1_530_000, overall_pos: 5 }),
  makeResult({ race_id: 'r3', entry_id: 'e3a', date: '2025-10-05', members: [A], status: 'dnf' }),
  makeResult({ race_id: 'r3', entry_id: 'e3b', date: '2025-10-05', members: [B], final_ms: 1_600_000, overall_pos: 3 }),
  makeResult({ race_id: 'r4', entry_id: 'e4a', date: '2026-06-01', members: [A], status: 'dnf' }),
  makeResult({ race_id: 'r4', entry_id: 'e4b', date: '2026-06-01', members: [B], status: 'dnf' }),
  // Caio races alone
  makeResult({ race_id: 'r5', entry_id: 'e5', date: '2026-07-01', members: [{ athlete_id: 'ca', name: 'Caio Dias' }], final_ms: 1_450_000, overall_pos: 1 }),
];

beforeEach(() => {
  mocks.stats.mockReset().mockResolvedValue({ athletes: [ana, beto, caio], results });
});

const renderCompare = (route: string) => renderWithProviders(<PublicComparePage />, { route, path: '/comparar/:a/:b' });
const cells = (label: string) =>
  [...screen.getByRole('rowheader', { name: label }).closest('tr')!.querySelectorAll('td')].map((td) => td.textContent);

describe('PublicComparePage (#/comparar/:a/:b)', () => {
  it('puts both athletes side by side, with paces and records', async () => {
    renderCompare('/comparar/an/be');
    const side = await screen.findByTestId('compare-side-by-side');
    expect(within(side).getByRole('columnheader', { name: 'Ana Souza' })).toBeInTheDocument();
    expect(within(side).getByRole('columnheader', { name: 'Beto Alves' })).toBeInTheDocument();
    expect(cells('Participações')).toEqual(['4', '4']);
    expect(cells('Conclusões')).toEqual(['2', '3']);
    expect(cells('Vitórias gerais')).toEqual(['1', '1']);
    expect(cells('Ritmo · Corrida')).toEqual(['5:00 /km', '5:15 /km']);
    expect(cells('Ritmo · Natação')).toEqual(['1:47 /100m', '—']);
    expect(cells('Recorde · Corrida 5 km')).toEqual(['25:00', '25:30']);
    expect(cells('Recorde · Natação 750 m')).toEqual(['13:20', '—']);
  });

  it('"Juntos" shows the team numbers and each member leg', async () => {
    renderCompare('/comparar/an/be');
    const t = await screen.findByTestId('compare-together');
    expect(within(t).getByText('Provas juntos').nextElementSibling).toHaveTextContent('1');
    expect(t).toHaveTextContent('Tubarões');
    expect(t).toHaveTextContent('Ana Souza: Natação 13:20');
    expect(t).toHaveTextContent('Beto Alves: Corrida 26:40');
    expect(t).toHaveTextContent('1º de 6');
  });

  it('"Confronto direto" scores the races in common', async () => {
    renderCompare('/comparar/an/be');
    const h = await screen.findByTestId('compare-head-to-head');
    expect(h).toHaveTextContent('Ana Souza 1 × 1 Beto Alves');
    expect(h).toHaveTextContent('1 sem decisão');
    expect(h).toHaveTextContent('Ana Souza por 0:30');
  });

  it('?ano=2026 restricts every section; an unknown ?ano is the career (Review Focus 1)', async () => {
    const { unmount } = renderCompare('/comparar/an/be?ano=2026');
    expect(await screen.findByTestId('compare-head-to-head')).toHaveTextContent('Ana Souza 1 × 0 Beto Alves');
    unmount();
    renderCompare('/comparar/an/be?ano=1999');
    expect(await screen.findByTestId('compare-head-to-head')).toHaveTextContent('Ana Souza 1 × 1 Beto Alves');
    expect(screen.getByTestId('year-filter')).toHaveValue('carreira');
  });

  it('says so when they never met; the side-by-side stays', async () => {
    renderCompare('/comparar/an/ca');
    expect(await screen.findByText('Vocês ainda não correram juntos nem na mesma prova.')).toBeInTheDocument();
    expect(screen.queryByTestId('compare-together')).not.toBeInTheDocument();
    expect(screen.queryByTestId('compare-head-to-head')).not.toBeInTheDocument();
    expect(screen.getByTestId('compare-side-by-side')).toBeInTheDocument();
  });

  it('the same athlete twice asks for two different ones', async () => {
    renderCompare('/comparar/an/an');
    expect(await screen.findByText('Escolha dois atletas diferentes')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver o perfil' })).toHaveAttribute('href', '/atleta/an');
  });

  it('a private or unknown athlete is not found', async () => {
    renderCompare('/comparar/an/px');
    expect(await screen.findByText('Atleta não encontrado ou perfil privado')).toBeInTheDocument();
  });

  it('sets and resets the page title', async () => {
    const { unmount } = renderCompare('/comparar/an/be');
    await screen.findByTestId('compare-side-by-side');
    expect(document.title).toBe('Ana Souza × Beto Alves – EnduranceBaseClub');
    unmount();
    expect(document.title).toBe('EnduranceBaseClub');
  });

  it('two record distances that read the same do not clash (row keys by modality and distance)', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const long = (who: { athlete_id: string; name: string }, race: string, d: number, t: number) =>
      makeResult({ race_id: race, entry_id: `${race}-${who.athlete_id}`, date: '2026-09-01', members: [who], final_ms: t, overall_pos: 1, legs: [{ athlete_id: who.athlete_id, distance_m: d, time_ms: t }] });
    mocks.stats.mockResolvedValue({ athletes: [ana, beto, caio], results: [long(A, 'h1', 21_097, 5_400_000), long(B, 'h2', 21_100, 5_500_000)] });
    renderCompare('/comparar/an/be');
    await screen.findByTestId('compare-side-by-side');
    expect(screen.getByRole('rowheader', { name: 'Recorde · Corrida 21,097 km' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Recorde · Corrida 21,1 km' })).toBeInTheDocument();
    expect(errors.mock.calls.some((c) => String(c[0]).includes('same key'))).toBe(false);
    errors.mockRestore();
  });
});
