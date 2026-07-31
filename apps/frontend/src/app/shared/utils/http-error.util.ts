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
 * `message` NUNCA devuelve el texto de transporte de Angular (QUI-559): ese
 * string describe cómo falló el HTTP, no por qué el negocio rechazó la
 * operación, y mostrarlo dejaba al cajero leyendo
 * `"Http failure response for …/store/payments/pos: 409 Conflict"` en lugar de
 * `"Stock insuficiente para X: requiere 10, disponible 8."`. Cuando no hay
 * mensaje de negocio, `message` queda `undefined` a propósito para que el
 * consumidor aplique SU fallback de dominio (`message || 'No se pudo …'`).
 * Esto cubre también el fallo de red (`status === 0`): con `withFetch()` el
 * `TypeError: Failed to fetch` del navegador llega dentro de `err.error` y
 * pasaría por envelope del backend si solo se mirara `.message`.
 *
 * Se prefiere este helper sobre `extractApiErrorMessage`
 * (`core/utils/api-error-handler.ts`) cuando el mensaje del backend es
 * **dinámico**: ese otro camino resuelve por `error_code` contra el catálogo
 * estático `ERROR_MESSAGES` y descarta el texto del backend, así que perdería
 * el nombre del producto y las cantidades del bloqueo de stock.
 *
 * Caso `responseType: 'blob'` (p.ej. descarga de PDF): `err.error` es un `Blob`
 * sin `error_code`/`message` parseables, así que `code` y `message` quedan
 * `undefined` — comportamiento esperado, el consumidor usa su fallback.
 */

/**
 * Textos que describen CÓMO falló la comunicación, nunca por qué el negocio
 * rechazó la operación. Angular arma los dos primeros; el resto los produce el
 * navegador cuando la petición ni siquiera obtiene respuesta (`withFetch()`
 * deja el `TypeError` nativo en `err.error`, y cada motor lo redacta distinto).
 */
const TRANSPORT_MESSAGE_PREFIXES = [
  'Http failure response', // Angular
  'Http failure during parsing', // Angular
  'Failed to fetch', // Chromium
  'NetworkError when attempting to fetch resource', // Firefox
  'Load failed', // Safari
  'The user aborted a request', // abort()
];

/** Forma del envelope de error del backend (`VendixHttpException`). */
interface VendixErrorBody {
  error_code?: string;
  /** `string[]` cuando class-validator rechaza un DTO. */
  message?: string | string[];
  errors?: Array<{ message?: string }>;
}

export interface ApiErrorInfo {
  /** `error_code` del backend (p.ej. `DISPATCH_NOTE_NO_SHIPPING_ADDRESS`). */
  code?: string;
  /** Mensaje de negocio del backend; `undefined` si no hay ninguno utilizable. */
  message?: string;
  /** Status HTTP (p.ej. 400, 403, 409). */
  status?: number;
}

export function extractApiError(err: unknown): ApiErrorInfo {
  const e = err as
    | {
        error?: VendixErrorBody | string | unknown;
        message?: string;
        status?: number;
      }
    | null
    | undefined;

  const status = typeof e?.status === 'number' ? e.status : undefined;
  const raw = e?.error;

  // `status === 0` significa que la petición nunca obtuvo respuesta: red caída,
  // backend reiniciándose, preflight CORS rechazado. No existe mensaje de
  // negocio posible — lo único disponible es la jerga del navegador, que jamás
  // debe llegar al cajero.
  if (status === 0) {
    return { status };
  }

  const body = businessBody(raw);

  return {
    code: typeof body.error_code === 'string' ? body.error_code : undefined,
    message:
      humanText(businessMessage(body)) ??
      // Algunas capas serializan el body antes de re-lanzar.
      humanText(typeof raw === 'string' ? raw : undefined) ??
      // Un `Error` lanzado por una guarda del frontend ya es user-facing; el
      // `message` de un `HttpErrorResponse` no lo es y `humanText` lo descarta.
      humanText(e?.message),
    status,
  };
}

/**
 * El envelope del backend solo puede venir en un objeto plano. Un `Error`
 * (p.ej. el `TypeError: Failed to fetch` que `withFetch()` coloca en
 * `err.error`) tiene `.message`, pero es transporte disfrazado de body.
 */
function businessBody(raw: unknown): VendixErrorBody {
  if (!raw || typeof raw !== 'object' || raw instanceof Error) {
    return {};
  }
  return raw as VendixErrorBody;
}

/** Mensaje de negocio del envelope, resolviendo array y `errors[]` anidado. */
function businessMessage(body: VendixErrorBody): string | undefined {
  const { message } = body;

  if (Array.isArray(message)) {
    const joined = message
      .filter((item): item is string => typeof item === 'string' && !!item.trim())
      .join(' ');
    if (joined) return joined;
  } else if (typeof message === 'string' && message.trim()) {
    return message;
  }

  return body.errors?.find((item) => !!item?.message?.trim())?.message;
}

/** El texto solo si es legible por un humano — nunca la descripción de transporte. */
function humanText(value: string | undefined): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const text = value.trim();
  return TRANSPORT_MESSAGE_PREFIXES.some((prefix) => text.startsWith(prefix))
    ? undefined
    : value;
}
