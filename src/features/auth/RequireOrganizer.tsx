import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { Logo } from '../../components/Logo';
import { Button, Card, Spinner } from '../../components/ui';
import { useSession } from './session';

/** Guards the organizer area: renders `children` (or the nested route) only for organizers. */
export default function RequireOrganizer({ children }: { children?: ReactNode }) {
  const { status, me, signOut } = useSession();
  const location = useLocation();
  const from = location.pathname + location.search;
  // Stable object: <Navigate> re-navigates whenever its `state` prop changes identity.
  const redirectState = useMemo(() => ({ from }), [from]);

  if (status === 'loading') {
    return (
      <div className="flex min-h-full items-center justify-center p-6">
        <Spinner size={32} />
      </div>
    );
  }
  if (status === 'anon') return <Navigate to="/entrar" replace state={redirectState} />;
  if (status === 'forbidden') {
    return (
      <div className="flex min-h-full items-center justify-center bg-bg px-4 py-10 text-fg">
        <Card className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
          <Logo size={64} />
          <p className="text-base font-medium">Esta conta não tem acesso de organização</p>
          <p className="text-sm text-muted">Entre com uma conta de organizador ou peça acesso à organizadora master.</p>
          <Button className="mt-3" onClick={() => void signOut()} data-testid="logout">
            Sair
          </Button>
        </Card>
      </div>
    );
  }
  if (me?.must_change_password) return <Navigate to="/trocar-senha" replace />;
  return <>{children ?? <Outlet />}</>;
}
