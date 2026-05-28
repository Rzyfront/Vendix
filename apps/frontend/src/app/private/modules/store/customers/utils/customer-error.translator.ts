import { HttpErrorResponse } from '@angular/common/http';

/**
 * Traductor centralizado de errores HTTP del módulo de clientes a mensajes
 * en español listos para mostrar en toasts.
 *
 * Vendix backend response shape (ver `AllExceptionsFilter`):
 *   {
 *     statusCode: number,
 *     error_code?: string,      // p.ej. 'SYS_CONFLICT_001', 'CUST_FIND_001'
 *     message: string,
 *     details?: any,
 *     timestamp: string,
 *     path: string
 *   }
 *
 * Códigos relevantes (ver `apps/backend/src/common/errors/error-codes.ts`):
 *   - SYS_CONFLICT_001       (409) -> documento duplicado en organización
 *   - SYS_VALIDATION_001     (422) -> validación de DTO (class-validator)
 *   - SYS_NOT_FOUND_001      (404) -> recurso no encontrado
 *   - SYS_FORBIDDEN_001      (403) -> acceso denegado
 *   - SYS_UNAUTHORIZED_001   (401) -> sesión expirada
 *   - SYS_INTERNAL_001       (500) -> error interno
 *   - CUST_FIND_001          (404) -> cliente no encontrado
 *   - CUST_CREATE_001        (400) -> error creando cliente
 *   - CUST_VALIDATE_001      (400) -> validación de cliente falló
 *   - CUST_PERM_001          (403) -> acceso denegado al cliente
 *   - CUST_BULK_001..004     (400/409) -> errores de bulk upload
 */

type AnyError =
  | HttpErrorResponse
  | { status?: number; error?: any; message?: string }
  | unknown;

const ERROR_CODE_MESSAGES: Record<string, string> = {
  // Customers domain
  CUST_FIND_001: 'No se encontró el cliente',
  CUST_CREATE_001: 'No se pudo crear el cliente. Revisa los datos.',
  CUST_VALIDATE_001:
    'Datos del cliente inválidos. Revisa los campos marcados.',
  CUST_PERM_001: 'No tienes permisos para acceder a este cliente',
  CUST_BULK_001: 'El archivo excede el límite de filas permitido',
  CUST_BULK_002: 'Algunas filas del archivo no son válidas',
  CUST_BULK_003: 'Hay correos duplicados en el archivo',
  CUST_BULK_004: 'Se requiere contexto de tienda para la carga masiva',

  // System (used by customers domain)
  SYS_CONFLICT_001:
    'Ya existe un cliente con este documento en la organización',
  SYS_VALIDATION_001:
    'Datos del formulario inválidos. Revisa los campos marcados.',
  SYS_NOT_FOUND_001: 'No se encontró el recurso solicitado',
  SYS_FORBIDDEN_001: 'No tienes permisos para realizar esta acción',
  SYS_UNAUTHORIZED_001: 'Tu sesión expiró. Vuelve a iniciar sesión.',
  SYS_INTERNAL_001:
    'Error del servidor. Inténtalo de nuevo en un momento.',

  // Legacy/granular codes that may appear from older endpoints
  CUSTOMER_DOCUMENT_DUPLICATE: 'Ya existe un cliente con este documento',
  CUSTOMER_DOCUMENT_INVALID:
    'Datos del documento inválidos. Revisa el tipo y número.',
};

/**
 * Traduce un error HTTP a un mensaje en español listo para mostrar al usuario.
 *
 * @param err Error capturado por RxJS / HttpClient (HttpErrorResponse o similar).
 * @param fallback Mensaje a usar cuando no se puede mapear el error a una copia conocida.
 * @returns Mensaje en español.
 */
export function translateCustomerError(
  err: AnyError,
  fallback = 'Ocurrió un error. Inténtalo de nuevo.',
): string {
  if (!err) return fallback;
  const e = err as any;

  // Vendix backend shape: HttpErrorResponse.error = { statusCode, error_code, message, details }
  const status: number | undefined =
    typeof e?.status === 'number' ? e.status : e?.error?.statusCode;

  const code: string | undefined =
    typeof e?.error?.error_code === 'string'
      ? e.error.error_code
      : typeof e?.error?.code === 'string'
        ? e.error.code
        : typeof e?.error?.error?.code === 'string'
          ? e.error.error.code
          : undefined;

  const apiMessage: string | undefined =
    typeof e?.error?.message === 'string'
      ? e.error.message
      : typeof e?.error?.error?.message === 'string'
        ? e.error.error.message
        : undefined;

  const details = e?.error?.details ?? e?.error?.error?.details;
  const fields: string[] = Array.isArray(details?.fields)
    ? details.fields
    : Array.isArray(details)
      ? details
      : [];

  // 1. Specific known codes
  if (code && ERROR_CODE_MESSAGES[code]) {
    // For validation, if the message touches the document fields use a more
    // specific copy regardless of generic mapping.
    if (code === 'SYS_VALIDATION_001' || code === 'CUST_VALIDATE_001') {
      const touchesDocument =
        fields.includes('document_type') ||
        fields.includes('document_number') ||
        (typeof apiMessage === 'string' && /document/i.test(apiMessage));
      if (touchesDocument) {
        return 'Datos del documento inválidos. Revisa el tipo y número.';
      }
    }
    return ERROR_CODE_MESSAGES[code];
  }

  // 2. HTTP-status fallbacks
  if (status === 409) {
    return 'Ya existe un cliente con este documento';
  }
  if (status === 404) {
    return 'No se encontró el cliente';
  }
  if (status === 400 || status === 422) {
    const touchesDocument =
      fields.includes('document_type') ||
      fields.includes('document_number') ||
      (typeof apiMessage === 'string' && /document/i.test(apiMessage));
    if (touchesDocument) {
      return 'Datos del documento inválidos. Revisa el tipo y número.';
    }
    return 'Datos del formulario inválidos. Revisa los campos marcados.';
  }
  if (status === 403) {
    return 'No tienes permisos para realizar esta acción';
  }
  if (status === 401) {
    return 'Tu sesión expiró. Vuelve a iniciar sesión.';
  }
  if (typeof status === 'number' && status >= 500) {
    return 'Error del servidor. Inténtalo de nuevo en un momento.';
  }

  // 3. Last-resort: backend message if it looks like a human sentence (starts with letter)
  if (apiMessage && /^[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(apiMessage)) {
    return apiMessage;
  }

  return fallback;
}
