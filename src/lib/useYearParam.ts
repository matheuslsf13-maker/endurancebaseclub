import { useSearchParams } from 'react-router';

/** Spec 2026-09-28 §3.3: the year filter lives in the URL (`?ano=AAAA`) so a shared link keeps it.
 * A missing year, or one not in `years`, is the career (null). Other query params are preserved. */
export function useYearParam(years: string[]): [string | null, (year: string | null) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get('ano');
  const year = raw !== null && years.includes(raw) ? raw : null;
  const setYear = (next: string | null) => {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next === null) p.delete('ano');
      else p.set('ano', next);
      return p;
    }, { replace: true });
  };
  return [year, setYear];
}
