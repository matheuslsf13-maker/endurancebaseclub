import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Badge, Button, EmptyState, Input, Select, useToast } from '../../components/ui';
import type { BadgeTone } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { formatClock } from '../../lib/format';
import type { Crossing, Issue, IssueType } from '../../domain/consolidation';
import { ISSUE_LABEL, SEVERITY_LABEL, crossingSourceLabel } from '../../domain/labels';
import { entryDisplayName } from '../../domain/eventModel';
import type { EventIndex } from '../../domain/eventModel';
import { planBibAssignment } from '../../domain/suggestLeg';
import { useEventContext } from '../events/EventContext';
import { CrossingEditor } from './CrossingEditor';

type Severity = Issue['severity'];
const SEVERITY_ORDER: Severity[] = ['error', 'warning', 'info'];
const SEVERITY_PLURAL: Record<Severity, string> = { error: 'Erros', warning: 'Avisos', info: 'Info' };
const SEVERITY_TONE: Record<Severity, BadgeTone> = { error: 'danger', warning: 'warning', info: 'info' };

/** Which leg an issue's suggested move points to, resolved through its entry's race. */
function suggestedLegLabel(issue: Issue, index: EventIndex): string {
  const entry = issue.entry_id ? index.entriesById.get(issue.entry_id) : undefined;
  const race = entry ? index.racesById.get(entry.race_id) : undefined;
  const leg = race && issue.suggested_leg_index !== undefined ? race.legs[issue.suggested_leg_index] : undefined;
  return leg?.label ?? '';
}

function crossingStatus(c: Crossing): { label: string; tone: BadgeTone } {
  if (c.official_ms === null) return { label: 'Sem passagem', tone: 'neutral' };
  if (c.chosen_mark_discarded) return { label: 'Escolha descartada', tone: 'danger' };
  if (c.divergent && !c.resolution) return { label: 'Divergência', tone: 'warning' };
  if (c.resolution) return { label: 'Resolvido', tone: 'info' };
  return { label: 'OK', tone: 'success' };
}

/** Editing target for the modal: which entry/leg crossing is open, or none. */
interface EditingTarget {
  entryId: string;
  legIndex: number;
}

export default function ReviewTab() {
  const { agg, index, timing, refresh } = useEventContext();
  const toast = useToast();
  const [raceFilter, setRaceFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState<'all' | IssueType>('all');
  const [expanded, setExpanded] = useState<Record<Severity, boolean>>({ error: true, warning: true, info: false });
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<EditingTarget | null>(null);

  const filteredIssues = useMemo(
    () =>
      timing.issues.filter(
        (i) => (raceFilter === 'all' || i.race_id === raceFilter) && (typeFilter === 'all' || i.type === typeFilter),
      ),
    [timing.issues, raceFilter, typeFilter],
  );
  const bySeverity = useMemo(() => {
    const map = new Map<Severity, Issue[]>();
    for (const sev of SEVERITY_ORDER) map.set(sev, []);
    for (const issue of filteredIssues) map.get(issue.severity)!.push(issue);
    return map;
  }, [filteredIssues]);

  const crossings = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows: EditingTarget[] = [];
    for (const entry of agg.entries) {
      const race = index.racesById.get(entry.race_id);
      if (!race) continue;
      if (term) {
        const name = entryDisplayName(entry, index).toLowerCase();
        if (!entry.bib.toLowerCase().includes(term) && !name.includes(term)) continue;
      }
      for (let k = 0; k < race.legs.length; k++) rows.push({ entryId: entry.id, legIndex: k });
    }
    return rows;
  }, [agg.entries, index, search]);

  async function moveSuggested(issue: Issue) {
    const markId = issue.mark_ids?.[0];
    if (!markId || issue.suggested_leg_index === undefined) return;
    try {
      await api.admin.updateMark(markId, { leg_index: issue.suggested_leg_index });
      await refresh();
    } catch (err) {
      toast.show({ message: err instanceof ApiError ? err.message : 'Erro inesperado', tone: 'danger' });
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="brand-title text-lg font-semibold">Pendências</h2>
          <div className="flex flex-wrap items-end gap-3">
            <Select
              label="Prova"
              value={raceFilter}
              onChange={(e) => setRaceFilter(e.target.value)}
              className="w-auto"
              options={[{ value: 'all', label: 'Todas as provas' }, ...agg.races.map((r) => ({ value: r.id, label: r.name }))]}
            />
            <Select
              label="Tipo"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as 'all' | IssueType)}
              className="w-auto"
              options={[
                { value: 'all', label: 'Todos os tipos' },
                ...(Object.entries(ISSUE_LABEL) as [IssueType, string][]).map(([value, label]) => ({ value, label })),
              ]}
            />
          </div>
        </div>

        {filteredIssues.length === 0 ? (
          <EmptyState title="Nenhuma pendência" />
        ) : (
          <div data-testid="issues-list" className="flex flex-col gap-3">
            {SEVERITY_ORDER.map((sev) => {
              const list = bySeverity.get(sev) ?? [];
              const isOpen = expanded[sev];
              return (
                <div key={sev} className="overflow-hidden rounded-xl border border-border">
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center justify-between px-4 py-2 text-left font-medium hover:bg-surface-2"
                    onClick={() => setExpanded((prev) => ({ ...prev, [sev]: !prev[sev] }))}
                  >
                    <span>
                      {SEVERITY_PLURAL[sev]} ({list.length})
                    </span>
                    <span aria-hidden="true">{isOpen ? '−' : '+'}</span>
                  </button>
                  {isOpen && list.length > 0 && (
                    <ul className="flex flex-col divide-y divide-border border-t border-border">
                      {list.map((issue, i) => (
                        <li key={i} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <Badge tone={SEVERITY_TONE[issue.severity]}>{SEVERITY_LABEL[issue.severity]}</Badge>{' '}
                            <span className="text-sm">{issue.message}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {issue.type === 'unassigned' && issue.mark_ids?.[0] && <UnassignedAssign markId={issue.mark_ids[0]} />}
                            {issue.entry_id !== undefined && issue.leg_index !== undefined && (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => setEditing({ entryId: issue.entry_id!, legIndex: issue.leg_index! })}
                              >
                                Resolver
                              </Button>
                            )}
                            {issue.type === 'divergence' && issue.suggested_leg_index !== undefined && issue.mark_ids?.[0] && (
                              <Button size="sm" data-testid="move-mark-suggested" onClick={() => void moveSuggested(issue)}>
                                Mover marcação para a perna {issue.suggested_leg_index + 1} ({suggestedLegLabel(issue, index)})
                              </Button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="brand-title text-lg font-semibold">Todas as passagens</h2>
          <Input label="Buscar" placeholder="Nº ou nome" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        </div>
        {crossings.length === 0 ? (
          <EmptyState title="Nenhuma passagem encontrada" />
        ) : (
          <ul className="flex flex-col gap-2">
            {crossings.map(({ entryId, legIndex }) => (
              <CrossingRow
                key={`${entryId}-${legIndex}`}
                entryId={entryId}
                legIndex={legIndex}
                onOpen={() => setEditing({ entryId, legIndex })}
              />
            ))}
          </ul>
        )}
      </section>

      {editing && <CrossingEditor entryId={editing.entryId} legIndex={editing.legIndex} onClose={() => setEditing(null)} />}
    </div>
  );
}

function CrossingRow({ entryId, legIndex, onOpen }: { entryId: string; legIndex: number; onOpen: () => void }) {
  const { agg, index, timing } = useEventContext();
  const entry = index.entriesById.get(entryId);
  const race = entry ? index.racesById.get(entry.race_id) : undefined;
  const legTiming = timing.byEntry.get(entryId)?.legs[legIndex];
  if (!entry || !race || !legTiming) return null;

  const leg = race.legs[legIndex];
  const c = legTiming.crossing;
  const status = crossingStatus(c);
  const source = crossingSourceLabel(c, index.timekeepersById, agg.marks);

  return (
    <li>
      <button
        type="button"
        data-testid="crossing-row"
        onClick={onOpen}
        className="flex w-full flex-col gap-1 rounded-xl border border-border bg-surface px-4 py-3 text-left hover:bg-surface-2 sm:flex-row sm:items-center sm:justify-between"
      >
        <span className="min-w-0 truncate">
          Nº {entry.bib} · {entryDisplayName(entry, index)} · Perna {legIndex + 1} ({leg.label})
        </span>
        <span className="flex flex-wrap items-center gap-3 text-sm tabular text-muted">
          <span>{c.official_ms !== null ? formatClock(c.official_ms, { tenths: true }) : '—'}</span>
          <span>{source || '—'}</span>
          <span>{c.candidates.length} marc.</span>
          <span>{c.spread_ms !== null ? `${(c.spread_ms / 1000).toFixed(1)} s` : '—'}</span>
          <Badge tone={status.tone}>{status.label}</Badge>
        </span>
      </button>
    </li>
  );
}

/** Inline "typed bib → suggested leg" assignment for an `unassigned` issue (Ruling 2: reuses
 * `planBibAssignment`, the same helper the timekeeper app and live board use). */
function UnassignedAssign({ markId }: { markId: string }) {
  const { agg, index, refresh } = useEventContext();
  const toast = useToast();
  const [bib, setBib] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const mark = agg.marks.find((m) => m.id === markId);
    if (!mark) return;
    const plan = planBibAssignment({
      entries: agg.entries,
      racesById: index.racesById,
      marks: agg.marks,
      markId: mark.id,
      tsMs: Date.parse(mark.ts),
      bibText: bib,
    });
    if ('error' in plan) {
      toast.show({ message: plan.error, tone: 'danger' });
      return;
    }
    setBusy(true);
    try {
      await api.admin.updateMark(mark.id, { entry_id: plan.entry.id, leg_index: plan.suggestion.leg_index });
      if (plan.warning) toast.show({ message: plan.warning, tone: 'warning' });
      await refresh();
      setBib('');
    } catch (err) {
      toast.show({ message: err instanceof ApiError ? err.message : 'Erro inesperado', tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="flex items-center gap-2">
      <input
        aria-label="Nº de peito"
        placeholder="Nº"
        value={bib}
        onChange={(e) => setBib(e.target.value)}
        className="min-h-11 w-20 rounded-xl border border-border bg-surface px-2 text-sm"
      />
      <Button type="submit" size="sm" variant="secondary" loading={busy}>
        Atribuir
      </Button>
    </form>
  );
}
