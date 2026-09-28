import { foldAccents } from '../../lib/text';

/** Spec 2026-09-28 §3.2: name search ignoring accents, case and surrounding spaces; an empty term
 * keeps everyone. */
export function searchAthletes<T extends { name: string }>(athletes: T[], term: string): T[] {
  const t = foldAccents(term.trim());
  return t ? athletes.filter((a) => foldAccents(a.name).includes(t)) : athletes;
}
