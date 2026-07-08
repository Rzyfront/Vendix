/**
 * Espejo de apps/frontend/src/app/private/modules/store/customers/utils/customer-error.translator.ts
 *
 * Traductor de errores backend → mensajes user-facing en español.
 * Mantiene la misma lógica que web: códigos CUST_*, SYS_* y CUSTOMER_DOCUMENT_*
 * mapean a strings consistentes entre plataformas (paridad verbatim).
 *
 * Uso:
 *   import { translateCustomerError } from '@/features/store/utils/customer-error.translator';
 *   const message = translateCustomerError(err, 'No se pudo guardar el cliente');
 */

// Códigos del backend (apps/backend/src/common/errors/error-codes.ts)
const ERROR_CODE_MESSAGES: Record<string, string> = {
  // Customers domain
  CUST_FIND_001: 'No se encontró el cliente',
  CUST_CREATE_001: 'No se pudo crear el cliente. Revisa los datos.',
  CUST_VALIDATE_001: 'Datos del cliente inválidos. Revisa los campos marcados.',
  CUST_PERM_001: 'No tienes permisos para acceder a este cliente',
  CUST_BULK_001: 'El archivo excede el límite de filas permitido',
  CUST_BULK_002: 'Algunas filas del archivo no son válidas',
  CUST_BULK_003: 'Hay correos duplicados en el archivo',
  CUST_BULK_004: 'Se requiere contexto de tienda para la carga masiva',

  // System
  SYS_CONFLICT_001: 'Ya existe un cliente con este documento en la organización',
  SYS_VALIDATION_001: 'Datos del formulario inválidos. Revisa los campos marcados.',
  SYS_NOT_FOUND_001: 'No se encontró el recurso solicitado',
  SYS_FORBIDDEN_001: 'No tienes permisos para realizar esta acción',
  SYS_UNAUTHORIZED_001: 'Tu sesión expiró. Vuelve a iniciar sesión.',
  SYS_INTERNAL_001: 'Error del servidor. Inténtalo de nuevo en un momento.',

  // Legacy codes (compatibilidad con backend viejo)
  CUSTOMER_DOCUMENT_DUPLICATE: 'Ya existe un cliente con este documento',
  CUSTOMER_DOCUMENT_INVALID: 'Datos del documento inválidos. Revisa el tipo y número.',
};

interface ApiErrorPayload {
  success?: boolean;
  data?: unknown;
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
    fields?: string[];
  };
  message?: string | string[];
  fields?: string[];
  statusCode?: number;
}

interface TranslatedError {
  message: string;
  code?: string;
}

/**
 * Extrae el código de error del payload de la API.
 * Soporta tanto el formato nuevo (`error.code`) como el legacy (`code` directo).
 */
function extractErrorCode(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const p = payload as ApiErrorPayload;
  return p.error?.code ?? (p as unknown as { code?: string }).code;
}

/**
 * Extrae el mensaje del payload (puede ser string o array).
 */
function extractMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const p = payload as ApiErrorPayload;
  if (typeof p.message === 'string') return p.message;
  if (Array.isArray(p.message) && p.message.length > 0) return p.message[0];
  if (typeof p.error?.message === 'string') return p.error.message;
  return undefined;
}

/**
 * Detecta si el error involucra campos document_type o document_number.
 */
function hasDocumentFields(fields: unknown): boolean {
  if (!Array.isArray(fields)) return false;
  return fields.some(
    (f) => typeof f === 'string' && /document/i.test(f),
  );
}

/**
 * Traduce un error del backend a un mensaje user-facing en español.
 *
 * Reglas (mirror web):
 * 1. Si el código del error está en ERROR_CODE_MESSAGES, usar el mensaje del mapa.
 * 2. Special: SYS_VALIDATION_001 / CUST_VALIDATE_001 + campos de documento → "Datos del documento inválidos..."
 * 3. Special: HTTP 409 → mensaje de documento duplicado.
 * 4. Special: HTTP 404 → "No se encontró el cliente".
 * 5. Special: HTTP 400/422 con campos de documento → mensaje de documento.
 * 6. Special: HTTP 403 → permisos.
 * 7. Special: HTTP 401 → sesión expirada.
 * 8. Special: HTTP >=500 → error del servidor.
 * 9. Fallback: "Ocurrió un error. Inténtalo de nuevo."
 *
 * @param err - Axios error u objeto error cualquiera
 * @param fallback - Mensaje por defecto si no se puede traducir
 * @returns TranslatedError { message, code? }
 */
export function translateCustomerError(
  err: unknown,
  fallback = 'Ocurrió un error. Inténtalo de nuevo.',
): TranslatedError {
  if (!err) return { message: fallback };

  // Extraer payload y status code
  const anyErr = err as {
    response?: { data?: unknown; status?: number; statusCode?: number };
    status?: number;
    statusCode?: number;
    data?: unknown;
    code?: string;
    message?: string;
  };

  const payload =
    anyErr.response?.data ??
    (anyErr.data !== undefined ? anyErr.data : anyErr);
  const status =
    anyErr.response?.status ??
    anyErr.response?.statusCode ??
    anyErr.status ??
    anyErr.statusCode ??
    0;

  const code = extractErrorCode(payload);
  const fields =
    (payload as ApiErrorPayload)?.error?.fields ??
    (payload as ApiErrorPayload)?.fields;
  const apiMessage = extractMessage(payload);

  // 1. Known code → message from map
  if (code && ERROR_CODE_MESSAGES[code]) {
    let message = ERROR_CODE_MESSAGES[code];
    // 2. Special: validation error with document fields
    if (
      (code === 'SYS_VALIDATION_001' || code === 'CUST_VALIDATE_001') &&
      hasDocumentFields(fields)
    ) {
      message = 'Datos del documento inválidos. Revisa el tipo y número.';
    }
    return { message, code };
  }

  // 3-8. Status code based fallbacks
  if (status === 409) {
    return {
      message: 'Ya existe un cliente con este documento',
      code,
    };
  }
  if (status === 404) {
    return { message: 'No se encontró el cliente', code };
  }
  if (status === 400 || status === 422) {
    if (hasDocumentFields(fields) || /document/i.test(apiMessage ?? '')) {
      return {
        message: 'Datos del documento inválidos. Revisa el tipo y número.',
        code,
      };
    }
    return {
      message:
        apiMessage && typeof apiMessage === 'string'
          ? apiMessage
          : 'Datos del formulario inválidos. Revisa los campos marcados.',
      code,
    };
  }
  if (status === 403) {
    return { message: 'No tienes permisos para realizar esta acción', code };
  }
  if (status === 401) {
    return { message: 'Tu sesión expiró. Vuelve a iniciar sesión.', code };
  }
  if (status >= 500) {
    return { message: 'Error del servidor. Inténtalo de nuevo en un momento.', code };
  }

  // 9. Final fallback
  return {
    message: apiMessage && typeof apiMessage === 'string' ? apiMessage : fallback,
    code,
  };
}

/**
 * Re-export para compatibilidad con consumidores que importaban
 * `translateCustomerError` desde web customer-modal.component.ts.
 */
export { ERROR_CODE_MESSAGES as CUSTOMER_ERROR_MESSAGES };