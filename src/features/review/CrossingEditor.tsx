import { useMemo, useState } from 'react';
import { Badge, Button, Input, Modal, Select, Table, useToast } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { formatClock, formatDuration, parseClockInput } from '../../lib/format';
import { computeEntryTiming } from '../../domain/consolidation';
import type { ResolutionMode, ResolutionRow, MarkRow } from '../../lib/types';
import { entryDisplayName, entryWave, legAthleteId } from '../../domain/eventModel';
import { planBibAssignment } from '../../domain/suggestLeg';
import { useEventContext } from '../events/EventContext';

export interface CrossingEditorProps {
  entryId: string;
  legIndex: number;
  onClose: () => void;
}

/** Modal to review one entry's leg crossing (spec §8): the candidate marks (with per-mark
 * discard/restore and move actions), a decision (system time / a specific mark / a manual time)
 * and a live preview of the resulting leg time and total — recomputed with `computeEntryTiming`,
 * never with ad-hoc arithmetic. */
export function CrossingEditor({ entryId, legIndex, onClose }: CrossingEditorProps) {
  const { agg, index, timing, refresh } = useEventContext();
  const toast = useToast();

  const entry = index.entriesById.get(entryId);
  const race = entry ? index.racesById.get(entry.race_id) : undefined;
  const legTiming = timing.byEntry.get(entryId)?.legs[legIndex];
  const crossing = legTiming?.crossing ?? null;
  const resolution = crossing?.resolution ?? null;
  // A stored `mark` resolution can point at a mark that computeCrossing no longer lists among
  // `candidates` (it was discarded since, or lost to a duplicate) — `crossing.chosen_mark_discarded`
  // is the domain's own signal for exactly that "official time already fell back to the system
  // time" case. Seeding the form from that stale resolution would leave no radio checked and
  // silently resend the same broken decision, so start from `system` instead — the value the
  // official time already shows — and say so.
  const markMissing = resolution?.mode === 'mark' && !!crossing && !crossing.candidates.some((c) => c.mark_id === resolution.mark_id);

  const [mode, setMode] = useState<ResolutionMode>(markMissing ? 'system' : (resolution?.mode ?? 'system'));
  const [markId, setMarkId] = useState<string | null>(!markMissing && resolution?.mode === 'mark' ? resolution.mark_id : null);
  const [manualText, setManualText] = useState(() =>
    resolution?.mode === 'manual' && resolution.manual_ts ? formatClock(Date.parse(resolution.manual_ts), { millis: true }) : '',
  );
  const [manualError, setManualError] = useState<string | null>(null);
  const [note, setNote] = useState(resolution?.note ?? '');
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [busyMarkId, setBusyMarkId] = useState<string | null>(null);
  const [moveBib, setMoveBib] = useState<Record<string, string>>({});
  const [moveLeg, setMoveLeg] = useState<Record<string, number>>({});

  const legMarks = useMemo(
    () =>
      agg.marks
        .filter((m) => m.entry_id === entryId && m.leg_index === legIndex)
        .slice()
        .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts)),
    [agg.marks, entryId, legIndex],
  );

  const preview = useMemo(() => {
    if (!entry || !race) return null;
    const wave = entryWave(entry, index);
    const entryMarks = agg.marks.filter((m) => m.entry_id === entryId);
    let manualTs: string | null = null;
    if (mode === 'manual') {
      const ms = parseClockInput(manualText, agg.event.date);
      manualTs = ms !== null ? new Date(ms).toISOString() : null;
    }
    const hypothetical: ResolutionRow = {
      entry_id: entryId,
      leg_index: legIndex,
      event_id: agg.event.id,
      mode,
      mark_id: mode === 'mark' ? markId : null,
      manual_ts: manualTs,
      note,
      updated_at: new Date().toISOString(),
    };
    const otherResolutions = agg.resolutions.filter((r) => !(r.entry_id === entryId && r.leg_index === legIndex));
    return computeEntryTiming(entry, race, wave, entryMarks, [...otherResolutions, hypothetical]);
  }, [entry, race, index, agg.marks, agg.resolutions, agg.event, entryId, legIndex, mode, markId, manualText, note]);

  function authorOf(timekeeperId: string | null): string {
    return timekeeperId === null ? 'Organização' : (index.timekeepersById.get(timekeeperId)?.name ?? 'Cronometrista');
  }

  async function toggleDiscard(mark: MarkRow) {
    setBusyMarkId(mark.id);
    try {
      await api.admin.updateMark(mark.id, { discarded: !mark.discarded });
      await refresh();
    } catch (err) {
      toast.show({ message: err instanceof ApiError ? err.message : 'Erro inesperado', tone: 'danger' });
    } finally {
      setBusyMarkId(null);
    }
  }

  async function moveMark(mark: MarkRow) {
    const bib = (moveBib[mark.id] ?? '').trim();
    setBusyMarkId(mark.id);
    try {
      if (bib) {
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
        await api.admin.updateMark(mark.id, { entry_id: plan.entry.id, leg_index: plan.suggestion.leg_index });
        if (plan.warning) toast.show({ message: plan.warning, tone: 'warning' });
      } else {
        const target = moveLeg[mark.id] ?? legIndex;
        if (target === legIndex) return;
        await api.admin.updateMark(mark.id, { leg_index: target });
      }
      await refresh();
    } catch (err) {
      toast.show({ message: err instanceof ApiError ? err.message : 'Erro inesperado', tone: 'danger' });
    } finally {
      setBusyMarkId(null);
    }
  }

  async function save() {
    setManualError(null);
    let manualTs: string | null = null;
    if (mode === 'manual') {
      const ms = parseClockInput(manualText, agg.event.date);
      if (ms === null) {
        setManualError('Hora inválida (hh:mm:ss)');
        return;
      }
      manualTs = new Date(ms).toISOString();
    }
    setSaving(true);
    try {
      await api.admin.setResolution(entryId, legIndex, mode, mode === 'mark' ? markId : null, manualTs, note);
      await refresh();
      onClose();
    } catch (err) {
      toast.show({ message: err instanceof ApiError ? err.message : 'Erro inesperado', tone: 'danger' });
    } finally {
      setSaving(false);
    }
  }

  async function clearDecision() {
    setClearing(true);
    try {
      await api.admin.clearResolution(entryId, legIndex);
      await refresh();
      onClose();
    } catch (err) {
      toast.show({ message: err instanceof ApiError ? err.message : 'Erro inesperado', tone: 'danger' });
    } finally {
      setClearing(false);
    }
  }

  if (!entry || !race || !crossing) {
    return (
      <Modal open onClose={onClose} title="Passagem">
        <p className="text-sm text-muted">Passagem não encontrada.</p>
      </Modal>
    );
  }

  const leg = race.legs[legIndex];
  const athleteId = legAthleteId(entry, legIndex);
  const athleteName = athleteId ? index.athletesById.get(athleteId)?.name : undefined;
  const systemLabel = crossing.system_source === 'reference' ? 'Tempo do sistema (cronometrista de referência)' : 'Tempo do sistema (mediana)';
  const systemTime = crossing.system_ms !== null ? formatClock(crossing.system_ms, { millis: true }) : '—';

  return (
    <Modal
      open
      onClose={onClose}
      title={`Nº ${entry.bib} · Perna ${legIndex + 1} (${leg.label})`}
      size="lg"
      footer={
        <>
          {resolution && (
            <Button variant="secondary" onClick={() => void clearDecision()} loading={clearing}>
              Remover decisão
            </Button>
          )}
          <Button onClick={() => void save()} loading={saving} data-testid="resolution-save">
            Salvar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          {entryDisplayName(entry, index)}
          {athleteName ? ` · ${athleteName}` : ''}
        </p>

        <Table>
          <thead>
            <tr className="text-muted">
              <th className="py-1 pr-2">Cronometrista</th>
              <th className="py-1 pr-2">Hora</th>
              <th className="py-1 pr-2">Δ mediana</th>
              <th className="py-1 pr-2">Situação</th>
              <th className="py-1 pr-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {legMarks.map((m) => {
              const ts = Date.parse(m.ts);
              const delta = crossing.median_ms !== null ? (ts - crossing.median_ms) / 1000 : null;
              const isDuplicate = crossing.duplicates.includes(m.id);
              return (
                <tr key={m.id} className="border-t border-border align-top">
                  <td className="py-2 pr-2 whitespace-nowrap">{authorOf(m.timekeeper_id)}</td>
                  <td className="py-2 pr-2 whitespace-nowrap tabular">{formatClock(ts, { millis: true })}</td>
                  <td className="py-2 pr-2 whitespace-nowrap tabular">
                    {delta !== null ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} s` : '—'}
                  </td>
                  <td className="py-2 pr-2">
                    <div className="flex flex-wrap gap-1">
                      {isDuplicate && <Badge tone="info">Duplicada</Badge>}
                      {m.discarded && <Badge tone="danger">Descartada</Badge>}
                    </div>
                  </td>
                  <td className="py-2 pr-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="secondary" loading={busyMarkId === m.id} onClick={() => void toggleDiscard(m)}>
                        {m.discarded ? 'Restaurar' : 'Descartar'}
                      </Button>
                      <Select
                        label="Mover para"
                        className="w-auto"
                        value={String(moveLeg[m.id] ?? legIndex)}
                        onChange={(e) => setMoveLeg((s) => ({ ...s, [m.id]: Number(e.target.value) }))}
                        options={race.legs.map((l, i) => ({ value: String(i), label: `Perna ${i + 1} (${l.label})` }))}
                      />
                      <Input
                        label="Nº (opcional)"
                        className="w-20"
                        value={moveBib[m.id] ?? ''}
                        onChange={(e) => setMoveBib((s) => ({ ...s, [m.id]: e.target.value }))}
                      />
                      <Button size="sm" variant="secondary" loading={busyMarkId === m.id} onClick={() => void moveMark(m)}>
                        Mover
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>

        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-medium">Decisão</legend>
          {markMissing && (
            <p className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
              A marcação escolhida foi descartada — escolha outra decisão.
            </p>
          )}
          <label className="flex min-h-11 items-center gap-2">
            <input type="radio" name="resolution" data-testid="resolution-system" checked={mode === 'system'} onChange={() => setMode('system')} />
            <span>
              {systemLabel}: {systemTime}
            </span>
          </label>
          {crossing.candidates.map((c) => (
            <label key={c.mark_id} className="flex min-h-11 items-center gap-2">
              <input
                type="radio"
                name="resolution"
                data-testid={`resolution-mark-${c.mark_id}`}
                checked={mode === 'mark' && markId === c.mark_id}
                onChange={() => {
                  setMode('mark');
                  setMarkId(c.mark_id);
                }}
              />
              <span>
                {authorOf(c.timekeeper_id)}: {formatClock(c.ts_ms, { millis: true })}
              </span>
            </label>
          ))}
          <label className="flex min-h-11 items-center gap-2">
            <input type="radio" name="resolution" data-testid="resolution-manual" checked={mode === 'manual'} onChange={() => setMode('manual')} />
            <span>Manual:</span>
            <input
              type="text"
              placeholder="hh:mm:ss.d"
              value={manualText}
              onChange={(e) => {
                setManualText(e.target.value);
                setMode('manual');
              }}
              data-testid="resolution-manual-input"
              aria-label="Hora manual"
              className="min-h-11 w-32 rounded-xl border border-border bg-surface px-2"
            />
          </label>
          {manualError && (
            <p role="alert" className="text-sm text-danger">
              {manualError}
            </p>
          )}
          <Input label="Observação" value={note} onChange={(e) => setNote(e.target.value)} />
        </fieldset>

        {preview && (
          <div className="rounded-xl border border-border bg-surface-2 p-3 text-sm tabular">
            <p>Tempo da perna: {formatDuration(preview.legs[legIndex]?.leg_ms ?? null)}</p>
            <p>Total: {formatDuration(preview.total_ms)}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
