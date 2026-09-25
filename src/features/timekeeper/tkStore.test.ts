import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EntryRow, MarkRow, TkSession } from '../../lib/types';
import type { LocalMark, OutboxItem } from '../../lib/outbox';
import {
  iso, makeEntry, makeMark, makeRace, makeTimekeeper, makeWave, MIN, SEC, T0,
} from '../../domain/testing/fixtures';
import {
  applyWaveStarts, assignMark, assignmentMessage, burstHead, localToMarkRow, markToInput, mergedMarks, newMark, onCourse,
  selectedMarkId, sessionIndex,
} from './tkStore';

const ME = 'tk-me';

// Solo entry (Ana does both legs), with the member name tk_open embeds.
const solo = (p: Partial<EntryRow> = {}): EntryRow =>
  makeEntry({ members: [{ athlete_id: 'a1', position: 0, legs: [0, 1], name: 'Ana Souza' }], ...p });

function session(p: Partial<TkSession> = {}): TkSession {
  return {
    event: { id: 'e1', name: 'Evento Teste', date: '2026-10-11', location: 'Vila Velha' },
    races: [makeRace()], waves: [makeWave()], entries: [solo()], timekeepers: [makeTimekeeper()],
    version: 1, server_now: iso(T0), ...p,
  };
}

// Relay pair: João swims (leg 0), Matheus runs (leg 1). Member names come embedded (tk_open).
const relayRace = makeRace({ id: 'r2', name: 'Revezamento', team_size: 2 });
const relayWave = makeWave({ id: 'w2', race_id: 'r2' });
function relayEntry(p: Partial<EntryRow> = {}): EntryRow {
  return makeEntry({
    id: 'en-relay', race_id: 'r2', wave_id: 'w2', bib: '101', team_name: 'Tubarões',
    members: [
      { athlete_id: 'a1', position: 0, legs: [0], name: 'João' },
      { athlete_id: 'a2', position: 1, legs: [1], name: 'Matheus' },
    ],
    ...p,
  });
}

function local(p: Partial<LocalMark> & { id: string; ts: string }): LocalMark {
  return {
    device_ts: p.ts, clock_offset_ms: 0, clock_rtt_ms: 80, entry_id: null, leg_index: null, athlete_id: null,
    discarded: false, local_updated_at: Date.parse(p.ts), ...p,
  };
}
const item = (mark: LocalMark, state: OutboxItem['state'], reason?: string): OutboxItem => ({ mark, state, reason });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('localToMarkRow', () => {
  it('fills the server-only fields from the local mark', () => {
    const m = local({ id: 'm1', ts: iso(T0 + MIN), discarded: true, local_updated_at: T0 + 2 * MIN });
    expect(localToMarkRow(m, 'e1', ME)).toEqual({
      id: 'm1', event_id: 'e1', timekeeper_id: ME, ts: iso(T0 + MIN), device_ts: iso(T0 + MIN),
      clock_offset_ms: 0, clock_rtt_ms: 80, entry_id: null, leg_index: null, athlete_id: null,
      discarded: true, discarded_by: 'timekeeper', created_at: iso(T0 + MIN), updated_at: iso(T0 + 2 * MIN),
    });
    expect(localToMarkRow({ ...m, discarded: false }, 'e1', ME).discarded_by).toBeNull();
  });
});

describe('mergedMarks', () => {
  it('prefers a pending local edit over the server copy and keeps synced server marks', () => {
    const serverEdited = makeMark({ id: 'm1', at: T0 + MIN, timekeeper_id: ME, entry_id: null, leg_index: null });
    const serverOther = makeMark({ id: 'm2', at: T0 + 2 * MIN, timekeeper_id: 'tk2' });
    const serverSynced = makeMark({ id: 'm3', at: T0 + 3 * MIN, timekeeper_id: ME });
    const localEdit = local({ id: 'm1', ts: iso(T0 + MIN), entry_id: 'en1', leg_index: 1 });
    const localSynced = local({ id: 'm3', ts: iso(T0 + 3 * MIN), entry_id: null, leg_index: null });

    const merged = mergedMarks(
      [serverEdited, serverOther, serverSynced],
      [item(localEdit, 'pending'), item(localSynced, 'synced')],
      'e1', ME,
    );

    expect(merged.map(m => m.id)).toEqual(['m1', 'm2', 'm3']);
    expect(merged[0]).toMatchObject({ entry_id: 'en1', leg_index: 1, timekeeper_id: ME });
    expect(merged[1]).toBe(serverOther);
    expect(merged[2]).toBe(serverSynced); // not pending: the server copy wins
  });

  it('lets the server copy win over a rejected edit (the organizer moved the mark)', () => {
    const moved = makeMark({ id: 'm1', at: T0 + MIN, timekeeper_id: ME, entry_id: 'en1', leg_index: 1 });
    const mine = local({ id: 'm1', ts: iso(T0 + MIN), entry_id: 'en1', leg_index: 0 });
    const merged = mergedMarks([moved], [item(mine, 'rejected', 'Alterada pela organização')], 'e1', ME);
    expect(merged).toEqual([moved]);
  });

  it('adds local marks the server has not returned yet, but not rejected new marks', () => {
    const fresh = local({ id: 'new', ts: iso(T0 + 5 * MIN) });
    const acked = local({ id: 'acked', ts: iso(T0 + 4 * MIN) });
    const refused = local({ id: 'refused', ts: iso(T0 + 6 * MIN), entry_id: 'gone', leg_index: 0 });
    const merged = mergedMarks(
      [],
      [item(acked, 'synced'), item(fresh, 'pending'), item(refused, 'rejected', 'Atleta não encontrado neste evento')],
      'e1', ME,
    );
    expect(merged.map(m => m.id)).toEqual(['acked', 'new']);
    expect(merged[1]).toEqual(localToMarkRow(fresh, 'e1', ME));
  });
});

describe('newMark', () => {
  it('stamps ts with the synced time and keeps the device time and clock state for auditing', () => {
    const mark = newMark(T0 + 5 * SEC, T0 + 5 * SEC - 1234, { offset_ms: 1234, rtt_ms: 90, synced_at: T0 });
    expect(mark).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      ts: iso(T0 + 5 * SEC), device_ts: iso(T0 + 5 * SEC - 1234), clock_offset_ms: 1234, clock_rtt_ms: 90,
      entry_id: null, leg_index: null, athlete_id: null, discarded: false,
    });
  });

  it('leaves the clock fields empty when the clock never synced', () => {
    const mark = newMark(T0, T0, null);
    expect(mark.clock_offset_ms).toBeNull();
    expect(mark.clock_rtt_ms).toBeNull();
  });

  it('still creates a v4 id where crypto.randomUUID is missing (plain-http origins)', () => {
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array<ArrayBuffer>) => real.getRandomValues(a) });
    const a = newMark(T0, T0, null).id;
    const b = newMark(T0, T0, null).id;
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});

describe('assignMark', () => {
  it('suggests the selected athlete leg on a relay (second member → leg 1)', () => {
    const mark = markToInput(makeMark({ id: 'x', at: T0 + 20 * MIN, entry_id: null, leg_index: null }));
    const { mark: assigned, suggestion } = assignMark(mark, relayEntry(), relayRace, [], 'a2');
    expect(suggestion).toMatchObject({ leg_index: 1, athlete_id: 'a2', reason: 'next' });
    expect(assigned).toEqual({ ...mark, entry_id: 'en-relay', leg_index: 1, athlete_id: 'a2' });
  });

  it('ignores the mark itself when it was already filed on a leg', () => {
    // Filed by mistake on leg 1 (and nothing else is known): counting itself would say "same crossing, leg 1".
    const self = makeMark({ id: 'x', at: T0 + 10 * MIN, entry_id: 'en1', leg_index: 1 });
    const { suggestion } = assignMark(markToInput(self), solo(), makeRace(), [self]);
    expect(suggestion).toMatchObject({ leg_index: 0, reason: 'next' });
  });

  it('confirms the crossing another timekeeper already marked', () => {
    const other = makeMark({ at: T0 + 10 * MIN, timekeeper_id: 'tk2', entry_id: 'en-relay', leg_index: 0 });
    const mine = markToInput(makeMark({ id: 'x', at: T0 + 10 * MIN + 3 * SEC, entry_id: null, leg_index: null }));
    const { mark, suggestion } = assignMark(mine, relayEntry(), relayRace, [other]);
    expect(suggestion).toMatchObject({ leg_index: 0, reason: 'same_crossing', athlete_id: 'a1' });
    expect(mark.leg_index).toBe(0);
  });
});

describe('assignmentMessage', () => {
  it('names the bib, the athlete and the leg (Ruling 8 wording)', () => {
    expect(assignmentMessage(relayEntry(), relayRace, { leg_index: 1, athlete_id: 'a2', reason: 'next', warning: null }, 'Matheus'))
      .toBe('✓ Nº 101 · Matheus · fim da perna 2/2 (Corrida)');
  });

  it('warns when the entry had already finished', () => {
    expect(assignmentMessage(relayEntry(), relayRace, { leg_index: 1, athlete_id: 'a2', reason: 'next', warning: 'already_finished' }, 'Matheus'))
      .toBe('Nº 101 já concluiu — registrada como fim da perna 2/2 (Corrida)');
  });
});

describe('onCourse', () => {
  const relaySession = (entries: EntryRow[] = [relayEntry()]) => session({ races: [relayRace], waves: [relayWave], entries });
  const leg0 = T0 + 10 * MIN;
  const relayLeg0 = () => makeMark({ at: leg0, timekeeper_id: 'tk2', entry_id: 'en-relay', leg_index: 0 });

  it('lists a relay whose leg 0 was marked with the next athlete and the leg timer', () => {
    const now = leg0 + 2 * MIN;
    const list = onCourse(relaySession(), [relayLeg0()], now);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      athleteName: 'Matheus', legLabel: 'Corrida', legIndex: 1, legElapsedMs: now - leg0, displayName: 'Tubarões', confirm: null,
    });
    expect(list[0].entry.id).toBe('en-relay');
    expect(list[0].race.id).toBe('r2');
    expect(list[0].timing.status).toBe('on_course');
  });

  it('lists started entries without crossings on their first leg, and leaves out entries not started or out of the race', () => {
    const waiting = makeWave({ id: 'w3', race_id: 'r1', start_at: null });
    const list = onCourse(session({
      waves: [makeWave(), waiting],
      entries: [
        solo({ id: 'a', bib: '1' }),
        solo({ id: 'b', bib: '2', wave_id: 'w3' }),
        solo({ id: 'c', bib: '3', status: 'dns' }),
        solo({ id: 'd', bib: '4', status: 'dnf' }),
      ],
    }), [], T0 + 5 * MIN);
    expect(list.map(i => i.entry.bib)).toEqual(['1']);
    expect(list[0]).toMatchObject({ legIndex: 0, legLabel: 'Natação', athleteName: 'Ana Souza', legElapsedMs: 5 * MIN });
  });

  it('pins a crossing inside the same-crossing window at the top with the seconds left to confirm', () => {
    const now = leg0 + 10_200;
    const list = onCourse(relaySession([relayEntry(), solo({ id: 'solo', race_id: 'r2', wave_id: 'w2', bib: '7' })]), [relayLeg0()], now);
    expect(list.map(i => i.entry.id)).toEqual(['en-relay', 'solo']);
    expect(list[0].confirm).toEqual({ leg_index: 0, leg_label: 'Natação', leg_ms: 10 * MIN, crossing_ms: leg0, remaining_s: 20, mine: false });
    // Still on course: the row keeps showing who is running now.
    expect(list[0]).toMatchObject({ athleteName: 'Matheus', legIndex: 1, legElapsedMs: 10_200 });

    expect(onCourse(relaySession(), [relayLeg0()], leg0 + 29_999)[0].confirm?.remaining_s).toBe(1);
    expect(onCourse(relaySession(), [relayLeg0()], leg0 + 30_000)[0].confirm).toBeNull();
  });

  it('keeps a finished entry listed while its finish can still be confirmed, then drops it', () => {
    const finish = T0 + 30 * MIN;
    const marks = [
      makeMark({ at: T0 + 10 * MIN, entry_id: 'en1', leg_index: 0 }),
      makeMark({ at: finish, entry_id: 'en1', leg_index: 1 }),
    ];
    const during = onCourse(session(), marks, finish + 10 * SEC);
    expect(during).toHaveLength(1);
    expect(during[0].timing.status).toBe('finished');
    expect(during[0]).toMatchObject({ legIndex: null, legLabel: 'Corrida', athleteName: 'Ana Souza' });
    expect(during[0].confirm).toEqual({ leg_index: 1, leg_label: 'Corrida', leg_ms: 20 * MIN, crossing_ms: finish, remaining_s: 20, mine: false });

    expect(onCourse(session(), marks, finish + 31 * SEC)).toEqual([]);
  });

  it('orders pinned rows by most recent crossing, then the rest by leg time, longest first', () => {
    const now = T0 + 30 * MIN + 10 * SEC;
    const s = session({
      entries: [
        solo({ id: 'A', bib: '1' }), // leg 0 at 10 min → on the run for 20 min
        solo({ id: 'B', bib: '2' }), // finished 10 s ago
        solo({ id: 'C', bib: '3' }), // swim ended 5 s ago
        solo({ id: 'D', bib: '4' }), // no crossing yet → swimming for 30 min
      ],
    });
    const marks = [
      makeMark({ at: T0 + 10 * MIN, entry_id: 'A', leg_index: 0 }),
      makeMark({ at: T0 + 12 * MIN, entry_id: 'B', leg_index: 0 }),
      makeMark({ at: T0 + 30 * MIN, entry_id: 'B', leg_index: 1 }),
      makeMark({ at: T0 + 30 * MIN + 5 * SEC, entry_id: 'C', leg_index: 0 }),
    ];
    const list = onCourse(s, marks, now);
    expect(list.map(i => i.entry.id)).toEqual(['C', 'B', 'D', 'A']);
    expect(list.map(i => i.confirm?.remaining_s ?? null)).toEqual([25, 20, null, null]);
  });
});

describe('onCourse: crossings this timekeeper already marked (Ruling 44 M8)', () => {
  const relaySession = () => session({ races: [relayRace], waves: [relayWave], entries: [relayEntry()] });
  const leg0 = T0 + 10 * MIN;

  it('flags a pinned crossing that has a mark of this timekeeper', () => {
    const marks = [
      makeMark({ id: 'o', at: leg0, timekeeper_id: 'tk2', entry_id: 'en-relay', leg_index: 0 }),
      makeMark({ id: 'm', at: leg0 + 2 * SEC, timekeeper_id: ME, entry_id: 'en-relay', leg_index: 0 }),
    ];
    expect(onCourse(relaySession(), marks, leg0 + 5 * SEC, ME)[0].confirm).toMatchObject({ leg_index: 0, mine: true });
  });

  it('does not flag a crossing only other timekeepers (or discarded marks of mine) marked', () => {
    const marks = [
      makeMark({ id: 'o', at: leg0, timekeeper_id: 'tk2', entry_id: 'en-relay', leg_index: 0 }),
      { ...makeMark({ id: 'm', at: leg0 + 2 * SEC, timekeeper_id: ME, entry_id: 'en-relay', leg_index: 0 }), discarded: true },
    ];
    expect(onCourse(relaySession(), marks, leg0 + 5 * SEC, ME)[0].confirm).toMatchObject({ mine: false });
    expect(onCourse(relaySession(), marks, leg0 + 5 * SEC)[0].confirm).toMatchObject({ mine: false });
  });
});

describe('burst selection (review Important 1)', () => {
  const now = T0 + 10 * MIN;
  const un = (id: string, agoMs: number) => makeMark({ id, at: now - agoMs, timekeeper_id: ME, entry_id: null, leg_index: null });
  const stale = un('stale', 2 * MIN);
  const a = un('a', 20 * SEC);
  const b = un('b', 10 * SEC);

  it('burstHead is the oldest mark younger than the 60 s unassigned threshold', () => {
    expect(burstHead([stale, a, b], now)?.id).toBe('a');
    expect(burstHead([b, a], now)?.id).toBe('a');
    expect(burstHead([un('edge', 60 * SEC)], now)?.id).toBe('edge');
    expect(burstHead([un('old', 60 * SEC + 1)], now)).toBeNull();
    expect(burstHead([stale], now)).toBeNull();
  });

  it('auto picks the burst head; a stale mark is only used when it was chosen explicitly', () => {
    expect(selectedMarkId({ mode: 'auto' }, [stale, a, b], now)).toBe('a');
    expect(selectedMarkId({ mode: 'auto' }, [stale], now)).toBeNull();
    expect(selectedMarkId({ mode: 'none' }, [stale, a, b], now)).toBeNull();
    expect(selectedMarkId({ mode: 'id', id: 'b', chosen: false }, [stale, a, b], now)).toBe('b');
    expect(selectedMarkId({ mode: 'id', id: 'stale', chosen: true }, [stale, a, b], now)).toBe('stale');
    // Selected by the app (not by the timekeeper): it leaves once stale, like the automatic pick.
    expect(selectedMarkId({ mode: 'id', id: 'stale', chosen: false }, [stale, a, b], now)).toBe('a');
    expect(selectedMarkId({ mode: 'id', id: 'stale', chosen: false }, [stale], now)).toBeNull();
    // A selected mark that got an athlete (or was discarded) hands over to the automatic pick.
    expect(selectedMarkId({ mode: 'id', id: 'gone', chosen: true }, [stale, a, b], now)).toBe('a');
  });
});

describe('sessionIndex', () => {
  it('names entries from the member names embedded by tk_open', () => {
    const idx = sessionIndex(session({ entries: [relayEntry({ team_name: null })] }));
    expect(idx.athletesById.get('a2')?.name).toBe('Matheus');
  });
});

describe('applyWaveStarts', () => {
  it('updates the start of known waves and keeps the same session when nothing changed', () => {
    const s = session({ waves: [makeWave({ id: 'w1', start_at: null }), makeWave({ id: 'w2', race_id: 'r1', start_at: iso(T0) })] });
    const next = applyWaveStarts(s, [{ id: 'w1', start_at: iso(T0 + MIN) }, { id: 'w2', start_at: iso(T0) }, { id: 'zz', start_at: iso(T0) }]);
    expect(next.waves.map(w => w.start_at)).toEqual([iso(T0 + MIN), iso(T0)]);
    expect(next.waves[1]).toBe(s.waves[1]);
    expect(applyWaveStarts(next, [{ id: 'w1', start_at: iso(T0 + MIN) }])).toBe(next);
  });
});
