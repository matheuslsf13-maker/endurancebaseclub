import { Link } from 'react-router';
import { Logo } from '../components/Logo';

export default function NotFound() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-bg px-4 py-10 text-center text-fg">
      <Logo size={64} />
      <h1 className="brand-title text-lg font-semibold">Página não encontrada</h1>
      <p className="max-w-sm text-sm text-muted">O endereço pode estar incompleto ou a página não existe mais.</p>
      <Link
        to="/"
        className="inline-flex min-h-11 items-center rounded-xl border border-border px-4 text-sm font-medium hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Voltar ao início
      </Link>
    </div>
  );
}
