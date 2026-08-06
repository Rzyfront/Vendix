import { UserRole } from '../../auth/enums/user-role.enum';

/**
 * Capacidades que la consola de tenants publica en el perfil.
 *
 * Las claves son literalmente los nombres de permiso sembrados en
 * `permissions-roles.seed.ts`, no un vocabulario paralelo. Un segundo
 * vocabulario obligaría a mantener un mapa entre ambos, y el día que se
 * desincronice la UI mostraría un botón que el backend rechaza con 403 —o, peor,
 * escondería uno que sí está autorizado y nadie sabría por qué.
 */
export const TENANT_CAPABILITY_NAMES = [
  'superadmin:tenants:read',
  'superadmin:tenants:dian:read',
  'superadmin:tenants:dian:write',
  'superadmin:tenants:dian:certificate:write',
  'superadmin:tenants:dian:promote',
  'superadmin:tenants:resolutions:read',
  'superadmin:tenants:resolutions:write',
  'superadmin:tenants:settings:read',
  'superadmin:tenants:settings:write',
] as const;

export type TenantCapabilities = Record<string, boolean>;

interface ActorPermission {
  name?: string;
  status?: string;
}

export interface CapabilityActor {
  roles?: string[];
  permissions?: ActorPermission[];
}

/**
 * Traduce los permisos del ACTOR —no los del tenant— a la forma que consume la
 * UI (`capabilities[nombre] === true`).
 *
 * El bypass de `super_admin` se replica aquí a propósito: `PermissionsGuard`
 * (`:35-37`) devuelve `true` sin mirar la lista cuando el rol está presente, así
 * que derivar la UI únicamente de `permissions[]` pintaría la consola entera en
 * solo lectura para el mismo usuario al que el backend le acepta cada escritura.
 * Esa divergencia es la que deja la pantalla inservible sin que falle nada.
 *
 * Se calcula sobre el actor y no sobre el tenant porque la pregunta que responde
 * es "¿puede ESTE operador pulsar este botón?". Lo que el tenant admite por su
 * alcance fiscal ya lo resuelve `TenantContextRunner`, que fuerza el
 * `store_id` correcto o responde 400.
 */
export function buildTenantCapabilities(
  actor: CapabilityActor | undefined,
): TenantCapabilities {
  const isSuperAdmin = Boolean(actor?.roles?.includes(UserRole.SUPER_ADMIN));

  const granted = new Set(
    (actor?.permissions ?? [])
      .filter((permission) => permission?.status === 'active')
      .map((permission) => permission?.name)
      .filter((name): name is string => typeof name === 'string'),
  );

  return TENANT_CAPABILITY_NAMES.reduce<TenantCapabilities>((acc, name) => {
    acc[name] = isSuperAdmin || granted.has(name);
    return acc;
  }, {});
}
