import type { UseQueryResult } from '@tanstack/react-query';
import { Button, Spinner } from '../../components/ui';
import { ApiError } from '../../lib/api';
import type { PubStatsPayload } from '../../lib/types';

/** Loading spinner or load error (+ "Tentar novamente") of a page built on usePublicStats. */
export function PublicStatsFallback({ query, testId }: { query: UseQueryResult<PubStatsPayload>; testId: string }) {
  return (
    <div data-testid={testId} className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      {query.isError ? (
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="text-sm text-danger-text">
            {query.error instanceof ApiError ? query.error.message : 'Não foi possível carregar os atletas.'}
          </p>
          <Button size="sm" onClick={() => void query.refetch()} loading={query.isFetching}>
            Tentar novamente
          </Button>
        </div>
      ) : (
        <div className="flex justify-center py-16">
          <Spinner size={32} />
        </div>
      )}
    </div>
  );
}
