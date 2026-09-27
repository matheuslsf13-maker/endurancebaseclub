import { Link } from 'react-router';
import { Table } from '../../components/ui';
import { groupLabel } from '../../domain/categories';
import { STATUS_LABEL } from '../../domain/labels';
import type { RaceClassification } from '../../domain/ranking';
import { formatDuration, formatGap } from '../../lib/format';
import type { AthleteRow, EntryRow, RaceRow, RankingDim } from '../../lib/types';
import type { EntryTiming } from '../../domain/consolidation';

export type AthleteLinkMode = 'admin' | 'public' | false;

export interface ClassificationTableProps {
  race: RaceRow;
  cls: RaceClassification;
  showLegs?: boolean;
  linkAthletes?: AthleteLinkMode;
  /** Resolves a member's display name; entries only carry `athlete_id` (spec §6, `admin_get_event`
   * does not embed member names). Required even though the brief's prop list omits it — there is
   * no other way to go from an entry to a human name (see report). */
  athletesById: Map<string, AthleteRow>;
}

/** `Nome (Perna label)` per member, `·`-joined — the plain-text form used where links do not make
 * sense (podium cards). A team's members are always shown with the leg(s) they cover so a relay's
 * card reads e.g. "Ana (Natação) · Beto (Corrida)"; an individual entry (`team_size <= 1`) is just
 * the athlete's name, since there is nothing to disambiguate. */
export function entryLabel(entry: EntryRow, race: RaceRow, athletesById: Map<string, AthleteRow>): string {
  const members = entry.members.slice().sort((a, b) => a.position - b.position);
  if (race.team_size <= 1) {
    return members.map(m => athletesById.get(m.athlete_id)?.name ?? '?').join(' / ');
  }
  return members
    .map(m => {
      const name = athletesById.get(m.athlete_id)?.name ?? '?';
      const legLabels = m.legs.map(k => race.legs[k]?.label).filter((l): l is string => !!l).join('/');
      return legLabels ? `${name} (${legLabels})` : name;
    })
    .join(' · ');
}

const PROFILE_PATH: Record<Exclude<AthleteLinkMode, false>, string> = { admin: '/atletas', public: '/atleta' };

/** Same breakdown as `entryLabel`, but each member's name links to their profile (admin: always;
 * public: only athletes with `public_profile`), per Task 26's "athlete names link … when
 * `public_profile`" rule. */
function MemberNames({
  entry, race, athletesById, linkAthletes,
}: { entry: EntryRow; race: RaceRow; athletesById: Map<string, AthleteRow>; linkAthletes: AthleteLinkMode }) {
  const members = entry.members.slice().sort((a, b) => a.position - b.position);
  const isTeam = race.team_size > 1;

  return (
    <>
      {members.map((m, i) => {
        const athlete = athletesById.get(m.athlete_id);
        const name = athlete?.name ?? '?';
        const legLabels = isTeam ? m.legs.map(k => race.legs[k]?.label).filter((l): l is string => !!l).join('/') : '';
        const text = legLabels ? `${name} (${legLabels})` : name;
        const canLink = linkAthletes === 'admin' || (linkAthletes === 'public' && athlete?.public_profile === true);
        return (
          <span key={m.athlete_id}>
            {i > 0 ? ' · ' : ''}
            {canLink ? (
              <Link to={`${PROFILE_PATH[linkAthletes as Exclude<AthleteLinkMode, false>]}/${m.athlete_id}`} className="underline underline-offset-2 hover:text-accent">
                {text}
              </Link>
            ) : (
              text
            )}
          </span>
        );
      })}
    </>
  );
}

/** pt-BR status text for a classification row, with Controller Ruling 9's hint: a `finished`
 * status with no resolvable `final_ms` (a finish mark with no wave start to time it from) is
 * unranked but did cross the line, so it is called out rather than shown as a plain "Concluiu". */
function statusText(timing: EntryTiming): string {
  const label = STATUS_LABEL[timing.status];
  return timing.status === 'finished' && timing.final_ms === null ? `${label} (sem largada)` : label;
}

const PODIUM_ROW_CLASS = 'bg-warning/10';

export function ClassificationTable({ race, cls, showLegs = false, linkAthletes = false, athletesById }: ClassificationTableProps) {
  const legCount = race.legs.length;
  // "Categoria" merges sex/age/level into one column (spec §9's dimensions); level is included
  // only when this race actually uses levels, so a race without them does not show "Sem nível" on
  // every row.
  const hasLevels = cls.rows.some(r => r.category.level !== null);
  const catDims: RankingDim[] = hasLevels ? ['sex', 'age', 'level'] : ['sex', 'age'];

  return (
    <Table data-testid="classification-table">
      <thead>
        <tr>
          <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">Pos</th>
          <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">Nº</th>
          <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">Atleta/Equipe</th>
          <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">Categoria</th>
          {showLegs && Array.from({ length: legCount }, (_, k) => (
            <th key={k} className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
              Perna {k + 1} ({race.legs[k].label})
            </th>
          ))}
          <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">Total</th>
          <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">Penal.</th>
          <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">Final</th>
          <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">Dif. 1º</th>
          <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">Status</th>
        </tr>
      </thead>
      <tbody>
        {cls.rows.map(row => {
          const isPodium = row.overall_pos !== null && row.overall_pos <= 3;
          return (
            <tr
              key={row.entry.id}
              data-testid="classification-row"
              className={`border-t border-border tabular ${isPodium ? PODIUM_ROW_CLASS : ''}`}
            >
              <td className="px-3 py-2">{row.overall_pos ?? '—'}</td>
              <td className="px-3 py-2">{row.entry.bib}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                {linkAthletes ? (
                  <MemberNames entry={row.entry} race={race} athletesById={athletesById} linkAthletes={linkAthletes} />
                ) : (
                  entryLabel(row.entry, race, athletesById)
                )}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">{groupLabel(catDims, row.category)}</td>
              {showLegs && Array.from({ length: legCount }, (_, k) => (
                <td key={k} className="px-3 py-2">
                  {formatDuration(row.timing.legs.find(l => l.leg_index === k)?.leg_ms ?? null)}
                </td>
              ))}
              <td className="px-3 py-2">{formatDuration(row.timing.total_ms)}</td>
              <td className="px-3 py-2">{formatGap(row.entry.penalty_ms)}</td>
              <td className="px-3 py-2 font-medium">{formatDuration(row.timing.final_ms)}</td>
              <td className="px-3 py-2">{formatGap(row.gap_ms)}</td>
              <td className="px-3 py-2 whitespace-nowrap">{statusText(row.timing)}</td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
