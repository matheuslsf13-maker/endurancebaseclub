import { describe, it, expect } from 'vitest';
import { defaultRaceConfig, generateAgeGroups, RACE_PRESETS, normalizeRaceConfig, MODALITY_LABEL } from './presets';

describe('presets', () => {
  it('individual default config', () => {
    const c = defaultRaceConfig(1);
    expect(c.rankings.map(r => r.id)).toEqual(['geral', 'faixa']);
    expect(c.rankings[0]).toEqual({ id: 'geral', name: 'Geral', dims: ['sex'], size: 3 });
    expect(c.rankings[1]).toEqual({ id: 'faixa', name: 'Faixa etária', dims: ['sex', 'age'], size: 3 });
    expect(c.age_groups.map(g => g.label)).toEqual(['até 19', '20-29', '30-39', '40-49', '50-59', '60+']);
    expect(c).toMatchObject({ cumulative: false, same_crossing_window_s: 30, divergence_threshold_s: 3, time_source: 'median', age_rule: 'year_end', team_age_rule: 'sum', reference_timekeeper_id: null });
  });
  it('team default config', () => {
    const c = defaultRaceConfig(2);
    expect(c.rankings).toEqual([{ id: 'geral', name: 'Geral', dims: ['sex'], size: 3 }]);
    expect(c.age_groups).toEqual([]);
  });
  it('generates age groups', () => {
    expect(generateAgeGroups(20, 10, 60)).toEqual([
      { label: 'até 19', min: 0, max: 19 }, { label: '20-29', min: 20, max: 29 }, { label: '30-39', min: 30, max: 39 },
      { label: '40-49', min: 40, max: 49 }, { label: '50-59', min: 50, max: 59 }, { label: '60+', min: 60, max: null },
    ]);
    expect(generateAgeGroups(18, 5, 28).map(g => g.label)).toEqual(['até 17', '18-22', '23-27', '28+']);
  });
  it('has the race presets', () => {
    const ids = RACE_PRESETS.map(p => p.id);
    expect(ids).toEqual(['corrida-5k', 'corrida-10k', 'natacao-1500', 'ciclismo-20k', 'duathlon', 'aquathlon', 'triathlon-sprint', 'triathlon-olimpico', 'revezamento-dupla-aquathlon', 'revezamento-trio-triathlon', 'personalizada']);
    const sprint = RACE_PRESETS.find(p => p.id === 'triathlon-sprint')!;
    expect(sprint.legs.map(l => [l.modality, l.distance_m])).toEqual([['swim', 750], ['bike', 20000], ['run', 5000]]);
    expect(RACE_PRESETS.find(p => p.id === 'duathlon')!.legs.map(l => l.distance_m)).toEqual([5000, 20000, 2500]);
    expect(RACE_PRESETS.find(p => p.id === 'revezamento-dupla-aquathlon')!.team_size).toBe(2);
    expect(RACE_PRESETS.find(p => p.id === 'revezamento-trio-triathlon')!.team_size).toBe(3);
    expect(MODALITY_LABEL.swim).toBe('Natação');
  });
  it('normalizes partial configs', () => {
    expect(normalizeRaceConfig(null, 2)).toEqual(defaultRaceConfig(2));
    const c = normalizeRaceConfig({ divergence_threshold_s: -1, same_crossing_window_s: 0, rankings: [] }, 1);
    expect(c.divergence_threshold_s).toBe(3);
    expect(c.same_crossing_window_s).toBe(30);
    expect(c.rankings).toEqual([]);
  });
});
