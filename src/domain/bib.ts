import type { EntryRow } from '../lib/types';

export type BibResolution = { entry: EntryRow; warning: string | null } | { error: string };

/** Trims and uppercases a bib number as typed by a timekeeper (`" 12a "` -> `"12A"`). */
export function normalizeBib(input: string): string {
  return input.trim().toUpperCase();
}

const ALL_DIGITS = /^\d+$/;

/**
 * Resolves a typed bib number against an event's entries: exact (normalized) match first, then —
 * when the input is purely numeric — a numeric-equivalent match against entries whose bib is also
 * purely numeric (so "7" finds "007" but never matches an alphanumeric bib like "12A"). DNS/DSQ
 * entries resolve with a warning instead of an error, since the timekeeper may still want to mark
 * a late/contested crossing for them.
 */
export function resolveBib(entries: EntryRow[], input: string): BibResolution {
  const norm = normalizeBib(input);
  if (!norm) return { error: 'Digite o nº de peito' };

  let match = entries.find(e => normalizeBib(e.bib) === norm);
  if (!match && ALL_DIGITS.test(norm)) {
    const target = parseInt(norm, 10);
    match = entries.find(e => {
      const b = normalizeBib(e.bib);
      return ALL_DIGITS.test(b) && parseInt(b, 10) === target;
    });
  }
  if (!match) return { error: `Nº ${norm} não encontrado` };

  const warning =
    match.status === 'dns' ? `Nº ${match.bib} está marcado como DNS` :
    match.status === 'dsq' ? `Nº ${match.bib} está marcado como DSQ` :
    null;

  return { entry: match, warning };
}
