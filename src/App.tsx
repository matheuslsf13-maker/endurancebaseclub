import { createHashRouter, Navigate, RouterProvider } from 'react-router';
import type { RouteObject } from 'react-router';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { useSession } from './features/auth/session';
import LoginPage from './features/auth/LoginPage';
import ChangePasswordPage from './features/auth/ChangePasswordPage';
import RequireOrganizer from './features/auth/RequireOrganizer';
import EventsPage from './features/events/EventsPage';
import EventLayout from './features/events/EventLayout';
import EventGeneralTab from './features/events/EventGeneralTab';
import RacesTab from './features/races/RacesTab';
import EntriesTab from './features/entries/EntriesTab';
import TimingTab from './features/timing/TimingTab';
import ReviewTab from './features/review/ReviewTab';
import ResultsTab from './features/results/ResultsTab';
import AthletesPage from './features/athletes/AthletesPage';
import AthleteProfilePage from './features/athletes/AthleteProfilePage';
import HelpPage from './features/help/HelpPage';
import SettingsPage from './features/settings/SettingsPage';
import TimekeeperPage from './features/timekeeper/TimekeeperPage';
import PublicHome from './features/public/PublicHome';
import PublicEventPage from './features/public/PublicEventPage';
import PublicAthletePage from './features/public/PublicAthletePage';
import NotFound from './features/NotFound';

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
  return <PublicHome />;
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
  { path: '/entrar', element: <LoginPage /> },
  { path: '/trocar-senha', element: <ChangePasswordPage /> },
  {
    element: <OrganizerArea />,
    children: [
      { path: '/eventos', element: <EventsPage /> },
      {
        path: '/eventos/:eventId',
        element: <EventLayout />,
        children: [
          { index: true, element: <Navigate to="geral" replace /> },
          { path: 'geral', element: <EventGeneralTab /> },
          { path: 'provas', element: <RacesTab /> },
          { path: 'inscricoes', element: <EntriesTab /> },
          { path: 'cronometragem', element: <TimingTab /> },
          { path: 'revisao', element: <ReviewTab /> },
          { path: 'resultados', element: <ResultsTab /> },
        ],
      },
      { path: '/atletas', element: <AthletesPage /> },
      { path: '/atletas/:athleteId', element: <AthleteProfilePage /> },
      { path: '/ajuda', element: <HelpPage /> },
      { path: '/config', element: <SettingsPage /> },
    ],
  },
  { path: '/c/:token', element: <TimekeeperPage /> },
  { path: '/p/:slug', element: <PublicEventPage /> },
  { path: '/atleta/:athleteId', element: <PublicAthletePage /> },
  { path: '*', element: <NotFound /> },
];

const router = createHashRouter(routes);

export default function App() {
  return <RouterProvider router={router} />;
}
