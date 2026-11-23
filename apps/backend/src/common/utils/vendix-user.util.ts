import { Prisma } from '@prisma/client';

/**
 * Nombre del rol de los clientes finales de las tiendas (compradores de
 * ecommerce, clientes registrados desde el POS, etc.). Canónico contra
 * `apps/backend/prisma/seeds/permissions-roles.seed.ts`.
 */
export const CUSTOMER_ROLE_NAME = 'customer';

/**
 * Regla de negocio: qué es un "usuario de Vendix".
 *
 * Un usuario de Vendix es el personal de las organizaciones y tiendas que
 * usan la plataforma (owner, admin, manager, supervisor, employee, staff,
 * roles personalizados de organización o tienda) y los `super_admin`. Los
 * clientes finales de esas tiendas NO son usuarios de Vendix, aunque vivan en
 * la misma tabla `users`.
 *
 * Criterio: el usuario tiene AL MENOS UN rol (vía `user_roles -> roles`) cuyo
 * nombre no es `customer`. Es el mismo criterio que ya usa el login staff
 * (`auth.service.ts`, filtro A1) y `store-users.service.ts#staffLookup`.
 *
 * - Cliente que además es owner/empleado de una tienda → SÍ cuenta.
 * - Usuario cuyo único rol es `customer` → NO cuenta.
 * - Usuario sin ningún rol → NO cuenta.
 *
 * Todo KPI, gráfica, segmentación o listado del Super Admin que hable de
 * "usuarios" debe filtrar con este fragmento; no repetir la condición en línea.
 *
 * Devuelve un objeto nuevo en cada llamada para que ningún consumidor pueda
 * mutar el criterio compartido al componer su propio `where`.
 */
export function vendixUserWhere(): Prisma.usersWhereInput {
  return {
    user_roles: {
      some: {
        roles: { name: { not: CUSTOMER_ROLE_NAME } },
      },
    },
  };
}

/**
 * Compone el criterio de usuario de Vendix con otro filtro de `users` sin
 * pisar sus claves: el criterio va en un `AND`, así un `where` que ya trae su
 * propio `user_roles` u `OR` (búsqueda) conserva ambos.
 */
export function withVendixUser(
  where: Prisma.usersWhereInput = {},
): Prisma.usersWhereInput {
  return { AND: [vendixUserWhere(), where] };
}
