import { NavLink, Outlet } from 'react-router';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';

export interface LayoutProps {
  onLogout: () => void;
}

const NAV_ITEMS: { to: string; label: string }[] = [
  { to: '/eventos', label: 'Eventos' },
  { to: '/atletas', label: 'Atletas' },
  { to: '/ajuda', label: 'Ajuda' },
  { to: '/config', label: 'Configurações' },
];

export function Layout({ onLogout }: LayoutProps) {
  return (
    <div className="flex min-h-full flex-col bg-bg text-fg">
      <header className="no-print border-b border-border">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <div className="flex shrink-0 items-center gap-3">
            <Logo size={32} />
            <span className="brand-title text-sm font-semibold sm:text-base">ENDURANCE BASE CLUB</span>
          </div>

          <nav
            aria-label="Principal"
            className="order-3 -mx-4 flex w-full min-w-0 flex-1 gap-1 overflow-x-auto px-4 sm:order-none sm:mx-0 sm:w-auto sm:px-0"
          >
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-xl px-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                    isActive ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <ThemeToggle />
            <button
              type="button"
              onClick={onLogout}
              data-testid="logout"
              className="inline-flex min-h-11 items-center rounded-xl border border-border px-3 text-sm font-medium text-fg hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Sair
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
