import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, Input, Modal, Select, useToast } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import type { EntryRow } from '../../lib/types';
import { useEventContext } from '../events/EventContext';
import { foldAccents } from './entryForm';

export interface BulkEntryDialogProps {
  open: boolean;
  onClose(): void;
  onCreated(entries: EntryRow[]): void;
}

/** "Inscrever vários": pick one individual race and check off any number of athletes, creating
 * one entry per athlete in a single call. Team races have no meaningful "bulk entry" (each entry
 * still needs a per-leg assignment), so only `team_size === 1` races are offered. */
export function BulkEntryDialog({ open, onClose, onCreated }: BulkEntryDialogProps) {
  const { agg, refresh } = useEventContext();
  const toast = useToast();
  const individualRaces = agg.races.filter((r) => r.team_size === 1).slice().sort((a, b) => a.position - b.position);

  const [raceId, setRaceId] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const athletesQuery = useQuery({ queryKey: ['athletes'], queryFn: () => api.admin.listAthletes(), enabled: open });
  const athletes = athletesQuery.data ?? [];

  // Fresh every time the dialog opens, so a previous selection never bleeds into the next one.
  useEffect(() => {
    if (!open) return;
    setRaceId(individualRaces[0]?.id ?? '');
    setSearch('');
    setSelected(new Set());
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reset when the dialog opens
  }, [open]);

  const alreadyEntered = new Set(agg.entries.filter((e) => e.race_id === raceId).flatMap((e) => e.members.map((m) => m.athlete_id)));
  const term = foldAccents(search.trim());
  const candidates = athletes
    .filter((a) => !alreadyEntered.has(a.id))
    .filter((a) => !term || foldAccents(a.name).includes(term));

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleConfirm() {
    if (!raceId || selected.size === 0) return;
    setSaving(true);
    setError(null);
    try {
      const created = await api.admin.bulkCreateEntries(raceId, Array.from(selected));
      await refresh();
      toast.show({ message: `${created.length} inscrição(ões) criada(s).`, tone: 'success' });
      onCreated(created);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro inesperado');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Inscrever vários atletas"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            data-testid="bulk-confirm"
            loading={saving}
            disabled={!raceId || selected.size === 0}
            onClick={() => void handleConfirm()}
          >
            Inscrever {selected.size > 0 ? selected.size : ''}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {individualRaces.length === 0 ? (
          <EmptyState title="Nenhuma prova individual cadastrada">
            A inscrição em massa só está disponível para provas individuais.
          </EmptyState>
        ) : (
          <>
            <Select
              label="Prova"
              value={raceId}
              onChange={(e) => {
                setRaceId(e.target.value);
                setSelected(new Set());
              }}
              options={individualRaces.map((r) => ({ value: r.id, label: r.name }))}
            />
            <Input label="Buscar atleta" placeholder="Nome" value={search} onChange={(e) => setSearch(e.target.value)} />
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <div className="max-h-72 overflow-y-auto rounded-xl border border-border">
              {candidates.length === 0 ? (
                <p className="p-3 text-sm text-muted">Nenhum atleta disponível.</p>
              ) : (
                candidates.map((a) => (
                  <label key={a.id} className="flex min-h-11 cursor-pointer items-center gap-2 border-b border-border px-3 py-2 text-sm last:border-b-0 hover:bg-surface-2">
                    <input
                      type="checkbox"
                      style={{ accentColor: 'var(--accent)' }}
                      className="h-5 w-5 rounded border-border"
                      checked={selected.has(a.id)}
                      onChange={() => toggle(a.id)}
                    />
                    {a.name}
                  </label>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
