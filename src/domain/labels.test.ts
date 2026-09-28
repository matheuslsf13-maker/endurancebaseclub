import { describe, expect, it } from 'vitest';
import { crossingSourceLabel } from './labels';
import { computeCrossing } from './consolidation';
import { makeMark, makeRace, makeTimekeeper, MIN, SEC, T0 } from './testing/fixtures';
import type { RaceConfig } from '../lib/types';

const L0 = T0 + 10 * MIN;
const tkById = new Map([makeTimekeeper({ id: 'tk1', name: 'Ana' }), makeTimekeeper({ id: 'tk2', name: 'Bia' })].map((t) => [t.id, t]));
const marks = [makeMark({ at: L0, timekeeper_id: 'tk1' }), makeMark({ at: L0 + 2 * SEC, timekeeper_id: 'tk2' })];
const crossing = (patch: Partial<RaceConfig>) => {
  const config = makeRace({ configPatch: patch }).config;
  return { c: computeCrossing({ legIndex: 0, marks, resolution: null, config }), config };
};

describe('crossingSourceLabel (0009)', () => {
  it('names the system method', () => {
    const med = crossing({ time_source: 'median', reference_timekeeper_id: null });
    expect(crossingSourceLabel(med.c, tkById, marks, med.config)).toBe('Sistema (mediana)');
    const avg = crossing({ time_source: 'mean', reference_timekeeper_id: null });
    expect(crossingSourceLabel(avg.c, tkById, marks, avg.config)).toBe('Sistema (média)');
  });
  it('names the priority timekeeper', () => {
    const prio = crossing({ time_source: 'mean', reference_timekeeper_id: 'tk2' });
    expect(crossingSourceLabel(prio.c, tkById, marks, prio.config)).toBe('Prioritário (Bia)');
  });
});
