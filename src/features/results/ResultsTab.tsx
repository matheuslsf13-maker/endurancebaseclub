import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Badge, Button, EmptyState, Select } from '../../components/ui';
import { useConfirm } from '../../components/ui/Confirm';
import { useToast } from '../../components/ui/Toast';
import { buildFinalizeRows } from '../../domain/snapshot';
import { api, ApiError } from '../../lib/api';
import { formatDateTimeBR } from '../../lib/format';
import { useEventContext } from '../events/EventContext';
import { ClassificationTable } from './ClassificationTable';
import { exportWorkbook } from './exportWorkbook';
import { PodiumView } from './PodiumView';

export default function ResultsTab() {
  const { agg, index, timing, classifications, refresh } = useEventContext();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  const races = useMemo(() => [...agg.races].sort((a, b) => a.position - b.position), [agg.races]);
  const [selectedRaceId, setSelectedRaceId] = useState<string>(() => races[0]?.id ?? '');
  const race = races.find(r => r.id === selectedRaceId) ?? races[0] ?? null;
  const cls = race ? classifications.get(race.id) : undefined;

  if (!race || !cls) {
    return <EmptyState title="Nenhuma prova cadastrada">Cadastre uma prova em Provas para ver os resultados aqui.</EmptyState>;
  }

  const raceIssues = timing.issues.filter(i => i.race_id === race.id);
  const openIssues = raceIssues.filter(i => i.severity !== 'info');
  const errorCount = openIssues.filter(i => i.severity === 'error').length;
  const warningCount = openIssues.filter(i => i.severity === 'warning').length;
  const onCourseCount = [...timing.byEntry.values()].filter(t => t.race_id === race.id && t.status === 'on_course').length;

  function reportError(e: unknown) {
    toast.show({ message: e instanceof ApiError ? e.message : 'Não foi possível concluir a ação.', tone: 'danger' });
  }

  async function handleFinalize() {
    if (!race || !cls) return;
    const ok = await confirm({
      title: `Finalizar "${race.name}"?`,
      message: (
        <div className="flex flex-col gap-2">
          <p>
            {errorCount} erro(s) e {warningCount} aviso(s) pendentes em Revisão.
          </p>
          {onCourseCount > 0 && (
            <p>
              Ainda há {onCourseCount} atleta(s) em prova — eles ficarão como Em prova/DNF conforme o status atual ao
              finalizar.
            </p>
          )}
          <p>Os resultados desta prova passam a ser oficiais e a planilha/pódios não mudam mais sozinhos.</p>
        </div>
      ),
      confirmLabel: 'Finalizar',
      danger: errorCount > 0,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const rows = buildFinalizeRows(agg.event, cls, index.athletesById);
      await api.admin.finalizeRace(race.id, rows);
      toast.show({ message: 'Prova finalizada.', tone: 'success' });
      await refresh();
    } catch (e) {
      reportError(e);
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
              {openIssues.length} pendência(s) — ver Revisão
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

      <ClassificationTable race={race} cls={cls} showLegs={race.legs.length > 1} linkAthletes="admin" athletesById={index.athletesById} />

      <PodiumView cls={cls} athletesById={index.athletesById} />
    </div>
  );
}
