import { describe, expect, it } from 'vitest';

// Ruling 32: `.env.test` points Vitest at the local Supabase project, so any module that
// (transitively) imports the real client loads without mocking it.
describe('supabase client', () => {
  it('can be imported in tests', async () => {
    const { supabase } = await import('./supabase');
    expect(typeof supabase.rpc).toBe('function');
  });

  it('keeps the session under ebc.auth, refreshes it and never reads it from the URL', async () => {
    const { supabase } = await import('./supabase');
    const auth = supabase.auth as unknown as {
      storageKey: string; persistSession: boolean; autoRefreshToken: boolean; detectSessionInUrl: boolean;
    };
    expect({
      storageKey: auth.storageKey,
      persistSession: auth.persistSession,
      autoRefreshToken: auth.autoRefreshToken,
      detectSessionInUrl: auth.detectSessionInUrl,
    }).toEqual({ storageKey: 'ebc.auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false });
  });
});
