import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { Logo } from '../../components/Logo';
import { ThemeToggle } from '../../components/ThemeToggle';

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const NAV: { to: string; label: string; testId: string; match(pathname: string): boolean }[] = [
  { to: '/', label: 'Eventos', testId: 'public-nav-events', match: (p) => p === '/' || p.startsWith('/p/') },
  { to: '/perfis', label: 'Atletas', testId: 'public-nav-athletes', match: (p) => p.startsWith('/perfis') || p.startsWith('/atleta/') || p.startsWith('/comparar/') },
  { to: '/ranking', label: 'Rankings', testId: 'public-nav-ranking', match: (p) => p.startsWith('/ranking') },
];

/**
 * Shell for every public page (spec §6/§12; 2026-09-28 §3.1): logo + brand name, the public
 * navigation (Eventos · Atletas · Rankings, current one marked with aria-current), the theme
 * toggle and a link to the organizer login — no admin navigation.
 */
export function PublicShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <div className="flex min-h-full flex-col bg-bg text-fg">
      <header className="border-b border-border">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <Link to="/" className={`flex shrink-0 items-center gap-3 ${FOCUS}`}>
            <Logo size={32} />
            <span className="brand-title text-sm font-semibold sm:text-base">ENDURANCE BASE CLUB</span>
          </Link>
          <nav aria-label="Páginas públicas" className="order-last flex w-full gap-1 sm:order-none sm:w-auto">
            {NAV.map((item) => {
              const active = item.match(pathname);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  data-testid={item.testId}
                  aria-current={active ? 'page' : undefined}
                  className={`inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-medium ${FOCUS} ${active ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg'}`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <ThemeToggle />
            <Link
              to="/entrar"
              className={`inline-flex min-h-11 items-center rounded-xl border border-border px-3 text-sm font-medium text-fg hover:bg-surface-2 ${FOCUS}`}
            >
              Área da organização
            </Link>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
