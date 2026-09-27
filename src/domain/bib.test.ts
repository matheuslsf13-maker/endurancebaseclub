import { describe, it, expect } from 'vitest';
import { normalizeBib, resolveBib } from './bib';
import { makeEntry } from './testing/fixtures';

const entries = [makeEntry({ id: 'e7', bib: '007' }), makeEntry({ id: 'e101', bib: '101' }), makeEntry({ id: 'e5', bib: '5', status: 'dns' }), makeEntry({ id: 'e9', bib: '9', status: 'dsq' }), makeEntry({ id: 'e12a', bib: '12A' })];
describe('bib resolution', () => {
  it('normalizes', () => { expect(normalizeBib('  101 ')).toBe('101'); expect(normalizeBib(' 12a ')).toBe('12A'); });
  it('matches exact, trimmed and numeric-equivalent bibs', () => {
    expect(resolveBib(entries, ' 101 ')).toMatchObject({ entry: { id: 'e101' }, warning: null });
    expect(resolveBib(entries, '7')).toMatchObject({ entry: { id: 'e7' } });
    expect(resolveBib(entries, '0101')).toMatchObject({ entry: { id: 'e101' } });
    expect(resolveBib(entries, '12a')).toMatchObject({ entry: { id: 'e12a' } });
  });
  it('reports unknown or empty bibs', () => {
    expect(resolveBib(entries, '999')).toEqual({ error: 'Nº 999 não encontrado' });
    expect(resolveBib(entries, '  ')).toEqual({ error: 'Digite o nº de peito' });
  });
  it('warns (does not block) for DNS and DSQ', () => {
    expect(resolveBib(entries, '5')).toMatchObject({ entry: { id: 'e5' }, warning: 'Nº 5 está marcado como DNS' });
    expect(resolveBib(entries, '9')).toMatchObject({ entry: { id: 'e9' }, warning: 'Nº 9 está marcado como DSQ' });
  });
});
