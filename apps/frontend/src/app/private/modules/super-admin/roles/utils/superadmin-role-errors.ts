import {
  ERROR_MESSAGES,
  DEFAULT_ERROR_MESSAGE,
} from '../../../../../core/utils/error-messages';

/**
 * QUI-72 — Traducción de los errores tipados que emiten los endpoints de roles
 * de superadmin.
 *
 * Los códigos `ROLE_SCOPE_*` / `ROLE_ASSIGN_*` todavía NO viven en el catálogo
 * global `core/utils/error-messages.ts`; se traducen aquí y se cae al catálogo
 * global cuando el código sí existe (`SYS_VALIDATION_001`,
 * `SUP_ADMIN_PERM_001`). Los textos son los del nivel PLATAFORMA: a diferencia
 * del panel de tienda, aquí el actor sí puede administrar los tres alcances, de
 * modo que un 403 significa una guarda de negocio, no falta de permisos.
 */
const SUPERADMIN_ROLE_ERROR_MESSAGES: Record<string, string> = {
  ROLE_SCOPE_001: 'Este rol no admite la edición solicitada.',
  ROLE_SCOPE_002: 'No se pudo resolver la organización del rol.',
  ROLE_SCOPE_003: 'No se pudo resolver la tienda de la asignación.',
  ROLE_SCOPE_004: 'El rol no existe.',
  ROLE_ASSIGN_001:
    'El rol pertenece a otra organización: sólo se puede asignar a usuarios de esa organización.',
  ROLE_ASSIGN_002: 'Este rol del núcleo no se administra desde esta pantalla.',
  ROLE_ASSIGN_003:
    'Los roles de sistema sólo los asigna el administrador de la plataforma.',
  ROLE_ASSIGN_004:
    'La asignación no existe con ese alcance. Verifica si es org-wide o de una tienda concreta.',
  ROLE_ASSIGN_005: 'El usuario ya tiene este rol con ese alcance.',
  ROLE_ASSIGN_006: 'El usuario no existe o no es válido para este rol.',
  ROLE_ASSIGN_007:
    'La tienda de la asignación no corresponde a la organización del rol.',
  SUP_ADMIN_ROLE_001: 'El rol no existe.',
  SUP_ADMIN_PERM_001:
    'Los roles núcleo (owner, super_admin) sólo admiten cambiar la descripción: se resuelven por nombre en seeds y guards.',
  SYS_VALIDATION_001:
    'El alcance elegido no es coherente: un rol de sistema no puede tener organización ni tienda, y una tienda exige su organización.',
};

/**
 * Traduce un error HTTP de los endpoints de roles a un mensaje mostrable.
 *
 * Prioridad: mapa local → catálogo global → `message` del backend → fallback.
 */
export function superadminRoleErrorMessage(
  error: unknown,
  fallback: string,
): string {
  const body = (error as { error?: unknown })?.error ?? error;
  const typed = body as
    | { error_code?: string; message?: string }
    | null
    | undefined;

  const code = typed?.error_code;
  if (code) {
    const local = SUPERADMIN_ROLE_ERROR_MESSAGES[code];
    if (local) return local;
    const global = ERROR_MESSAGES[code];
    if (global && global !== DEFAULT_ERROR_MESSAGE) return global;
  }

  return typed?.message || fallback;
}
