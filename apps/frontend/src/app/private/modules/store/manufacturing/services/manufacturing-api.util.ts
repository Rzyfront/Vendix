import { Observable, throwError } from 'rxjs';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  meta?: unknown;
}

export interface PaginatedApiResponse<T> {
  success: boolean;
  data: T[];
  message?: string;
  meta: {
    pagination: {
      total: number;
      page: number;
      limit: number;
      pages?: number;
    };
  };
}

/**
 * Convierte un HttpErrorResponse en un mensaje UX en español (string), igual
 * que `ProductionOrdersService`. Los consumidores lo reciben como `error`.
 */
export function handleManufacturingError(
  error: any,
  fallback = 'Error al procesar la solicitud',
): Observable<never> {
  let message = fallback;
  const apiMessage = error?.error?.message;
  if (apiMessage) {
    message =
      typeof apiMessage === 'string'
        ? apiMessage
        : Array.isArray(apiMessage)
          ? apiMessage.join(', ')
          : message;
  } else if (error?.status === 401) {
    message = 'No autorizado';
  } else if (error?.status === 403) {
    message = 'No tienes permisos suficientes';
  } else if (error?.status === 404) {
    message = 'Registro no encontrado';
  } else if (typeof error?.status === 'number' && error.status >= 500) {
    message = 'Error del servidor. Inténtalo más tarde';
  }
  return throwError(() => message);
}
