import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { Logo } from '../../components/Logo';
import { Button, Card, Input } from '../../components/ui';
import { useSession } from './session';

/** Where to go after signing in: the page RequireOrganizer bounced from, if it is an in-app path. */
function redirectTarget(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from;
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : '/eventos';
}

export default function LoginPage() {
  const { status, signIn } = useSession();
  const navigate = useNavigate();
  const target = redirectTarget(useLocation().state);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in (e.g. opened #/entrar from a bookmark): skip the form.
  if (status === 'organizer' && !busy) return <Navigate to={target} replace />;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
      navigate(target, { replace: true });
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Não foi possível entrar');
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-bg px-4 py-10 text-fg">
      <Card className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo size={88} />
          <h1 className="brand-title text-lg font-semibold">Endurance Base Club</h1>
          <p className="text-sm text-muted">Acesso da organização</p>
        </div>

        <form className="mt-6 flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <Input
            label="E-mail"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid="login-email"
          />
          <Input
            label="Senha"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-testid="login-password"
          />
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" loading={busy} disabled={!email.trim() || !password} data-testid="login-submit">
            Entrar
          </Button>
        </form>

        <p className="mt-6 text-center text-sm">
          <Link to="/" className="text-muted underline underline-offset-2 hover:text-fg">
            Ver resultados públicos
          </Link>
        </p>
      </Card>
    </div>
  );
}
