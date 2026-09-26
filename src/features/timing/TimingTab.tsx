import { useState } from 'react';
import { Button, Card, Checkbox, Input } from '../../components/ui';
import { useConfirm } from '../../components/ui/Confirm';
import { useToast } from '../../components/ui/Toast';
import { QrCode } from '../../components/QrCode';
import { api } from '../../lib/api';
import { useEventContext } from '../events/EventContext';
import { TimekeepersPanel } from './TimekeepersPanel';
import { WavesPanel } from './WavesPanel';
import { LiveBoard } from './LiveBoard';
import { errorMessage } from './timingHelpers';

/**
 * The timekeeper link (spec §7.1): the master copies it or shows the QR code, toggles whether
 * it currently accepts new marks, and can rotate the token so old links stop working. The copied
 * text is exactly `${location.origin}${location.pathname}#/c/${event.tk_token}`.
 */
function TimekeeperLinkCard() {
  const { agg, patchAgg, refresh } = useEventContext();
  const { event } = agg;
  const confirm = useConfirm();
  const toast = useToast();
  const [rotating, setRotating] = useState(false);
  const [togglingEnabled, setTogglingEnabled] = useState(false);

  const link = `${location.origin}${location.pathname}#/c/${event.tk_token ?? ''}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(link);
      toast.show({ message: 'Link copiado', tone: 'success' });
    } catch {
      toast.show({ message: 'Não foi possível copiar o link', tone: 'danger' });
    }
  }

  function handleShare() {
    const nav = navigator as Navigator & { share?: (data: { title?: string; text?: string; url?: string }) => Promise<void> };
    if (typeof nav.share === 'function') {
      void nav.share({ title: 'Cronometragem', text: 'Entre para cronometrar', url: link }).catch(() => {});
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(link)}`, '_blank', 'noopener');
    }
  }

  async function handleToggleEnabled(next: boolean) {
    setTogglingEnabled(true);
    try {
      const updated = await api.admin.saveEvent({ ...event, tk_enabled: next });
      patchAgg((a) => ({ ...a, event: updated }));
      await refresh();
    } catch (e) {
      toast.show({ message: errorMessage(e), tone: 'danger' });
    } finally {
      setTogglingEnabled(false);
    }
  }

  async function handleRotate() {
    const ok = await confirm({
      title: 'Gerar novo link dos cronometristas?',
      message: 'O link e o QR code atuais deixam de funcionar. Os cronometristas já cadastrados continuam ativos.',
      confirmLabel: 'Gerar novo link',
      danger: true,
    });
    if (!ok) return;
    setRotating(true);
    try {
      const token = await api.admin.rotateTkToken(event.id);
      patchAgg((a) => ({ ...a, event: { ...a.event, tk_token: token } }));
      await refresh();
      toast.show({ message: 'Novo link gerado', tone: 'success' });
    } catch (e) {
      toast.show({ message: errorMessage(e), tone: 'danger' });
    } finally {
      setRotating(false);
    }
  }

  return (
    <Card>
      <h2 className="brand-title mb-4 text-lg font-semibold">Link dos cronometristas</h2>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex flex-1 flex-col gap-3">
          <Input
            label="Link"
            readOnly
            value={link}
            data-testid="tk-link"
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className="flex flex-wrap gap-2">
            <Button data-testid="tk-copy" onClick={handleCopy}>
              Copiar link
            </Button>
            <Button variant="secondary" onClick={handleShare}>
              Compartilhar
            </Button>
            <Button variant="secondary" onClick={handleRotate} loading={rotating}>
              Gerar novo link
            </Button>
          </div>
          <Checkbox
            label="Link ativo"
            checked={event.tk_enabled ?? true}
            disabled={togglingEnabled}
            onChange={(e) => void handleToggleEnabled(e.currentTarget.checked)}
          />
        </div>
        <QrCode value={link} size={160} testid="tk-qr" />
      </div>
    </Card>
  );
}

export default function TimingTab() {
  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <TimekeeperLinkCard />
      <TimekeepersPanel />
      <WavesPanel />
      <LiveBoard />
    </div>
  );
}
