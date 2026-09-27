import { describe, expect, it } from 'vitest';
import { errorMessage, parseLevels } from './eventHelpers';

describe('parseLevels', () => {
  it('trims, drops empties and de-duplicates while keeping the first-seen order', () => {
    expect(parseLevels('Elite, Base, Elite')).toEqual(['Elite', 'Base']);
    expect(parseLevels('  Elite ,  , Base  ,,')).toEqual(['Elite', 'Base']);
    expect(parseLevels('')).toEqual([]);
    expect(parseLevels('   ')).toEqual([]);
  });

  it('is case-sensitive (does not fold "Elite" and "elite")', () => {
    expect(parseLevels('Elite, elite')).toEqual(['Elite', 'elite']);
  });

  it('keeps a single level as-is', () => {
    expect(parseLevels('Base')).toEqual(['Base']);
  });
});

describe('errorMessage', () => {
  // `errorMessage` only cares that the value is an `Error` with a message; `ApiError` (whose
  // pt-BR message this is meant to surface) is one, so a plain `Error` covers it here without
  // pulling in `lib/api` → `lib/supabase`, which throws outside a browser env with no
  // VITE_SUPABASE_URL set (see events.test.tsx's own note on this).
  it('returns a plain Error message', () => {
    expect(errorMessage(new Error('algo quebrou'), 'fallback')).toBe('algo quebrou');
  });

  it('falls back when the error has no message', () => {
    expect(errorMessage(new Error(''), 'fallback')).toBe('fallback');
  });

  it('falls back for anything that is not an Error (string, object, null, undefined)', () => {
    expect(errorMessage('boom', 'fallback')).toBe('fallback');
    expect(errorMessage({ message: 'not an Error instance' }, 'fallback')).toBe('fallback');
    expect(errorMessage(null, 'fallback')).toBe('fallback');
    expect(errorMessage(undefined, 'fallback')).toBe('fallback');
  });
});
