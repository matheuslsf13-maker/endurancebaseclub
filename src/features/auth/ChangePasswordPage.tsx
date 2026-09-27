import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { Logo } from '../../components/Logo';
import { Button, Card, Input, Spinner, useToast } from '../../components/ui';
import { useSession } from './session';

const MIN_LENGTH = 8;

export default function ChangePasswordPage() {
  const { status, me, changePassword, signOut } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [errors, setErrors] = useState<{ pw1?: string; pw2?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  if (status === 'loading') {
    return (
      <div className="flex min-h-full items-center justify-center p-6">
        <Spinner size={32} />
      </div>
    );
  }
  if (status !== 'organizer') return <Navigate to="/entrar" replace />;

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
      navigate('/eventos', { replace: true });
    } catch (err) {
      setErrors({ form: err instanceof Error && err.message ? err.message : 'Não foi possível alterar a senha' });
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-bg px-4 py-10 text-fg">
      <Card className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo size={64} />
          <h1 className="brand-title text-lg font-semibold">Nova senha</h1>
          <p className="text-sm text-muted">
            {me?.must_change_password
              ? 'Por segurança, troque a senha provisória antes de continuar.'
              : 'Escolha uma nova senha para a sua conta.'}
          </p>
        </div>

        <form className="mt-6 flex flex-col gap-4" onSubmit={onSubmit} noValidate>
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
          <Button type="submit" size="lg" loading={busy} data-testid="newpass-submit">
            Salvar nova senha
          </Button>
          <Button variant="ghost" onClick={() => void signOut()} disabled={busy} data-testid="logout">
            Sair
          </Button>
        </form>
      </Card>
    </div>
  );
}
