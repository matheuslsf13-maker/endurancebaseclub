import { useState } from 'react';
import type { FormEvent } from 'react';
import { Button, Card, Table } from '../../components/ui';
import { useConfirm } from '../../components/ui/Confirm';
import { useToast } from '../../components/ui/Toast';
import { formatClock, parseClockInput } from '../../lib/format';
import { api } from '../../lib/api';
import { useEventContext } from '../events/EventContext';
import type { WaveRow } from '../../lib/types';
import { errorMessage } from './timingHelpers';

interface WaveRowItemProps {
  raceName: string;
  wave: WaveRow;
}

/**
 * One race/wave (spec §7.6). "Largar agora" stamps the synced instant of the confirm tap
 * (Review Focus 5 + a controller ruling): the handler awaits the confirmation first, then reads
 * `clock.now()` as the very first thing afterwards — before any further `await` — so the recorded
 * start is the moment the organizer actually confirmed, not the moment the dialog opened.
 */
function WaveRowItem({ raceName, wave }: WaveRowItemProps) {
  const { agg, patchAgg, refresh, clock } = useEventContext();
  const confirm = useConfirm();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function applyStart(startAt: string | null) {
    setBusy(true);
    try {
      const updated = await api.admin.setWaveStart(wave.id, startAt);
      // Immediate feedback locally; `refresh()` then recomputes every entry's timing against the
      // canonical aggregate — required whether this is the first start or a correction made after
      // marks already exist (Review Focus 5: "esqueceram de apertar Largar").
      patchAgg((a) => ({ ...a, waves: a.waves.map((w) => (w.id === updated.id ? updated : w)) }));
      await refresh();
    } catch (e) {
      toast.show({ message: errorMessage(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function handleLargarAgora() {
    const ok = await confirm({
      title: `Largar ${raceName} – ${wave.name} agora?`,
      confirmLabel: 'Largar agora',
    });
    if (!ok) return;
    const nowMs = clock.now();
    await applyStart(new Date(nowMs).toISOString());
  }

  function handleSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem('time') as HTMLInputElement;
    const text = input.value.trim();
    if (!text) return;
    const ms = parseClockInput(text, agg.event.date);
    if (ms === null) {
      setError('Horário inválido — use hh:mm:ss');
      return;
    }
    setError(null);
    void applyStart(new Date(ms).toISOString());
  }

  async function handleClear() {
    const ok = await confirm({
      title: `Limpar a largada de ${raceName} – ${wave.name}?`,
      message: 'A onda volta a mostrar "Não largou".',
      confirmLabel: 'Limpar',
      danger: true,
    });
    if (!ok) return;
    await applyStart(null);
  }

  const started = wave.start_at !== null;
  const status = started ? formatClock(Date.parse(wave.start_at as string), { tenths: true }) : 'Não largou';

  return (
    <tr className="border-t border-border">
      <td className="px-3 py-2">{raceName}</td>
      <td className="px-3 py-2">{wave.name}</td>
      <td className="tabular px-3 py-2">{status}</td>
      <td className="px-3 py-2">
        <Button data-testid="wave-start" size="sm" loading={busy} onClick={() => void handleLargarAgora()}>
          Largar agora
        </Button>
      </td>
      <td className="px-3 py-2">
        <form
          // Remounts (and so resets the uncontrolled input) whenever the wave's own start time
          // changes, but not while the organizer is mid-edit of an unsaved value.
          key={`${wave.id}-${wave.start_at ?? ''}`}
          onSubmit={handleSave}
          className="flex flex-wrap items-center gap-2"
        >
          <label className="sr-only" htmlFor={`wave-time-${wave.id}`}>
            Horário de largada — {raceName} {wave.name}
          </label>
          <input
            id={`wave-time-${wave.id}`}
            name="time"
            data-testid="wave-time-input"
            defaultValue={started ? status : ''}
            placeholder="hh:mm:ss.d"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `wave-time-error-${wave.id}` : undefined}
            className="min-h-11 w-32 rounded-xl border border-border bg-surface px-3 py-2 text-fg tabular placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          />
          <Button type="submit" variant="secondary" size="sm" data-testid="wave-time-save" loading={busy}>
            Salvar
          </Button>
        </form>
        {error && (
          <p id={`wave-time-error-${wave.id}`} role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </td>
      <td className="px-3 py-2">
        <Button variant="ghost" size="sm" disabled={!started || busy} onClick={() => void handleClear()}>
          Limpar
        </Button>
      </td>
    </tr>
  );
}

export function WavesPanel() {
  const { agg, index } = useEventContext();
  const races = [...agg.races].sort((a, b) => a.position - b.position);

  return (
    <Card>
      <h2 className="brand-title mb-4 text-lg font-semibold">Largadas</h2>
      <Table>
        <thead>
          <tr>
            <th className="px-3 py-2">Prova</th>
            <th className="px-3 py-2">Onda</th>
            <th className="px-3 py-2">Horário</th>
            <th className="px-3 py-2">Largar agora</th>
            <th className="px-3 py-2">Corrigir horário</th>
            <th className="px-3 py-2">Limpar</th>
          </tr>
        </thead>
        <tbody>
          {races.flatMap((race) =>
            (index.wavesByRace.get(race.id) ?? []).map((wave) => (
              <WaveRowItem key={wave.id} raceName={race.name} wave={wave} />
            )),
          )}
        </tbody>
      </Table>
    </Card>
  );
}
