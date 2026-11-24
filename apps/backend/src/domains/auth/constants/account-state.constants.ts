import type { user_state_enum } from '@prisma/client';

/**
 * QUI-1045 — Estados de cuenta que no pueden iniciar, renovar ni cambiar de
 * sesión. `inactive` es la desactivación que hace el administrador desde el
 * panel y se trata igual que `suspended` y `archived`.
 */
export const SESSION_BLOCKED_USER_STATES: readonly user_state_enum[] = [
  'inactive',
  'suspended',
  'archived',
];

/**
 * QUI-1045 — Únicos estados que reciben y pueden usar un enlace de
 * recuperación de contraseña. `pending_verification` sigue permitido: dueños,
 * empleados y clientes creados por terceros fijan así su primera clave.
 */
export const PASSWORD_RECOVERY_USER_STATES: readonly user_state_enum[] = [
  'active',
  'pending_verification',
];

export function isSessionBlockedState(
  state: string | null | undefined,
): boolean {
  return SESSION_BLOCKED_USER_STATES.includes(state as user_state_enum);
}

export function canRecoverPassword(state: string | null | undefined): boolean {
  return PASSWORD_RECOVERY_USER_STATES.includes(state as user_state_enum);
}
