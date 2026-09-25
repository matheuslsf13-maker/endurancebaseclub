import { ApiError } from '../../lib/api';

/** The pt-BR message to show for any `api` failure: `ApiError.message` (already pt-BR) or a
 * generic fallback for anything else thrown. Shared by every panel of the Timing tab. */
export function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Erro inesperado';
}
