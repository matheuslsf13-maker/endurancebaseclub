import { describe, expect, it } from 'vitest';
import { foldAccents } from './text';

describe('foldAccents', () => {
  it('drops accents and case', () => {
    expect(foldAccents('João Núñez')).toBe('joao nunez');
    expect(foldAccents('ÂNGELA')).toBe('angela');
  });
});
