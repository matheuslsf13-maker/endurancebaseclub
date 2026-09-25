import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, EmptyState, Input, Modal, Spinner, useConfirm, useToast } from '../../components/ui';
import type { BadgeTone } from '../../components/ui';
import { api } from '../../lib/api';
import { formatDateBR } from '../../lib/format';
import type { EventStatus, EventSummary } from '../../lib/types';

const STATUS: Record<EventStatus, { label: string; tone: BadgeTone }> = {
  planejado: { label: 'Planejado', tone: 'neutral' },
  ao_vivo: { label: 'Ao vivo', tone: 'success' },
  encerrado: { label: 'Encerrado', tone: 'info' },
};

/** Comma-separated free text ("Elite, Base, Elite") into a trimmed, order-preserving unique list. */
export function parseLevels(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(',')) {
    const v = raw.trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export default function EventsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { data: events, isLoading, error } = useQuery({
    queryKey: ['events'],
    queryFn: () => api.admin.listEvents(),
  });

  const sorted = useMemo(
    () => [...(events ?? [])].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    [events],
  );

  const [showCreate, setShowCreate] = useState(false);
  const [duplicateOf, setDuplicateOf] = useState<EventSummary | null>(null);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['events'] });
  }

  async function handleDelete(ev: EventSummary) {
    const ok = await confirm({
      title: `Excluir "${ev.name}"?`,
      message: 'Provas, inscrições e marcações desse evento serão apagadas. Essa ação não pode ser desfeita.',
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.admin.deleteEvent(ev.id);
      await refresh();
      toast.show({ message: 'Evento excluído', tone: 'success' });
    } catch (err) {
      toast.show({ message: errorMessage(err, 'Não foi possível excluir o evento'), tone: 'danger' });
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="brand-title text-xl font-semibold">Eventos</h1>
        <Button data-testid="new-event" onClick={() => setShowCreate(true)}>
          Novo evento
        </Button>
      </div>

      <div className="mt-6">
        {isLoading && (
          <div className="flex justify-center py-16">
            <Spinner size={32} />
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(error, 'Não foi possível carregar os eventos')}
          </p>
        )}
        {!isLoading && !error && sorted.length === 0 && (
          <EmptyState title="Nenhum evento ainda">Crie o primeiro evento para começar a cronometrar.</EmptyState>
        )}
        {!isLoading && sorted.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sorted.map((ev) => (
              <EventCard
                key={ev.id}
                event={ev}
                onDuplicate={() => setDuplicateOf(ev)}
                onDelete={() => void handleDelete(ev)}
              />
            ))}
          </div>
        )}
      </div>

      <CreateEventModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(id) => {
          setShowCreate(false);
          void refresh();
          navigate(`/eventos/${id}/provas`);
        }}
      />

      {duplicateOf && (
        <DuplicateEventModal
          event={duplicateOf}
          onClose={() => setDuplicateOf(null)}
          onDuplicated={(id) => {
            setDuplicateOf(null);
            void refresh();
            navigate(`/eventos/${id}`);
          }}
        />
      )}
    </div>
  );
}

function EventCard({
  event,
  onDuplicate,
  onDelete,
}: {
  event: EventSummary;
  onDuplicate(): void;
  onDelete(): void;
}) {
  const status = STATUS[event.status];
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <Link
          to={`/eventos/${event.id}`}
          className="font-semibold break-words hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {event.name}
        </Link>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <p className="text-sm text-muted tabular">
        {formatDateBR(event.date)}
        {event.location ? ` · ${event.location}` : ''}
      </p>
      <p className="text-sm text-muted tabular">
        {event.races_count} {event.races_count === 1 ? 'prova' : 'provas'} · {event.entries_count}{' '}
        {event.entries_count === 1 ? 'inscrição' : 'inscrições'}
      </p>
      <div className="mt-auto flex flex-wrap gap-2 pt-2">
        <Button size="sm" variant="secondary" onClick={onDuplicate}>
          Duplicar
        </Button>
        <Button size="sm" variant="danger" onClick={onDelete}>
          Excluir
        </Button>
      </div>
    </Card>
  );
}

function CreateEventModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose(): void;
  onCreated(id: string): void;
}) {
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [location, setLocation] = useState('');
  const [levels, setLevels] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName('');
    setDate('');
    setLocation('');
    setLevels('');
    setError(null);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api.admin.saveEvent({
        name: name.trim(),
        date,
        location: location.trim(),
        levels: parseLevels(levels),
      });
      reset();
      onCreated(created.id);
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível criar o evento'));
      setBusy(false);
    }
  }

  function handleClose() {
    reset();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Novo evento"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" form="create-event-form" loading={busy} data-testid="event-create-submit">
            Criar evento
          </Button>
        </>
      }
    >
      <form id="create-event-form" className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <Input
          label="Nome do evento"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="event-name"
        />
        <Input
          label="Data"
          type="date"
          required
          value={date}
          onChange={(e) => setDate(e.target.value)}
          data-testid="event-date"
        />
        <Input
          label="Local"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          data-testid="event-location"
        />
        <Input
          label="Níveis"
          hint="Ex.: Elite, Base"
          value={levels}
          onChange={(e) => setLevels(e.target.value)}
          data-testid="event-levels"
        />
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

function DuplicateEventModal({
  event,
  onClose,
  onDuplicated,
}: {
  event: EventSummary;
  onClose(): void;
  onDuplicated(id: string): void;
}) {
  const [name, setName] = useState(`${event.name} (cópia)`);
  const [date, setDate] = useState(event.date);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const id = await api.admin.duplicateEvent(event.id, name.trim(), date);
      onDuplicated(id);
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível duplicar o evento'));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Duplicar "${event.name}"`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" form="duplicate-event-form" loading={busy} data-testid="event-duplicate-submit">
            Duplicar
          </Button>
        </>
      }
    >
      <form id="duplicate-event-form" className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <Input
          label="Nome do novo evento"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="duplicate-name"
        />
        <Input
          label="Data"
          type="date"
          required
          value={date}
          onChange={(e) => setDate(e.target.value)}
          data-testid="duplicate-date"
        />
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
