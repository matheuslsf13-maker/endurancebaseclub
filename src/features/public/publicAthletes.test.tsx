import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { makeResult } from '../../domain/testing/results';
import type { PubStatsPayload, PublicAthleteRow } from '../../lib/types';
import PublicAthletesPage from './PublicAthletesPage';
import PublicAthletePage from './PublicAthletePage';

const mocks = vi.hoisted(() => ({ stats: vi.fn<() => Promise<PubStatsPayload>>() }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  api: { pub: { stats: mocks.stats } },
}));

const joao: PublicAthleteRow = { id: 'jo', name: 'João Núñez', sex: 'M', city: 'Vitória', team_club: 'Tubarões' };
const ana: PublicAthleteRow = { id: 'an', name: 'Ana Souza', sex: 'F', city: 'Vila Velha', team_club: null };
const bia: PublicAthleteRow = { id: 'bi', name: 'Bia Lima', sex: 'F', city: null, team_club: null };
const results = [
  makeResult({ race_id: 'r1', entry_id: 'e1', date: '2025-10-05', members: [{ athlete_id: 'an', name: 'Ana Souza' }], final_ms: 1_500_000, overall_pos: 1 }),
  makeResult({
    race_id: 'r2', entry_id: 'e2', date: '2026-03-10', race: 'Revezamento', final_ms: 2_400_000, overall_pos: 2,
    members: [{ athlete_id: 'an', name: 'Ana Souza' }, { athlete_id: 'jo', name: 'João Núñez' }],
    legs: [{ athlete_id: 'an', modality: 'swim', label: 'Natação', distance_m: 750, time_ms: 800_000 }, { athlete_id: 'jo', time_ms: 1_600_000 }],
  }),
  makeResult({
    race_id: 'r3', entry_id: 'e3', date: '2026-05-01', race: 'Revezamento', final_ms: 2_500_000, overall_pos: 3,
    members: [{ athlete_id: 'an', name: 'Ana Souza' }, { athlete_id: 'px', name: 'Privada' }],
    legs: [{ athlete_id: 'an', modality: 'swim', label: 'Natação', distance_m: 750, time_ms: 790_000 }, { athlete_id: 'px', time_ms: 1_710_000 }],
  }),
];
const payload: PubStatsPayload = { athletes: [joao, ana, bia], results };

beforeEach(() => {
  mocks.stats.mockReset().mockResolvedValue(payload);
});

const renderDirectory = () => renderWithProviders(<PublicAthletesPage />, { route: '/perfis', path: '/perfis' });
const renderProfile = (route = '/atleta/an') => renderWithProviders(<PublicAthletePage />, { route, path: '/atleta/:athleteId' });
const tile = (label: string) => screen.getByText(label).nextElementSibling?.textContent;

describe('PublicAthletesPage (#/perfis)', () => {
  it('lists the public athletes A→Z with city, club and how many races', async () => {
    renderDirectory();
    const rows = await screen.findAllByTestId('athlete-row');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Ana Souza'), expect.stringContaining('Bia Lima'), expect.stringContaining('João Núñez'),
    ]);
    expect(rows[0]).toHaveTextContent('Vila Velha');
    expect(rows[0]).toHaveTextContent('3 provas');
    expect(rows[1]).toHaveTextContent('0 provas');
    expect(rows[2]).toHaveTextContent('Vitória · Tubarões');
    expect(rows[2]).toHaveTextContent('1 prova');
    expect(rows[0]).toHaveAttribute('href', '/atleta/an');
  });

  it('searches ignoring accents, case and surrounding spaces (Review Focus 4)', async () => {
    const user = userEvent.setup();
    renderDirectory();
    await user.type(await screen.findByTestId('athlete-search'), '  JOAO ');
    expect(screen.getAllByTestId('athlete-row').map((r) => r.textContent)).toEqual([expect.stringContaining('João Núñez')]);
    await user.clear(screen.getByTestId('athlete-search'));
    await user.type(screen.getByTestId('athlete-search'), 'zzz');
    expect(screen.getByText('Nenhum atleta encontrado')).toBeInTheDocument();
  });

  it('filters by sex', async () => {
    const user = userEvent.setup();
    renderDirectory();
    await screen.findAllByTestId('athlete-row');
    await user.click(screen.getByRole('button', { name: 'Feminino' }));
    expect(screen.getAllByTestId('athlete-row').map((r) => r.textContent)).toEqual([
      expect.stringContaining('Ana Souza'), expect.stringContaining('Bia Lima'),
    ]);
  });

  it('says when there is no public athlete yet', async () => {
    mocks.stats.mockResolvedValue({ athletes: [], results: [] });
    renderDirectory();
    expect(await screen.findByText('Nenhum atleta com perfil público ainda')).toBeInTheDocument();
  });

  it('offers a retry after a load error', async () => {
    const user = userEvent.setup();
    mocks.stats.mockRejectedValueOnce(new Error('offline'));
    renderDirectory();
    expect(await screen.findByText('Não foi possível carregar os atletas.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findAllByTestId('athlete-row')).toHaveLength(3);
  });

  it('the header navigation marks "Atletas" as the current page', async () => {
    renderDirectory();
    await screen.findAllByTestId('athlete-row');
    expect(screen.getByTestId('public-nav-events')).toHaveAttribute('href', '/');
    expect(screen.getByTestId('public-nav-ranking')).toHaveAttribute('href', '/ranking');
    expect(screen.getByTestId('public-nav-athletes')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('public-nav-events')).not.toHaveAttribute('aria-current');
  });
});

describe('PublicAthletePage (#/atleta/:id)', () => {
  it('shows the header and the career by default, with the years to choose from', async () => {
    renderProfile();
    expect(await screen.findByRole('heading', { name: 'Ana Souza' })).toBeInTheDocument();
    const year = screen.getByTestId('year-filter');
    expect(within(year).getAllByRole('option').map((o) => o.textContent)).toEqual(['Carreira', '2026', '2025']);
    expect(year).toHaveValue('carreira');
    expect(tile('Participações')).toBe('3');
  });

  it('?ano=2025 filters every number', async () => {
    renderProfile('/atleta/an?ano=2025');
    await screen.findByRole('heading', { name: 'Ana Souza' });
    expect(screen.getByTestId('year-filter')).toHaveValue('2025');
    expect(tile('Participações')).toBe('1');
  });

  it('an unknown ?ano is the career (Review Focus 1)', async () => {
    renderProfile('/atleta/an?ano=abc');
    await screen.findByRole('heading', { name: 'Ana Souza' });
    expect(screen.getByTestId('year-filter')).toHaveValue('carreira');
    expect(tile('Participações')).toBe('3');
  });

  it('choosing a year writes ?ano to the URL', async () => {
    const user = userEvent.setup();
    const { router } = renderProfile();
    await screen.findByRole('heading', { name: 'Ana Souza' });
    await user.selectOptions(screen.getByTestId('year-filter'), '2026');
    expect(router.state.location.search).toBe('?ano=2026');
    expect(tile('Participações')).toBe('2');
  });

  it('links a public partner to "Nós dois" (keeping the year) and leaves a private one as text', async () => {
    renderProfile('/atleta/an?ano=2026');
    await screen.findByRole('heading', { name: 'Ana Souza' });
    expect(screen.getByRole('link', { name: 'João Núñez' })).toHaveAttribute('href', '/comparar/an/jo?ano=2026');
    expect(screen.getByText('Privada')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Privada' })).not.toBeInTheDocument();
  });

  it('"Comparar com…" picks another athlete (never the same one) and opens "Nós dois"', async () => {
    const user = userEvent.setup();
    const { router } = renderProfile();
    await screen.findByRole('heading', { name: 'Ana Souza' });
    await user.click(screen.getByTestId('compare-with'));
    const picker = screen.getByTestId('compare-picker');
    expect(within(picker).queryByRole('button', { name: /Ana Souza/ })).not.toBeInTheDocument();
    await user.type(within(picker).getByLabelText('Buscar atleta'), 'bia');
    await user.click(within(picker).getByRole('button', { name: /Bia Lima/ }));
    expect(router.state.location.pathname).toBe('/comparar/an/bi');
  });

  it('a private or unknown athlete gets the not-found message', async () => {
    renderProfile('/atleta/px');
    expect(await screen.findByText('Atleta não encontrado ou perfil privado')).toBeInTheDocument();
  });

  it('sets and resets the page title (C-Minor-15)', async () => {
    const { unmount } = renderProfile();
    await screen.findByRole('heading', { name: 'Ana Souza' });
    expect(document.title).toBe('Ana Souza – EnduranceBaseClub');
    unmount();
    expect(document.title).toBe('EnduranceBaseClub');
  });
});
