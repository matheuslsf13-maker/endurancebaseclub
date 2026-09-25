import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import { iso, makeAthlete, makeEntry, makeEvent, makeRace, makeWave, T0 } from '../../domain/testing/fixtures';
import type { EventAggregate } from '../../lib/types';
import { EventProvider } from '../events/EventContext';
import EntriesTab from './EntriesTab';

const mocks = vi.hoisted(() => ({
  listAthletes: vi.fn(),
  saveAthlete: vi.fn(),
  saveEntry: vi.fn(),
  bulkCreateEntries: vi.fn(),
  updateEntryStatus: vi.fn(),
  deleteEntry: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  api: {
    admin: {
      listAthletes: mocks.listAthletes,
      saveAthlete: mocks.saveAthlete,
      saveEntry: mocks.saveEntry,
      bulkCreateEntries: mocks.bulkCreateEntries,
      updateEntryStatus: mocks.updateEntryStatus,
      deleteEntry: mocks.deleteEntry,
    },
  },
}));
const { listAthletes, saveAthlete, saveEntry, bulkCreateEntries, updateEntryStatus, deleteEntry } = mocks;

const ANA = makeAthlete({ id: 'a1', name: 'Ana Souza', sex: 'F', birth_date: '1990-06-15' });
const BETO = makeAthlete({ id: 'a2', name: 'Beto Lima', sex: 'M', birth_date: '1988-01-01' });

function makeAgg(p: Partial<EventAggregate> = {}): EventAggregate {
  return {
    event: makeEvent({ id: 'ev1', name: 'Copa EBC', levels: [] }),
    races: [], waves: [], entries: [], athletes: [], timekeepers: [],
    marks: [], resolutions: [], results: [], version: 1, server_now: iso(T0), ...p,
  };
}

function renderTab(agg: EventAggregate, refresh = vi.fn(async () => {})) {
  renderWithProviders(
    <EventProvider eventId="ev1" agg={agg} refresh={refresh} patchAgg={vi.fn()}>
      <EntriesTab />
    </EventProvider>,
  );
  return { refresh };
}

beforeEach(() => {
  vi.clearAllMocks();
  listAthletes.mockResolvedValue([ANA, BETO]);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('entries list', () => {
  it('shows pernas, onda and status for each entry', () => {
    const race = makeRace({
      id: 'r1', name: 'Revezamento', team_size: 2,
      legs: [{ modality: 'swim', label: 'Natação', distance_m: 750 }, { modality: 'run', label: 'Corrida', distance_m: 5000 }],
    });
    const wave = makeWave({ id: 'w1', race_id: 'r1', name: 'Largada geral' });
    const entry = makeEntry({
      id: 'en1', race_id: 'r1', wave_id: 'w1', bib: '101', team_name: 'Dupla A', status: 'ok',
      members: [{ athlete_id: 'a1', position: 0, legs: [0] }, { athlete_id: 'a2', position: 1, legs: [1] }],
    });
    renderTab(makeAgg({ races: [race], waves: [wave], entries: [entry], athletes: [ANA, BETO] }));

    expect(screen.getByText('Dupla A')).toBeInTheDocument();
    expect(screen.getByText('Ana Souza – Natação · Beto Lima – Corrida')).toBeInTheDocument();
    expect(screen.getByText('Largada geral')).toBeInTheDocument();
    expect(screen.getByText('Normal')).toBeInTheDocument();
  });

  it('shows an empty state with no races', () => {
    renderTab(makeAgg());
    expect(screen.getByText(/cadastre uma prova/i)).toBeInTheDocument();
    expect(screen.queryByTestId('new-entry')).not.toBeInTheDocument();
  });

  it('filters by race and by accent-insensitive search', async () => {
    const user = userEvent.setup();
    const race1 = makeRace({ id: 'r1', name: 'Aquathlon', team_size: 1 });
    const race2 = makeRace({ id: 'r2', name: 'Corrida', team_size: 1 });
    const entries = [
      makeEntry({ id: 'en1', race_id: 'r1', bib: '1', members: [{ athlete_id: 'a1', position: 0, legs: [0] }] }),
      makeEntry({ id: 'en2', race_id: 'r2', bib: '2', members: [{ athlete_id: 'a2', position: 0, legs: [0] }] }),
    ];
    renderTab(makeAgg({ races: [race1, race2], entries, athletes: [ANA, BETO] }));

    expect(screen.getByText('Ana Souza')).toBeInTheDocument();
    expect(screen.getByText('Beto Lima')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Buscar'), 'ana'); // no accent, lowercase
    expect(screen.getByText('Ana Souza')).toBeInTheDocument();
    expect(screen.queryByText('Beto Lima')).not.toBeInTheDocument();
  });
});

describe('creating a team entry', () => {
  it('assigns legs to each member and saves the exact payload', async () => {
    const user = userEvent.setup();
    saveEntry.mockResolvedValue(makeEntry({ id: 'en9' }));
    const race = makeRace({
      id: 'r1', name: 'Revezamento', team_size: 2,
      legs: [{ modality: 'swim', label: 'Natação', distance_m: 750 }, { modality: 'run', label: 'Corrida', distance_m: 5000 }],
    });
    const { refresh } = renderTab(makeAgg({ races: [race] }));

    await user.click(screen.getByTestId('new-entry'));
    await user.type(screen.getByTestId('entry-team-name'), 'Dupla A');

    await user.type(screen.getByTestId('entry-member-0'), 'Ana');
    await user.click(await screen.findByTestId('entry-member-0-option-a1'));
    await user.type(screen.getByTestId('entry-member-1'), 'Beto');
    await user.click(await screen.findByTestId('entry-member-1-option-a2'));

    // Swap the default assignment: leg 0 (Natação) to Beto (member index 1), leg 1 (Corrida) to Ana (member index 0).
    await user.selectOptions(screen.getByTestId('entry-leg-0'), '1');
    await user.selectOptions(screen.getByTestId('entry-leg-1'), '0');

    await user.type(screen.getByTestId('entry-bib'), '101');
    await user.click(screen.getByTestId('entry-save'));

    await waitFor(() => expect(saveEntry).toHaveBeenCalledTimes(1));
    const payload = saveEntry.mock.calls[0][0];
    expect(payload.race_id).toBe('r1');
    expect(payload.team_name).toBe('Dupla A');
    expect(payload.bib).toBe('101');
    expect(payload.members).toEqual([
      { athlete_id: 'a1', legs: [1] },
      { athlete_id: 'a2', legs: [0] },
    ]);
    expect(refresh).toHaveBeenCalled();
  });

  it('blocks save and shows validation messages when required fields are missing', async () => {
    const user = userEvent.setup();
    const race = makeRace({ id: 'r1', team_size: 2 });
    renderTab(makeAgg({ races: [race] }));

    await user.click(screen.getByTestId('new-entry'));
    await user.click(screen.getByTestId('entry-save'));

    expect(await screen.findByText('Informe o nome da equipe')).toBeInTheDocument();
    expect(screen.getByText('Escolha o atleta 1')).toBeInTheDocument();
    expect(screen.getByText('Escolha o atleta 2')).toBeInTheDocument();
    expect(saveEntry).not.toHaveBeenCalled();
  });

  it('surfaces the server error in a banner instead of closing the modal', async () => {
    const user = userEvent.setup();
    const race = makeRace({ id: 'r2', team_size: 1 });
    renderTab(makeAgg({ races: [race] }));

    await user.click(screen.getByTestId('new-entry'));
    await user.type(screen.getByTestId('entry-member-0'), 'Ana');
    await user.click(await screen.findByTestId('entry-member-0-option-a1'));

    const { ApiError } = await import('../../lib/api');
    saveEntry.mockRejectedValueOnce(new ApiError('Nº já usado nesta prova'));
    await user.click(screen.getByTestId('entry-save'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Nº já usado nesta prova');
    expect(screen.getByTestId('entry-save')).toBeInTheDocument(); // modal stayed open
  });

  it('creates a new athlete inline from the member picker and saves the entry with its id', async () => {
    const user = userEvent.setup();
    saveAthlete.mockResolvedValue(makeAthlete({ id: 'a9', name: 'Carla Nova', sex: 'F' }));
    saveEntry.mockResolvedValue(makeEntry({ id: 'en9' }));
    const race = makeRace({ id: 'r2', team_size: 1, legs: [{ modality: 'run', label: 'Corrida', distance_m: 5000 }] });
    renderTab(makeAgg({ races: [race] }));

    await user.click(screen.getByTestId('new-entry'));
    await user.type(screen.getByTestId('entry-member-0'), 'Carla');
    await user.click(await screen.findByText('+ Novo atleta'));

    await user.type(screen.getByTestId('athlete-name'), 'Carla Nova');
    await user.click(screen.getByTestId('athlete-save'));
    await waitFor(() => expect(screen.queryByTestId('athlete-name')).not.toBeInTheDocument());

    await user.click(screen.getByTestId('entry-save'));
    await waitFor(() => expect(saveEntry).toHaveBeenCalledTimes(1));
    expect(saveEntry.mock.calls[0][0].members).toEqual([{ athlete_id: 'a9', legs: [0] }]);
  });
});

describe('editing an existing entry', () => {
  it('prefills the form from the entry and race', async () => {
    const user = userEvent.setup();
    const race = makeRace({ id: 'r1', team_size: 1, legs: [{ modality: 'run', label: 'Corrida', distance_m: 5000 }] });
    const entry = makeEntry({ id: 'en1', race_id: 'r1', bib: '7', members: [{ athlete_id: 'a1', position: 0, legs: [0] }] });
    renderTab(makeAgg({ races: [race], entries: [entry], athletes: [ANA] }));

    await user.click(screen.getByText('Editar'));
    expect(screen.getByTestId('entry-bib')).toHaveValue('7');
    expect(screen.getByTestId('entry-member-0')).toHaveValue('Ana Souza');
  });
});

describe('status/penalidade', () => {
  it('parses the m:ss penalty and calls updateEntryStatus with milliseconds', async () => {
    const user = userEvent.setup();
    const race = makeRace({ id: 'r1', team_size: 1 });
    const entry = makeEntry({ id: 'en1', race_id: 'r1', status: 'ok', penalty_ms: 0, notes: '' });
    updateEntryStatus.mockResolvedValue({ ...entry, status: 'dnf', penalty_ms: 90_000 });
    const { refresh } = renderTab(makeAgg({ races: [race], entries: [entry], athletes: [ANA] }));

    await user.click(screen.getByText('Status/penalidade'));
    await user.selectOptions(screen.getByTestId('entry-status-select'), 'dnf');
    await user.clear(screen.getByTestId('entry-penalty-input'));
    await user.type(screen.getByTestId('entry-penalty-input'), '1:30');
    await user.click(screen.getByTestId('entry-status-save'));

    await waitFor(() => expect(updateEntryStatus).toHaveBeenCalledWith('en1', 'dnf', 90_000, ''));
    expect(refresh).toHaveBeenCalled();
  });

  it('shows a validation message for an invalid penalty instead of saving', async () => {
    const user = userEvent.setup();
    const race = makeRace({ id: 'r1', team_size: 1 });
    const entry = makeEntry({ id: 'en1', race_id: 'r1' });
    renderTab(makeAgg({ races: [race], entries: [entry], athletes: [ANA] }));

    await user.click(screen.getByText('Status/penalidade'));
    await user.clear(screen.getByTestId('entry-penalty-input'));
    await user.type(screen.getByTestId('entry-penalty-input'), 'abc');
    await user.click(screen.getByTestId('entry-status-save'));

    expect(await screen.findByText(/penalidade inválida/i)).toBeInTheDocument();
    expect(updateEntryStatus).not.toHaveBeenCalled();
  });
});

describe('deleting an entry', () => {
  it('deletes after confirmation and refreshes', async () => {
    const user = userEvent.setup();
    const race = makeRace({ id: 'r1', team_size: 1 });
    const entry = makeEntry({ id: 'en1', race_id: 'r1' });
    const { refresh } = renderTab(makeAgg({ races: [race], entries: [entry], athletes: [ANA] }));

    await user.click(screen.getByText('Excluir'));
    await user.click(screen.getByTestId('confirm-ok'));

    expect(deleteEntry).toHaveBeenCalledWith('en1');
    expect(refresh).toHaveBeenCalled();
  });
});

describe('bulk entry dialog', () => {
  it('creates one entry per selected athlete for the chosen individual race', async () => {
    const user = userEvent.setup();
    const race = makeRace({ id: 'r2', name: 'Corrida 5km', team_size: 1 });
    bulkCreateEntries.mockResolvedValue([makeEntry({ id: 'en1' }), makeEntry({ id: 'en2' })]);
    const { refresh } = renderTab(makeAgg({ races: [race] }));

    await user.click(screen.getByTestId('bulk-entries'));
    await user.click(await screen.findByText('Ana Souza'));
    await user.click(screen.getByText('Beto Lima'));
    await user.click(screen.getByTestId('bulk-confirm'));

    await waitFor(() => expect(bulkCreateEntries).toHaveBeenCalledTimes(1));
    expect(bulkCreateEntries).toHaveBeenCalledWith('r2', expect.arrayContaining(['a1', 'a2']));
    expect(bulkCreateEntries.mock.calls[0][1]).toHaveLength(2);
    expect(refresh).toHaveBeenCalled();
  });

  it('only offers individual races', async () => {
    const user = userEvent.setup();
    const teamRace = makeRace({ id: 'r1', name: 'Revezamento', team_size: 2 });
    renderTab(makeAgg({ races: [teamRace] }));

    await user.click(screen.getByTestId('bulk-entries'));
    expect(screen.getByText(/nenhuma prova individual/i)).toBeInTheDocument();
    expect(screen.getByTestId('bulk-confirm')).toBeDisabled();
  });
});
