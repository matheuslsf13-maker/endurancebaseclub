import { useState } from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Button } from './Button';
import { Input, Select, Checkbox } from './Field';
import { Modal } from './Modal';
import { ConfirmProvider, useConfirm } from './Confirm';
import { Tabs } from './Tabs';
import { Badge } from './Badge';
import { Table } from './Table';
import { EmptyState } from './EmptyState';
import { ToastProvider, useToast } from './Toast';

import { Layout } from '../Layout';
import { ThemeToggle } from '../ThemeToggle';
import { QrCode } from '../QrCode';
import { LineChart } from '../LineChart';
import { useNow } from '../../hooks/useNow';
import { renderWithProviders } from '../../test/renderWithProviders';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Button', () => {
  it('renders children and calls onClick', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Salvar</Button>);
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('shows a spinner and is disabled when loading', () => {
    render(
      <Button loading data-testid="save-btn">
        Salvar
      </Button>,
    );
    const btn = screen.getByTestId('save-btn');
    expect(btn).toBeDisabled();
    expect(within(btn).getByRole('status')).toBeInTheDocument();
  });
});

describe('Field', () => {
  it('Input shows the label and switches from hint to error', () => {
    const { rerender } = render(
      <Input label="Nome" hint="Como aparece nos resultados" onChange={() => {}} value="" />,
    );
    expect(screen.getByLabelText('Nome')).toBeInTheDocument();
    expect(screen.getByText('Como aparece nos resultados')).toBeInTheDocument();

    rerender(<Input label="Nome" error="Obrigatório" onChange={() => {}} value="" />);
    expect(screen.getByText('Obrigatório')).toBeInTheDocument();
    expect(screen.queryByText('Como aparece nos resultados')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Nome')).toHaveAttribute('aria-invalid', 'true');
  });

  it('Select renders the given options', () => {
    render(
      <Select
        label="Sexo"
        value="M"
        onChange={() => {}}
        options={[
          { value: 'M', label: 'Masculino' },
          { value: 'F', label: 'Feminino' },
        ]}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Sexo' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Feminino' })).toBeInTheDocument();
  });

  it('Checkbox fires onChange when toggled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Checkbox label="Perfil público" checked={false} onChange={onChange} />);
    await user.click(screen.getByLabelText('Perfil público'));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('Modal', () => {
  it('calls onClose on Escape', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Detalhes">
        <p>Conteúdo</p>
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'Detalhes' })).toBeInTheDocument();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on backdrop click and renders nothing when closed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(
      <Modal open onClose={onClose} title="Detalhes">
        <p>Conteúdo</p>
      </Modal>,
    );
    await user.click(screen.getByTestId('modal-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <Modal open={false} onClose={onClose} title="Detalhes">
        <p>Conteúdo</p>
      </Modal>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Modal focus management', () => {
  function FocusHarness() {
    const [open, setOpen] = useState(false);
    return (
      <div>
        <button onClick={() => setOpen(true)}>Abrir modal</button>
        <Modal open={open} onClose={() => setOpen(false)} title="Detalhes" footer={<button>Rodapé</button>}>
          <button>Ação</button>
        </Modal>
      </div>
    );
  }

  it('moves focus into the dialog on open, traps Tab inside it, and restores focus to the trigger on close', async () => {
    const user = userEvent.setup();
    render(<FocusHarness />);
    const trigger = screen.getByText('Abrir modal');

    await user.click(trigger);
    const closeBtn = screen.getByLabelText('Fechar');
    expect(closeBtn).toHaveFocus();

    await user.tab();
    expect(screen.getByText('Ação')).toHaveFocus();
    await user.tab();
    expect(screen.getByText('Rodapé')).toHaveFocus();
    await user.tab();
    expect(closeBtn).toHaveFocus(); // wraps from the last focusable back to the first

    await user.tab({ shift: true });
    expect(screen.getByText('Rodapé')).toHaveFocus(); // Shift+Tab from the first wraps to the last

    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
  });
});

function ConfirmHarness() {
  const confirm = useConfirm();
  const [result, setResult] = useState('pending');
  return (
    <div>
      <button
        onClick={async () => {
          const ok = await confirm({ title: 'Excluir evento?', message: 'Esta ação não pode ser desfeita.', danger: true });
          setResult(ok ? 'true' : 'false');
        }}
      >
        Abrir confirmação
      </button>
      <div data-testid="confirm-result">{result}</div>
    </div>
  );
}

describe('useConfirm', () => {
  it('resolves true when confirm-ok is clicked', async () => {
    const user = userEvent.setup();
    render(
      <ConfirmProvider>
        <ConfirmHarness />
      </ConfirmProvider>,
    );
    await user.click(screen.getByText('Abrir confirmação'));
    await user.click(await screen.findByTestId('confirm-ok'));
    expect(await screen.findByTestId('confirm-result')).toHaveTextContent('true');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('resolves false when confirm-cancel is clicked', async () => {
    const user = userEvent.setup();
    render(
      <ConfirmProvider>
        <ConfirmHarness />
      </ConfirmProvider>,
    );
    await user.click(screen.getByText('Abrir confirmação'));
    await user.click(await screen.findByTestId('confirm-cancel'));
    expect(await screen.findByTestId('confirm-result')).toHaveTextContent('false');
  });
});

describe('Tabs', () => {
  it('renders NavLinks with data-testid tab-<id> and marks the active one', () => {
    renderWithProviders(
      <Tabs
        items={[
          { id: 'geral', label: 'Geral', to: '/eventos/1/geral' },
          { id: 'revisao', label: 'Revisão', to: '/eventos/1/revisao', badge: <Badge tone="danger">2</Badge> },
        ]}
      />,
      { route: '/eventos/1/geral' },
    );
    const geral = screen.getByTestId('tab-geral');
    expect(geral).toHaveAttribute('href', '/eventos/1/geral');
    expect(geral).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('tab-revisao')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});

describe('Badge', () => {
  it('renders its children', () => {
    render(<Badge tone="success">Confirmado</Badge>);
    expect(screen.getByText('Confirmado')).toBeInTheDocument();
  });
});

describe('Table', () => {
  it('wraps a table and marks its thead sticky', () => {
    render(
      <Table>
        <thead>
          <tr>
            <th>Nº</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>1</td>
          </tr>
        </tbody>
      </Table>,
    );
    const thead = screen.getByText('Nº').closest('thead');
    expect(thead).toHaveClass('sticky');
  });
});

describe('EmptyState', () => {
  it('renders the title and optional children', () => {
    render(
      <EmptyState title="Nenhum atleta cadastrado">
        <p>Cadastre o primeiro atleta.</p>
      </EmptyState>,
    );
    expect(screen.getByText('Nenhum atleta cadastrado')).toBeInTheDocument();
    expect(screen.getByText('Cadastre o primeiro atleta.')).toBeInTheDocument();
  });
});

function ToastHarness({ onUndo }: { onUndo: () => void }) {
  const { show } = useToast();
  return (
    <button
      onClick={() =>
        show({
          message: 'Marcação atribuída ao nº 101',
          tone: 'success',
          testid: 'assign-toast',
          actions: [{ label: 'Desfazer', onClick: onUndo, testid: 'toast-undo' }],
        })
      }
    >
      Disparar toast
    </button>
  );
}

describe('useToast', () => {
  it('show renders the message and an action button that fires its handler', async () => {
    const user = userEvent.setup();
    const onUndo = vi.fn();
    render(
      <ToastProvider>
        <ToastHarness onUndo={onUndo} />
      </ToastProvider>,
    );
    await user.click(screen.getByText('Disparar toast'));
    expect(await screen.findByTestId('assign-toast')).toBeInTheDocument();
    expect(screen.getByText('Marcação atribuída ao nº 101')).toBeInTheDocument();
    await user.click(screen.getByTestId('toast-undo'));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('pauses the auto-dismiss timer while hovered and resumes with the remaining time on mouseleave', () => {
    vi.useFakeTimers();
    const onUndo = vi.fn();
    render(
      <ToastProvider>
        <ToastHarness onUndo={onUndo} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('Disparar toast'));
    const toast = screen.getByTestId('assign-toast');

    // 2s of the 5s default elapse, then the pointer enters the toast.
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    fireEvent.mouseEnter(toast);

    // Hovering well past the original 5s duration must not dismiss it.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByTestId('assign-toast')).toBeInTheDocument();

    // Leaving resumes the countdown with the ~3s that remained.
    fireEvent.mouseLeave(toast);
    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(screen.getByTestId('assign-toast')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(screen.queryByTestId('assign-toast')).not.toBeInTheDocument();
  });
});

describe('Layout', () => {
  it('renders the brand, nav links and calls onLogout', async () => {
    const user = userEvent.setup();
    const onLogout = vi.fn();
    renderWithProviders(<Layout onLogout={onLogout} />, { route: '/eventos' });
    expect(screen.getByText('ENDURANCE BASE CLUB')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Eventos' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Atletas' })).toBeInTheDocument();
    await user.click(screen.getByTestId('logout'));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});

describe('ThemeToggle', () => {
  beforeEach(() => {
    document.documentElement.dataset.theme = 'dark';
    window.localStorage.clear();
  });

  it('flips data-theme and writes ebc.theme via safeLocalStorage', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    const toggle = screen.getByRole('button');

    await user.click(toggle);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem('ebc.theme')).toBe('light');

    await user.click(toggle);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem('ebc.theme')).toBe('dark');
  });
});

describe('QrCode', () => {
  it('renders an img built from QRCode.toDataURL', async () => {
    render(<QrCode value="https://ebc.example/c/abc123" size={120} testid="tk-qr" />);
    const img = await screen.findByTestId('tk-qr');
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
  });
});

describe('LineChart', () => {
  it('exposes an accessible summary and the "menor é melhor" note', () => {
    render(
      <LineChart
        title="Evolução 5 km corrida"
        formatValue={(v) => `${Math.round(v / 1000)}s`}
        points={[
          { label: '10/2025', value: 1500000 },
          { label: '03/2026', value: 1400000, tooltip: 'Prova X' },
        ]}
      />,
    );
    expect(screen.getByRole('img', { name: /Evolução 5 km corrida/ })).toBeInTheDocument();
    expect(screen.getByText('menor é melhor')).toBeInTheDocument();
  });

  it('shows an empty state when there are no points', () => {
    render(<LineChart title="Evolução" formatValue={(v) => String(v)} points={[]} />);
    expect(screen.getByText('Sem dados para exibir')).toBeInTheDocument();
  });
});

describe('LineChart touch interaction', () => {
  function renderChart() {
    return render(
      <div>
        <LineChart
          title="Evolução 5 km corrida"
          formatValue={(v) => `${Math.round(v / 1000)}s`}
          points={[
            { label: '10/2025', value: 1500000 },
            { label: '03/2026', value: 1400000, tooltip: 'Prova X' },
          ]}
        />
        <button>Fora do gráfico</button>
      </div>,
    );
  }

  it('keeps the tooltip after a tap ends (pointerup then pointerleave) on touch', () => {
    renderChart();
    const svg = screen.getByRole('img', { name: /Evolução 5 km corrida/ });

    fireEvent.pointerDown(svg, { pointerType: 'touch', clientX: 10, clientY: 10 });
    expect(screen.getByTestId('line-chart-tooltip')).toBeInTheDocument();

    fireEvent.pointerUp(svg, { pointerType: 'touch', clientX: 10, clientY: 10 });
    fireEvent.pointerLeave(svg, { pointerType: 'touch', clientX: 10, clientY: 10 });
    expect(screen.getByTestId('line-chart-tooltip')).toBeInTheDocument();
  });

  it('still clears the tooltip on pointerleave for mouse (hover keeps its previous behavior)', () => {
    renderChart();
    const svg = screen.getByRole('img', { name: /Evolução 5 km corrida/ });

    fireEvent.pointerMove(svg, { pointerType: 'mouse', clientX: 10, clientY: 10 });
    expect(screen.getByTestId('line-chart-tooltip')).toBeInTheDocument();

    fireEvent.pointerLeave(svg, { pointerType: 'mouse', clientX: 10, clientY: 10 });
    expect(screen.queryByTestId('line-chart-tooltip')).not.toBeInTheDocument();
  });

  it('clears a sticky touch selection on a tap outside the chart', () => {
    renderChart();
    const svg = screen.getByRole('img', { name: /Evolução 5 km corrida/ });

    fireEvent.pointerDown(svg, { pointerType: 'touch', clientX: 10, clientY: 10 });
    expect(screen.getByTestId('line-chart-tooltip')).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByText('Fora do gráfico'), { pointerType: 'touch' });
    expect(screen.queryByTestId('line-chart-tooltip')).not.toBeInTheDocument();
  });
});

describe('LineChart responsive geometry', () => {
  it('falls back to a fixed viewBox width with no forced stretch when ResizeObserver is unavailable', () => {
    render(
      <LineChart
        title="Evolução"
        formatValue={(v) => String(v)}
        points={[
          { label: 'A', value: 1 },
          { label: 'B', value: 2 },
        ]}
        height={200}
      />,
    );
    const svg = screen.getByRole('img', { name: /Evolução/ });
    expect(svg).toHaveAttribute('viewBox', '0 0 640 200');
    expect(svg).not.toHaveAttribute('preserveAspectRatio', 'none');
  });

  it('adopts the container width once a ResizeObserver reports it, keeping geometry uniform', () => {
    let observedCallback: ResizeObserverCallback | null = null;
    class FakeResizeObserver {
      constructor(cb: ResizeObserverCallback) {
        observedCallback = cb;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);

    render(
      <LineChart
        title="Evolução"
        formatValue={(v) => String(v)}
        points={[
          { label: 'A', value: 1 },
          { label: 'B', value: 2 },
        ]}
        height={200}
      />,
    );
    const svg = screen.getByRole('img', { name: /Evolução/ });
    expect(svg).toHaveAttribute('viewBox', '0 0 640 200');

    act(() => {
      observedCallback?.([{ contentRect: { width: 480 } }] as unknown as ResizeObserverEntry[], {} as unknown as ResizeObserver);
    });

    expect(svg).toHaveAttribute('viewBox', '0 0 480 200');
  });

  it('attaches the ResizeObserver once the chart container mounts, even if it first rendered empty', () => {
    let observedCallback: ResizeObserverCallback | null = null;
    let observedTarget: Element | null = null;
    class FakeResizeObserver {
      constructor(cb: ResizeObserverCallback) {
        observedCallback = cb;
      }
      observe(target: Element) {
        observedTarget = target;
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);

    const { rerender } = render(
      <LineChart title="Evolução" formatValue={(v) => String(v)} points={[]} height={200} />,
    );
    // points=[] renders the EmptyState, not the chart's container div, so
    // nothing should be observed yet.
    expect(observedTarget).toBeNull();

    rerender(
      <LineChart
        title="Evolução"
        formatValue={(v) => String(v)}
        points={[
          { label: 'A', value: 1 },
          { label: 'B', value: 2 },
        ]}
        height={200}
      />,
    );

    // The container mounts for the first time on this rerender (not on the
    // component's first-ever commit) — the observer must attach now.
    expect(observedTarget).not.toBeNull();

    const svg = screen.getByRole('img', { name: /Evolução/ });
    expect(svg).toHaveAttribute('viewBox', '0 0 640 200');

    act(() => {
      observedCallback?.([{ contentRect: { width: 480 } }] as unknown as ResizeObserverEntry[], {} as unknown as ResizeObserver);
    });

    expect(svg).toHaveAttribute('viewBox', '0 0 480 200');
  });
});

describe('useNow', () => {
  it('ticks on the given interval', () => {
    vi.useFakeTimers();
    function Harness() {
      const now = useNow(1000);
      return <span data-testid="now">{now}</span>;
    }
    render(<Harness />);
    const first = Number(screen.getByTestId('now').textContent);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    const second = Number(screen.getByTestId('now').textContent);
    expect(second).toBeGreaterThan(first);
  });
});
