import { describe, expect, it } from 'vitest';
import { computeHeadToHead, computeTogether } from './pairStats';
import { makeResult } from './testing/results';

const ANA = { athlete_id: 'a', name: 'Ana' };
const BETO = { athlete_id: 'b', name: 'Beto' };
const CAIO = { athlete_id: 'c', name: 'Caio' };

describe('computeTogether (spec §5.2)', () => {
  const relayWin = makeResult({
    race_id: 'r1', entry_id: 'e1', date: '2026-03-10', race: 'Revezamento', team_name: 'Tubarões',
    members: [ANA, BETO], final_ms: 2_400_000, overall_pos: 1, finishers: 8,
    podiums: [{ ranking_id: 'geral', ranking_name: 'Geral', group_label: 'Geral', podium_pos: 1 }],
    legs: [
      { athlete_id: 'a', modality: 'swim', label: 'Natação', distance_m: 750, time_ms: 800_000 },
      { athlete_id: 'b', label: 'Corrida', time_ms: 1_600_000 },
    ],
  });
  const relayDnf = makeResult({
    race_id: 'r2', entry_id: 'e2', date: '2026-09-01', race: 'Revezamento', team_name: 'Tubarões',
    members: [ANA, BETO], status: 'dnf', legs: [{ athlete_id: 'a', time_ms: 900_000 }, { athlete_id: 'b', time_ms: null }],
  });
  const anaWithCaio = makeResult({ race_id: 'r3', entry_id: 'e3', date: '2026-05-01', members: [ANA, CAIO], final_ms: 2_000_000, overall_pos: 2 });
  const anaSolo = makeResult({ race_id: 'r4', entry_id: 'e4', date: '2026-06-01', members: [ANA], final_ms: 1_500_000, overall_pos: 1 });

  it('summarizes only the results where both were in the same entry', () => {
    const t = computeTogether('a', 'b', [relayWin, relayDnf, anaWithCaio, anaSolo])!;
    expect(t.summary).toEqual({ participations: 2, finishes: 1, wins_overall: 1, wins_category: 1, podiums: 1, best_overall_pos: 1, avg_percentile: 1 / 8 });
  });
  it('lists the races newest first with each member own legs', () => {
    const t = computeTogether('a', 'b', [relayWin, relayDnf])!;
    expect(t.races.map((r) => r.entry_id)).toEqual(['e2', 'e1']);
    expect(t.races[1]).toMatchObject({ race_name: 'Revezamento', team_name: 'Tubarões', status: 'finished', final_ms: 2_400_000, overall_pos: 1, finishers: 8 });
    expect(t.races[1].members).toEqual([
      { athlete_id: 'a', name: 'Ana', legs: [{ label: 'Natação', time_ms: 800_000 }] },
      { athlete_id: 'b', name: 'Beto', legs: [{ label: 'Corrida', time_ms: 1_600_000 }] },
    ]);
  });
  it('is null when they never shared an entry', () => {
    expect(computeTogether('a', 'b', [anaWithCaio, anaSolo])).toBeNull();
  });
});

describe('computeHeadToHead (spec §5.3)', () => {
  const results = [
    // r1: both placed -> a (2nd) beats b (5th) by 30 s
    makeResult({ race_id: 'r1', entry_id: 'r1a', date: '2026-01-10', members: [ANA], final_ms: 1_500_000, overall_pos: 2 }),
    makeResult({ race_id: 'r1', entry_id: 'r1b', date: '2026-01-10', members: [BETO], final_ms: 1_530_000, overall_pos: 5 }),
    // r2: b placed, a DNF -> b wins, no difference
    makeResult({ race_id: 'r2', entry_id: 'r2a', date: '2026-02-10', members: [ANA], status: 'dnf' }),
    makeResult({ race_id: 'r2', entry_id: 'r2b', date: '2026-02-10', members: [BETO], final_ms: 1_600_000, overall_pos: 3 }),
    // r3: both DNF -> no decision
    makeResult({ race_id: 'r3', entry_id: 'r3a', date: '2026-03-10', members: [ANA], status: 'dnf' }),
    makeResult({ race_id: 'r3', entry_id: 'r3b', date: '2026-03-10', members: [BETO], status: 'dnf' }),
    // r4: a shared position (a tie) -> no decision, difference 0 (Review Focus 2)
    makeResult({ race_id: 'r4', entry_id: 'r4a', date: '2026-04-10', members: [ANA], final_ms: 1_400_000, overall_pos: 4 }),
    makeResult({ race_id: 'r4', entry_id: 'r4b', date: '2026-04-10', members: [BETO], final_ms: 1_400_000, overall_pos: 4 }),
    // r5: b DNS -> not a confrontation
    makeResult({ race_id: 'r5', entry_id: 'r5a', date: '2026-05-10', members: [ANA], final_ms: 1_450_000, overall_pos: 1 }),
    makeResult({ race_id: 'r5', entry_id: 'r5b', date: '2026-05-10', members: [BETO], status: 'dns' }),
    // r6: the same entry (a team) -> "together", not a confrontation
    makeResult({ race_id: 'r6', entry_id: 'r6ab', date: '2026-06-10', members: [ANA, BETO], final_ms: 2_000_000, overall_pos: 1 }),
    // r7: a DSQ with a time, b placed -> b wins; both have final_ms, so the difference shows
    makeResult({ race_id: 'r7', entry_id: 'r7a', date: '2026-07-10', members: [ANA], status: 'dsq', final_ms: 1_300_000 }),
    makeResult({ race_id: 'r7', entry_id: 'r7b', date: '2026-07-10', members: [BETO], final_ms: 1_350_000, overall_pos: 1 }),
    // r8: only a ran -> nothing
    makeResult({ race_id: 'r8', entry_id: 'r8a', date: '2026-08-10', members: [ANA], final_ms: 1_500_000, overall_pos: 1 }),
  ];

  it('scores the races where both started in their own entries, newest first', () => {
    const h = computeHeadToHead('a', 'b', results)!;
    expect({ a: h.a_wins, b: h.b_wins, none: h.no_decision }).toEqual({ a: 1, b: 2, none: 2 });
    expect(h.races.map((r) => [r.race_id, r.winner, r.diff_ms])).toEqual([
      ['r7', 'b', 50_000], ['r4', null, 0], ['r3', null, null], ['r2', 'b', null], ['r1', 'a', 30_000],
    ]);
    expect(h.races[4]).toMatchObject({ a: { entry_id: 'r1a', overall_pos: 2 }, b: { entry_id: 'r1b', overall_pos: 5 } });
  });
  it('is null without a race in common', () => {
    expect(computeHeadToHead('a', 'b', [results[0], results[13]])).toBeNull();
    expect(computeHeadToHead('a', 'c', results)).toBeNull();
  });
});
