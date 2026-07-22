/**
 * Normaliza un error de `HttpClient` a `{ code, message, status }` SIN destruir
 * la metadata del backend.
 *
 * El body estructurado del backend vive en `err.error`
 * (`{ statusCode, error_code, message }`), NO en `err.message` — este último es
 * el string genérico de Angular (`"Http failure response for <url>: 400 ..."`).
 *
 * Regla del contrato de errores (ver memoria `reference_service_swallows_httperror`):
 * los servicios deben re-lanzar el `HttpErrorResponse` CRUDO
 * (`catchError((e) => throwError(() => e))`) y dejar que el componente use este
 * helper para decidir qué mostrar. Aplastar el error a `new Error(msg)` en el
 * servicio destruye `error_code`/`status` y rompe cualquier ramificación por código.
 *
 * Caso `responseType: 'blob'` (p.ej. descarga de PDF): `err.error` es un `Blob`
 * sin `error_code`/`message` parseables, así que `code` queda `undefined` y
 * `message` cae al genérico de Angular — comportamiento esperado.
 */
export interface ApiErrorInfo {
  /** `error_code` del backend (p.ej. `DISPATCH_NOTE_NO_SHIPPING_ADDRESS`). */
  code?: string;
  /** Mensaje de negocio del backend, con fallback al mensaje genérico. */
  message?: string;
  /** Status HTTP (p.ej. 400, 403, 409). */
  status?: number;
}

export function extractApiError(err: unknown): ApiErrorInfo {
  const e = err as {
    error?: { error_code?: string; message?: string } | unknown;
    message?: string;
    status?: number;
  };
  const body = (e?.error ?? {}) as { error_code?: string; message?: string };
  return {
    code: body?.error_code,
    message: body?.message ?? e?.message,
    status: e?.status,
  };
}
