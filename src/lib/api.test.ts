import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { supabase } from './supabase';
import { api, ApiError } from './api';
import type { EventRow, FinalizeRowInput, ImportRowInput, Leg, TkMarkInput } from './types';

vi.mock('./supabase', () => ({ supabase: { rpc: vi.fn() } }));

type RpcMock = Mock<(fn: string, args?: Record<string, unknown>) => Promise<unknown>>;
const rpc = supabase.rpc as unknown as RpcMock;

const ok = (data: unknown) => ({ data, error: null, status: 200 });

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue(ok(null));
});

describe('api', () => {
  it('saves an event through admin_save_event with the payload as p_event', async () => {
    const e = { name: 'Copa EBC', date: '2026-10-11', location: 'Lago Paranoá', levels: ['Elite', 'Base'] };
    const saved = { ...e, id: 'ev1' } as EventRow;
    rpc.mockResolvedValue(ok(saved));

    await expect(api.admin.saveEvent(e)).resolves.toEqual(saved);
    expect(rpc.mock.calls).toEqual([['admin_save_event', { p_event: e }]]);
  });

  it('syncs timekeeper marks through tk_sync with every p_ parameter', async () => {
    const m: TkMarkInput = {
      id: 'm1', ts: '2026-10-11T11:00:05.300Z', device_ts: '2026-10-11T11:00:05.100Z', clock_offset_ms: 200,
      clock_rtt_ms: 80, entry_id: null, leg_index: null, athlete_id: null, discarded: false,
    };
    await api.tk.sync('t', 'k', 's', [m], null);
    expect(rpc.mock.calls).toEqual([
      ['tk_sync', { p_token: 't', p_timekeeper_id: 'k', p_secret: 's', p_marks: [m], p_since: null }],
    ]);
  });

  it('polls public live data through pub_live', async () => {
    await api.pub.live('slug', '2026-10-11T11:00:00.000Z');
    expect(rpc.mock.calls).toEqual([['pub_live', { p_slug: 'slug', p_since: '2026-10-11T11:00:00.000Z' }]]);
  });

  it('sets a resolution with the six p_ parameters', async () => {
    await api.admin.setResolution('e', 1, 'manual', null, '2026-10-11T11:30:00.000Z', 'x');
    expect(rpc.mock.calls).toEqual([
      ['admin_set_resolution', {
        p_entry_id: 'e', p_leg_index: 1, p_mode: 'manual', p_mark_id: null,
        p_manual_ts: '2026-10-11T11:30:00.000Z', p_note: 'x',
      }],
    ]);
  });

  it('throws an ApiError carrying the server message and code', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Falhou', code: 'P0001' }, status: 400 });
    const err = await api.admin.deleteEvent('ev1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ message: 'Falhou', code: 'P0001' });
  });

  it('turns a failed fetch into a "no connection" ApiError', async () => {
    rpc.mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await api.admin.listEvents().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ message: 'Sem conexão com o servidor', code: 'network' });
  });

  it('treats the status-0 result supabase-js resolves with on a network failure as "no connection"', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 });
    const err = await api.tk.open('tok').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ message: 'Sem conexão com o servidor', code: 'network' });
  });

  it('returns the server clock as epoch milliseconds', async () => {
    rpc.mockResolvedValue(ok(1790000000000));
    await expect(api.serverTime()).resolves.toBe(1790000000000);
    expect(rpc.mock.calls).toEqual([['server_time']]);
  });

  it('rejects a server clock that is not a number instead of skewing the synced clock', async () => {
    rpc.mockResolvedValue(ok(null));
    await expect(api.serverTime()).rejects.toBeInstanceOf(ApiError);
  });

  const legs: Leg[] = [{ modality: 'run', label: 'Corrida', distance_m: 5000 }];
  const race = { event_id: 'ev1', name: '5 km', legs, waves: [{ name: 'Largada geral' }] };
  const athlete = { name: 'Ana Souza', sex: 'F' as const, birth_date: '1990-06-15' };
  const entry = { race_id: 'r1', bib: null, members: [{ athlete_id: 'a1', legs: [0] }] };
  const rows: ImportRowInput[] = [{
    name: 'Ana Souza', sex: 'F', birth_date: null, email: null, phone: null, city: null, team_club: null, race_name: null,
  }];
  const finalizeRows: FinalizeRowInput[] = [];

  // Every RPC name and p_ parameter must match the SQL functions exactly (contracts.md).
  it.each<[string, () => Promise<unknown>, string, Record<string, unknown> | undefined]>([
    ['admin.me', () => api.admin.me(), 'admin_me', undefined],
    ['admin.passwordChanged', () => api.admin.passwordChanged(), 'admin_password_changed', undefined],
    ['admin.listOrganizers', () => api.admin.listOrganizers(), 'admin_list_organizers', undefined],
    ['admin.createOrganizer', () => api.admin.createOrganizer('bia@ebc.test', 'provisoria-1', 'Bia'), 'admin_create_organizer',
      { p_email: 'bia@ebc.test', p_password: 'provisoria-1', p_name: 'Bia' }],
    ['admin.deleteOrganizer', () => api.admin.deleteOrganizer('u2'), 'admin_delete_organizer', { p_user_id: 'u2' }],
    ['admin.listEvents', () => api.admin.listEvents(), 'admin_list_events', undefined],
    ['admin.getEvent', () => api.admin.getEvent('ev1'), 'admin_get_event', { p_event_id: 'ev1' }],
    ['admin.deleteEvent', () => api.admin.deleteEvent('ev1'), 'admin_delete_event', { p_event_id: 'ev1' }],
    ['admin.duplicateEvent', () => api.admin.duplicateEvent('ev1', 'Copa EBC 2027', '2027-10-10'), 'admin_duplicate_event',
      { p_event_id: 'ev1', p_name: 'Copa EBC 2027', p_date: '2027-10-10' }],
    ['admin.rotateTkToken', () => api.admin.rotateTkToken('ev1'), 'admin_rotate_tk_token', { p_event_id: 'ev1' }],
    ['admin.saveRace', () => api.admin.saveRace(race), 'admin_save_race', { p_race: race }],
    ['admin.deleteRace', () => api.admin.deleteRace('r1'), 'admin_delete_race', { p_race_id: 'r1' }],
    ['admin.setWaveStart', () => api.admin.setWaveStart('w1', null), 'admin_set_wave_start', { p_wave_id: 'w1', p_start_at: null }],
    ['admin.listAthletes', () => api.admin.listAthletes(), 'admin_list_athletes', undefined],
    ['admin.saveAthlete', () => api.admin.saveAthlete(athlete), 'admin_save_athlete', { p_athlete: athlete }],
    ['admin.deleteAthlete', () => api.admin.deleteAthlete('a1'), 'admin_delete_athlete', { p_athlete_id: 'a1' }],
    ['admin.importAthletes', () => api.admin.importAthletes(null, rows), 'admin_import_athletes', { p_event_id: null, p_rows: rows }],
    ['admin.athleteProfile', () => api.admin.athleteProfile('a1'), 'admin_athlete_profile', { p_athlete_id: 'a1' }],
    ['admin.saveEntry', () => api.admin.saveEntry(entry), 'admin_save_entry', { p_entry: entry }],
    ['admin.bulkCreateEntries', () => api.admin.bulkCreateEntries('r1', ['a1', 'a2']), 'admin_bulk_create_entries',
      { p_race_id: 'r1', p_athlete_ids: ['a1', 'a2'] }],
    ['admin.updateEntryStatus', () => api.admin.updateEntryStatus('en1', 'dsq', 30000, 'Cortou o percurso'), 'admin_update_entry_status',
      { p_entry_id: 'en1', p_status: 'dsq', p_penalty_ms: 30000, p_notes: 'Cortou o percurso' }],
    ['admin.deleteEntry', () => api.admin.deleteEntry('en1'), 'admin_delete_entry', { p_entry_id: 'en1' }],
    ['admin.live', () => api.admin.live('ev1', null), 'admin_live', { p_event_id: 'ev1', p_since: null }],
    ['admin.updateMark', () => api.admin.updateMark('m1', { entry_id: 'en1', leg_index: 0 }), 'admin_update_mark',
      { p_mark_id: 'm1', p_patch: { entry_id: 'en1', leg_index: 0 } }],
    ['admin.clearResolution', () => api.admin.clearResolution('en1', 2), 'admin_clear_resolution', { p_entry_id: 'en1', p_leg_index: 2 }],
    ['admin.updateTimekeeper', () => api.admin.updateTimekeeper('k1', { active: false }), 'admin_update_timekeeper',
      { p_timekeeper_id: 'k1', p_patch: { active: false } }],
    ['admin.finalizeRace', () => api.admin.finalizeRace('r1', finalizeRows), 'admin_finalize_race', { p_race_id: 'r1', p_rows: finalizeRows }],
    ['admin.unfinalizeRace', () => api.admin.unfinalizeRace('r1'), 'admin_unfinalize_race', { p_race_id: 'r1' }],
    ['tk.open', () => api.tk.open('tok'), 'tk_open', { p_token: 'tok' }],
    ['tk.register', () => api.tk.register('tok', 'Carla', 'iPhone'), 'tk_register', { p_token: 'tok', p_name: 'Carla', p_device_label: 'iPhone' }],
    ['pub.events', () => api.pub.events(), 'pub_events', undefined],
    ['pub.event', () => api.pub.event('copa-ebc-2026-10-11'), 'pub_event', { p_slug: 'copa-ebc-2026-10-11' }],
    ['pub.athlete', () => api.pub.athlete('a1'), 'pub_athlete', { p_athlete_id: 'a1' }],
  ])('%s calls the matching RPC with its p_ parameters', async (_name, invoke, fn, args) => {
    await invoke();
    expect(rpc.mock.calls).toEqual([args === undefined ? [fn] : [fn, args]]);
  });
});
