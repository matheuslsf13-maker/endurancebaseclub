import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Button, Card, Checkbox, Input, Select, Textarea, useConfirm, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import type { EventStatus } from '../../lib/types';
import { useEventContext } from './EventContext';

const STATUS_OPTIONS: { value: EventStatus; label: string }[] = [
  { value: 'planejado', label: 'Planejado' },
  { value: 'ao_vivo', label: 'Ao vivo' },
  { value: 'encerrado', label: 'Encerrado' },
];

/** Comma-separated free text ("Elite, Base, Elite") into a trimmed, order-preserving unique list. */
function parseLevels(text: string): string[] {
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

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

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

  // A save (or a poll bringing a newer version) replaces `event`: pick up its fields again.
  useEffect(() => {
    setName(event.name);
    setDate(event.date);
    setLocation(event.location);
    setDescription(event.description);
    setLevels(event.levels.join(', '));
    setStatus(event.status);
    setIsPublic(event.is_public);
    setSlug(event.public_slug ?? '');
  }, [event]);

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
      <Card className="flex flex-col gap-4">
        <h2 className="font-semibold">Dados do evento</h2>
        <Input label="Nome do evento" required value={name} onChange={(e) => setName(e.target.value)} data-testid="event-name" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        </div>
        <Textarea label="Descrição" value={description} onChange={(e) => setDescription(e.target.value)} />
        <Input
          label="Níveis"
          hint="Ex.: Elite, Base"
          value={levels}
          onChange={(e) => setLevels(e.target.value)}
          data-testid="event-levels"
        />
        <Select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as EventStatus)}
          options={STATUS_OPTIONS}
        />
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="font-semibold">Público</h2>
        <Checkbox
          label="Resultados públicos"
          checked={isPublic}
          onChange={(e) => setIsPublic(e.target.checked)}
          data-testid="event-public"
        />
        {isPublic && (
          <div className="flex flex-col gap-2">
            <Input label="Endereço público (slug)" value={slug} onChange={(e) => setSlug(e.target.value)} />
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
