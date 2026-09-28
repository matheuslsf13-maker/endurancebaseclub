import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { PubStatsPayload } from '../../lib/types';

/** Spec 2026-09-28 §4.3: the one public bundle behind the athletes directory, the profiles, "Nós
 * dois" and the rankings — fetched once, fresh for 5 minutes, refetched when the tab regains focus
 * (results only change when the organizer finalizes a race). */
export function usePublicStats(): UseQueryResult<PubStatsPayload> {
  return useQuery({ queryKey: ['pub-stats'], queryFn: () => api.pub.stats(), staleTime: 5 * 60_000, refetchOnWindowFocus: true });
}
