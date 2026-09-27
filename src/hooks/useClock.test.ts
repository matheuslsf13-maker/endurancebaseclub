import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const serverTime = vi.hoisted(() => vi.fn<() => Promise<number>>());
vi.mock('../lib/api', () => ({ api: { serverTime } }));

// The clock is a module-level singleton: each test loads a fresh copy of the module.
async function loadUseClock() {
  vi.resetModules();
  return (await import('./useClock')).useClock;
}

const SAVED = { offset_ms: 5_000, rtt_ms: 100, synced_at: 123 };
const saved = () => JSON.parse(window.localStorage.getItem('ebc.clock') ?? 'null') as unknown;

let visibility: DocumentVisibilityState;
let addListener: MockInstance<typeof document.addEventListener>;
let setItem: MockInstance<Storage['setItem']>;
let start: number;
let sampledAt: number[];

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  // Listeners of earlier tests' module copies must not answer this test's visibility events.
  addListener = vi.spyOn(document, 'addEventListener');
  setItem = vi.spyOn(Storage.prototype, 'setItem');
  start = Date.now();
  sampledAt = [];
  serverTime.mockReset();
  // Instant answers from a server clock 2 s ahead of the device.
  serverTime.mockImplementation(async () => {
    sampledAt.push(Date.now() - start);
    return Date.now() + 2_000;
  });
});

afterEach(() => {
  for (const [type, listener, options] of addListener.mock.calls) document.removeEventListener(type, listener, options);
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
});

const clockWrites = () => setItem.mock.calls.filter(([key]) => key === 'ebc.clock').length;

describe('useClock', () => {
  it('restores the offset saved under ebc.clock before the first sample answers', async () => {
    window.localStorage.setItem('ebc.clock', JSON.stringify(SAVED));
    serverTime.mockReturnValue(new Promise<number>(() => {}));
    const useClock = await loadUseClock();

    const { result } = renderHook(() => useClock());

    expect(result.current.synced).toBe(true);
    expect(result.current.offsetMs).toBe(5_000);
    expect(result.current.now()).toBe(Date.now() + 5_000);
  });

  it('ignores a corrupted saved state and runs on the device clock until it syncs', async () => {
    window.localStorage.setItem('ebc.clock', JSON.stringify({ offset_ms: 'x', rtt_ms: 10 }));
    serverTime.mockReturnValue(new Promise<number>(() => {}));
    const useClock = await loadUseClock();

    const { result } = renderHook(() => useClock());

    expect(result.current.synced).toBe(false);
    expect(result.current.offsetMs).toBeNull();
    expect(result.current.now()).toBe(Date.now());
  });

  it('takes 5 samples 300 ms apart, then one every 20 s, saving the state after each', async () => {
    const useClock = await loadUseClock();
    const { result } = renderHook(() => useClock());

    await act(() => vi.advanceTimersByTimeAsync(1_200));
    expect(sampledAt).toEqual([0, 300, 600, 900, 1_200]);
    expect(result.current.offsetMs).toBe(2_000);
    expect(clockWrites()).toBe(5);
    // Every sample has the same (zero) round trip, so the first one stays the reference.
    expect(saved()).toEqual({ offset_ms: 2_000, rtt_ms: 0, synced_at: start });

    await act(() => vi.advanceTimersByTimeAsync(19_999));
    expect(sampledAt).toHaveLength(5);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(sampledAt).toEqual([0, 300, 600, 900, 1_200, 21_200]);
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(sampledAt.slice(5)).toEqual([21_200, 41_200]);
    expect(clockWrites()).toBe(7);
  });

  it('is one clock for the whole app: later callers share it and do not sample again', async () => {
    const useClock = await loadUseClock();
    const first = renderHook(() => useClock());
    const second = renderHook(() => useClock());

    expect(second.result.current).toBe(first.result.current);
    await act(() => vi.advanceTimersByTimeAsync(1_200));
    expect(serverTime).toHaveBeenCalledTimes(5);
  });

  it('samples again when the page becomes visible, one request at a time', async () => {
    const useClock = await loadUseClock();
    renderHook(() => useClock());
    await act(() => vi.advanceTimersByTimeAsync(1_200));
    expect(serverTime).toHaveBeenCalledTimes(5);

    let answer!: (ms: number) => void;
    serverTime.mockImplementation(() => new Promise<number>((resolve) => { answer = resolve; }));
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(serverTime).toHaveBeenCalledTimes(5);

    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(serverTime).toHaveBeenCalledTimes(6);

    answer(Date.now() + 2_000);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(clockWrites()).toBe(6);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(serverTime).toHaveBeenCalledTimes(7);
  });

  it('keeps the saved offset while the server is unreachable', async () => {
    window.localStorage.setItem('ebc.clock', JSON.stringify(SAVED));
    setItem.mockClear();
    serverTime.mockRejectedValue(new Error('Sem conexão com o servidor'));
    const useClock = await loadUseClock();
    const { result } = renderHook(() => useClock());

    await act(() => vi.advanceTimersByTimeAsync(21_200));

    expect(serverTime).toHaveBeenCalledTimes(6);
    expect(result.current.offsetMs).toBe(5_000);
    expect(clockWrites()).toBe(0);
    expect(saved()).toEqual(SAVED);
  });
});
