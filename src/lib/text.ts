/** Diacritic- and case-insensitive fold for name searches ("joao" must find "João"). Shared by the
 * organizer screens and the public pages (so a public chunk never imports the entries feature). */
export function foldAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}
