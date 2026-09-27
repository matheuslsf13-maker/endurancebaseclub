import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Badge, Button, Checkbox, EmptyState, Select } from '../../components/ui';
import { useConfirm } from '../../components/ui/Confirm';
import { useToast } from '../../components/ui/Toast';
import { computeEventTiming } from '../../domain/consolidation';
import { indexEvent } from '../../domain/eventModel';
import { classifyRace } from '../../domain/ranking';
import type { RaceClassification } from '../../domain/ranking';
import { buildFinalizeRows, classificationFromResults, snapshotDrift } from '../../domain/snapshot';
import { api, ApiError } from '../../lib/api';
import { formatDateTimeBR } from '../../lib/format';
import type { EntryRow } from '../../lib/types';
import { useEventContext } from '../events/EventContext';
import type { EventContextValue } from '../events/EventContext';
import { ClassificationTable } from './ClassificationTable';
import { exportWorkbook } from './exportWorkbook';
import { driftMessage, plural, withSnapshotNames } from './officialResults';
import { PodiumView } from './PodiumView';

/** The "Marcar N como DNF" option of the finalize confirm (spec §8: "ao finalizar, sugerir DNF"). */
function DnfOption({ count, onChange }: { count: number; onChange: (checked: boolean) => void }) {
  const [checked, setChecked] = useState(false);
  return (
    <Checkbox
      label={`Marcar ${count} como DNF`}
      checked={checked}
      onChange={e => {
        setChecked(e.currentTarget.checked);
        onChange(e.currentTarget.checked);
      }}
    />
  );
}

type Latest = Pick<EventContextValue, 'agg' | 'index' | 'timing' | 'classifications' | 'nowMs'>;

/** Ids of the race's entries still on course in `timing`. */
function onCourseIds(timing: Latest['timing'], raceId: string): string[] {
  return [...timing.byEntry.values()].filter(t => t.race_id === raceId && t.status === 'on_course').map(t => t.entry_id);
}

export default function ResultsTab() {
  const { agg, index, timing, classifications, nowMs, refresh, patchAgg } = useEventContext();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  // The finalize rows are built from the data current when the organizer confirms — marks keep
  // arriving while the dialog is open (B2-I2) — so the handler reads the latest render from here.
  const latest = useRef<Latest>({ agg, index, timing, classifications, nowMs });
  useLayoutEffect(() => {
    latest.current = { agg, index, timing, classifications, nowMs };
  });

  const races = useMemo(() => [...agg.races].sort((a, b) => a.position - b.position), [agg.races]);
  const [selectedRaceId, setSelectedRaceId] = useState<string>(() => races[0]?.id ?? '');
  const race = races.find(r => r.id === selectedRaceId) ?? races[0] ?? null;
  const cls = race ? classifications.get(race.id) : undefined;

  // A finalized race shows its official result — the snapshot the public page, the athletes'
  // statistics and the workbook use — and how far the live data has moved from it (B2-I2).
  const finalizedAt = race?.finalized_at ?? null;
  const official = useMemo(
    () => (race && finalizedAt ? classificationFromResults(race, agg.results, agg.event.levels) : null),
    [race, finalizedAt, agg.results, agg.event.levels],
  );
  const drift = useMemo(() => (official && cls ? snapshotDrift(cls, agg.results).length : 0), [official, cls, agg.results]);

  if (!race || !cls) {
    return <EmptyState title="Nenhuma prova cadastrada">Cadastre uma prova em Provas para ver os resultados aqui.</EmptyState>;
  }

  const shown: RaceClassification = official ?? cls;
  const shownAthletes = official ? withSnapshotNames(index.athletesById, official) : index.athletesById;

  const raceIssues = timing.issues.filter(i => i.race_id === race.id);
  const openIssues = raceIssues.filter(i => i.severity !== 'info');
  const errorCount = openIssues.filter(i => i.severity === 'error').length;
  const warningCount = openIssues.filter(i => i.severity === 'warning').length;

  function reportError(e: unknown) {
    toast.show({ message: e instanceof ApiError ? e.message : 'Não foi possível concluir a ação.', tone: 'danger' });
  }

  /** The race's classification over `entries` (the latest ones, some just set to DNF). */
  function classifyLatest(now: Latest, raceId: string, entries: EntryRow[]): RaceClassification | undefined {
    if (entries === now.agg.entries) return now.classifications.get(raceId);
    const aggNow = { ...now.agg, entries };
    const raceNow = aggNow.races.find(r => r.id === raceId);
    if (!raceNow) return undefined;
    const idx = indexEvent(aggNow);
    const timingNow = computeEventTiming(aggNow, now.nowMs);
    return classifyRace(raceNow, idx.entriesByRace.get(raceId) ?? [], timingNow.byEntry, idx.athletesById, aggNow.event);
  }

  async function handleFinalize() {
    if (!race) return;
    const raceId = race.id;
    const stillOnCourse = onCourseIds(timing, raceId);
    const choice = { markDnf: false };
    const ok = await confirm({
      title: `Finalizar "${race.name}"?`,
      message: (
        <div className="flex flex-col gap-2">
          <p>
            Pendências em Revisão: {plural(errorCount, 'erro', 'erros')} e {plural(warningCount, 'aviso', 'avisos')}.
          </p>
          {stillOnCourse.length > 0 && (
            <>
              <p>
                Ainda há {plural(stillOnCourse.length, 'inscrição', 'inscrições')} em prova — sem marcar DNF,{' '}
                {stillOnCourse.length === 1 ? 'ela fica' : 'elas ficam'} como “Em prova” no resultado oficial.
              </p>
              <DnfOption count={stillOnCourse.length} onChange={v => { choice.markDnf = v; }} />
            </>
          )}
          <p>
            Os resultados desta prova passam a ser oficiais (página pública e estatísticas dos atletas). Correções feitas
            depois só entram no resultado oficial se você reabrir e finalizar de novo.
          </p>
        </div>
      ),
      confirmLabel: 'Finalizar',
      danger: errorCount > 0,
    });
    if (!ok) return;
    setBusy(true);
    let entriesChanged = false;
    try {
      const now = latest.current;
      let entries = now.agg.entries;
      if (choice.markDnf) {
        // Only entries listed in the dialog that are still on course now (one may have finished).
        const current = new Set(onCourseIds(now.timing, raceId));
        const targets = entries.filter(e => stillOnCourse.includes(e.id) && current.has(e.id));
        for (const e of targets) {
          await api.admin.updateEntryStatus(e.id, 'dnf', e.penalty_ms, e.notes);
          entriesChanged = true;
        }
        if (targets.length > 0) {
          const dnf = new Set(targets.map(e => e.id));
          const setDnf = (list: EntryRow[]) => list.map(e => (dnf.has(e.id) ? { ...e, status: 'dnf' as const } : e));
          entries = setDnf(entries);
          patchAgg(a => ({ ...a, entries: setDnf(a.entries) }));
        }
      }
      const clsNow = classifyLatest(now, raceId, entries);
      if (!clsNow) throw new ApiError('Prova não encontrada');
      const rows = buildFinalizeRows(now.agg.event, clsNow, now.index.athletesById);
      await api.admin.finalizeRace(raceId, rows);
      toast.show({ message: 'Prova finalizada.', tone: 'success' });
      await refresh();
    } catch (e) {
      reportError(e);
      if (entriesChanged) void refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleUnfinalize() {
    if (!race) return;
    const ok = await confirm({
      title: `Reabrir "${race.name}"?`,
      message: 'Os resultados oficiais desta prova são removidos e ela volta a mostrar a classificação parcial (ao vivo).',
      confirmLabel: 'Reabrir',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.admin.unfinalizeRace(race.id);
      toast.show({ message: 'Prova reaberta.', tone: 'success' });
      await refresh();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  }

  function handleExport() {
    try {
      // Finalized races are built from their stored snapshot inside the workbook model.
      exportWorkbook(agg, timing, [...classifications.values()]);
    } catch {
      toast.show({ message: 'Não foi possível gerar a planilha.', tone: 'danger' });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Print-only header: guarantees the printed page shows the event title and race name even
          if the surrounding shell's own header is styled for screen use. */}
      <div className="hidden print:block">
        <h1 className="brand-title text-xl font-semibold">{agg.event.name}</h1>
        <h2 className="text-lg">{race.name}</h2>
      </div>

      <div className="no-print max-w-xs">
        <Select
          label="Prova"
          data-testid="race-select"
          value={race.id}
          onChange={e => setSelectedRaceId(e.target.value)}
          options={races.map(r => ({ value: r.id, label: r.name }))}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">{race.name}</h2>
          {race.finalized_at ? (
            <Badge tone="info">Oficial · finalizada em {formatDateTimeBR(Date.parse(race.finalized_at))}</Badge>
          ) : (
            <Badge tone="warning">Parcial (ao vivo)</Badge>
          )}
          {openIssues.length > 0 && (
            <Link
              to={`/eventos/${agg.event.id}/revisao`}
              className="no-print text-sm text-muted underline underline-offset-2 hover:text-fg"
            >
              {plural(openIssues.length, 'pendência', 'pendências')} — ver Revisão
            </Link>
          )}
        </div>

        <div className="no-print flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={handleExport} data-testid="export-xlsx">
            Exportar planilha
          </Button>
          <Button variant="secondary" size="sm" onClick={() => window.print()} data-testid="print">
            Imprimir
          </Button>
          {race.finalized_at ? (
            <Button variant="secondary" size="sm" loading={busy} onClick={() => void handleUnfinalize()} data-testid="unfinalize-race">
              Reabrir prova
            </Button>
          ) : (
            <Button size="sm" loading={busy} onClick={() => void handleFinalize()} data-testid="finalize-race">
              Finalizar prova
            </Button>
          )}
        </div>
      </div>

      {official && drift > 0 && (
        <p data-testid="drift-banner" role="status" className="no-print rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm font-medium">
          {driftMessage(drift)}
        </p>
      )}

      <ClassificationTable race={race} cls={shown} showLegs={race.legs.length > 1} linkAthletes="admin" athletesById={shownAthletes} />

      <PodiumView cls={shown} athletesById={shownAthletes} />
    </div>
  );
}
