import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router';
import { Badge, Button, Card, EmptyState, Table } from '../../components/ui';
import { useToast } from '../../components/ui/Toast';
import { formatClock, formatDuration } from '../../lib/format';
import { api } from '../../lib/api';
import { entryDisplayName, legAthleteId } from '../../domain/eventModel';
import type { EventIndex } from '../../domain/eventModel';
import { planBibAssignment } from '../../domain/suggestLeg';
import { useEventContext } from '../events/EventContext';
import { useNow } from '../../hooks/useNow';
import type { EntryRow, MarkRow, RaceRow } from '../../lib/types';
import { errorMessage } from './timingHelpers';

const RECENT_MARKS_LIMIT = 30;
/** Live per-leg timers refresh twice a second (spec §7.6 "cronômetro da perna"). */
const LEG_TIMER_TICK_MS = 500;

/** Author label for a mark's feed row: "Organização" for an organizer mark, the timekeeper's
 * name when known, or "Cronometrista" for an id no longer in the loaded roster (Ruling 33). */
function timekeeperLabel(timekeeperId: string | null, index: EventIndex): string {
  if (timekeeperId === null) return 'Organização';
  return index.timekeepersById.get(timekeeperId)?.name ?? 'Cronometrista';
}

function markSituacao(mark: MarkRow, byEntry: ReturnType<typeof useEventContext>['timing']['byEntry']): string {
  if (mark.discarded) return 'Descartada';
  if (mark.entry_id === null) return 'Sem atleta';
  const entryTiming = byEntry.get(mark.entry_id);
  const leg = mark.leg_index !== null ? entryTiming?.legs[mark.leg_index] : undefined;
  if (leg?.crossing.duplicates.includes(mark.id)) return 'Duplicada';
  return 'Usada';
}

interface OnCourseRowProps {
  entry: EntryRow;
  race: RaceRow;
}

/** One on-course entry: current athlete, current leg and a running leg timer (spec §7.6). */
function OnCourseRow({ entry, race }: OnCourseRowProps) {
  const { index, timing, clock } = useEventContext();
  const tick = useNow(LEG_TIMER_TICK_MS);
  const officialNow = tick + (clock.offsetMs ?? 0);

  const t = timing.byEntry.get(entry.id);
  if (!t || t.current_leg === null) return null;
  const leg = race.legs[t.current_leg];
  const athleteId = legAthleteId(entry, t.current_leg);
  const athleteName = athleteId ? (index.athletesById.get(athleteId)?.name ?? '—') : '—';
  const elapsed = t.current_leg_start_ms !== null ? Math.max(0, officialNow - t.current_leg_start_ms) : null;

  return (
    <tr className="border-t border-border">
      <td className="tabular px-3 py-2">{entry.bib}</td>
      <td className="px-3 py-2">{entryDisplayName(entry, index)}</td>
      <td className="px-3 py-2">{athleteName}</td>
      <td className="px-3 py-2">
        Perna {t.current_leg + 1} · {leg.label}
      </td>
      <td className="tabular px-3 py-2">{formatDuration(elapsed, { tenths: true })}</td>
    </tr>
  );
}

interface UnassignedRowProps {
  mark: MarkRow;
}

/** "Sem atleta" inline assignment: types a bib, `planBibAssignment` resolves it and suggests the
 * leg (Ruling 2 — no local `resolveBib`/`suggestLeg` copy); no athleteId is ever passed here
 * (Ruling 10 only applies to the "Em prova" list, but there is none to derive one from anyway). */
function UnassignedRow({ mark }: UnassignedRowProps) {
  const { agg, index, refresh } = useEventContext();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem('bib') as HTMLInputElement;
    const bibText = input.value;
    const plan = planBibAssignment({
      entries: agg.entries,
      racesById: index.racesById,
      marks: agg.marks,
      markId: mark.id,
      tsMs: Date.parse(mark.ts),
      bibText,
    });
    if ('error' in plan) {
      setError(plan.error);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.admin.updateMark(mark.id, { entry_id: plan.entry.id, leg_index: plan.suggestion.leg_index });
      await refresh();
      toast.show({
        message: `Nº ${plan.entry.bib} atribuído · perna ${plan.suggestion.leg_index + 1}/${plan.race.legs.length} (${plan.race.legs[plan.suggestion.leg_index].label})`,
        tone: plan.warning ? 'warning' : 'success',
      });
      if (plan.warning) toast.show({ message: plan.warning, tone: 'warning' });
      input.value = '';
    } catch (e2) {
      toast.show({ message: errorMessage(e2), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-2 border-t border-border py-2 first:border-t-0">
      <span className="tabular">{formatClock(Date.parse(mark.ts), { tenths: true })}</span>
      <span className="text-muted">{timekeeperLabel(mark.timekeeper_id, index)}</span>
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <label className="sr-only" htmlFor={`live-assign-bib-${mark.id}`}>
          Nº de peito
        </label>
        <input
          id={`live-assign-bib-${mark.id}`}
          name="bib"
          data-testid="live-assign-bib"
          placeholder="Nº"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `live-assign-error-${mark.id}` : undefined}
          className="min-h-11 w-24 rounded-xl border border-border bg-surface px-3 py-2 text-fg tabular placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
        <Button type="submit" size="sm" data-testid="live-assign-submit" loading={busy}>
          Atribuir
        </Button>
      </form>
      {error && (
        <p id={`live-assign-error-${mark.id}`} role="alert" className="w-full text-sm text-danger">
          {error}
        </p>
      )}
    </li>
  );
}

/** Painel ao vivo (spec §7.6): contadores, quem está em prova (com cronômetro da perna), o feed
 * de marcações recentes e a lista "Sem atleta" para atribuição rápida. */
export function LiveBoard() {
  const { eventId, agg, index, timing } = useEventContext();

  let onCourse = 0;
  let finished = 0;
  let notStarted = 0;
  for (const t of timing.byEntry.values()) {
    if (t.status === 'on_course') onCourse++;
    else if (t.status === 'finished') finished++;
    else if (t.status === 'not_started') notStarted++;
  }
  const pendingCount = timing.issues.filter((i) => i.severity !== 'info').length;

  const races = [...agg.races].sort((a, b) => a.position - b.position);
  const onCourseByRace = new Map<string, EntryRow[]>();
  for (const entry of agg.entries) {
    if (timing.byEntry.get(entry.id)?.status !== 'on_course') continue;
    const list = onCourseByRace.get(entry.race_id) ?? [];
    list.push(entry);
    onCourseByRace.set(entry.race_id, list);
  }
  for (const list of onCourseByRace.values()) {
    list.sort((a, b) => a.bib.localeCompare(b.bib, 'pt-BR', { numeric: true }));
  }

  const recentMarks = [...agg.marks].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts)).slice(0, RECENT_MARKS_LIMIT);
  const unassigned = agg.marks
    .filter((m) => !m.discarded && m.entry_id === null)
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

  return (
    <Card data-testid="live-board">
      <h2 className="brand-title mb-4 text-lg font-semibold">Ao vivo</h2>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-surface-2 p-3">
          <p className="text-sm text-muted">Em prova</p>
          <p className="tabular text-2xl font-semibold">{onCourse}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface-2 p-3">
          <p className="text-sm text-muted">Concluídos</p>
          <p className="tabular text-2xl font-semibold">{finished}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface-2 p-3">
          <p className="text-sm text-muted">Não largaram</p>
          <p className="tabular text-2xl font-semibold">{notStarted}</p>
        </div>
        <Link
          to={`/eventos/${eventId}/revisao`}
          className="rounded-xl border border-border bg-surface-2 p-3 hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <p className="text-sm text-muted">Pendências</p>
          <p className={`tabular text-2xl font-semibold ${pendingCount > 0 ? 'text-warning' : ''}`}>{pendingCount}</p>
        </Link>
      </div>

      {races.map((race) => {
        const list = onCourseByRace.get(race.id) ?? [];
        if (list.length === 0) return null;
        return (
          <div key={race.id} className="mb-6">
            <h3 className="mb-2 font-semibold">{race.name}</h3>
            <Table data-testid={`on-course-table-${race.id}`}>
              <thead>
                <tr>
                  <th className="px-3 py-2">Nº</th>
                  <th className="px-3 py-2">Equipe</th>
                  <th className="px-3 py-2">Atleta atual</th>
                  <th className="px-3 py-2">Perna</th>
                  <th className="px-3 py-2">Tempo da perna</th>
                </tr>
              </thead>
              <tbody>
                {list.map((entry) => (
                  <OnCourseRow key={entry.id} entry={entry} race={race} />
                ))}
              </tbody>
            </Table>
          </div>
        );
      })}

      <div className="mb-6">
        <h3 className="mb-2 font-semibold">Últimas marcações</h3>
        {recentMarks.length === 0 ? (
          <EmptyState title="Nenhuma marcação ainda" />
        ) : (
          <Table data-testid="recent-marks-table">
            <thead>
              <tr>
                <th className="px-3 py-2">Hora</th>
                <th className="px-3 py-2">Cronometrista</th>
                <th className="px-3 py-2">Nº</th>
                <th className="px-3 py-2">Perna</th>
                <th className="px-3 py-2">Situação</th>
              </tr>
            </thead>
            <tbody>
              {recentMarks.map((m) => {
                const entry = m.entry_id ? index.entriesById.get(m.entry_id) : undefined;
                return (
                  <tr key={m.id} className="border-t border-border">
                    <td className="tabular px-3 py-2">{formatClock(Date.parse(m.ts), { tenths: true })}</td>
                    <td className="px-3 py-2">{timekeeperLabel(m.timekeeper_id, index)}</td>
                    <td className="tabular px-3 py-2">{entry?.bib ?? '—'}</td>
                    <td className="tabular px-3 py-2">{m.leg_index !== null ? m.leg_index + 1 : '—'}</td>
                    <td className="px-3 py-2">{markSituacao(m, timing.byEntry)}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </div>

      <div>
        <h3 className="mb-2 flex items-center gap-2 font-semibold">
          Sem atleta
          {unassigned.length > 0 && <Badge tone="warning">{unassigned.length}</Badge>}
        </h3>
        {unassigned.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma marcação pendente.</p>
        ) : (
          <ul>
            {unassigned.map((m) => (
              <UnassignedRow key={m.id} mark={m} />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
