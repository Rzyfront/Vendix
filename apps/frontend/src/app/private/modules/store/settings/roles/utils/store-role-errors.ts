import {
  ERROR_MESSAGES,
  DEFAULT_ERROR_MESSAGE,
} from '../../../../../../core/utils/error-messages';

/**
 * QUI-72 — El controlador de roles de tienda dejó de degradar excepciones a
 * `200 { success:false }`: ahora emite 403/404/409 reales con `error_code`.
 *
 * Los códigos `ROLE_SCOPE_*` / `ROLE_ASSIGN_*` todavía NO están en el catálogo
 * global `core/utils/error-messages.ts` (fuera del alcance de este módulo), así
 * que se traducen aquí y se cae al catálogo global cuando el código sí existe.
 */
const STORE_ROLE_ERROR_MESSAGES: Record<string, string> = {
  ROLE_SCOPE_001:
    'Este rol es de sólo lectura en la tienda: se administra desde el nivel que lo creó.',
  ROLE_SCOPE_002:
    'No se pudo resolver la organización del contexto. Vuelve a iniciar sesión.',
  ROLE_SCOPE_003:
    'No se pudo resolver la tienda del contexto. Vuelve a iniciar sesión.',
  ROLE_SCOPE_004: 'El rol no existe o no es visible en esta tienda.',
  ROLE_ASSIGN_001:
    'Este rol no se puede asignar a un usuario fuera de su organización.',
  ROLE_ASSIGN_002: 'Este rol del núcleo no se administra desde esta pantalla.',
  ROLE_ASSIGN_003:
    'Los roles de sistema sólo los asigna el administrador de la plataforma.',
  ROLE_ASSIGN_004:
    'La asignación no existe en esta tienda. Si el rol es heredado de la organización, quítalo desde el panel de la organización.',
  ROLE_ASSIGN_005: 'El usuario ya tiene este rol asignado en esta tienda.',
  ROLE_ASSIGN_006: 'El usuario no pertenece a esta tienda.',
  ROLE_ASSIGN_007:
    'La tienda de la asignación no corresponde a la organización del rol.',
};

/**
 * Traduce un error HTTP de los endpoints de roles a un mensaje mostrable.
 *
 * Prioridad: mapa local → catálogo global → `message` del backend → fallback.
 * NO se apoya en `success: false`, que ya no existe para estos endpoints.
 */
export function storeRoleErrorMessage(error: unknown, fallback: string): string {
  const body = (error as { error?: unknown })?.error ?? error;
  const typed = body as
    | { error_code?: string; message?: string }
    | null
    | undefined;

  const code = typed?.error_code;
  if (code) {
    const local = STORE_ROLE_ERROR_MESSAGES[code];
    if (local) return local;
    const global = ERROR_MESSAGES[code];
    if (global && global !== DEFAULT_ERROR_MESSAGE) return global;
  }

  return typed?.message || fallback;
}
