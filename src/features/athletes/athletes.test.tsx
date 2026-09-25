import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormEvent } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '../../test/renderWithProviders';
import { Modal } from '../../components/ui';
import type { AthleteRow, ImportResult, ResultRow, ResultSnapshot } from '../../lib/types';

const mocks = vi.hoisted(() => ({
  listAthletes: vi.fn(),
  saveAthlete: vi.fn(),
  deleteAthlete: vi.fn(),
  importAthletes: vi.fn(),
  athleteProfile: vi.fn(),
  listEvents: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  api: {
    admin: {
      listAthletes: mocks.listAthletes,
      saveAthlete: mocks.saveAthlete,
      deleteAthlete: mocks.deleteAthlete,
      importAthletes: mocks.importAthletes,
      athleteProfile: mocks.athleteProfile,
      listEvents: mocks.listEvents,
    },
  },
}));
const { listAthletes, saveAthlete, deleteAthlete, importAthletes, athleteProfile, listEvents } = mocks;

import { ApiError } from '../../lib/api';
import { AthleteForm } from './AthleteForm';
import { ImportDialog } from './ImportDialog';
import { StatsView } from './StatsView';
import AthletesPage from './AthletesPage';
import AthleteProfilePage from './AthleteProfilePage';

beforeEach(() => {
  vi.clearAllMocks();
  listEvents.mockResolvedValue([]);
});
afterEach(() => {
  vi.useRealTimers();
});

function makeAthlete(p: Partial<AthleteRow> = {}): AthleteRow {
  return {
    id: 'a1', name: 'Ana Souza', sex: 'F', birth_date: '1990-06-15', email: null, phone: null,
    city: null, team_club: null, notes: '', public_profile: true, ...p,
  };
}

describe('AthleteForm', () => {
  it('creates an athlete, converting the dd/mm/aaaa birth date, and reports the saved row', async () => {
    const user = userEvent.setup();
    const saved = makeAthlete({ id: 'a9', name: 'Nova Atleta' });
    saveAthlete.mockResolvedValue(saved);
    const onSaved = vi.fn();

    renderWithProviders(<AthleteForm onSaved={onSaved} onCancel={vi.fn()} />);
    await user.type(screen.getByTestId('athlete-name'), 'Nova Atleta');
    await user.selectOptions(screen.getByTestId('athlete-sex'), 'F');
    await user.type(screen.getByTestId('athlete-birth'), '15/06/1990');
    await user.click(screen.getByTestId('athlete-save'));

    await waitFor(() =>
      expect(saveAthlete).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Nova Atleta', sex: 'F', birth_date: '1990-06-15' }),
      ),
    );
    expect(onSaved).toHaveBeenCalledWith(saved);
  });

  it('prefills from `initial` and sends its id back so the save updates the same athlete', async () => {
    const user = userEvent.setup();
    const initial = makeAthlete({ id: 'a1', name: 'Ana Souza', birth_date: '1990-06-15' });
    saveAthlete.mockResolvedValue(initial);
    renderWithProviders(<AthleteForm initial={initial} onSaved={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByTestId('athlete-name')).toHaveValue('Ana Souza');
    expect(screen.getByTestId('athlete-birth')).toHaveValue('15/06/1990');
    await user.click(screen.getByTestId('athlete-save'));

    await waitFor(() => expect(saveAthlete).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' })));
  });

  it('shows the server error message and does not call onSaved when saving fails', async () => {
    const user = userEvent.setup();
    saveAthlete.mockRejectedValue(new ApiError('Já existe um atleta com esse nome', 'P0001'));
    const onSaved = vi.fn();
    renderWithProviders(<AthleteForm onSaved={onSaved} onCancel={vi.fn()} />);

    await user.type(screen.getByTestId('athlete-name'), 'Duplicado');
    await user.click(screen.getByTestId('athlete-save'));

    expect(await screen.findByText('Já existe um atleta com esse nome')).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('rejects an invalid birth date locally without calling saveAthlete', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AthleteForm onSaved={vi.fn()} onCancel={vi.fn()} />);

    await user.type(screen.getByTestId('athlete-name'), 'Fulano');
    await user.type(screen.getByTestId('athlete-birth'), '31/02/2000');
    await user.click(screen.getByTestId('athlete-save'));

    expect(await screen.findByText(/data.*inv/i)).toBeInTheDocument();
    expect(saveAthlete).not.toHaveBeenCalled();
  });

  it('calls onCancel when Cancelar is clicked', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderWithProviders(<AthleteForm onSaved={vi.fn()} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('does not let its submit bubble into an outer form when reused inside a modal in another form (Task 21 nests it in EntryForm)', async () => {
    const user = userEvent.setup();
    saveAthlete.mockResolvedValue(makeAthlete());
    const outerSpy = vi.fn((e: FormEvent<HTMLFormElement>) => e.preventDefault());

    renderWithProviders(
      <form onSubmit={outerSpy}>
        <Modal open onClose={vi.fn()} title="Novo atleta">
          <AthleteForm onSaved={vi.fn()} onCancel={vi.fn()} />
        </Modal>
      </form>,
    );

    await user.type(screen.getByTestId('athlete-name'), 'Fulano');
    await user.click(screen.getByTestId('athlete-save'));

    await waitFor(() => expect(saveAthlete).toHaveBeenCalled());
    expect(outerSpy).not.toHaveBeenCalled();
  });
});

// Review Focus 3 (Brazilian spreadsheets on import): the exact table from Task 14's
// importMapping.test.ts, serialized as a ';'-delimited CSV — 2 valid rows, 3 bad rows.
const REVIEW_FOCUS_3_HEADER = ['Nome Completo', 'Gênero', 'Data de Nascimento', 'E-mail', 'Celular', 'Cidade', 'Assessoria', 'Prova'];
const REVIEW_FOCUS_3_ROWS = [
  ['  Ana   Souza ', 'Feminino', '15/06/1990', 'ANA@X.COM', '27 99999-0000', 'Vitória', 'EBC Team', 'Corrida 5K'],
  ['Beto', 'masc', '33039', '', '', '', '', ''],
  ['', 'F', '', '', '', '', '', ''],
  ['Caio', 'X', '', '', '', '', '', ''],
  ['Dani', 'fem', '31/02/1990', '', '', '', '', ''],
  ['', '', '', '', '', '', '', ''],
];
const REVIEW_FOCUS_3_CSV = [REVIEW_FOCUS_3_HEADER, ...REVIEW_FOCUS_3_ROWS].map((r) => r.join(';')).join('\n');

function csvFile(text: string, name = 'atletas.csv'): File {
  return new File([text], name, { type: 'text/csv' });
}

/** Bytes for a Windows-1252 CSV: every char here sits in the ASCII/Latin-1 range, where the
 * Unicode code point and the cp1252 byte coincide, so this doubles as a literal encoder. */
function latin1Bytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

describe('ImportDialog', () => {
  it('parses a Brazilian CSV (UTF-8, ; delimiter, dd/mm/aaaa, Excel serial date), previews 2 valid rows and 3 errors by row number, and imports with no event selected', async () => {
    const user = userEvent.setup();
    const result: ImportResult = { inserted: 2, updated: 0, entries_created: 0, errors: [] };
    importAthletes.mockResolvedValue(result);
    const onImported = vi.fn();

    renderWithProviders(<ImportDialog open onClose={vi.fn()} onImported={onImported} />);

    await user.upload(screen.getByTestId('import-file'), csvFile(REVIEW_FOCUS_3_CSV));

    expect(await screen.findByText(/2 atleta/)).toBeInTheDocument();
    expect(screen.getByText(/3 erro/)).toBeInTheDocument();
    expect(screen.getByText('Linha 4: Nome vazio')).toBeInTheDocument();
    expect(screen.getByText('Linha 5: Sexo inválido: "X"')).toBeInTheDocument();
    expect(screen.getByText('Linha 6: Data de nascimento inválida: "31/02/1990"')).toBeInTheDocument();
    expect(screen.getByText('Ana Souza')).toBeInTheDocument();
    expect(screen.getByText('Beto')).toBeInTheDocument();

    await user.click(screen.getByTestId('import-confirm'));

    await waitFor(() =>
      expect(importAthletes).toHaveBeenCalledWith(null, [
        { name: 'Ana Souza', sex: 'F', birth_date: '1990-06-15', email: 'ana@x.com', phone: '27 99999-0000', city: 'Vitória', team_club: 'EBC Team', race_name: 'Corrida 5K' },
        { name: 'Beto', sex: 'M', birth_date: '1990-06-15', email: null, phone: null, city: null, team_club: null, race_name: null },
      ]),
    );
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/2 novos, 0 atualizados, 0 inscrições/)).toBeInTheDocument();
  });

  it('imports into the chosen event when one is selected', async () => {
    const user = userEvent.setup();
    listEvents.mockResolvedValue([
      { id: 'ev1', name: 'Copa EBC', date: '2026-10-11', location: '', description: '', levels: [], status: 'planejado', is_public: false, public_slug: null, version: 1, races_count: 1, entries_count: 0 },
    ]);
    importAthletes.mockResolvedValue({ inserted: 2, updated: 0, entries_created: 1, errors: [] });
    renderWithProviders(<ImportDialog open onClose={vi.fn()} onImported={vi.fn()} />);

    await user.upload(screen.getByTestId('import-file'), csvFile(REVIEW_FOCUS_3_CSV));
    await screen.findByText(/2 atleta/);
    await user.selectOptions(screen.getByLabelText(/Inscrever na prova/), 'ev1');
    await user.click(screen.getByTestId('import-confirm'));

    await waitFor(() => expect(importAthletes).toHaveBeenCalledWith('ev1', expect.any(Array)));
  });

  it('re-decodes as Windows-1252 when the UTF-8 reading shows replacement characters', async () => {
    const user = userEvent.setup();
    importAthletes.mockResolvedValue({ inserted: 1, updated: 0, entries_created: 0, errors: [] });
    renderWithProviders(<ImportDialog open onClose={vi.fn()} onImported={vi.fn()} />);

    const text = 'Nome;Sexo;Data de nascimento;E-mail;Telefone;Cidade;Equipe;Prova\nJosé Vitória;M;;;;;;';
    const file = new File([latin1Bytes(text) as BlobPart], 'latin1.csv', { type: 'text/csv' });

    await user.upload(screen.getByTestId('import-file'), file);
    expect(await screen.findByText('José Vitória')).toBeInTheDocument();
  });

  it('shows the server error and keeps the preview when the import call fails', async () => {
    const user = userEvent.setup();
    importAthletes.mockRejectedValue(new ApiError('Evento não encontrado', 'P0001'));
    renderWithProviders(<ImportDialog open onClose={vi.fn()} onImported={vi.fn()} />);

    await user.upload(screen.getByTestId('import-file'), csvFile(REVIEW_FOCUS_3_CSV));
    await screen.findByText(/2 atleta/);
    await user.click(screen.getByTestId('import-confirm'));

    expect(await screen.findByText('Evento não encontrado')).toBeInTheDocument();
  });

  it('offers a template download link with the expected header', () => {
    renderWithProviders(<ImportDialog open onClose={vi.fn()} onImported={vi.fn()} />);
    const link = screen.getByRole('link', { name: /baixar modelo/i });
    expect(decodeURIComponent(link.getAttribute('href') ?? '')).toContain(
      'Nome;Sexo;Data de nascimento;E-mail;Telefone;Cidade;Equipe;Prova',
    );
  });
});

// The Task 12 (`src/domain/stats.test.ts`) fixture, copied verbatim so this test exercises the
// real shape computeAthleteStats works with.
function result(p: { date: string; name: string; race: string; status: ResultSnapshot['status']; final: number | null; pos: number | null; fin: number; podiums?: ResultSnapshot['podiums']; members?: ResultSnapshot['members']; legs: ResultSnapshot['legs'] }): ResultRow {
  const members = p.members ?? [{ athlete_id: 'a1', name: 'Ana', legs: p.legs.map((l) => l.leg_index) }];
  return {
    race_id: `r-${p.date}`, entry_id: `en-${p.date}`, event_id: `e-${p.date}`, athlete_ids: members.map((m) => m.athlete_id),
    status: p.status, final_ms: p.final, overall_pos: p.pos, finalized_at: `${p.date}T20:00:00Z`,
    data: { event: { id: `e-${p.date}`, name: p.name, date: p.date }, race: { id: `r-${p.date}`, name: p.race, team_size: members.length }, bib: '1', team_name: members.length > 1 ? 'Tubarões' : null, members, legs: p.legs, category: { sex: 'F', age: 36, age_group: '30-39', level: null }, status: p.status, total_ms: p.final, penalty_ms: 0, final_ms: p.final, positions: { overall: p.pos, sex: p.pos, finishers: p.fin }, podiums: p.podiums ?? [] },
  };
}
const run = (t: number | null) => ({ leg_index: 0, modality: 'run' as const, label: 'Corrida', distance_m: 5000, athlete_id: 'a1', time_ms: t });
const STATS_FIXTURE_RESULTS = [
  result({ date: '2026-03-10', name: 'Etapa 1', race: 'Corrida 5K', status: 'finished', final: 1_350_000, pos: 1, fin: 20, podiums: [{ ranking_id: 'geral', ranking_name: 'Geral', group_label: 'Feminino', podium_pos: 1 }], legs: [run(1_350_000)] }),
  result({ date: '2026-06-20', name: 'Etapa 2', race: 'Aquathlon Revezamento', status: 'finished', final: 2_400_000, pos: 3, fin: 12, podiums: [{ ranking_id: 'geral', ranking_name: 'Geral', group_label: 'Misto', podium_pos: 2 }],
    members: [{ athlete_id: 'a1', name: 'Ana', legs: [0] }, { athlete_id: 'a2', name: 'Bia', legs: [1] }],
    legs: [{ leg_index: 0, modality: 'swim', label: 'Natação', distance_m: 750, athlete_id: 'a1', time_ms: 750_000 }, { leg_index: 1, modality: 'run', label: 'Corrida', distance_m: 5000, athlete_id: 'a2', time_ms: 1_650_000 }] }),
  result({ date: '2026-09-01', name: 'Etapa 3', race: 'Corrida 5K', status: 'dnf', final: null, pos: null, fin: 25, legs: [run(null)] }),
  result({ date: '2026-09-20', name: 'Etapa 4', race: 'Corrida 5K', status: 'finished', final: 1_300_000, pos: 5, fin: 30, podiums: [{ ranking_id: 'faixa', ranking_name: 'Faixa etária', group_label: 'Feminino · 30-39', podium_pos: 1 }], legs: [run(1_300_000)] }),
];

describe('StatsView', () => {
  const athlete = makeAthlete();

  it('renders KPI tiles, personal records (including an empty pace cell for an "other" leg), the pace-by-modality table (excluding "other") and the evolution chart', () => {
    const otherLegResult = result({
      date: '2026-01-01', name: 'Etapa X', race: 'Prova Mista', status: 'finished', final: 500_000, pos: 1, fin: 5,
      legs: [{ leg_index: 0, modality: 'other', label: 'Transição', distance_m: 1000, athlete_id: 'a1', time_ms: 500_000 }],
    });
    renderWithProviders(<StatsView athlete={athlete} results={[...STATS_FIXTURE_RESULTS, otherLegResult]} />);

    expect(screen.getByText('Recordes pessoais')).toBeInTheDocument();
    expect(screen.getByText('Ritmo por modalidade')).toBeInTheDocument();
    expect(screen.getByText('4:20 /km')).toBeInTheDocument();
    // The swim record ("1:40 /100m") happens to equal the swim ritmo-por-modalidade cell too
    // (a single swim leg), so both tables show it — hence 2, not 1.
    expect(screen.getAllByText('1:40 /100m')).toHaveLength(2);
    expect(screen.getByText('4:25 /km')).toBeInTheDocument();
    // The "other" leg's record row shows its time with an empty pace cell (Ruling 20).
    const otherRow = screen.getByText('Outro', { selector: 'td' }).closest('tr');
    expect(otherRow).not.toBeNull();
    expect(otherRow).toHaveTextContent('8:20');
    expect(otherRow?.querySelector('td:nth-child(4)')).toHaveTextContent('');
    // pace_by_modality (Ritmo por modalidade) never lists "other": only run/swim/bike appear there.
    const paceSection = screen.getByText('Ritmo por modalidade').closest('section');
    expect(paceSection).not.toBeNull();
    expect(paceSection).not.toHaveTextContent('Outro');

    expect(screen.getByRole('img', { name: /Evolução/ })).toBeInTheDocument();
    expect(screen.getAllByText('Participações').length).toBeGreaterThan(0);
  });

  it('shows the empty state when the athlete has no finalized results', () => {
    renderWithProviders(<StatsView athlete={athlete} results={[]} />);
    expect(screen.getByText('Sem resultados oficiais ainda')).toBeInTheDocument();
  });

  it('routes partner links to the public athlete page in public mode', () => {
    renderWithProviders(<StatsView athlete={athlete} results={STATS_FIXTURE_RESULTS} publicMode />);
    expect(screen.getByRole('link', { name: 'Bia' })).toHaveAttribute('href', '/atleta/a2');
  });

  it('routes partner links to the organizer profile outside public mode', () => {
    renderWithProviders(<StatsView athlete={athlete} results={STATS_FIXTURE_RESULTS} />);
    expect(screen.getByRole('link', { name: 'Bia' })).toHaveAttribute('href', '/atletas/a2');
  });
});

describe('AthletesPage', () => {
  beforeEach(() => {
    listAthletes.mockResolvedValue([
      makeAthlete({ id: 'a1', name: 'Ana Souza', sex: 'F', city: 'Vitória', team_club: 'EBC', participations: 3, wins: 1, podiums: 2 }),
      makeAthlete({ id: 'a2', name: 'Beto Alves', sex: 'M', birth_date: null, city: 'Vila Velha', team_club: null, participations: 0, wins: 0, podiums: 0 }),
    ]);
  });

  it('lists athletes with a link from the name to the profile', async () => {
    renderWithProviders(<AthletesPage />);
    expect(await screen.findByText('Ana Souza')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ana Souza' })).toHaveAttribute('href', '/atletas/a1');
    expect(screen.getByText('Beto Alves')).toBeInTheDocument();
  });

  it('filters by search term on name/city/team, accent-insensitive', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AthletesPage />);
    await screen.findByText('Ana Souza');

    await user.type(screen.getByTestId('athlete-search'), 'vitoria');
    expect(screen.getByText('Ana Souza')).toBeInTheDocument();
    expect(screen.queryByText('Beto Alves')).not.toBeInTheDocument();
  });

  it('creates a new athlete through the modal and refreshes the list', async () => {
    const user = userEvent.setup();
    saveAthlete.mockResolvedValue(makeAthlete({ id: 'a3', name: 'Caio Lima', sex: 'M' }));
    renderWithProviders(<AthletesPage />);
    await screen.findByText('Ana Souza');

    await user.click(screen.getByTestId('new-athlete'));
    await user.type(screen.getByTestId('athlete-name'), 'Caio Lima');
    await user.click(screen.getByTestId('athlete-save'));

    await waitFor(() => expect(screen.queryByTestId('athlete-name')).not.toBeInTheDocument());
    await waitFor(() => expect(listAthletes).toHaveBeenCalledTimes(2));
  });

  it('deletes an athlete after confirming', async () => {
    const user = userEvent.setup();
    deleteAthlete.mockResolvedValue(undefined);
    renderWithProviders(<AthletesPage />);
    await screen.findByText('Ana Souza');

    await user.click(screen.getAllByRole('button', { name: 'Excluir' })[0]);
    await user.click(screen.getByTestId('confirm-ok'));

    await waitFor(() => expect(deleteAthlete).toHaveBeenCalledWith('a1'));
  });

  it('shows the server error message and does not remove the row when delete fails', async () => {
    const user = userEvent.setup();
    deleteAthlete.mockRejectedValue(new ApiError('Atleta possui inscrições', 'P0001'));
    renderWithProviders(<AthletesPage />);
    await screen.findByText('Ana Souza');

    await user.click(screen.getAllByRole('button', { name: 'Excluir' })[0]);
    await user.click(screen.getByTestId('confirm-ok'));

    expect(await screen.findByText('Atleta possui inscrições')).toBeInTheDocument();
    expect(screen.getByText('Ana Souza')).toBeInTheDocument();
  });

  it('opens the import dialog from the toolbar button', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AthletesPage />);
    await screen.findByText('Ana Souza');

    await user.click(screen.getByTestId('import-athletes'));
    expect(screen.getByTestId('import-file')).toBeInTheDocument();
  });
});

describe('AthleteProfilePage', () => {
  it('renders the athlete header, the public profile link and the stats view', async () => {
    athleteProfile.mockResolvedValue({
      athlete: makeAthlete({ id: 'a1', name: 'Ana Souza', city: 'Vitória', team_club: 'EBC' }),
      results: [],
    });
    renderWithProviders(<AthleteProfilePage />, { route: '/atletas/a1', path: '/atletas/:athleteId' });

    expect(await screen.findByRole('heading', { name: 'Ana Souza' })).toBeInTheDocument();
    expect(athleteProfile).toHaveBeenCalledWith('a1');
    expect(screen.getByRole('link', { name: /perfil público/i })).toHaveAttribute('href', '/atleta/a1');
    expect(screen.getByText('Sem resultados oficiais ainda')).toBeInTheDocument();
  });

  it('does not link to a public profile when the athlete opted out', async () => {
    athleteProfile.mockResolvedValue({ athlete: makeAthlete({ public_profile: false }), results: [] });
    renderWithProviders(<AthleteProfilePage />, { route: '/atletas/a1', path: '/atletas/:athleteId' });

    await screen.findByRole('heading', { name: 'Ana Souza' });
    expect(screen.queryByRole('link', { name: /perfil público/i })).not.toBeInTheDocument();
  });

  it('opens the edit modal, saves and refreshes the profile', async () => {
    const user = userEvent.setup();
    const initial = makeAthlete({ id: 'a1', name: 'Ana Souza' });
    athleteProfile.mockResolvedValue({ athlete: initial, results: [] });
    saveAthlete.mockResolvedValue({ ...initial, city: 'Vila Velha' });
    renderWithProviders(<AthleteProfilePage />, { route: '/atletas/a1', path: '/atletas/:athleteId' });

    await screen.findByRole('heading', { name: 'Ana Souza' });
    await user.click(screen.getByRole('button', { name: 'Editar' }));
    expect(screen.getByTestId('athlete-name')).toHaveValue('Ana Souza');
    await user.click(screen.getByTestId('athlete-save'));

    await waitFor(() => expect(screen.queryByTestId('athlete-name')).not.toBeInTheDocument());
    await waitFor(() => expect(athleteProfile).toHaveBeenCalledTimes(2));
  });

  it('deletes the athlete after confirming and shows the server error on failure', async () => {
    const user = userEvent.setup();
    athleteProfile.mockResolvedValue({ athlete: makeAthlete(), results: [] });
    deleteAthlete.mockRejectedValue(new ApiError('Atleta possui inscrições', 'P0001'));
    renderWithProviders(<AthleteProfilePage />, { route: '/atletas/a1', path: '/atletas/:athleteId' });

    await screen.findByRole('heading', { name: 'Ana Souza' });
    await user.click(screen.getByRole('button', { name: 'Excluir' }));
    await user.click(screen.getByTestId('confirm-ok'));

    expect(await screen.findByText('Atleta possui inscrições')).toBeInTheDocument();
  });
});
