import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

function renderTab(agg: EventAggregate, refresh = vi.fn(async () => {})) {
  render(
    <ToastProvider>
      <ConfirmProvider>
        <EventProvider eventId="ev1" agg={agg} refresh={refresh} patchAgg={vi.fn()}>
          <RacesTab />
        </EventProvider>
      </ConfirmProvider>
    </ToastProvider>,
  );
  return { refresh };
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
    // Team default config has a single "Geral" podium (Nível checkbox present but disabled: no event levels).
    expect(screen.getByRole('checkbox', { name: 'Nível' })).toBeDisabled();

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
