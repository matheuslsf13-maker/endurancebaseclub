import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { api, ApiError } from '../../lib/api';
import type { AdminMe } from '../../lib/types';

export type SessionStatus = 'loading' | 'anon' | 'organizer' | 'forbidden';

export interface SessionValue {
  status: SessionStatus;
  me: AdminMe | null;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  changePassword(pw: string): Promise<void>;
  refreshMe(): Promise<void>;
}

/** Exported so tests can provide a fake session without Supabase. */
export const SessionContext = createContext<SessionValue | null>(null);

interface SessionState {
  status: SessionStatus;
  me: AdminMe | null;
}

const ANON: SessionState = { status: 'anon', me: null };
const FORBIDDEN: SessionState = { status: 'forbidden', me: null };

/** Delay before re-checking a restored session while the server is unreachable. */
const RESTORE_RETRY_MS = 3_000;

/** Supabase Auth errors (returned or thrown) as pt-BR ApiErrors. */
function authError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  const err = (typeof e === 'object' && e !== null ? e : {}) as { name?: string; message?: string; code?: string; status?: number };
  if (e instanceof TypeError || err.name === 'AuthRetryableFetchError') return new ApiError('Sem conexão com o servidor', 'network');
  if (err.code === 'invalid_credentials' || err.message === 'Invalid login credentials') return new ApiError('E-mail ou senha incorretos');
  if (err.code === 'same_password') return new ApiError('A nova senha precisa ser diferente da atual', err.code);
  if (err.code === 'weak_password') return new ApiError('Senha muito fraca. Escolha outra senha.', err.code);
  if (err.code === 'email_not_confirmed') return new ApiError('Este e-mail ainda não foi confirmado', err.code);
  if (err.code === 'user_banned') return new ApiError('Esta conta está bloqueada', err.code);
  if (err.status === 429 || err.code?.startsWith('over_')) {
    return new ApiError('Muitas tentativas seguidas. Aguarde um pouco e tente de novo.', err.code ?? null);
  }
  if (err.name === 'AuthSessionMissingError' || err.code === 'session_not_found' || err.code === 'session_expired') {
    return new ApiError('Sua sessão expirou. Entre novamente.', err.code ?? null);
  }
  return new ApiError(err.message || 'Erro inesperado', err.code ?? null);
}

/** Ends the Supabase session; supabase-js removes the local copy even when the server is unreachable. */
async function dropSession(): Promise<void> {
  try {
    await supabase.auth.signOut();
  } catch {
    // Nothing left to do: the session is gone locally either way.
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<SessionState>({ status: 'loading', me: null });

  // Being signed in is not enough: only accounts with an `organizers` row get in. For any other
  // account admin_me answers 42501 — sign it out and let the UI explain why.
  const loadMe = useCallback(async () => {
    try {
      const me = await api.admin.me();
      setState({ status: 'organizer', me });
    } catch (e) {
      if (e instanceof ApiError && e.code === '42501') {
        setState(FORBIDDEN);
        await dropSession();
        return;
      }
      throw e;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const restore = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        if (!data.session) {
          setState(ANON);
          return;
        }
        await loadMe();
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.code === 'network') {
          // Offline right now: keep "loading" rather than pretend the organizer is logged out.
          retry = setTimeout(() => void restore(), RESTORE_RETRY_MS);
          return;
        }
        // The stored session is unusable (revoked, invalid JWT…): start over from the login page.
        await dropSession();
        setState(ANON);
      }
    };
    void restore();

    // Sessions can also end outside this provider (refresh token revoked, sign-out in another tab).
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event !== 'SIGNED_OUT') return;
      setState((s) => (s.status === 'forbidden' ? s : ANON));
      queryClient.clear();
    });

    return () => {
      cancelled = true;
      clearTimeout(retry);
      data.subscription.unsubscribe();
    };
  }, [loadMe, queryClient]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      let error: unknown;
      try {
        ({ error } = await supabase.auth.signInWithPassword({ email: email.trim(), password }));
      } catch (e) {
        error = e;
      }
      if (error) throw authError(error);
      await loadMe();
    },
    [loadMe],
  );

  // Cached admin data (athletes' contacts included) must not outlive the session on this device.
  const signOut = useCallback(async () => {
    await dropSession();
    setState(ANON);
    queryClient.clear();
  }, [queryClient]);

  const changePassword = useCallback(
    async (pw: string) => {
      let error: unknown;
      try {
        ({ error } = await supabase.auth.updateUser({ password: pw }));
      } catch (e) {
        error = e;
      }
      if (error) throw authError(error);
      await api.admin.passwordChanged();
      await loadMe();
    },
    [loadMe],
  );

  const value = useMemo<SessionValue>(
    () => ({ status: state.status, me: state.me, signIn, signOut, changePassword, refreshMe: loadMe }),
    [state, signIn, signOut, changePassword, loadMe],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within a SessionProvider');
  return ctx;
}
