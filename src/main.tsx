import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { SessionProvider } from './features/auth/session';
import { ConfirmProvider, ToastProvider } from './components/ui';
import { buildRegisterSWCallbacks, UpdatePrompt } from './components/UpdatePrompt';
import { ApiError } from './lib/api';
import './index.css';

// Ruling 26: registerType is 'prompt' (vite.config.ts), so a new build never reloads an open tab
// on its own — it only takes over once every tab has closed. Registering here (production only;
// dev/test never touch a service worker) lets us decide, per route, whether to even mention it:
// the timekeeper link (#/c/<token>) stays silent so a cronometrista mid-race is never interrupted;
// everywhere else `UpdatePrompt` offers a manual "Atualizar" that calls `updateSW(true)`. Both
// callbacks are built by `buildRegisterSWCallbacks` (tested on its own): `onNeedReload` is passed
// explicitly because workbox-window's default is to reload every controlled tab — including an
// open `#/c/` one — the moment another tab of this device applies the update.
if (import.meta.env.PROD) {
  let updateSW: (reloadPage?: boolean) => Promise<void>;
  updateSW = registerSW({ immediate: true, ...buildRegisterSWCallbacks(() => () => updateSW(true)) });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      // Validation/permission errors do not go away on retry; only network failures are retried.
      retry: (failureCount, error) => failureCount < 2 && error instanceof ApiError && error.code === 'network',
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <ToastProvider>
          <ConfirmProvider>
            <UpdatePrompt />
            <App />
          </ConfirmProvider>
        </ToastProvider>
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
