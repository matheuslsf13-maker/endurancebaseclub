import { ageOn } from '../../domain/categories';

const TZ = 'America/Sao_Paulo';

/** Today's date, in Brasília, as 'aaaa-mm-dd' — the app-wide rule that every date is shown in
 * America/Sao_Paulo applies here too, even though "idade hoje" has nothing to do with an event.
 * Shared by AthletesPage (the "Idade hoje" column) and AthleteProfilePage (the header). */
export function todayIsoBrasilia(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** The athlete's age as of today (Brasília), or `null` when the birth date is unknown. */
export function ageToday(birthDate: string | null): number | null {
  return birthDate ? ageOn(birthDate, todayIsoBrasilia(), 'event_date') : null;
}
