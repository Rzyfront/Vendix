import { Role } from '../interfaces/role.interface';

/**
 * Rol de los clientes finales de las tiendas. Debe coincidir con
 * `CUSTOMER_ROLE_NAME` del backend (`common/utils/vendix-user.util.ts`).
 */
export const CUSTOMER_ROLE_NAME = 'customer';

/**
 * Roles que el Super Admin puede asignar. El Super Admin administra usuarios
 * de Vendix (el personal de organizaciones y tiendas): el rol `customer` es lo
 * que convierte a alguien en cliente final, así que no se ofrece. El backend
 * lo rechaza igual (`SUP_ADMIN_ROLE_002`); quitar un `customer` existente
 * sigue permitido.
 */
export function isSuperadminAssignableRole(role: Pick<Role, 'name'>): boolean {
  return role.name !== CUSTOMER_ROLE_NAME;
}
