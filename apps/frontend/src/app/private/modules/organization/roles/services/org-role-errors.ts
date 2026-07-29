import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';

/**
 * QUI-72 — mensaje mostrable para los errores del dominio de roles.
 *
 * Desde que el controlador dejó de degradar las excepciones a
 * `200 { success: false }`, el frontend recibe 403/404/409 reales con
 * `error_code`. La traducción de `ROLE_SCOPE_*` / `ROLE_ASSIGN_*` vive en el
 * catálogo GLOBAL (`core/utils/error-messages.ts`), compartido por los tres
 * niveles de roles: aquí NO se duplica ningún texto, sólo se añade un fallback
 * accionable cuando el backend no manda código tipado (fallo de red, 5xx).
 */
export function getRoleErrorCode(error: unknown): string | null {
  const body = (error as { error?: unknown })?.error ?? error;
  const code = (body as { error_code?: unknown })?.error_code;
  return typeof code === 'string' ? code : null;
}

export function extractRoleErrorMessage(
  error: unknown,
  fallback = 'No se pudo completar la operación',
): string {
  const generic = extractApiErrorMessage(error);
  if (!generic || generic === 'Error desconocido') {
    return fallback;
  }
  return generic;
}
