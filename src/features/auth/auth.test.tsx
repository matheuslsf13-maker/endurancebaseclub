import { useState } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Routes } from 'react-router';

import { renderWithProviders } from '../../test/renderWithProviders';
import { ApiError } from '../../lib/api';
import type { AdminMe } from '../../lib/types';
import { SessionContext, SessionProvider, useSession } from './session';
import type { SessionStatus, SessionValue } from './session';
import LoginPage from './LoginPage';
import ChangePasswordPage from './ChangePasswordPage';
import RequireOrganizer from './RequireOrganizer';

// supabase.rpc() returns a query builder that api.ts awaits after attaching its timeout signal;
// `rpcAnswer` decides what the awaited builder yields.
const sb = vi.hoisted(() => {
  const rpcAnswer = vi.fn();
  return {
    rpcAnswer,
    rpc: vi.fn((...args: unknown[]) => ({ abortSignal: () => rpcAnswer(...args) })),
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
      updateUser: vi.fn(),
    },
  };
});
vi.mock('../../lib/supabase', () => ({ supabase: sb }));

const ME: AdminMe = { user_id: 'u1', email: 'ana@ebc.test', name: 'Ana', role: 'owner', must_change_password: false };

function fakeSession(overrides: Partial<SessionValue> = {}): SessionValue {
  return {
    status: 'anon',
    me: null,
    signIn: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    changePassword: vi.fn().mockResolvedValue(undefined),
    refreshMe: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderRoutes(route: string, session: SessionValue, routes: ReactNode) {
  return renderWithProviders(
    <SessionContext.Provider value={session}>
      <Routes>{routes}</Routes>
    </SessionContext.Provider>,
    { route },
  );
}

describe('LoginPage', () => {
  it('submits the credentials and navigates to /eventos', async () => {
    const user = userEvent.setup();
    const session = fakeSession();
    const { router } = renderRoutes('/entrar', session, (
      <>
        <Route path="/entrar" element={<LoginPage />} />
        <Route path="/eventos" element={<p>Painel de eventos</p>} />
      </>
    ));

    await user.type(screen.getByTestId('login-email'), 'ana@ebc.test');
    await user.type(screen.getByTestId('login-password'), 'senha-segura');
    await user.click(screen.getByTestId('login-submit'));

    expect(await screen.findByText('Painel de eventos')).toBeInTheDocument();
    expect(session.signIn).toHaveBeenCalledWith('ana@ebc.test', 'senha-segura');
    expect(router.state.location.pathname).toBe('/eventos');
  });

  it('shows "E-mail ou senha incorretos" when the sign-in fails', async () => {
    const user = userEvent.setup();
    const session = fakeSession({ signIn: vi.fn().mockRejectedValue(new ApiError('E-mail ou senha incorretos')) });
    const { router } = renderRoutes('/entrar', session, <Route path="/entrar" element={<LoginPage />} />);

    await user.type(screen.getByTestId('login-email'), 'ana@ebc.test');
    await user.type(screen.getByTestId('login-password'), 'errada');
    await user.click(screen.getByTestId('login-submit'));

    expect(await screen.findByText('E-mail ou senha incorretos')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/entrar');
    expect(screen.getByTestId('login-submit')).toBeEnabled();
  });

  it('returns to the page the organizer was trying to open', async () => {
    const user = userEvent.setup();
    function StatefulSession({ children }: { children: ReactNode }) {
      const [status, setStatus] = useState<SessionStatus>('anon');
      const value = fakeSession({
        status,
        me: status === 'organizer' ? ME : null,
        signIn: vi.fn(async () => setStatus('organizer')),
      });
      return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
    }
    const { router } = renderWithProviders(
      <StatefulSession>
        <Routes>
          <Route path="/entrar" element={<LoginPage />} />
          <Route path="/eventos/*" element={<RequireOrganizer><p>Revisão do evento</p></RequireOrganizer>} />
        </Routes>
      </StatefulSession>,
      { route: '/eventos/ev1/revisao' },
    );

    await user.type(await screen.findByTestId('login-email'), 'ana@ebc.test');
    await user.type(screen.getByTestId('login-password'), 'senha-segura');
    await user.click(screen.getByTestId('login-submit'));

    expect(await screen.findByText('Revisão do evento')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/eventos/ev1/revisao');
  });
});

describe('RequireOrganizer', () => {
  const guarded = (
    <>
      <Route path="/entrar" element={<p>Tela de login</p>} />
      <Route path="/trocar-senha" element={<p>Troque sua senha</p>} />
      <Route path="/eventos/*" element={<RequireOrganizer><p>Área da organização</p></RequireOrganizer>} />
    </>
  );

  it('redirects anonymous visitors to /entrar, remembering where they were going', async () => {
    const { router } = renderRoutes('/eventos/ev1/revisao', fakeSession(), guarded);

    expect(await screen.findByText('Tela de login')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/entrar');
    expect(router.state.location.state).toEqual({ from: '/eventos/ev1/revisao' });
    expect(screen.queryByText('Área da organização')).not.toBeInTheDocument();
  });

  it('redirects organizers with a provisional password to /trocar-senha', async () => {
    const session = fakeSession({ status: 'organizer', me: { ...ME, must_change_password: true } });
    const { router } = renderRoutes('/eventos', session, guarded);

    expect(await screen.findByText('Troque sua senha')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/trocar-senha');
  });

  it('renders the protected page for organizers', () => {
    renderRoutes('/eventos', fakeSession({ status: 'organizer', me: ME }), guarded);
    expect(screen.getByText('Área da organização')).toBeInTheDocument();
  });

  it('shows a spinner while the session is being checked', () => {
    renderRoutes('/eventos', fakeSession({ status: 'loading' }), guarded);
    expect(screen.getByRole('status', { name: 'Carregando' })).toBeInTheDocument();
    expect(screen.queryByText('Área da organização')).not.toBeInTheDocument();
  });

  it('explains that the account has no organizer access and offers to log out', async () => {
    const user = userEvent.setup();
    const session = fakeSession({ status: 'forbidden' });
    renderRoutes('/eventos', session, guarded);

    expect(screen.getByText('Esta conta não tem acesso de organização')).toBeInTheDocument();
    await user.click(screen.getByTestId('logout'));
    expect(session.signOut).toHaveBeenCalledTimes(1);
  });
});

describe('ChangePasswordPage', () => {
  it('requires 8+ characters and a matching confirmation, then saves and opens /eventos', async () => {
    const user = userEvent.setup();
    const session = fakeSession({ status: 'organizer', me: { ...ME, must_change_password: true } });
    const { router } = renderRoutes('/trocar-senha', session, (
      <>
        <Route path="/trocar-senha" element={<ChangePasswordPage />} />
        <Route path="/eventos" element={<p>Painel de eventos</p>} />
      </>
    ));

    await user.type(screen.getByTestId('newpass-1'), 'curta');
    await user.type(screen.getByTestId('newpass-2'), 'curta');
    await user.click(screen.getByTestId('newpass-submit'));
    expect(screen.getByText('A senha precisa ter pelo menos 8 caracteres')).toBeInTheDocument();

    await user.clear(screen.getByTestId('newpass-1'));
    await user.type(screen.getByTestId('newpass-1'), 'senha-nova-1');
    await user.clear(screen.getByTestId('newpass-2'));
    await user.type(screen.getByTestId('newpass-2'), 'senha-nova-2');
    await user.click(screen.getByTestId('newpass-submit'));
    expect(screen.getByText('As senhas não conferem')).toBeInTheDocument();
    expect(session.changePassword).not.toHaveBeenCalled();

    await user.clear(screen.getByTestId('newpass-2'));
    await user.type(screen.getByTestId('newpass-2'), 'senha-nova-1');
    await user.click(screen.getByTestId('newpass-submit'));

    expect(await screen.findByText('Painel de eventos')).toBeInTheDocument();
    expect(session.changePassword).toHaveBeenCalledWith('senha-nova-1');
    expect(router.state.location.pathname).toBe('/eventos');
  });

  it('sends visitors without a session to /entrar', async () => {
    const { router } = renderRoutes('/trocar-senha', fakeSession(), (
      <>
        <Route path="/trocar-senha" element={<ChangePasswordPage />} />
        <Route path="/entrar" element={<p>Tela de login</p>} />
      </>
    ));
    expect(await screen.findByText('Tela de login')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/entrar');
  });
});

describe('SessionProvider', () => {
  let current: SessionValue;
  function Probe() {
    current = useSession();
    return <p data-testid="status">{current.status}</p>;
  }
  function renderProvider() {
    return render(
      <QueryClientProvider client={new QueryClient()}>
        <SessionProvider>
          <Probe />
        </SessionProvider>
      </QueryClientProvider>,
    );
  }
  const status = () => screen.getByTestId('status');
  const rpcOk = (data: unknown) => ({ data, error: null, status: 200 });

  beforeEach(() => {
    vi.clearAllMocks();
    sb.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    sb.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    sb.auth.signInWithPassword.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null });
    sb.auth.signOut.mockResolvedValue({ error: null });
    sb.auth.updateUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    sb.rpcAnswer.mockResolvedValue(rpcOk(ME));
  });

  it('is anonymous when no session is stored', async () => {
    renderProvider();
    await waitFor(() => expect(status()).toHaveTextContent('anon'));
    expect(sb.rpc).not.toHaveBeenCalled();
  });

  it('restores a stored session by asking admin_me', async () => {
    sb.auth.getSession.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null });
    renderProvider();
    await waitFor(() => expect(status()).toHaveTextContent('organizer'));
    expect(sb.rpc).toHaveBeenCalledWith('admin_me');
    expect(current.me).toEqual(ME);
  });

  it('signs in with the trimmed e-mail and loads the organizer profile', async () => {
    renderProvider();
    await waitFor(() => expect(status()).toHaveTextContent('anon'));

    await act(() => current.signIn(' ana@ebc.test ', 'senha-segura'));

    expect(sb.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'ana@ebc.test', password: 'senha-segura' });
    expect(status()).toHaveTextContent('organizer');
    expect(current.me).toEqual(ME);
  });

  it('maps Supabase "Invalid login credentials" to "E-mail ou senha incorretos"', async () => {
    sb.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { name: 'AuthApiError', message: 'Invalid login credentials', status: 400, code: 'invalid_credentials' },
    });
    renderProvider();
    await waitFor(() => expect(status()).toHaveTextContent('anon'));

    const err = await current.signIn('ana@ebc.test', 'errada').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ message: 'E-mail ou senha incorretos' });
    expect(sb.rpc).not.toHaveBeenCalled();
    expect(status()).toHaveTextContent('anon');
  });

  it('maps an unreachable auth server to "Sem conexão com o servidor"', async () => {
    sb.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 },
    });
    renderProvider();
    await waitFor(() => expect(status()).toHaveTextContent('anon'));

    const err = await current.signIn('ana@ebc.test', 'senha-segura').catch((e: unknown) => e);
    expect(err).toMatchObject({ message: 'Sem conexão com o servidor', code: 'network' });
  });

  it.each([
    ['email_not_confirmed', 400, 'Email not confirmed', 'Este e-mail ainda não foi confirmado'],
    ['over_request_rate_limit', 429, 'Request rate limit reached', 'Muitas tentativas seguidas. Aguarde um pouco e tente de novo.'],
    ['user_banned', 400, 'User is banned', 'Esta conta está bloqueada'],
  ])('shows the Supabase Auth error %s in Portuguese', async (code, httpStatus, original, message) => {
    const error = { name: 'AuthApiError', message: original, status: httpStatus, code };
    sb.auth.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error });
    renderProvider();
    await waitFor(() => expect(status()).toHaveTextContent('anon'));

    const err = await current.signIn('ana@ebc.test', 'senha-segura').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ message });
  });

  it('marks accounts that are not organizers as forbidden and signs them out', async () => {
    sb.rpcAnswer.mockResolvedValue({ data: null, error: { message: 'Acesso restrito à organização', code: '42501' }, status: 403 });
    renderProvider();
    await waitFor(() => expect(status()).toHaveTextContent('anon'));

    await act(() => current.signIn('atleta@ebc.test', 'senha-segura'));

    expect(status()).toHaveTextContent('forbidden');
    expect(current.me).toBeNull();
    // Only this device: a global sign-out would also log the organizer out everywhere else.
    expect(sb.auth.signOut).toHaveBeenCalledTimes(1);
    expect(sb.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('changes the password, clears the provisional flag and reloads the profile', async () => {
    let mustChange = true;
    sb.auth.getSession.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null });
    sb.rpcAnswer.mockImplementation(async (fn: string) => {
      if (fn === 'admin_me') return rpcOk({ ...ME, must_change_password: mustChange });
      if (fn === 'admin_password_changed') {
        mustChange = false;
        return rpcOk(null);
      }
      throw new Error(`unexpected rpc ${fn}`);
    });
    renderProvider();
    await waitFor(() => expect(current.me?.must_change_password).toBe(true));

    await act(() => current.changePassword('senha-nova-123'));

    expect(sb.auth.updateUser).toHaveBeenCalledWith({ password: 'senha-nova-123' });
    expect(sb.rpc.mock.calls.map((c) => c[0])).toEqual(['admin_me', 'admin_password_changed', 'admin_me']);
    expect(current.me?.must_change_password).toBe(false);
  });

  it('does not flag the password as changed when Supabase refuses the new one', async () => {
    sb.auth.getSession.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null });
    sb.auth.updateUser.mockResolvedValue({
      data: { user: null }, error: { name: 'AuthSessionMissingError', message: 'Auth session missing!', status: 400 },
    });
    renderProvider();
    await waitFor(() => expect(status()).toHaveTextContent('organizer'));

    const err = await current.changePassword('senha-nova-123').catch((e: unknown) => e);

    expect(err).toMatchObject({ message: 'Sua sessão expirou. Entre novamente.' });
    expect(sb.rpc.mock.calls.map((c) => c[0])).toEqual(['admin_me']);
  });

  it('keeps loading while the server is unreachable and retries the restore', async () => {
    vi.useFakeTimers();
    try {
      sb.auth.getSession.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null });
      sb.rpcAnswer.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(rpcOk(ME));
      renderProvider();
      await act(() => vi.advanceTimersByTimeAsync(100));
      expect(status()).toHaveTextContent('loading');
      expect(sb.auth.signOut).not.toHaveBeenCalled();

      await act(() => vi.advanceTimersByTimeAsync(3_000));
      expect(status()).toHaveTextContent('organizer');
      expect(sb.rpc).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  describe('restoring a stored session', () => {
    const SESSION = { data: { session: { access_token: 't' } }, error: null };
    let onAuthEvent: (event: string) => void;
    const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

    beforeEach(() => {
      vi.useFakeTimers();
      onAuthEvent = () => {};
      sb.auth.onAuthStateChange.mockImplementation((cb: (event: string) => void) => {
        onAuthEvent = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      });
      sb.auth.getSession.mockResolvedValue(SESSION);
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('stays loading when an expired token cannot be refreshed offline, then recovers', async () => {
      // supabase-js keeps the stored session and reports the failed refresh as retryable.
      sb.auth.getSession.mockResolvedValueOnce({
        data: { session: null }, error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 },
      });
      renderProvider();
      await advance(100);
      expect(status()).toHaveTextContent('loading');
      expect(sb.auth.signOut).not.toHaveBeenCalled();
      expect(sb.rpc).not.toHaveBeenCalled();

      await advance(3_000);
      expect(status()).toHaveTextContent('organizer');
    });

    it('recovers as soon as supabase-js refreshes the token', async () => {
      sb.auth.getSession.mockResolvedValueOnce({
        data: { session: null }, error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 },
      });
      renderProvider();
      await advance(100);
      expect(status()).toHaveTextContent('loading');

      act(() => onAuthEvent('TOKEN_REFRESHED'));
      await advance(10);

      expect(status()).toHaveTextContent('organizer');
      expect(sb.rpc).toHaveBeenCalledTimes(1);
    });

    it('keeps the session through server errors, retrying with backoff', async () => {
      const unavailable = { data: null, error: { message: 'Could not query the database for the schema cache', code: 'PGRST002' }, status: 503 };
      sb.rpcAnswer.mockResolvedValueOnce(unavailable).mockResolvedValueOnce(unavailable).mockResolvedValue(rpcOk(ME));
      renderProvider();
      await advance(100);
      expect(status()).toHaveTextContent('loading');
      expect(sb.rpc).toHaveBeenCalledTimes(1);

      await advance(3_000);
      expect(sb.rpc).toHaveBeenCalledTimes(2);
      expect(status()).toHaveTextContent('loading');
      await advance(5_000);
      expect(sb.rpc).toHaveBeenCalledTimes(2);
      await advance(1_000);
      expect(sb.rpc).toHaveBeenCalledTimes(3);
      expect(status()).toHaveTextContent('organizer');
      expect(sb.auth.signOut).not.toHaveBeenCalled();
    });

    it.each([
      ['an expired JWT (PGRST301)', { message: 'JWT expired', code: 'PGRST301' }],
      ['invalid JWT claims (PGRST303)', { message: 'JWT claims validation failed', code: 'PGRST303' }],
      ['an HTTP 401', { message: 'Invalid JWT', code: '' }],
    ])('drops the session on this device only when the server rejects it: %s', async (_name, error) => {
      sb.rpcAnswer.mockResolvedValue({ data: null, error, status: 401 });
      renderProvider();
      await advance(100);

      expect(status()).toHaveTextContent('anon');
      expect(sb.auth.signOut).toHaveBeenCalledTimes(1);
      expect(sb.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    });

    it('is anonymous when the server refused to refresh the stored session', async () => {
      sb.auth.getSession.mockResolvedValue({
        data: { session: null },
        error: { name: 'AuthApiError', message: 'Invalid Refresh Token: Refresh Token Not Found', status: 400, code: 'refresh_token_not_found' },
      });
      renderProvider();
      await advance(100);

      expect(status()).toHaveTextContent('anon');
      expect(sb.rpc).not.toHaveBeenCalled();
      await advance(60_000);
      expect(sb.auth.getSession).toHaveBeenCalledTimes(1);
    });

    it('loads the organizer when another tab signs in', async () => {
      sb.auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
      renderProvider();
      await advance(100);
      expect(status()).toHaveTextContent('anon');

      act(() => onAuthEvent('SIGNED_IN'));
      await advance(10);

      expect(status()).toHaveTextContent('organizer');
    });

    it('does not load the profile twice for its own sign-in', async () => {
      sb.auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
      sb.auth.signInWithPassword.mockImplementation(async () => {
        onAuthEvent('SIGNED_IN');
        return { data: { session: { access_token: 't' } }, error: null };
      });
      renderProvider();
      await advance(100);

      await act(() => current.signIn('ana@ebc.test', 'senha-segura'));
      await advance(10);

      expect(status()).toHaveTextContent('organizer');
      expect(sb.rpc).toHaveBeenCalledTimes(1);
    });
  });

  it('returns to anonymous when the session ends elsewhere', async () => {
    let onAuthEvent: (event: string) => void = () => {};
    sb.auth.onAuthStateChange.mockImplementation((cb: (event: string) => void) => {
      onAuthEvent = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    sb.auth.getSession.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null });
    renderProvider();
    await waitFor(() => expect(status()).toHaveTextContent('organizer'));

    act(() => onAuthEvent('SIGNED_OUT'));

    expect(status()).toHaveTextContent('anon');
  });

  it('signs out back to anonymous', async () => {
    sb.auth.getSession.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null });
    renderProvider();
    await waitFor(() => expect(status()).toHaveTextContent('organizer'));

    await act(() => current.signOut());

    expect(sb.auth.signOut).toHaveBeenCalledTimes(1);
    expect(sb.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(status()).toHaveTextContent('anon');
    expect(current.me).toBeNull();
  });
});
