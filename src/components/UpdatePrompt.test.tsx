import { act } from '@testing-library/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from './ui';
import { buildRegisterSWCallbacks, shouldPromptForUpdate, UpdatePrompt } from './UpdatePrompt';

// Ruling 26: main.tsx dispatches this event (never on the timekeeper route) with an `update`
// callback that wraps the service worker's own `updateSW(true)`; UpdatePrompt only wires it to
// the kit's toast, so it never has to know about `virtual:pwa-register` itself.
function dispatchNeedRefresh(update: () => void) {
  window.dispatchEvent(new CustomEvent('ebc:sw-need-refresh', { detail: { update } }));
}

describe('UpdatePrompt', () => {
  it('renders nothing until a new version is announced', () => {
    render(
      <ToastProvider>
        <UpdatePrompt />
      </ToastProvider>,
    );
    expect(screen.queryByText('Nova versão disponível')).not.toBeInTheDocument();
  });

  it('shows the update toast and calls back into the service worker on click', async () => {
    const user = userEvent.setup();
    const update = vi.fn();
    render(
      <ToastProvider>
        <UpdatePrompt />
      </ToastProvider>,
    );

    act(() => dispatchNeedRefresh(update));

    expect(await screen.findByText('Nova versão disponível')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Atualizar' }));
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('throws immediately when rendered without a ToastProvider, instead of silently doing nothing', () => {
    // UpdatePrompt is mounted once, inside the providers; this only guards against a future
    // refactor moving it outside them without anyone noticing at review time — failing loudly
    // here beats a silently-missing update prompt in production.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<UpdatePrompt />)).toThrow('useToast must be used within a ToastProvider');
    spy.mockRestore();
  });
});

describe('shouldPromptForUpdate', () => {
  // Ruling 26: the timekeeper link is the one route a cronometrista may be mid-race on, so an
  // incoming update must never interrupt it there — every other route is free to prompt.
  it('is false on the timekeeper route', () => {
    expect(shouldPromptForUpdate('#/c/abc')).toBe(false);
  });

  it('is true everywhere else', () => {
    expect(shouldPromptForUpdate('#/eventos')).toBe(true);
    expect(shouldPromptForUpdate('#/')).toBe(true);
    expect(shouldPromptForUpdate('')).toBe(true);
  });
});

describe('buildRegisterSWCallbacks', () => {
  const originalLocation = window.location;

  // jsdom's `window.location.reload` is not a configurable property, so `vi.spyOn` cannot stub it
  // directly — the whole `location` object is swapped out instead (and restored after each test).
  function mockLocation(hash: string): ReturnType<typeof vi.fn> {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, hash, reload },
      writable: true,
      configurable: true,
    });
    return reload;
  }

  afterEach(() => {
    Object.defineProperty(window, 'location', { value: originalLocation, writable: true, configurable: true });
  });

  it('onNeedReload never reloads the timekeeper route (Ruling 26: same-device reload hazard)', () => {
    const reload = mockLocation('#/c/abc123');
    const { onNeedReload } = buildRegisterSWCallbacks(() => vi.fn());

    onNeedReload();

    expect(reload).not.toHaveBeenCalled();
  });

  it('onNeedReload reloads on every other route', () => {
    const reload = mockLocation('#/eventos');
    const { onNeedReload } = buildRegisterSWCallbacks(() => vi.fn());

    onNeedReload();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('onNeedRefresh dispatches the toast event only once even when called twice (vite-plugin-pwa fires it from both listeners on a long-open tab)', () => {
    window.location.hash = '#/eventos';
    const update = vi.fn();
    const { onNeedRefresh } = buildRegisterSWCallbacks(() => update);
    const handler = vi.fn();
    window.addEventListener('ebc:sw-need-refresh', handler);

    onNeedRefresh();
    onNeedRefresh();

    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener('ebc:sw-need-refresh', handler);
  });

  it('onNeedRefresh never dispatches on the timekeeper route', () => {
    window.location.hash = '#/c/abc123';
    const handler = vi.fn();
    window.addEventListener('ebc:sw-need-refresh', handler);
    const { onNeedRefresh } = buildRegisterSWCallbacks(() => vi.fn());

    onNeedRefresh();

    expect(handler).not.toHaveBeenCalled();
    window.removeEventListener('ebc:sw-need-refresh', handler);
  });
});
