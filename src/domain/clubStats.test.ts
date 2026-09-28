import { describe, expect, it } from 'vitest';
import { computeClubRecords, computeLeaders, rankLeaders } from './clubStats';
import { makeResult } from './testing/results';
import type { PublicAthleteRow } from '../lib/types';

const ANA: PublicAthleteRow = { id: 'ana', name: 'Ana', sex: 'F', city: null, team_club: null };
const BIA: PublicAthleteRow = { id: 'bia', name: 'Bia', sex: 'F', city: null, team_club: null };
const CARLOS: PublicAthleteRow = { id: 'carlos', name: 'Carlos', sex: 'M', city: null, team_club: null };
const DAVI: PublicAthleteRow = { id: 'davi', name: 'Davi', sex: 'M', city: null, team_club: null };
const athletes = [ANA, BIA, CARLOS, DAVI];
const m = (a: PublicAthleteRow) => ({ athlete_id: a.id, name: a.name });
const podium = (pos: number) => [{ ranking_id: 'geral', ranking_name: 'Geral', group_label: 'Geral', podium_pos: pos }];

const results = [
  // 2026: Ana wins a solo 5 km (podium 1)
  makeResult({ race_id: 'r1', entry_id: 'e1', date: '2026-03-10', members: [m(ANA)], final_ms: 1_500_000, overall_pos: 1, podiums: podium(1) }),
  // 2026: relay Ana (swim 750 m) + Carlos (run 5 km) wins -> a win for each
  makeResult({
    race_id: 'r2', entry_id: 'e2', date: '2026-05-01', members: [m(ANA), m(CARLOS)], final_ms: 2_200_000, overall_pos: 1,
    legs: [{ athlete_id: 'ana', modality: 'swim', label: 'Natação', distance_m: 750, time_ms: 800_000 }, { athlete_id: 'carlos', time_ms: 1_400_000 }],
  }),
  // 2025: Bia wins a solo 5 km; Ana 2nd in the same race (podium 2)
  makeResult({ race_id: 'r3', entry_id: 'e3', date: '2025-10-05', members: [m(BIA)], final_ms: 1_450_000, overall_pos: 1 }),
  makeResult({ race_id: 'r3', entry_id: 'e4', date: '2025-10-05', members: [m(ANA)], final_ms: 1_550_000, overall_pos: 2, podiums: podium(2) }),
  // 2026: Davi DSQ (never counts) and a private athlete's winning 5 km (not in `athletes`)
  makeResult({ race_id: 'r4', entry_id: 'e5', date: '2026-06-01', members: [m(DAVI)], status: 'dsq', final_ms: 1_200_000 }),
  makeResult({ race_id: 'r4', entry_id: 'e6', date: '2026-06-01', members: [{ athlete_id: 'priv', name: 'Privado' }], final_ms: 1_100_000, overall_pos: 1 }),
];
const row = (r: { pos: number; name: string; value: number }) => [r.pos, r.name, r.value];

describe('computeLeaders (spec §5.4)', () => {
  it('ranks with §10 definitions; ties share the position; zero is left out', () => {
    const l = computeLeaders(athletes, results, { year: null, sex: null });
    expect(l.wins.map(row)).toEqual([[1, 'Ana', 2], [2, 'Bia', 1], [2, 'Carlos', 1]]);
    expect(l.podiums.map(row)).toEqual([[1, 'Ana', 2]]);
    expect(l.finishes.map(row)).toEqual([[1, 'Ana', 3], [2, 'Bia', 1], [2, 'Carlos', 1]]);
    expect(l.km.map(row)).toEqual([[1, 'Ana', 10.75], [2, 'Bia', 5], [2, 'Carlos', 5]]);
  });
  it('filters by year and by the registered sex', () => {
    expect(computeLeaders(athletes, results, { year: '2026', sex: null }).wins.map((r) => r.name)).toEqual(['Ana', 'Carlos']);
    expect(computeLeaders(athletes, results, { year: null, sex: 'F' }).wins.map((r) => r.name)).toEqual(['Ana', 'Bia']);
    expect(computeLeaders(athletes, results, { year: null, sex: 'M' }).km.map((r) => [r.name, r.value])).toEqual([['Carlos', 5]]);
  });
  it('sums km in meters, so 100 m + 200 m ties with 300 m (Review Focus 3)', () => {
    const split = [
      makeResult({ race_id: 'k1', entry_id: 'k1', date: '2026-01-01', members: [m(BIA)], final_ms: 60_000, overall_pos: 1, legs: [{ athlete_id: 'bia', distance_m: 100, time_ms: 60_000 }] }),
      makeResult({ race_id: 'k2', entry_id: 'k2', date: '2026-01-02', members: [m(BIA)], final_ms: 90_000, overall_pos: 1, legs: [{ athlete_id: 'bia', distance_m: 200, time_ms: 90_000 }] }),
      makeResult({ race_id: 'k3', entry_id: 'k3', date: '2026-01-03', members: [m(CARLOS)], final_ms: 120_000, overall_pos: 1, legs: [{ athlete_id: 'carlos', distance_m: 300, time_ms: 120_000 }] }),
    ];
    expect(computeLeaders(athletes, split, { year: null, sex: null }).km.map((r) => [r.pos, r.name, r.value])).toEqual([[1, 'Bia', 0.3], [1, 'Carlos', 0.3]]);
  });
});

describe('rankLeaders', () => {
  it('keeps positions up to 10, including everyone tied with the 10th', () => {
    const rows = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 2, 1].map((v, i) => ({ athlete_id: `x${i}`, name: `Atleta ${String(i).padStart(2, '0')}`, value: v }));
    expect(rankLeaders(rows).map((r) => r.pos)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10]);
  });
});

describe('computeClubRecords (spec §5.5)', () => {
  it('keeps the best leg of each athlete, the 3 best athletes per group, groups by modality then distance', () => {
    const extra = [
      makeResult({ race_id: 'x1', entry_id: 'x1', date: '2026-08-01', members: [m(ANA)], final_ms: 1_700_000, overall_pos: 3 }),
      makeResult({ race_id: 'x2', entry_id: 'x2', date: '2026-08-02', members: [m(CARLOS)], final_ms: 3_000_000, overall_pos: 1, legs: [{ athlete_id: 'carlos', distance_m: 10_000, time_ms: 3_000_000 }] }),
    ];
    const g = computeClubRecords(athletes, [...results, ...extra], { year: null, sex: null });
    expect(g.map((x) => x.title)).toEqual(['Corrida 5 km', 'Corrida 10 km', 'Natação 750 m']);
    expect(g[0].entries.map((e) => [e.name, e.time_ms])).toEqual([['Carlos', 1_400_000], ['Bia', 1_450_000], ['Ana', 1_500_000]]);
    expect(g[0].entries[0]).toMatchObject({ pace: '4:40 /km', event_name: 'Evento 2026-05-01', event_date: '2026-05-01' });
  });
  it('a time tie goes to the earlier date; the sex filter and private athletes are respected', () => {
    const tie = [
      makeResult({ race_id: 't1', entry_id: 't1', date: '2026-04-01', members: [m(BIA)], final_ms: 1_450_000, overall_pos: 1 }),
      makeResult({ race_id: 't2', entry_id: 't2', date: '2024-04-01', members: [m(ANA)], final_ms: 1_450_000, overall_pos: 1 }),
    ];
    const g = computeClubRecords(athletes, [...results, ...tie], { year: null, sex: 'F' });
    expect(g[0].title).toBe('Corrida 5 km');
    expect(g[0].entries.map((e) => [e.name, e.event_date])).toEqual([['Ana', '2024-04-01'], ['Bia', '2025-10-05']]);
  });
  it('filters by year', () => {
    const g = computeClubRecords(athletes, results, { year: '2025', sex: null });
    expect(g.map((x) => x.title)).toEqual(['Corrida 5 km']);
    expect(g[0].entries.map((e) => e.name)).toEqual(['Bia', 'Ana']);
  });
});
