import { lazy, Suspense, useEffect } from 'react';
import type { ReactNode } from 'react';
import { createHashRouter, isRouteErrorResponse, Navigate, RouterProvider, useParams, useRouteError } from 'react-router';
import type { RouteObject } from 'react-router';
import { Layout } from './components/Layout';
import { Button, Spinner } from './components/ui';
import { useSession } from './features/auth/session';
import RequireOrganizer from './features/auth/RequireOrganizer';
import { safeLocalStorage } from './lib/storage';

/** C-Minor-7: key the timekeeper's own device remembers its last `#/c/:token` link under, so `#/`
 * can offer "Voltar à cronometragem" — a volunteer who reaches the plain public home (e.g. the
 * PWA's `start_url: '/'` icon, or closing and reopening the browser) has no other way back to
 * their timing screen. Exported so PublicHome (which renders the offer) reads the exact same key. */
export const LAST_TIMEKEEPER_TOKEN_KEY = 'ebc.lastTkToken';

// Ruling 30: every page is its own chunk, so `#/c/:token` (the timekeeper link, opened on 4G at
// the trackside) never downloads the admin screens, the XLSX writer, QR code or charts — only the
// route it actually needs. The route table, its paths and its guards stay exactly as they were;
// only how each `element` is imported and rendered changes.
const LoginPage = lazy(() => import('./features/auth/LoginPage'));
const ChangePasswordPage = lazy(() => import('./features/auth/ChangePasswordPage'));
const EventsPage = lazy(() => import('./features/events/EventsPage'));
const EventLayout = lazy(() => import('./features/events/EventLayout'));
const EventGeneralTab = lazy(() => import('./features/events/EventGeneralTab'));
const RacesTab = lazy(() => import('./features/races/RacesTab'));
const EntriesTab = lazy(() => import('./features/entries/EntriesTab'));
const TimingTab = lazy(() => import('./features/timing/TimingTab'));
const ReviewTab = lazy(() => import('./features/review/ReviewTab'));
const ResultsTab = lazy(() => import('./features/results/ResultsTab'));
const AthletesPage = lazy(() => import('./features/athletes/AthletesPage'));
const AthleteProfilePage = lazy(() => import('./features/athletes/AthleteProfilePage'));
const HelpPage = lazy(() => import('./features/help/HelpPage'));
const SettingsPage = lazy(() => import('./features/settings/SettingsPage'));
const TimekeeperPage = lazy(() => import('./features/timekeeper/TimekeeperPage'));
const PublicHome = lazy(() => import('./features/public/PublicHome'));
const PublicEventPage = lazy(() => import('./features/public/PublicEventPage'));
const PublicAthletePage = lazy(() => import('./features/public/PublicAthletePage'));
const NotFound = lazy(() => import('./features/NotFound'));

function PageFallback() {
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <Spinner size={32} />
    </div>
  );
}

/** Wraps a lazily-loaded page's element with the kit's Spinner as the Suspense fallback. */
function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageFallback />}>{children}</Suspense>;
}

/**
 * C-Minor-9: react-router's default error UI is English ("Unexpected Application Error!") and
 * shows a raw stack trace — the only screen a render error or a failed lazy chunk (a route's
 * `import()` rejecting, e.g. offline before the service worker has installed) could otherwise
 * reach. Deliberately NOT lazy-loaded itself (unlike every page above): if the failure IS a chunk
 * load, the fallback must already be part of the entry bundle to have any chance of rendering.
 */
export function RouteErrorBoundary() {
  const error = useRouteError();
  const isChunkLoadError =
    error instanceof Error && /dynamically imported module|Failed to fetch|Importing a module script failed/i.test(error.message);
  const notFound = isRouteErrorResponse(error) && error.status === 404;

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-bg px-4 py-10 text-center text-fg">
      <h1 className="brand-title text-lg font-semibold">Algo deu errado</h1>
      <p className="max-w-sm text-sm text-muted">
        {notFound
          ? 'Página não encontrada.'
          : isChunkLoadError
            ? 'Não foi possível carregar esta página — pode ser uma conexão instável ou uma nova versão do app.'
            : 'Ocorreu um erro inesperado.'}
      </p>
      <Button onClick={() => window.location.reload()}>Recarregar</Button>
    </div>
  );
}

/** Wraps `TimekeeperPage` only to persist the token this device just opened (C-Minor-7) — kept
 * here rather than inside TimekeeperPage itself so the route table owns the one line of storage
 * side effect the "Voltar à cronometragem" offer on `#/` depends on. */
function TimekeeperRoute() {
  const { token } = useParams<{ token: string }>();
  useEffect(() => {
    if (token) safeLocalStorage().setItem(LAST_TIMEKEEPER_TOKEN_KEY, token);
  }, [token]);
  return <TimekeeperPage />;
}

/** `#/`: the organizer's dashboard when signed in, the public event list otherwise. */
function Home() {
  const { status } = useSession();
  if (status === 'loading') {
    return (
      <div className="flex min-h-full items-center justify-center p-6">
        <Spinner size={32} />
      </div>
    );
  }
  if (status === 'organizer') return <Navigate to="/eventos" replace />;
  return (
    <Lazy>
      <PublicHome />
    </Lazy>
  );
}

function OrganizerArea() {
  const { signOut } = useSession();
  return (
    <RequireOrganizer>
      <Layout onLogout={() => void signOut()} />
    </RequireOrganizer>
  );
}

export const routes: RouteObject[] = [
  { path: '/', element: <Home />, errorElement: <RouteErrorBoundary /> },
  {
    path: '/entrar',
    element: (
      <Lazy>
        <LoginPage />
      </Lazy>
    ),
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: '/trocar-senha',
    element: (
      <Lazy>
        <ChangePasswordPage />
      </Lazy>
    ),
    errorElement: <RouteErrorBoundary />,
  },
  {
    element: <OrganizerArea />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        path: '/eventos',
        element: (
          <Lazy>
            <EventsPage />
          </Lazy>
        ),
      },
      {
        path: '/eventos/:eventId',
        element: (
          <Lazy>
            <EventLayout />
          </Lazy>
        ),
        children: [
          { index: true, element: <Navigate to="geral" replace /> },
          {
            path: 'geral',
            element: (
              <Lazy>
                <EventGeneralTab />
              </Lazy>
            ),
          },
          {
            path: 'provas',
            element: (
              <Lazy>
                <RacesTab />
              </Lazy>
            ),
          },
          {
            path: 'inscricoes',
            element: (
              <Lazy>
                <EntriesTab />
              </Lazy>
            ),
          },
          {
            path: 'cronometragem',
            element: (
              <Lazy>
                <TimingTab />
              </Lazy>
            ),
          },
          {
            path: 'revisao',
            element: (
              <Lazy>
                <ReviewTab />
              </Lazy>
            ),
          },
          {
            path: 'resultados',
            element: (
              <Lazy>
                <ResultsTab />
              </Lazy>
            ),
          },
        ],
      },
      {
        path: '/atletas',
        element: (
          <Lazy>
            <AthletesPage />
          </Lazy>
        ),
      },
      {
        path: '/atletas/:athleteId',
        element: (
          <Lazy>
            <AthleteProfilePage />
          </Lazy>
        ),
      },
      {
        path: '/ajuda',
        element: (
          <Lazy>
            <HelpPage />
          </Lazy>
        ),
      },
      {
        path: '/config',
        element: (
          <Lazy>
            <SettingsPage />
          </Lazy>
        ),
      },
    ],
  },
  {
    path: '/c/:token',
    element: (
      <Lazy>
        <TimekeeperRoute />
      </Lazy>
    ),
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: '/p/:slug',
    element: (
      <Lazy>
        <PublicEventPage />
      </Lazy>
    ),
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: '/atleta/:athleteId',
    element: (
      <Lazy>
        <PublicAthletePage />
      </Lazy>
    ),
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: '*',
    element: (
      <Lazy>
        <NotFound />
      </Lazy>
    ),
  },
];

const router = createHashRouter(routes);

export default function App() {
  return <RouterProvider router={router} />;
}
