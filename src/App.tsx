import { lazy, Suspense } from 'react';
import type { ReactNode } from 'react';
import { createHashRouter, Navigate, RouterProvider } from 'react-router';
import type { RouteObject } from 'react-router';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { useSession } from './features/auth/session';
import RequireOrganizer from './features/auth/RequireOrganizer';

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
  { path: '/', element: <Home /> },
  {
    path: '/entrar',
    element: (
      <Lazy>
        <LoginPage />
      </Lazy>
    ),
  },
  {
    path: '/trocar-senha',
    element: (
      <Lazy>
        <ChangePasswordPage />
      </Lazy>
    ),
  },
  {
    element: <OrganizerArea />,
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
        <TimekeeperPage />
      </Lazy>
    ),
  },
  {
    path: '/p/:slug',
    element: (
      <Lazy>
        <PublicEventPage />
      </Lazy>
    ),
  },
  {
    path: '/atleta/:athleteId',
    element: (
      <Lazy>
        <PublicAthletePage />
      </Lazy>
    ),
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
