import { describe, expect, it } from 'vitest';
import { defaultRaceConfig, normalizeRaceConfig, RACE_PRESETS } from '../../domain/presets';
import { makeRace, makeWave } from '../../domain/testing/fixtures';
import type { RaceConfig } from '../../lib/types';
import {
  distanceToForm, formToPayload, legsSummary, moveItem, parseDistance, presetToForm, raceToForm, teamSizeLabel,
  validateRaceForm,
} from './raceForm';
import type { RaceForm } from './raceForm';

function preset(id: string) {
  const p = RACE_PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`preset not found: ${id}`);
  return p;
}

function baseForm(p: Partial<RaceForm> = {}): RaceForm {
  return {
    event_id: 'e1',
    name: 'Prova Teste',
    position: 0,
    team_size: 1,
    legs: [{ modality: 'run', label: 'Corrida', distance: '5', unit: 'km' }],
    waves: [{ name: 'Largada geral', position: 0, start_at: null }],
    config: defaultRaceConfig(1),
    ...p,
  };
}

describe('distanceToForm', () => {
  it('shows meters when not a whole multiple of 1000', () => {
    expect(distanceToForm(750)).toEqual({ distance: '750', unit: 'm' });
  });
  it('shows kilometers when a whole multiple of 1000 (>= 1000)', () => {
    expect(distanceToForm(20000)).toEqual({ distance: '20', unit: 'km' });
    expect(distanceToForm(5000)).toEqual({ distance: '5', unit: 'km' });
  });
  it('shows an empty meters field for a null distance', () => {
    expect(distanceToForm(null)).toEqual({ distance: '', unit: 'm' });
  });
});

describe('presetToForm', () => {
  it('converts the Triathlon Sprint preset legs with the display unit rule', () => {
    const form = presetToForm(preset('triathlon-sprint'), 'ev1');
    expect(form.event_id).toBe('ev1');
    expect(form.team_size).toBe(1);
    expect(form.legs).toEqual([
      { modality: 'swim', label: 'Natação', distance: '750', unit: 'm' },
      { modality: 'bike', label: 'Ciclismo', distance: '20', unit: 'km' },
      { modality: 'run', label: 'Corrida', distance: '5', unit: 'km' },
    ]);
  });

  it('starts with one wave and the team defaults for the preset size', () => {
    const form = presetToForm(preset('revezamento-dupla-aquathlon'), 'ev1');
    expect(form.team_size).toBe(2);
    expect(form.waves).toEqual([{ name: 'Largada geral', position: 0, start_at: null }]);
    expect(form.config).toEqual(defaultRaceConfig(2));
  });
});

describe('raceToForm', () => {
  it('keeps existing wave ids and start times, sorted by position', () => {
    const race = makeRace({ id: 'r1', event_id: 'e1' });
    const waves = [
      makeWave({ id: 'w2', race_id: 'r1', name: 'Onda 2', position: 1, start_at: null }),
      makeWave({ id: 'w1', race_id: 'r1', name: 'Onda 1', position: 0, start_at: '2026-10-11T11:00:00.000Z' }),
      makeWave({ id: 'w9', race_id: 'other-race', position: 0 }),
    ];
    const form = raceToForm(race, waves);
    expect(form.id).toBe('r1');
    expect(form.waves).toEqual([
      { id: 'w1', name: 'Onda 1', position: 0, start_at: '2026-10-11T11:00:00.000Z' },
      { id: 'w2', name: 'Onda 2', position: 1, start_at: null },
    ]);
  });

  it('falls back to one "Largada geral" when the race has no wave', () => {
    const race = makeRace({ id: 'r1' });
    const form = raceToForm(race, []);
    expect(form.waves).toEqual([{ name: 'Largada geral', position: 0, start_at: null }]);
  });

  it('normalizes a partial/legacy config, filling in missing keys with the team-size defaults', () => {
    // Simulates a config saved before some keys existed (or trimmed by hand) — not something
    // RaceConfig's own type allows, but real legacy rows in the database can look like this.
    const legacyConfig = { cumulative: true } as unknown as RaceConfig;
    const race = makeRace({ id: 'r1', team_size: 2, config: legacyConfig });
    const form = raceToForm(race, []);

    expect(form.config).toEqual(normalizeRaceConfig(legacyConfig, 2));
    expect(form.config.rankings).toEqual(defaultRaceConfig(2).rankings);
    expect(form.config.age_groups).toEqual(defaultRaceConfig(2).age_groups);
    expect(form.config.divergence_threshold_s).toBe(defaultRaceConfig(2).divergence_threshold_s);
    expect(form.config.time_source).toBe(defaultRaceConfig(2).time_source);
    // The one field the legacy config did carry survives normalization.
    expect(form.config.cumulative).toBe(true);
  });
});

describe('moveItem', () => {
  it('is a no-op at either bound, returning the same array reference', () => {
    const items = [1, 2, 3];
    expect(moveItem(items, 0, -1)).toBe(items);
    expect(moveItem(items, 2, 1)).toBe(items);
  });

  it('swaps the item up or down, returning a new array', () => {
    const items = ['a', 'b', 'c'];
    const up = moveItem(items, 1, -1);
    expect(up).toEqual(['b', 'a', 'c']);
    expect(up).not.toBe(items);

    const down = moveItem(items, 1, 1);
    expect(down).toEqual(['a', 'c', 'b']);
    expect(down).not.toBe(items);
    // The input array itself is never mutated.
    expect(items).toEqual(['a', 'b', 'c']);
  });
});

describe('formToPayload', () => {
  it('converts a comma-decimal km distance to whole meters', () => {
    const form = baseForm({ legs: [{ modality: 'bike', label: 'Ciclismo', distance: '2,5', unit: 'km' }] });
    const payload = formToPayload(form);
    expect(payload.legs).toEqual([{ modality: 'bike', label: 'Ciclismo', distance_m: 2500 }]);
  });

  it('turns an empty "other" leg distance into null', () => {
    const form = baseForm({ legs: [{ modality: 'other', label: 'Corrida de saco', distance: '', unit: 'm' }] });
    const payload = formToPayload(form);
    expect(payload.legs).toEqual([{ modality: 'other', label: 'Corrida de saco', distance_m: null }]);
  });

  it('always includes the full waves list, numbering positions by order, with ids preserved and none for new waves', () => {
    const form = baseForm({
      id: 'r1',
      waves: [
        { id: 'w1', name: 'Onda 1', position: 0, start_at: '2026-10-11T11:00:00.000Z' },
        { name: 'Onda nova', position: 1, start_at: null },
      ],
    });
    const payload = formToPayload(form);
    expect(payload.waves).toEqual([
      { id: 'w1', name: 'Onda 1', position: 0 },
      { name: 'Onda nova', position: 1 },
    ]);
  });

  it('sends the full config object', () => {
    const form = baseForm();
    expect(formToPayload(form).config).toBe(form.config);
  });
});

describe('validateRaceForm', () => {
  it('requires a name', () => {
    expect(validateRaceForm(baseForm({ name: '  ' }))).toContain('Informe o nome da prova');
  });

  it('requires at least one leg', () => {
    expect(validateRaceForm(baseForm({ legs: [] }))).toContain('Adicione pelo menos uma perna');
  });

  it('flags an invalid distance by 1-based leg position', () => {
    const errors = validateRaceForm(
      baseForm({
        legs: [
          { modality: 'swim', label: 'Natação', distance: '750', unit: 'm' },
          { modality: 'run', label: 'Corrida', distance: 'abc', unit: 'km' },
        ],
      }),
    );
    expect(errors).toContain('Distância inválida na perna 2');
  });

  it('requires a distance for real modalities but allows a blank one for "other"', () => {
    const errors = validateRaceForm(baseForm({ legs: [{ modality: 'other', label: 'Extra', distance: '', unit: 'm' }] }));
    expect(errors).not.toContain('Distância inválida na perna 1');

    const errorsRun = validateRaceForm(baseForm({ legs: [{ modality: 'run', label: 'Corrida', distance: '', unit: 'km' }] }));
    expect(errorsRun).toContain('Distância inválida na perna 1');
  });

  it('surfaces age-group overlap messages from the domain validator', () => {
    const form = baseForm({
      config: {
        ...defaultRaceConfig(1),
        age_groups: [
          { label: '20-29', min: 20, max: 29 },
          { label: '25-34', min: 25, max: 34 },
        ],
      },
    });
    expect(validateRaceForm(form)).toContain('Faixas "20-29" e "25-34" se sobrepõem');
  });

  it('flags a podium ranking with an out-of-range size', () => {
    const form = baseForm({
      config: { ...defaultRaceConfig(1), rankings: [{ id: 'geral', name: 'Geral', dims: ['sex'], size: 11 }] },
    });
    expect(validateRaceForm(form)).toContain('O pódio "Geral" precisa de tamanho entre 1 e 10');
  });

  it('is empty for a well-formed form', () => {
    expect(validateRaceForm(baseForm())).toEqual([]);
  });
});

describe('parseDistance', () => {
  it('accepts dot and comma decimals', () => {
    expect(parseDistance('2.5', 'km')).toBe(2500);
    expect(parseDistance('2,5', 'km')).toBe(2500);
  });
  it('rejects blank, non-numeric and non-positive input', () => {
    expect(parseDistance('', 'm')).toBeNull();
    expect(parseDistance('abc', 'm')).toBeNull();
    expect(parseDistance('0', 'm')).toBeNull();
    expect(parseDistance('-5', 'm')).toBeNull();
  });
});

describe('teamSizeLabel', () => {
  it('names 1..3 and generalizes from 4', () => {
    expect(teamSizeLabel(1)).toBe('Individual');
    expect(teamSizeLabel(2)).toBe('Dupla');
    expect(teamSizeLabel(3)).toBe('Trio');
    expect(teamSizeLabel(4)).toBe('Equipe de 4');
    expect(teamSizeLabel(6)).toBe('Equipe de 6');
  });
});

describe('legsSummary', () => {
  it('joins label + distance per leg with an arrow', () => {
    const legs = preset('triathlon-sprint').legs;
    expect(legsSummary(legs)).toBe('Natação 750 m → Ciclismo 20 km → Corrida 5 km');
  });
  it('omits the distance for a leg without one', () => {
    expect(legsSummary([{ modality: 'other', label: 'Extra', distance_m: null }])).toBe('Extra');
  });
});
