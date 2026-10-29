import { HttpErrorResponse } from '@angular/common/http';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';

/** Shown when the request never reached the API (offline, server down). */
export const NETWORK_ERROR_MESSAGE = 'Sin conexión con el servidor. Revisa tu conexión e inténtalo de nuevo.';

/**
 * One user-facing text for any Hospitality API failure (R-FB-01): Spanish,
 * never `[object Object]` nor the browser's "Failed to fetch".
 */
export function hospitalityErrorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse && error.status === 0) return NETWORK_ERROR_MESSAGE;
  return extractApiErrorMessage(error);
}
