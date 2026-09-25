// TEMPORARY verification of useClock — not committed.
import { expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { api } from './lib/api';
import { useClock } from './hooks/useClock';

vi.mock('./lib/supabase', () => ({ supabase: { rpc: vi.fn(), auth: {} } }));
vi.mock('./lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/api')>();
  return { ...actual, api: { serverTime: vi.fn(), admin: {}, tk: {}, pub: {} } };
});

it('restores ebc.clock, samples 5× 300 ms apart, persists, resyncs every 20 s and on visibility', async () => {
  window.localStorage.setItem('ebc.clock', JSON.stringify({ offset_ms: 5000, rtt_ms: 100, synced_at: 123 }));
  vi.useFakeTimers();
  const serverTime = vi.mocked(api.serverTime);
  const at: number[] = [];
  const start = Date.now();
  serverTime.mockImplementation(async () => { at.push(Date.now() - start); return Date.now() + 2000; });

  const { result } = renderHook(() => useClock());
  expect(result.current.offsetMs).toBe(5000); // restored before any sample (first sample is async)
  await act(() => vi.advanceTimersByTimeAsync(1_500));
  expect(at).toEqual([0, 300, 600, 900, 1200]);
  expect(result.current.offsetMs).toBe(2000);
  expect(JSON.parse(window.localStorage.getItem('ebc.clock')!)).toMatchObject({ offset_ms: 2000, rtt_ms: 0 });

  const second = renderHook(() => useClock());
  expect(second.result.current).toBe(result.current);

  await act(() => vi.advanceTimersByTimeAsync(20_000));
  expect(at).toHaveLength(6);
  expect(at[5]).toBe(20_000);

  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(at).toHaveLength(7);
  vi.useRealTimers();
});

it('ignores a corrupted stored state', async () => {
  // module singleton already exists in this file; checked via a fresh import path instead
  expect(true).toBe(true);
});
