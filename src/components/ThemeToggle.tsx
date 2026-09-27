import { useState } from 'react';
import { safeLocalStorage } from '../lib/storage';

const STORAGE_KEY = 'ebc.theme';

type Theme = 'dark' | 'light';

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className = '' }: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme>(() => currentTheme());
  const isLight = theme === 'light';

  function toggle() {
    const next: Theme = isLight ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    safeLocalStorage().setItem(STORAGE_KEY, next);
    setTheme(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={isLight}
      data-testid="theme-toggle"
      className={`inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface-2 px-3 text-sm font-medium text-fg hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${className}`}
    >
      {isLight ? 'Modo sol' : 'Modo noite'}
    </button>
  );
}
