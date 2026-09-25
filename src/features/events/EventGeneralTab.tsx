import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Button, Card, Checkbox, Input, Select, Textarea, useConfirm, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import type { EventRow, EventStatus } from '../../lib/types';
import { useEventContext } from './EventContext';
import { copyToClipboard, errorMessage, parseLevels } from './eventHelpers';

const STATUS_OPTIONS: { value: EventStatus; label: string }[] = [
  { value: 'planejado', label: 'Planejado' },
  { value: 'ao_vivo', label: 'Ao vivo' },
  { value: 'encerrado', label: 'Encerrado' },
];

export default function EventGeneralTab() {
  const { agg, refresh } = useEventContext();
  const { event } = agg;
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();

  const [name, setName] = useState(event.name);
  const [date, setDate] = useState(event.date);
  const [location, setLocation] = useState(event.location);
  const [description, setDescription] = useState(event.description);
  const [levels, setLevels] = useState(event.levels.join(', '));
  const [status, setStatus] = useState<EventStatus>(event.status);
  const [isPublic, setIsPublic] = useState(event.is_public);
  const [slug, setSlug] = useState(event.public_slug ?? '');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Whether the organizer has typed anything since the form was last seeded from the server.
  const [dirty, setDirty] = useState(false);
  // The server's copy changed (another tab, another organizer, a live poll) while this one had
  // unsaved edits: the form keeps the organizer's values instead of silently discarding them.
  const [serverChanged, setServerChanged] = useState(false);
  const eventIdRef = useRef(event.id);

  function seedFromEvent(ev: EventRow) {
    setName(ev.name);
    setDate(ev.date);
    setLocation(ev.location);
    setDescription(ev.description);
    setLevels(ev.levels.join(', '));
    setStatus(ev.status);
    setIsPublic(ev.is_public);
    setSlug(ev.public_slug ?? '');
  }

  // Re-seed the form from a fresh `event` — but only when there's nothing to lose: either this
  // is a different event altogether (navigated here from another one), or the organizer hasn't
  // touched the form yet. A dirty form on the *same* event keeps its values and flags
  // `serverChanged` instead, so a background refetch never silently overwrites in-progress edits
  // (Ruling 40).
  useEffect(() => {
    const isDifferentEvent = event.id !== eventIdRef.current;
    eventIdRef.current = event.id;
    if (isDifferentEvent || !dirty) {
      seedFromEvent(event);
      setDirty(false);
      setServerChanged(false);
      return;
    }
    setServerChanged(true);
    // `dirty` is read intentionally without being a dependency: this must only re-run when the
    // event itself changes, never merely because the organizer started typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event]);

  function reloadFromServer() {
    seedFromEvent(event);
    setDirty(false);
    setServerChanged(false);
  }

  /** Wraps a field setter so any edit marks the form dirty. */
  function edited<T>(setter: (v: T) => void, value: T) {
    setter(value);
    setDirty(true);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.admin.saveEvent({
        id: event.id,
        name: name.trim(),
        date,
        location: location.trim(),
        description,
        levels: parseLevels(levels),
        status,
        is_public: isPublic,
        public_slug: isPublic ? slug.trim() || null : event.public_slug,
      });
      // Clear before `refresh()` resolves, so the resulting `event` update is treated as "our own
      // save landing", not as someone else's concurrent change.
      setDirty(false);
      setServerChanged(false);
      await refresh();
      toast.show({ message: 'Evento salvo', tone: 'success' });
    } catch (err) {
      toast.show({ message: errorMessage(err, 'Não foi possível salvar o evento'), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    const ok = await confirm({
      title: `Excluir "${event.name}"?`,
      message: 'Provas, inscrições e marcações desse evento serão apagadas. Essa ação não pode ser desfeita.',
      confirmLabel: 'Excluir evento',
      danger: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await api.admin.deleteEvent(event.id);
      toast.show({ message: 'Evento excluído', tone: 'success' });
      navigate('/eventos');
    } catch (err) {
      toast.show({ message: errorMessage(err, 'Não foi possível excluir o evento'), tone: 'danger' });
      setDeleting(false);
    }
  }

  const publicUrl = `${window.location.origin}/#/p/${slug}`;

  async function onCopyLink() {
    const ok = await copyToClipboard(publicUrl);
    toast.show({ message: ok ? 'Link copiado' : 'Não foi possível copiar o link', tone: ok ? 'success' : 'danger' });
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-6">
      {serverChanged && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          <p>Os dados do evento mudaram em outro lugar — salve para sobrescrever ou recarregue.</p>
          <Button type="button" size="sm" variant="secondary" onClick={reloadFromServer}>
            Recarregar
          </Button>
        </div>
      )}

      <Card className="flex flex-col gap-4">
        <h2 className="font-semibold">Dados do evento</h2>
        <Input
          label="Nome do evento"
          required
          value={name}
          onChange={(e) => edited(setName, e.target.value)}
          data-testid="event-name"
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Data"
            type="date"
            required
            value={date}
            onChange={(e) => edited(setDate, e.target.value)}
            data-testid="event-date"
          />
          <Input
            label="Local"
            value={location}
            onChange={(e) => edited(setLocation, e.target.value)}
            data-testid="event-location"
          />
        </div>
        <Textarea label="Descrição" value={description} onChange={(e) => edited(setDescription, e.target.value)} />
        <Input
          label="Níveis"
          hint="Ex.: Elite, Base"
          value={levels}
          onChange={(e) => edited(setLevels, e.target.value)}
          data-testid="event-levels"
        />
        <Select
          label="Status"
          value={status}
          onChange={(e) => edited(setStatus, e.target.value as EventStatus)}
          options={STATUS_OPTIONS}
        />
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="font-semibold">Público</h2>
        <Checkbox
          label="Resultados públicos"
          checked={isPublic}
          onChange={(e) => edited(setIsPublic, e.target.checked)}
          data-testid="event-public"
        />
        {isPublic && (
          <div className="flex flex-col gap-2">
            <Input label="Endereço público (slug)" value={slug} onChange={(e) => edited(setSlug, e.target.value)} />
            <div className="flex flex-wrap items-center gap-3">
              <p className="break-all text-sm text-muted tabular">…/#/p/{slug || '—'}</p>
              <Button type="button" size="sm" variant="secondary" onClick={() => void onCopyLink()}>
                Copiar link
              </Button>
            </div>
          </div>
        )}
      </Card>

      <div>
        <Button type="submit" loading={busy} data-testid="event-save">
          Salvar alterações
        </Button>
      </div>

      <Card className="flex flex-col gap-3 border-danger/40">
        <h2 className="font-semibold text-danger">Excluir evento</h2>
        <p className="text-sm text-muted">Remove o evento e tudo o que está registrado nele.</p>
        <div>
          <Button type="button" variant="danger" loading={deleting} onClick={() => void onDelete()}>
            Excluir evento
          </Button>
        </div>
      </Card>
    </form>
  );
}
