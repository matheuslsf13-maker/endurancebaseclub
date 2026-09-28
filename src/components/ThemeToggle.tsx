import { useState } from 'react';
import { safeLocalStorage } from '../lib/storage';

const STORAGE_KEY = 'ebc.theme';

type Theme = 'dark' | 'light';

// C-Minor-19: kept in sync with index.html's bootstrap script, which sets the same colors before
// the first paint (dark theme's --bg / light theme's --bg, src/index.css).
const THEME_COLOR: Record<Theme, string> = { dark: '#191513', light: '#F4F1EC' };

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function setThemeColorMeta(theme: Theme) {
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
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
    setThemeColorMeta(next);
    setTheme(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      data-testid="theme-toggle"
      className={`inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface-2 px-3 text-sm font-medium text-fg hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${className}`}
    >
      {/* C-Minor-17: the label names the action ("switch to night/day mode"), not the current
          mode — with a plain button (no aria-pressed) that reads unambiguously either way. */}
      {isLight ? 'Modo noite' : 'Modo sol'}
    </button>
  );
}
