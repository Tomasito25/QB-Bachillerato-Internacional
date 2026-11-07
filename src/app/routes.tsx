import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { Spinner } from '@/ui/Surface';
import { ErrorPage, NotFound } from './ErrorPage';
import { Layout } from './Layout';

/** Carga diferida: cada pantalla es un trozo aparte, y el Service Worker los guarda todos. */
function page(load: () => Promise<{ default: React.ComponentType }>): Pick<RouteObject, 'lazy'> {
  return { lazy: async () => ({ Component: (await load()).default }) };
}

export const router = createBrowserRouter(
  [
    {
      element: <Layout />,
      errorElement: <ErrorPage />,
      HydrateFallback: Spinner,
      children: [
        {
          errorElement: <ErrorPage />,
          children: [
            { path: '/', ...page(() => import('@/features/dashboard/DashboardPage')) },
            { path: '/explore', ...page(() => import('@/features/explore/ExplorePage')) },
            { path: '/explore/:subjectId', ...page(() => import('@/features/explore/SubjectPage')) },
            { path: '/bank', ...page(() => import('@/features/bank/BankPage')) },
            { path: '/q/:id', ...page(() => import('@/features/bank/QuestionDetailPage')) },
            { path: '/q/:id/edit', ...page(() => import('@/features/editor/EditorPage')) },
            { path: '/create', ...page(() => import('@/features/editor/EditorPage')) },
            { path: '/subjects', ...page(() => import('@/features/taxonomy/TaxonomyPage')) },
            { path: '/study', ...page(() => import('@/features/study/StudyPage')) },
            { path: '/study/session/:id', ...page(() => import('@/features/study/SessionPage')) },
            { path: '/study/session/:id/results', ...page(() => import('@/features/study/ResultsPage')) },
            { path: '/stats', ...page(() => import('@/features/stats/StatsPage')) },
            { path: '/sync', ...page(() => import('@/features/sync/SyncPage')) },
            { path: '/profile', ...page(() => import('@/features/profile/ProfilePage')) },
            { path: '/u/:login', ...page(() => import('@/features/profile/ProfilePage')) },
            { path: '/friends', ...page(() => import('@/features/friends/FriendsPage')) },
            { path: '/leaderboards', ...page(() => import('@/features/leaderboards/LeaderboardsPage')) },
            { path: '/competitions', ...page(() => import('@/features/competitions/CompetitionsPage')) },
            { path: '/competitions/new', ...page(() => import('@/features/competitions/NewCompetitionPage')) },
            { path: '/competitions/:id', ...page(() => import('@/features/competitions/CompetitionDetailPage')) },
            { path: '/settings', ...page(() => import('@/features/settings/SettingsPage')) },
            { path: '/guide', ...page(() => import('@/features/guide/GuidePage')) },
            { path: '*', element: <NotFound /> },
          ],
        },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' },
);
