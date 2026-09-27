import { useState } from 'react';
import { Link, Outlet, useMatch, useParams } from 'react-router';
import { Badge, Button, Card, Spinner, Tabs } from '../../components/ui';
import type { BadgeTone, TabItem } from '../../components/ui';
import { formatDateBR } from '../../lib/format';
import type { EventStatus } from '../../lib/types';
import { useEventData } from '../../hooks/useEventData';
import { EventProvider, useEventContext } from './EventContext';

const TABS: { id: string; label: string }[] = [
  { id: 'geral', label: 'Geral' },
  { id: 'provas', label: 'Provas' },
  { id: 'inscricoes', label: 'Inscrições' },
  { id: 'cronometragem', label: 'Cronometragem' },
  { id: 'revisao', label: 'Revisão' },
  { id: 'resultados', label: 'Resultados' },
];
/** Tabs that follow the race as it happens and therefore poll every 2 s. */
const LIVE_TABS = new Set(['cronometragem', 'revisao', 'resultados']);

const STATUS: Record<EventStatus, { label: string; tone: BadgeTone }> = {
  planejado: { label: 'Planejado', tone: 'neutral' },
  ao_vivo: { label: 'Ao vivo', tone: 'success' },
  encerrado: { label: 'Encerrado', tone: 'info' },
};

export default function EventLayout() {
  const eventId = useParams().eventId ?? '';
  const tab = useMatch('/eventos/:eventId/:tab/*')?.params.tab;
  const { agg, isLoading, error, refresh, patchAgg } = useEventData(eventId, { live: tab !== undefined && LIVE_TABS.has(tab) });

  if (!agg) {
    if (isLoading || !error) {
      return (
        <div className="flex justify-center px-4 py-16">
          <Spinner size={32} />
        </div>
      );
    }
    return <LoadError message={error.message} onRetry={refresh} />;
  }

  return (
    <EventProvider eventId={eventId} agg={agg} refresh={refresh} patchAgg={patchAgg}>
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <EventHeader />
        <div className="mt-6">
          <Outlet />
        </div>
      </div>
    </EventProvider>
  );
}

function EventHeader() {
  const { agg, timing } = useEventContext();
  const { event } = agg;
  const pending = timing.issues.filter((i) => i.severity !== 'info');
  const hasErrors = pending.some((i) => i.severity === 'error');
  const status = STATUS[event.status];

  const items: TabItem[] = TABS.map((t) => ({
    id: t.id,
    label: t.label,
    to: `/eventos/${event.id}/${t.id}`,
    badge: t.id === 'revisao' && pending.length > 0
      ? <Badge tone={hasErrors ? 'danger' : 'warning'}>{pending.length}</Badge>
      : undefined,
  }));

  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="brand-title text-xl font-semibold break-words">{event.name}</h1>
          <p className="mt-1 text-sm text-muted tabular">
            {formatDateBR(event.date)}
            {event.location ? ` · ${event.location}` : ''}
          </p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <Tabs items={items} />
    </header>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry(): Promise<void> }) {
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-12">
      <Card className="flex flex-col gap-4">
        <div>
          <p className="font-medium">Não foi possível carregar o evento</p>
          <p role="alert" className="mt-1 text-sm text-danger">
            {message}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void retry()} loading={retrying}>
            Tentar novamente
          </Button>
          <Link to="/eventos" className="text-sm text-muted underline underline-offset-2 hover:text-fg">
            Voltar para eventos
          </Link>
        </div>
      </Card>
    </div>
  );
}
