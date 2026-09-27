import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Badge, Button, Card, EmptyState, Input, Modal, Select, Table, Textarea, useConfirm, useToast } from '../../components/ui';
import { entryCategory, groupLabel } from '../../domain/categories';
import { entryDisplayName, entryWave, legAthleteId } from '../../domain/eventModel';
import type { EventIndex } from '../../domain/eventModel';
import { ENTRY_STATUS_LABEL } from '../../domain/labels';
import { api, ApiError } from '../../lib/api';
import { formatDuration } from '../../lib/format';
import type { AthleteRow, EntryRow, EntryStatus, RaceRow } from '../../lib/types';
import { useEventContext } from '../events/EventContext';
import { BulkEntryDialog } from './BulkEntryDialog';
import { EntryForm } from './EntryForm';
import { ENTRY_STATUS_OPTIONS, foldAccents, parsePenaltyMs } from './entryFormState';

type EditModalState = 'new' | EntryRow | null;

const STATUS_BADGE_TONE: Record<EntryStatus, 'neutral' | 'warning' | 'danger'> = {
  ok: 'neutral',
  dns: 'warning',
  dnf: 'warning',
  dsq: 'danger',
};

/** "Ana – Natação · Beto – Corrida": one `<atleta> – <perna>` pair per leg, in leg order. */
function legsSummary(entry: EntryRow, race: RaceRow, athletesById: Map<string, AthleteRow>): string {
  return race.legs
    .map((leg, k) => {
      const athleteId = legAthleteId(entry, k);
      const name = (athleteId && athletesById.get(athleteId)?.name) || '—';
      return `${name} – ${leg.label}`;
    })
    .join(' · ');
}

interface EntryStatusModalProps {
  entry: EntryRow;
  onClose(): void;
  onSaved(): void;
}

/** Status/penalidade modal — seeded once from the `entry` EntriesTab captured when the row action
 * was clicked (Ruling 40): a background refresh of `agg` while this is open never overwrites what
 * the organizer is choosing/typing here. */
function EntryStatusModal({ entry, onClose, onSaved }: EntryStatusModalProps) {
  const { refresh } = useEventContext();
  const [status, setStatus] = useState<EntryStatus>(entry.status);
  const [penaltyText, setPenaltyText] = useState(formatDuration(entry.penalty_ms));
  const [notes, setNotes] = useState(entry.notes);
  const [penaltyError, setPenaltyError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const penaltyMs = parsePenaltyMs(penaltyText);
    if (penaltyMs === null) {
      setPenaltyError('Penalidade inválida — use m:ss (ex.: 1:30)');
      return;
    }
    setPenaltyError(undefined);
    setFormError(null);
    setSaving(true);
    try {
      await api.admin.updateEntryStatus(entry.id, status, penaltyMs, notes.trim());
      await refresh();
      onSaved();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Erro inesperado');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Status e penalidade"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button data-testid="entry-status-save" loading={saving} onClick={() => void handleSave()}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {formError && (
          <p role="alert" className="text-sm text-danger">
            {formError}
          </p>
        )}
        <Select
          label="Status"
          data-testid="entry-status-select"
          options={ENTRY_STATUS_OPTIONS.map((s) => ({ value: s, label: ENTRY_STATUS_LABEL[s] }))}
          value={status}
          onChange={(e) => setStatus(e.target.value as EntryStatus)}
        />
        <Input
          label="Penalidade (m:ss)"
          hint="Ex.: 1:30 para um minuto e trinta segundos"
          data-testid="entry-penalty-input"
          value={penaltyText}
          onChange={(e) => setPenaltyText(e.target.value)}
          error={penaltyError}
        />
        <Textarea label="Observações" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </Modal>
  );
}

function entrySearchHaystack(entry: EntryRow, index: EventIndex): string {
  const memberNames = entry.members.map((m) => index.athletesById.get(m.athlete_id)?.name ?? '').join(' ');
  return foldAccents(`${entryDisplayName(entry, index)} ${entry.bib} ${memberNames}`);
}

/** Aba Inscrições: lista/filtra as inscrições do evento e abre o `EntryForm` (nova/editar), o
 * modal de status/penalidade e o `BulkEntryDialog` (inscrição em massa, provas individuais). */
export default function EntriesTab() {
  const { agg, index, refresh } = useEventContext();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();

  const [raceFilter, setRaceFilter] = useState('');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<EditModalState>(null);
  const [statusModal, setStatusModal] = useState<EntryRow | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  const races = agg.races.slice().sort((a, b) => a.position - b.position);

  const filtered = useMemo(() => {
    const term = foldAccents(search.trim());
    return agg.entries
      .filter((e) => {
        if (raceFilter && e.race_id !== raceFilter) return false;
        if (!term) return true;
        return entrySearchHaystack(e, index).includes(term);
      })
      .sort((a, b) => a.bib.localeCompare(b.bib, undefined, { numeric: true }));
  }, [agg.entries, index, raceFilter, search]);

  async function handleDelete(entry: EntryRow) {
    const ok = await confirm({
      title: 'Excluir inscrição',
      message: `Excluir a inscrição Nº ${entry.bib}? Essa ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.admin.deleteEntry(entry.id);
      await refresh();
      toast.show({ message: 'Inscrição excluída.', tone: 'success' });
    } catch (err) {
      toast.show({ message: err instanceof ApiError ? err.message : 'Erro inesperado', tone: 'danger' });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="brand-title text-lg font-semibold">Inscrições</h1>
        {races.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" data-testid="bulk-entries" onClick={() => setBulkOpen(true)}>
              Inscrever vários
            </Button>
            <Button data-testid="new-entry" onClick={() => setModal('new')}>
              Nova inscrição
            </Button>
          </div>
        )}
      </div>

      {races.length === 0 ? (
        <EmptyState title="Cadastre uma prova antes de inscrever atletas" />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_2fr]">
            <Select
              label="Prova"
              value={raceFilter}
              onChange={(e) => setRaceFilter(e.target.value)}
              options={[{ value: '', label: 'Todas' }, ...races.map((r) => ({ value: r.id, label: r.name }))]}
            />
            <Input label="Buscar" placeholder="Nome, equipe ou número" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          {/* Ruling 51: a real Button (not a plain text link) navigating to /atletas asking it
              to open ImportDialog on arrival (`?import=1`, read by AthletesPage) — a click used
              to land on the athletes page without the dialog open, needing a second click. */}
          <Card className="flex flex-col items-start gap-3 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
            <p>
              Prefere importar de uma planilha? — a coluna Prova inscreve automaticamente em provas individuais.
            </p>
            <Button variant="secondary" onClick={() => navigate('/atletas?import=1')}>
              Importar atletas
            </Button>
          </Card>

          {filtered.length === 0 ? (
            <EmptyState title="Nenhuma inscrição encontrada" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th className="px-3 py-2" scope="col">Nº</th>
                  <th className="px-3 py-2" scope="col">Prova</th>
                  <th className="px-3 py-2" scope="col">Equipe/Atleta</th>
                  <th className="px-3 py-2" scope="col">Pernas</th>
                  <th className="px-3 py-2" scope="col">Categoria</th>
                  <th className="px-3 py-2" scope="col">Onda</th>
                  <th className="px-3 py-2" scope="col">Status</th>
                  <th className="px-3 py-2" scope="col">Penalidade</th>
                  <th className="px-3 py-2" scope="col" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => {
                  const race = index.racesById.get(entry.race_id);
                  if (!race) return null;
                  const wave = entryWave(entry, index);
                  const category = entryCategory(entry, index.athletesById, race, agg.event);
                  return (
                    <tr key={entry.id} className="border-t border-border align-top">
                      <td className="px-3 py-2 tabular">{entry.bib}</td>
                      <td className="px-3 py-2">{race.name}</td>
                      <td className="px-3 py-2">{entryDisplayName(entry, index)}</td>
                      <td className="px-3 py-2">{legsSummary(entry, race, index.athletesById)}</td>
                      <td className="px-3 py-2">{groupLabel(['sex', 'age', 'level'], category)}</td>
                      <td className="px-3 py-2">{wave?.name ?? '—'}</td>
                      <td className="px-3 py-2">
                        <Badge tone={STATUS_BADGE_TONE[entry.status]}>{ENTRY_STATUS_LABEL[entry.status]}</Badge>
                      </td>
                      <td className="px-3 py-2 tabular">{entry.penalty_ms > 0 ? formatDuration(entry.penalty_ms) : '—'}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button variant="ghost" size="sm" onClick={() => setModal(entry)}>
                            Editar
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setStatusModal(entry)}>
                            Status/penalidade
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => void handleDelete(entry)}>
                            Excluir
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </>
      )}

      <Modal open={modal !== null} onClose={() => setModal(null)} title={modal === 'new' ? 'Nova inscrição' : 'Editar inscrição'} size="xl">
        {modal !== null && (
          <EntryForm
            initial={modal === 'new' ? undefined : modal}
            defaultRaceId={raceFilter || undefined}
            onSaved={() => setModal(null)}
            onCancel={() => setModal(null)}
          />
        )}
      </Modal>

      {statusModal && <EntryStatusModal entry={statusModal} onClose={() => setStatusModal(null)} onSaved={() => setStatusModal(null)} />}

      <BulkEntryDialog open={bulkOpen} onClose={() => setBulkOpen(false)} onCreated={() => setBulkOpen(false)} />
    </div>
  );
}
