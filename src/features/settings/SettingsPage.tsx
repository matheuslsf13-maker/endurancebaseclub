import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Input, Spinner, useConfirm, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { useSession } from '../auth/session';
import type { OrganizerRow } from '../../lib/types';

const MIN_LENGTH = 8;
// No 0/O, 1/l/I: every character the generator can produce reads unambiguously out loud or on paper.
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const PASSWORD_LENGTH = 12;

function generateTempPassword(): string {
  const bytes = new Uint32Array(PASSWORD_LENGTH);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < PASSWORD_LENGTH; i++) out += PASSWORD_ALPHABET[bytes[i] % PASSWORD_ALPHABET.length];
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

export default function SettingsPage() {
  const { me } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const isOwner = me?.role === 'owner';

  const { data: organizers, isLoading, error } = useQuery({
    queryKey: ['organizers'],
    queryFn: () => api.admin.listOrganizers(),
  });

  async function refreshOrganizers() {
    await queryClient.invalidateQueries({ queryKey: ['organizers'] });
  }

  async function handleRemove(o: OrganizerRow) {
    const ok = await confirm({
      title: `Remover ${o.name}?`,
      message: 'A pessoa perde o acesso ao painel imediatamente.',
      confirmLabel: 'Remover',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.admin.deleteOrganizer(o.user_id);
      await refreshOrganizers();
      toast.show({ message: 'Organizador removido', tone: 'success' });
    } catch (err) {
      toast.show({ message: errorMessage(err, 'Não foi possível remover o organizador'), tone: 'danger' });
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
      <h1 className="brand-title text-xl font-semibold">Configurações</h1>

      <MyAccountCard />

      <Card className="flex flex-col gap-4">
        <h2 className="font-semibold">Organizadores</h2>
        {isLoading && (
          <div className="flex justify-center py-6">
            <Spinner size={28} />
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(error, 'Não foi possível carregar os organizadores')}
          </p>
        )}
        {organizers && organizers.length > 0 && (
          <ul className="flex flex-col gap-2">
            {organizers.map((o) => (
              <li
                key={o.user_id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
              >
                <div>
                  <p className="font-medium">{o.name}</p>
                  <p className="text-sm text-muted">{o.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={o.role === 'owner' ? 'info' : 'neutral'}>{o.role === 'owner' ? 'Dono' : 'Organizador'}</Badge>
                  {isOwner && o.user_id !== me?.user_id && (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => void handleRemove(o)}
                      data-testid={`organizer-remove-${o.user_id}`}
                    >
                      Remover
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {isOwner && <AddOrganizer onAdded={refreshOrganizers} />}
      </Card>
    </div>
  );
}

function MyAccountCard() {
  const { me, changePassword } = useSession();
  const toast = useToast();
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [errors, setErrors] = useState<{ pw1?: string; pw2?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next = {
      pw1: pw1.length < MIN_LENGTH ? `A senha precisa ter pelo menos ${MIN_LENGTH} caracteres` : undefined,
      pw2: pw1 !== pw2 ? 'As senhas não conferem' : undefined,
    };
    setErrors(next);
    if (next.pw1 || next.pw2) return;

    setBusy(true);
    try {
      await changePassword(pw1);
      toast.show({ message: 'Senha alterada', tone: 'success' });
      setPw1('');
      setPw2('');
      setErrors({});
    } catch (err) {
      setErrors({ form: errorMessage(err, 'Não foi possível alterar a senha') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="font-semibold">Minha conta</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted">Nome</dt>
        <dd>{me?.name}</dd>
        <dt className="text-muted">E-mail</dt>
        <dd>{me?.email}</dd>
        <dt className="text-muted">Função</dt>
        <dd>{me?.role === 'owner' ? 'Dono' : 'Organizador'}</dd>
      </dl>
      <form className="flex flex-col gap-3" onSubmit={(e) => void onSubmit(e)} noValidate>
        <p className="text-sm font-medium">Trocar senha</p>
        <Input
          label="Nova senha"
          type="password"
          autoComplete="new-password"
          hint={`Pelo menos ${MIN_LENGTH} caracteres`}
          error={errors.pw1}
          value={pw1}
          onChange={(e) => setPw1(e.target.value)}
          data-testid="newpass-1"
        />
        <Input
          label="Repita a nova senha"
          type="password"
          autoComplete="new-password"
          error={errors.pw2}
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          data-testid="newpass-2"
        />
        {errors.form && (
          <p role="alert" className="text-sm text-danger">
            {errors.form}
          </p>
        )}
        <div>
          <Button type="submit" loading={busy} data-testid="newpass-submit">
            Salvar nova senha
          </Button>
        </div>
      </form>
    </Card>
  );
}

function AddOrganizer({ onAdded }: { onAdded(): Promise<void> }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);

  function reset() {
    setEmail('');
    setName('');
    setPassword('');
    setError(null);
    setCreated(null);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!password) {
      setError('Gere uma senha provisória antes de criar');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.admin.createOrganizer(email.trim(), password, name.trim());
      setCreated({ email: email.trim(), password });
      await onAdded();
    } catch (err) {
      // The server also enforces "only the owner creates organizers" (42501): show its pt-BR
      // message as a toast rather than swallowing it, in case this UI is ever reachable by a
      // non-owner (a stale session, a role change elsewhere).
      toast.show({ message: errorMessage(err, 'Não foi possível criar o organizador'), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function onCopyCredentials() {
    if (!created) return;
    const text = `E-mail: ${created.email}\nSenha provisória: ${created.password}`;
    const ok = await copyToClipboard(text);
    toast.show({ message: ok ? 'Credenciais copiadas' : 'Não foi possível copiar', tone: ok ? 'success' : 'danger' });
  }

  if (!open) {
    return (
      <div className="mt-2">
        <Button
          variant="secondary"
          onClick={() => {
            reset();
            setOpen(true);
          }}
          data-testid="add-organizer"
        >
          Adicionar organizador
        </Button>
      </div>
    );
  }

  if (created) {
    return (
      <Card className="mt-2 flex flex-col gap-3 border-success/40" data-testid="organizer-credentials">
        <p className="font-medium">Organizador criado</p>
        <p className="text-sm text-muted">Anote agora: essa senha não será mostrada de novo.</p>
        <p className="tabular text-sm">
          <strong>E-mail:</strong> {created.email}
        </p>
        <p className="tabular text-sm">
          <strong>Senha provisória:</strong> {created.password}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void onCopyCredentials()} data-testid="organizer-copy-credentials">
            Copiar credenciais
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              reset();
              setOpen(false);
            }}
          >
            Concluir
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <form className="mt-2 flex flex-col gap-3" onSubmit={(e) => void onSubmit(e)} noValidate>
      <Input label="Nome" required value={name} onChange={(e) => setName(e.target.value)} data-testid="organizer-name" />
      <Input
        label="E-mail"
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        data-testid="organizer-email"
      />
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <Input label="Senha provisória" readOnly value={password} className="tabular" data-testid="organizer-password" />
        </div>
        <Button type="button" variant="secondary" onClick={() => setPassword(generateTempPassword())} data-testid="organizer-generate-password">
          Gerar senha
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy} data-testid="organizer-save">
          Criar organizador
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
