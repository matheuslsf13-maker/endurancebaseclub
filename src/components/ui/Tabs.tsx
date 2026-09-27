import type { ReactNode } from 'react';
import { NavLink } from 'react-router';

export interface TabItem {
  id: string;
  label: string;
  to: string;
  badge?: ReactNode;
}

export interface TabsProps {
  items: TabItem[];
}

export function Tabs({ items }: TabsProps) {
  return (
    <nav aria-label="Abas" className="no-print flex gap-1 overflow-x-auto border-b border-border">
      {items.map((item) => (
        <NavLink
          key={item.id}
          to={item.to}
          data-testid={`tab-${item.id}`}
          className={({ isActive }) =>
            `inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              isActive ? 'border-fg text-fg' : 'border-transparent text-muted hover:text-fg'
            }`
          }
        >
          {item.label}
          {item.badge}
        </NavLink>
      ))}
    </nav>
  );
}
