import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
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

/** First delay before re-checking a stored session the server could not confirm; it doubles up to the max. */
const RESTORE_RETRY_MS = 3_000;
const RESTORE_RETRY_MAX_MS = 30_000;

/** PostgREST codes for a JWT it refused: expired or invalid (PGRST301), bad claims (PGRST303). */
const REJECTED_JWT_CODES = new Set(['PGRST301', 'PGRST303']);

/** The server refused the session itself (not a transient failure): it will never work again. */
function isRejectedSession(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 401 || (e.code !== null && REJECTED_JWT_CODES.has(e.code)));
}

/** A Supabase Auth failure that says nothing about the session: offline, or the auth server is down. */
function isTransientAuthError(e: unknown): boolean {
  const err = (typeof e === 'object' && e !== null ? e : {}) as { name?: string; status?: number };
  return e instanceof TypeError || err.name === 'AuthRetryableFetchError' || err.status === 0 || (err.status ?? 0) >= 500;
}

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

/**
 * Ends the session on this device only. `scope: 'global'` (the supabase-js default) would revoke the
 * organizer's refresh tokens everywhere: the master laptop must not log out because a phone did.
 * supabase-js removes the local copy even when the logout request itself fails.
 */
async function dropSession(): Promise<void> {
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // Nothing left to do: the session is gone locally either way.
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<SessionState>({ status: 'loading', me: null });
  // Read by the auth event listener, which outlives any single render.
  const statusRef = useRef<SessionStatus>('loading');
  const apply = useCallback((next: SessionState) => {
    statusRef.current = next.status;
    setState(next);
  }, []);
  // Set while signIn runs, so its own SIGNED_IN event does not load the profile a second time.
  const signingIn = useRef(false);

  // Being signed in is not enough: only accounts with an `organizers` row get in. For any other
  // account admin_me answers 42501 — sign it out and let the UI explain why.
  const loadMe = useCallback(async () => {
    try {
      const me = await api.admin.me();
      apply({ status: 'organizer', me });
    } catch (e) {
      if (e instanceof ApiError && e.code === '42501') {
        apply(FORBIDDEN);
        await dropSession();
        return;
      }
      throw e;
    }
  }, [apply]);

  useEffect(() => {
    let cancelled = false;
    let running = false;
    let failures = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;

    // Settles the status from the stored session. Only a definite answer leaves "loading": no
    // session → anon; the server refusing the JWT → drop it on this device → anon; 42501 →
    // forbidden (in loadMe). Anything else — offline, an expired token that cannot be refreshed
    // yet, a 5xx, a captive portal — keeps the session and tries again with backoff: a network
    // hiccup on race day must never log the organizer out.
    const restore = async () => {
      if (cancelled || running) return;
      running = true;
      clearTimeout(retry);
      let again = false;
      try {
        const { data, error } = await supabase.auth.getSession();
        if (cancelled) return;
        if (data.session) await loadMe();
        // After a transient refresh failure supabase-js keeps the session in storage; after any
        // other one (refresh token revoked) it has already removed it.
        else if (error && isTransientAuthError(error)) again = true;
        else apply(ANON);
      } catch (e) {
        if (cancelled) return;
        if (isRejectedSession(e)) {
          await dropSession();
          if (!cancelled) apply(ANON);
        } else {
          again = true;
        }
      } finally {
        running = false;
      }
      if (again && !cancelled) {
        retry = setTimeout(() => void restore(), Math.min(RESTORE_RETRY_MS * 2 ** failures, RESTORE_RETRY_MAX_MS));
        failures += 1;
      } else {
        failures = 0;
      }
    };
    void restore();

    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        // Sessions also end outside this provider (refresh token revoked, sign-out in another tab).
        clearTimeout(retry);
        if (statusRef.current !== 'forbidden') apply(ANON);
        queryClient.clear();
      } else if (
        (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') &&
        !signingIn.current &&
        (statusRef.current === 'loading' || statusRef.current === 'anon')
      ) {
        // The token was refreshed once the network came back, or another tab signed in.
        // Deferred: supabase-js runs these callbacks while holding its auth lock.
        setTimeout(() => void restore(), 0);
      }
    });

    return () => {
      cancelled = true;
      clearTimeout(retry);
      data.subscription.unsubscribe();
    };
  }, [apply, loadMe, queryClient]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      signingIn.current = true;
      try {
        let error: unknown;
        try {
          ({ error } = await supabase.auth.signInWithPassword({ email: email.trim(), password }));
        } catch (e) {
          error = e;
        }
        if (error) throw authError(error);
        await loadMe();
      } finally {
        signingIn.current = false;
      }
    },
    [loadMe],
  );

  // Cached admin data (athletes' contacts included) must not outlive the session on this device.
  const signOut = useCallback(async () => {
    await dropSession();
    apply(ANON);
    queryClient.clear();
  }, [apply, queryClient]);

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
