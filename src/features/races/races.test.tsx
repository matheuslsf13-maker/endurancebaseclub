import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ConfirmProvider, ToastProvider } from '../../components/ui';
import { defaultRaceConfig } from '../../domain/presets';
import { iso, makeEntry, makeEvent, makeRace, makeTimekeeper, makeWave, T0 } from '../../domain/testing/fixtures';
import type { EventAggregate } from '../../lib/types';
import { EventProvider } from '../events/EventContext';
import RacesTab from './RacesTab';

const mocks = vi.hoisted(() => ({
  serverTime: vi.fn<() => Promise<number>>(),
  saveRace: vi.fn(),
  deleteRace: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  api: { serverTime: mocks.serverTime, admin: { saveRace: mocks.saveRace, deleteRace: mocks.deleteRace } },
}));
const { saveRace, deleteRace } = mocks;

function makeAgg(p: Partial<EventAggregate> = {}): EventAggregate {
  return {
    event: makeEvent({ id: 'ev1', name: 'Copa EBC', levels: [] }),
    races: [], waves: [], entries: [], athletes: [], timekeepers: [makeTimekeeper({ id: 'tk1', name: 'Ana' })],
    marks: [], resolutions: [], results: [], version: 1, server_now: iso(T0), ...p,
  };
}

// A data router (not a bare render) so `RaceEditor`'s `useBlocker` (C-Minor-6, unsaved-edits guard)
// has the router context it needs — RacesTab itself does no navigation of its own.
function renderTab(agg: EventAggregate, refresh = vi.fn(async () => {})) {
  const router = createMemoryRouter([
    {
      path: '/',
      element: (
        <ToastProvider>
          <ConfirmProvider>
            <EventProvider eventId="ev1" agg={agg} refresh={refresh} patchAgg={vi.fn()}>
              <RacesTab />
            </EventProvider>
          </ConfirmProvider>
        </ToastProvider>
      ),
    },
    // A second route for the unsaved-edits navigation-block test (C-Minor-6) to navigate to.
    { path: '/outra-aba', element: <p>Outra aba</p> },
  ]);
  render(<RouterProvider router={router} />);
  return { refresh, router };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.serverTime.mockImplementation(async () => Date.now());
});
afterEach(() => {
  vi.useRealTimers();
});

describe('RacesTab list', () => {
  it('shows each race with its team size, legs summary and inscriptions, and a finalizada badge only when finalized', () => {
    const races = [
      makeRace({ id: 'r1', name: 'Aquathlon', team_size: 1, legs: [{ modality: 'swim', label: 'Natação', distance_m: 750 }, { modality: 'run', label: 'Corrida', distance_m: 5000 }] }),
      makeRace({ id: 'r2', name: 'Revezamento', team_size: 2, finalized_at: iso(T0), legs: [{ modality: 'bike', label: 'Ciclismo', distance_m: 20000 }] }),
    ];
    const entries = [makeEntry({ id: 'en1', race_id: 'r1' }), makeEntry({ id: 'en2', race_id: 'r1' })];
    renderTab(makeAgg({ races, entries }));

    expect(screen.getByText('Aquathlon')).toBeInTheDocument();
    expect(screen.getByText('Individual')).toBeInTheDocument();
    expect(screen.getByText('Natação 750 m → Corrida 5 km')).toBeInTheDocument();
    expect(screen.getByText(/^2 inscri/)).toBeInTheDocument();

    expect(screen.getByText('Revezamento')).toBeInTheDocument();
    expect(screen.getByText('Dupla')).toBeInTheDocument();
    expect(screen.getByText(/^0 inscri/)).toBeInTheDocument();
    expect(screen.getByText('Finalizada')).toBeInTheDocument();
  });

  it('counts inscriptions in Portuguese: "1 inscrição", "0/2 inscrições" (never "inscriçãos") — Task 28 E2E', () => {
    const races = [
      makeRace({ id: 'r1', name: 'Duas', position: 0 }),
      makeRace({ id: 'r2', name: 'Uma', position: 1 }),
      makeRace({ id: 'r3', name: 'Nenhuma', position: 2 }),
    ];
    const entries = [makeEntry({ id: 'en1', race_id: 'r1' }), makeEntry({ id: 'en2', race_id: 'r1' }), makeEntry({ id: 'en3', race_id: 'r2' })];
    renderTab(makeAgg({ races, entries }));

    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('2 inscrições')).toBeInTheDocument();
    expect(within(rows[1]).getByText('1 inscrição')).toBeInTheDocument();
    expect(within(rows[2]).getByText('0 inscrições')).toBeInTheDocument();
    expect(screen.queryByText(/inscriçãos/)).not.toBeInTheDocument();
  });

  it('shows an empty state with no races', () => {
    renderTab(makeAgg());
    expect(screen.getByText(/nenhuma prova/i)).toBeInTheDocument();
  });
});

describe('creating a race from a preset', () => {
  it('prefills team defaults, reorders a leg and saves the exact payload', async () => {
    const user = userEvent.setup();
    renderTab(makeAgg());

    await user.click(screen.getByTestId('new-race'));
    await user.selectOptions(screen.getByTestId('race-preset'), 'Revezamento em dupla (natação + corrida)');

    expect(screen.getByTestId('race-team-size')).toHaveValue('2');
    // 0008 team defaults: "Geral" (no division, the overall podium) then "Geral por sexo"; the Nível
    // checkboxes are present but disabled (no event levels).
    expect(screen.getByTestId('ranking-name-0')).toHaveValue('Geral');
    expect(screen.getByTestId('ranking-overall-0')).toHaveTextContent('Pódio geral: todos juntos, sem divisão');
    expect(screen.getByTestId('ranking-name-1')).toHaveValue('Geral por sexo');
    expect(screen.getByTestId('ranking-dim-sex-1')).toBeChecked();
    expect(screen.queryByTestId('ranking-overall-1')).toBeNull();
    for (const box of screen.getAllByRole('checkbox', { name: 'Nível' })) expect(box).toBeDisabled();

    // legs start as [swim, run]; move the second one (run) up so it becomes [run, swim].
    await user.click(screen.getByTestId('leg-move-up-1'));

    saveRace.mockResolvedValue({ race: makeRace(), waves: [] });
    await user.click(screen.getByTestId('race-save'));

    expect(saveRace).toHaveBeenCalledTimes(1);
    const payload = saveRace.mock.calls[0][0];
    expect(payload.id).toBeUndefined();
    expect(payload.event_id).toBe('ev1');
    expect(payload.team_size).toBe(2);
    expect(payload.legs).toEqual([
      { modality: 'run', label: 'Corrida', distance_m: 5000 },
      { modality: 'swim', label: 'Natação', distance_m: 750 },
    ]);
    expect(payload.config).toEqual(defaultRaceConfig(2));
    expect(payload.waves).toEqual([{ name: 'Largada geral', position: 0 }]);
  });
});

describe('editing an existing race', () => {
  function setup() {
    const race = makeRace({ id: 'r1', event_id: 'ev1', name: 'Aquathlon', team_size: 1 });
    const waves = [
      makeWave({ id: 'w1', race_id: 'r1', name: 'Largada geral', position: 0, start_at: iso(T0) }),
      makeWave({ id: 'w2', race_id: 'r1', name: 'Onda 2', position: 1, start_at: null }),
    ];
    return renderTab(makeAgg({ races: [race], waves }));
  }

  it('prefills the form and shows each wave start time read-only', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByTestId('race-edit-r1'));

    expect(screen.getByTestId('race-name')).toHaveValue('Aquathlon');
    expect(screen.getByText(/Largou às 08:00:00\.0/)).toBeInTheDocument();
    expect(screen.getByText('Sem largada')).toBeInTheDocument();
    // No input lets the organizer type a start time here (set only in Cronometragem).
    expect(screen.queryByLabelText(/horário da largada/i)).not.toBeInTheDocument();
  });

  it('surfaces the server validation error in a banner instead of navigating away', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByTestId('race-edit-r1'));

    const { ApiError } = await import('../../lib/api');
    saveRace.mockRejectedValueOnce(new ApiError('Não é possível mudar as pernas: já existem marcações nesta prova'));
    await user.click(screen.getByTestId('race-save'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Não é possível mudar as pernas: já existem marcações nesta prova');
    expect(screen.getByTestId('race-save')).toBeInTheDocument();
  });

  it('C-I4: moves focus to the error banner after a failed save, instead of leaving "Salvar" with no visible feedback', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByTestId('race-edit-r1'));

    const { ApiError } = await import('../../lib/api');
    saveRace.mockRejectedValueOnce(new ApiError('Distância inválida na perna 2'));
    await user.click(screen.getByTestId('race-save'));

    const alert = await screen.findByRole('alert');
    expect(alert.parentElement?.parentElement).toHaveFocus();
  });
});

describe('C-I3 / round 2 item N2: a wave that has started or has entries cannot be removed from the form', () => {
  it('disables "Remover" and explains why for a wave that already started', async () => {
    const user = userEvent.setup();
    const race = makeRace({ id: 'r1', event_id: 'ev1', team_size: 1 });
    const waves = [
      makeWave({ id: 'w1', race_id: 'r1', name: 'Largada geral', position: 0, start_at: iso(T0) }),
      makeWave({ id: 'w2', race_id: 'r1', name: 'Onda 2', position: 1, start_at: null }),
    ];
    renderTab(makeAgg({ races: [race], waves }));
    await user.click(screen.getByTestId('race-edit-r1'));

    expect(screen.getByTestId('wave-remove-0')).toBeDisabled();
    expect(screen.getByTestId('wave-remove-reason-0')).toHaveTextContent('Já largou');
    // Clicking a disabled button does nothing — the wave is still there.
    await user.click(screen.getByTestId('wave-remove-0'));
    expect(screen.getByTestId('wave-remove-0')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('disables "Remover" and explains why for a wave with entries', async () => {
    const user = userEvent.setup();
    const race = makeRace({ id: 'r1', event_id: 'ev1', team_size: 1 });
    const waves = [
      makeWave({ id: 'w1', race_id: 'r1', name: 'Largada geral', position: 0, start_at: null }),
      makeWave({ id: 'w2', race_id: 'r1', name: 'Onda 2', position: 1, start_at: null }),
    ];
    const entries = [makeEntry({ id: 'en1', race_id: 'r1', wave_id: 'w2' }), makeEntry({ id: 'en2', race_id: 'r1', wave_id: 'w2' })];
    renderTab(makeAgg({ races: [race], waves, entries }));
    await user.click(screen.getByTestId('race-edit-r1'));

    expect(screen.getByTestId('wave-remove-1')).toBeDisabled();
    expect(screen.getByTestId('wave-remove-reason-1')).toHaveTextContent('2 inscrições');
  });

  it('removes a wave with neither a start nor entries immediately, with no dialog', async () => {
    const user = userEvent.setup();
    const race = makeRace({ id: 'r1', event_id: 'ev1', team_size: 1 });
    const waves = [
      makeWave({ id: 'w1', race_id: 'r1', name: 'Largada geral', position: 0, start_at: iso(T0) }),
      makeWave({ id: 'w2', race_id: 'r1', name: 'Onda 2', position: 1, start_at: null }),
    ];
    renderTab(makeAgg({ races: [race], waves }));
    await user.click(screen.getByTestId('race-edit-r1'));

    expect(screen.getByTestId('wave-remove-1')).not.toBeDisabled();
    await user.click(screen.getByTestId('wave-remove-1'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('wave-remove-1')).not.toBeInTheDocument();
  });
});

describe('B1-I2 / C-Minor-5: warning before changing legs or team size once entries exist', () => {
  it('warns with the entry count before a team-size change, and still allows it once confirmed', async () => {
    const user = userEvent.setup();
    const race = makeRace({ id: 'r1', event_id: 'ev1', team_size: 2 });
    const entries = [makeEntry({ id: 'en1', race_id: 'r1' })];
    renderTab(makeAgg({ races: [race], waves: [makeWave({ race_id: 'r1' })], entries }));
    await user.click(screen.getByTestId('race-edit-r1'));

    await user.selectOptions(screen.getByTestId('race-team-size'), '3');
    expect(screen.getByRole('dialog')).toHaveTextContent('1 inscrição');
    expect(screen.getByRole('dialog')).toHaveTextContent('não permite mudar o tamanho da equipe');
    await user.click(screen.getByTestId('confirm-ok'));

    expect(screen.getByTestId('race-team-size')).toHaveValue('3');
  });

  it('does not warn about entries when there are none', async () => {
    const user = userEvent.setup();
    const race = makeRace({ id: 'r1', event_id: 'ev1', team_size: 2 });
    renderTab(makeAgg({ races: [race], waves: [makeWave({ race_id: 'r1' })] }));
    await user.click(screen.getByTestId('race-edit-r1'));

    await user.selectOptions(screen.getByTestId('race-team-size'), '3');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('race-team-size')).toHaveValue('3');
  });

  it('warns with the entry count before adding a leg, and still allows it once confirmed', async () => {
    const user = userEvent.setup();
    const race = makeRace({ id: 'r1', event_id: 'ev1', team_size: 1 });
    const entries = [makeEntry({ id: 'en1', race_id: 'r1' }), makeEntry({ id: 'en2', race_id: 'r1' })];
    renderTab(makeAgg({ races: [race], waves: [makeWave({ race_id: 'r1' })], entries }));
    await user.click(screen.getByTestId('race-edit-r1'));

    await user.click(screen.getByTestId('leg-add'));
    expect(screen.getByRole('dialog')).toHaveTextContent('2 inscrições');
    await user.click(screen.getByTestId('confirm-ok'));

    expect(screen.getByTestId('leg-label-2')).toBeInTheDocument();
  });

  it('cancelling the legs warning leaves the leg list untouched', async () => {
    const user = userEvent.setup();
    const race = makeRace({ id: 'r1', event_id: 'ev1', team_size: 1 });
    const entries = [makeEntry({ id: 'en1', race_id: 'r1' })];
    renderTab(makeAgg({ races: [race], waves: [makeWave({ race_id: 'r1' })], entries }));
    await user.click(screen.getByTestId('race-edit-r1'));

    await user.click(screen.getByTestId('leg-add'));
    await user.click(screen.getByTestId('confirm-cancel'));

    expect(screen.queryByTestId('leg-label-2')).not.toBeInTheDocument();
  });
});

describe('C-Minor-6: unsaved edits in the race editor', () => {
  it('asks for confirmation before Cancelar discards a dirty form', async () => {
    const user = userEvent.setup();
    renderTab(makeAgg());
    await user.click(screen.getByTestId('new-race'));
    await user.selectOptions(screen.getByTestId('race-preset'), 'Revezamento em dupla (natação + corrida)');

    await user.type(screen.getByTestId('race-name'), ' extra');
    await user.click(screen.getByTestId('race-cancel'));

    expect(await screen.findByRole('dialog')).toHaveTextContent(/alterações não salvas/);
    await user.click(screen.getByTestId('confirm-cancel'));
    expect(screen.getByTestId('race-name')).toBeInTheDocument();

    await user.click(screen.getByTestId('race-cancel'));
    await user.click(screen.getByTestId('confirm-ok'));
    expect(screen.queryByTestId('race-name')).not.toBeInTheDocument();
  });

  it('blocks an in-app navigation away from a dirty form until confirmed', async () => {
    const user = userEvent.setup();
    const race = makeRace({ id: 'r1', event_id: 'ev1' });
    const { router } = renderTab(makeAgg({ races: [race], waves: [makeWave({ race_id: 'r1' })] }));
    await user.click(screen.getByTestId('race-edit-r1'));
    await user.type(screen.getByTestId('race-name'), ' extra');

    // Simulate an in-app navigation attempt away from this route (e.g. clicking another top-level
    // tab's NavLink) while the form is dirty.
    void router.navigate('/outra-aba');
    expect(await screen.findByRole('dialog')).toHaveTextContent(/alterações não salvas/);

    await user.click(screen.getByTestId('confirm-cancel'));
    expect(screen.queryByText('Outra aba')).not.toBeInTheDocument();
    expect(screen.getByTestId('race-name')).toHaveValue('Aquathlon extra'); // still here, edit kept

    void router.navigate('/outra-aba');
    await screen.findByRole('dialog');
    await user.click(screen.getByTestId('confirm-ok'));
    expect(await screen.findByText('Outra aba')).toBeInTheDocument();
  });
});

describe('changing team size across the individual/team boundary', () => {
  it('asks to confirm and, once confirmed, saves the new team defaults for rankings and age groups', async () => {
    const user = userEvent.setup();
    const race = makeRace({ id: 'r1', event_id: 'ev1', team_size: 1 });
    renderTab(makeAgg({ races: [race], waves: [makeWave({ race_id: 'r1' })] }));
    await user.click(screen.getByTestId('race-edit-r1'));

    await user.selectOptions(screen.getByTestId('race-team-size'), '2');
    expect(screen.getByTestId('confirm-ok')).toBeInTheDocument();
    await user.click(screen.getByTestId('confirm-ok'));
    expect(screen.getByTestId('race-team-size')).toHaveValue('2');

    saveRace.mockResolvedValue({ race, waves: [] });
    await user.click(screen.getByTestId('race-save'));

    const payload = saveRace.mock.calls[0][0];
    expect(payload.config.rankings).toEqual(defaultRaceConfig(2).rankings);
    expect(payload.config.age_groups).toEqual(defaultRaceConfig(2).age_groups);
  });

  it('keeps the previous team size when the reset is cancelled', async () => {
    const user = userEvent.setup();
    const race = makeRace({ id: 'r1', event_id: 'ev1', team_size: 1 });
    renderTab(makeAgg({ races: [race], waves: [makeWave({ race_id: 'r1' })] }));
    await user.click(screen.getByTestId('race-edit-r1'));

    await user.selectOptions(screen.getByTestId('race-team-size'), '2');
    await user.click(screen.getByTestId('confirm-cancel'));

    expect(screen.getByTestId('race-team-size')).toHaveValue('1');
  });
});

describe('deleting a race', () => {
  it('deletes after confirmation and refreshes', async () => {
    const user = userEvent.setup();
    const race = makeRace({ id: 'r1', event_id: 'ev1', name: 'Aquathlon' });
    const { refresh } = renderTab(makeAgg({ races: [race], waves: [makeWave({ race_id: 'r1' })] }));

    await user.click(screen.getByTestId('race-delete-r1'));
    await user.click(screen.getByTestId('confirm-ok'));

    expect(deleteRace).toHaveBeenCalledWith('r1');
    expect(refresh).toHaveBeenCalled();
  });

  it('does nothing when cancelled', async () => {
    const user = userEvent.setup();
    const race = makeRace({ id: 'r1', event_id: 'ev1', name: 'Aquathlon' });
    renderTab(makeAgg({ races: [race], waves: [makeWave({ race_id: 'r1' })] }));

    await user.click(screen.getByTestId('race-delete-r1'));
    await user.click(screen.getByTestId('confirm-cancel'));

    expect(deleteRace).not.toHaveBeenCalled();
  });

  it('round 2 item 9: warns that a finalized race\'s results (athlete histories/stats) are erased too', async () => {
    const user = userEvent.setup();
    const race = makeRace({ id: 'r1', event_id: 'ev1', name: 'Aquathlon' });
    renderTab(makeAgg({ races: [race], waves: [makeWave({ race_id: 'r1' })] }));

    await user.click(screen.getByTestId('race-delete-r1'));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('resultados são apagados');
    expect(dialog).toHaveTextContent('histórico e das estatísticas dos atletas');
  });
});

describe('races list dialog helpers', () => {
  it('the preset select starts on a placeholder that keeps the editor closed', async () => {
    const user = userEvent.setup();
    renderTab(makeAgg());
    await user.click(screen.getByTestId('new-race'));
    expect(screen.queryByTestId('race-name')).not.toBeInTheDocument();
    within(screen.getByTestId('race-preset')).getByText(/selecione/i);
  });
});
