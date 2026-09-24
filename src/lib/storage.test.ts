import { describe, it, expect, vi } from 'vitest';
import { memoryStorage, readJSON, writeJSON, safeLocalStorage } from './storage';

describe('storage', () => {
  it('memory roundtrip and JSON helpers', () => {
    const s = memoryStorage();
    writeJSON(s, 'k', { a: 1 });
    expect(readJSON(s, 'k', null)).toEqual({ a: 1 });
    s.setItem('bad', '{not json');
    expect(readJSON(s, 'bad', 'fallback')).toBe('fallback');
    expect(readJSON(s, 'missing', 7)).toBe(7);
  });
  it('safeLocalStorage works and survives a throwing localStorage', () => {
    const s = safeLocalStorage();
    s.setItem('x', '1');
    expect(s.getItem('x')).toBe('1');
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const s2 = safeLocalStorage();
    expect(() => s2.setItem('y', '2')).not.toThrow();
    expect(s2.getItem('y')).toBe('2'); // served from the in-memory fallback
    spy.mockRestore();
  });
});
