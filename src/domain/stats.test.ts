import { describe, it, expect } from 'vitest';
import { computeAthleteStats } from './stats';
import type { ResultRow, ResultSnapshot } from '../lib/types';

function result(p: { date: string; name: string; race: string; status: ResultSnapshot['status']; final: number | null; pos: number | null; fin: number; podiums?: ResultSnapshot['podiums']; members?: ResultSnapshot['members']; legs: ResultSnapshot['legs'] }): ResultRow {
  const members = p.members ?? [{ athlete_id: 'a1', name: 'Ana', legs: p.legs.map(l => l.leg_index) }];
  return {
    race_id: `r-${p.date}`, entry_id: `en-${p.date}`, event_id: `e-${p.date}`, athlete_ids: members.map(m => m.athlete_id),
    status: p.status, final_ms: p.final, overall_pos: p.pos, finalized_at: `${p.date}T20:00:00Z`,
    data: { event: { id: `e-${p.date}`, name: p.name, date: p.date }, race: { id: `r-${p.date}`, name: p.race, team_size: members.length }, bib: '1', team_name: members.length > 1 ? 'Tubarões' : null, members, legs: p.legs, category: { sex: 'F', age: 36, age_group: '30-39', level: null }, status: p.status, total_ms: p.final, penalty_ms: 0, final_ms: p.final, positions: { overall: p.pos, sex: p.pos, finishers: p.fin }, podiums: p.podiums ?? [] },
  };
}
const run = (t: number | null) => ({ leg_index: 0, modality: 'run' as const, label: 'Corrida', distance_m: 5000, athlete_id: 'a1', time_ms: t });
const results = [
  result({ date: '2026-03-10', name: 'Etapa 1', race: 'Corrida 5K', status: 'finished', final: 1_350_000, pos: 1, fin: 20, podiums: [{ ranking_id: 'geral', ranking_name: 'Geral', group_label: 'Feminino', podium_pos: 1 }], legs: [run(1_350_000)] }),
  result({ date: '2026-06-20', name: 'Etapa 2', race: 'Aquathlon Revezamento', status: 'finished', final: 2_400_000, pos: 3, fin: 12, podiums: [{ ranking_id: 'geral', ranking_name: 'Geral', group_label: 'Misto', podium_pos: 2 }],
    members: [{ athlete_id: 'a1', name: 'Ana', legs: [0] }, { athlete_id: 'a2', name: 'Bia', legs: [1] }],
    legs: [{ leg_index: 0, modality: 'swim', label: 'Natação', distance_m: 750, athlete_id: 'a1', time_ms: 750_000 }, { leg_index: 1, modality: 'run', label: 'Corrida', distance_m: 5000, athlete_id: 'a2', time_ms: 1_650_000 }] }),
  result({ date: '2026-09-01', name: 'Etapa 3', race: 'Corrida 5K', status: 'dnf', final: null, pos: null, fin: 25, legs: [run(null)] }),
  result({ date: '2026-09-20', name: 'Etapa 4', race: 'Corrida 5K', status: 'finished', final: 1_300_000, pos: 5, fin: 30, podiums: [{ ranking_id: 'faixa', ranking_name: 'Faixa etária', group_label: 'Feminino · 30-39', podium_pos: 1 }], legs: [run(1_300_000)] }),
];

describe('computeAthleteStats', () => {
  const s = computeAthleteStats('a1', results);
  it('counts participations and outcomes', () => {
    expect(s).toMatchObject({ participations: 4, finishes: 3, dnf: 1, dsq: 0, dns: 0, completion_rate: 0.75, wins_overall: 1, wins_category: 2, podiums: 3, best_overall_pos: 1 });
    expect(s.avg_percentile).toBeCloseTo((1 / 20 + 3 / 12 + 5 / 30) / 3, 6);
  });
  it('personal records and paces use only the athlete own legs', () => {
    expect(s.records.find(r => r.modality === 'run')).toMatchObject({ distance_m: 5000, time_ms: 1_300_000, pace: '4:20 /km', event_name: 'Etapa 4' });
    expect(s.records.find(r => r.modality === 'swim')).toMatchObject({ distance_m: 750, time_ms: 750_000, pace: '1:40 /100m' });
    expect(s.pace_by_modality.find(p => p.modality === 'run')).toMatchObject({ distance_m: 10_000, time_ms: 2_650_000, pace: '4:25 /km' });
    expect(s.km_by_modality).toEqual({ run: 10, swim: 0.75 });
  });
  it('history, evolution and partners', () => {
    expect(s.history.map(h => h.event_name)).toEqual(['Etapa 4', 'Etapa 3', 'Etapa 2', 'Etapa 1']);
    expect(s.history[0].podiums).toEqual(['Faixa etária: 1º (Feminino · 30-39)']);
    expect(s.evolution).toMatchObject({ modality: 'run', distance_m: 5000, points: [{ date: '2026-03-10', time_ms: 1_350_000 }, { date: '2026-09-20', time_ms: 1_300_000 }] });
    expect(s.partners).toEqual([{ athlete_id: 'a2', name: 'Bia', count: 1 }]);
  });
  it('empty history', () => {
    expect(computeAthleteStats('zz', [])).toMatchObject({ participations: 0, completion_rate: null, best_overall_pos: null, avg_percentile: null, evolution: null, records: [] });
  });
});

describe('computeAthleteStats status buckets', () => {
  it('dns and not_started both bucket as dns and are excluded from participations (completion_rate null with no participations, even though results is non-empty)', () => {
    const rows = [
      result({ date: '2026-01-01', name: 'Etapa A', race: 'Corrida 5K', status: 'dns', final: null, pos: null, fin: 0, legs: [] }),
      result({ date: '2026-02-01', name: 'Etapa B', race: 'Corrida 5K', status: 'not_started', final: null, pos: null, fin: 0, legs: [] }),
    ];
    const s = computeAthleteStats('a1', rows);
    expect(s).toMatchObject({ participations: 0, finishes: 0, dnf: 0, dns: 2, dsq: 0, completion_rate: null });
  });

  it('on_course buckets as dnf and dsq as its own bucket; both still count as participations', () => {
    const rows = [
      result({ date: '2026-01-01', name: 'Etapa A', race: 'Corrida 5K', status: 'on_course', final: null, pos: null, fin: 0, legs: [] }),
      result({ date: '2026-02-01', name: 'Etapa B', race: 'Corrida 5K', status: 'dsq', final: null, pos: null, fin: 0, legs: [] }),
    ];
    const s = computeAthleteStats('a1', rows);
    expect(s).toMatchObject({ participations: 2, finishes: 0, dnf: 1, dsq: 1, dns: 0, completion_rate: 0 });
  });
});

describe('computeAthleteStats other modality', () => {
  it('includes "other" legs in records and km_by_modality, but skips them in pace_by_modality', () => {
    const rows = [
      result({
        date: '2026-01-01', name: 'Etapa X', race: 'Prova Mista', status: 'finished', final: 500_000, pos: 1, fin: 5,
        legs: [{ leg_index: 0, modality: 'other', label: 'Transição', distance_m: 1000, athlete_id: 'a1', time_ms: 500_000 }],
      }),
    ];
    const s = computeAthleteStats('a1', rows);
    expect(s.records.find(r => r.modality === 'other')).toMatchObject({ distance_m: 1000, time_ms: 500_000 });
    expect(s.pace_by_modality.find(p => p.modality === 'other')).toBeUndefined();
    expect(s.km_by_modality).toEqual({ other: 1 });
  });
});
