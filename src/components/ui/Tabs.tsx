import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router';

export interface TabItem {
  id: string;
  label: string;
  to: string;
  badge?: ReactNode;
}

export interface TabsProps {
  items: TabItem[];
}

/**
 * C-Minor-8: at 390 px a tab strip with more items than fit scrolls, but a phone's scrollbar is
 * hidden at rest, so there is no hint anything is off-screen, and the active tab (e.g. a route
 * landed on directly, or "Resultados" after "Revisão" grows a badge) is never brought into view.
 * Fix: scroll the active tab into view whenever the route changes, and fade both edges with a
 * gradient so the strip visibly continues. Shared by every admin event tab strip (EventLayout).
 */
export function Tabs({ items }: TabsProps) {
  const location = useLocation();
  // Which item's NavLink last rendered as active, and its DOM node — captured during render
  // (react-router's `isActive` render prop, not a separate match computation) so it can be
  // scrolled into view from an effect once the route settles.
  const activeIdRef = useRef<string | null>(null);
  const nodesRef = useRef(new Map<string, HTMLAnchorElement | null>());

  useEffect(() => {
    const node = activeIdRef.current ? nodesRef.current.get(activeIdRef.current) : null;
    node?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [location.pathname]);

  return (
    <div className="relative">
      <nav aria-label="Abas" className="no-print flex gap-1 overflow-x-auto border-b border-border">
        {items.map((item) => (
          <NavLink
            key={item.id}
            to={item.to}
            ref={(el) => {
              nodesRef.current.set(item.id, el);
            }}
            data-testid={`tab-${item.id}`}
            className={({ isActive }) => {
              if (isActive) activeIdRef.current = item.id;
              return `inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                isActive ? 'border-fg text-fg' : 'border-transparent text-muted hover:text-fg'
              }`;
            }}
          >
            {item.label}
            {item.badge}
          </NavLink>
        ))}
      </nav>
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-bg to-transparent" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-bg to-transparent" />
    </div>
  );
}
