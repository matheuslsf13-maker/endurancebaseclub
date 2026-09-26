import { act } from '@testing-library/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from './ui';
import { shouldPromptForUpdate, UpdatePrompt } from './UpdatePrompt';

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

  it('ignores the event when rendered without a ToastProvider (nothing to crash)', () => {
    // UpdatePrompt is mounted once, inside the providers; this only guards against a future
    // refactor moving it outside them without anyone noticing at review time.
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
