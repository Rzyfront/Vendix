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

/**
 * Identificador SQL calificado `alias.columna`. Se exige el alias porque el
 * fragmento se incrusta dentro de un subquery con sus propias columnas
 * `user_id`: una columna sin calificar se resolvería contra la tabla interna y
 * el EXISTS dejaría de mirar la fila exterior sin que nada falle.
 */
const QUALIFIED_COLUMN = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/i;
const SQL_ALIAS = /^[a-z_][a-z0-9_]*$/i;

function qualifiedColumn(column: string): Prisma.Sql {
  if (!QUALIFIED_COLUMN.test(column)) {
    throw new Error(
      `vendix-user.util: '${column}' no es una columna calificada (alias.columna)`,
    );
  }
  return Prisma.raw(column);
}

/**
 * Equivalente SQL de {@link vendixUserWhere} para consultas crudas: verdadero
 * cuando el usuario de `userIdColumn` tiene al menos un rol que no es
 * `customer`.
 *
 * `userIdColumn` es un identificador, no un valor, así que no puede viajar
 * como parámetro: se valida contra `alias.columna` y se rechaza cualquier otra
 * cosa. El nombre del rol sí va parametrizado.
 */
export function vendixUserSql(userIdColumn: string): Prisma.Sql {
  const column = qualifiedColumn(userIdColumn);
  return Prisma.sql`EXISTS (SELECT 1 FROM user_roles vu_ur JOIN roles vu_r ON vu_r.id = vu_ur.role_id WHERE vu_ur.user_id = ${column} AND vu_r.name <> ${CUSTOMER_ROLE_NAME})`;
}

/**
 * Regla de negocio: qué eventos de `audit_logs` son actividad del personal.
 *
 * Un evento cuenta si su autor es un usuario de Vendix o si no tiene autor
 * (`user_id` nulo: eventos de sistema, jobs, webhooks), que no son de clientes.
 * Los eventos de clientes finales (registro, cambios de su cuenta, etc.) y los
 * de usuarios sin ningún rol quedan fuera.
 */
export function vendixActorAuditWhere(): Prisma.audit_logsWhereInput {
  return { OR: [{ user_id: null }, { users: vendixUserWhere() }] };
}

/**
 * Añade {@link vendixActorAuditWhere} a un `where` de `audit_logs` sin pisar
 * sus claves: el criterio entra en el `AND` (conservando el que ya traiga), así
 * las claves de primer nivel del filtro original siguen donde estaban.
 */
export function withVendixActor(
  where: Prisma.audit_logsWhereInput = {},
): Prisma.audit_logsWhereInput {
  const existing =
    where.AND === undefined
      ? []
      : Array.isArray(where.AND)
        ? where.AND
        : [where.AND];
  return { ...where, AND: [...existing, vendixActorAuditWhere()] };
}

/**
 * Equivalente SQL de {@link vendixActorAuditWhere} para consultas crudas.
 *
 * Usa `IN (subconsulta sin correlación)` y no el `EXISTS` de
 * {@link vendixUserSql}: dentro de un `OR`, Postgres no convierte un `EXISTS`
 * correlacionado en semi-join y lo evaluaría fila por fila sobre
 * `audit_logs`; la subconsulta sin correlación se resuelve una sola vez
 * (hashed SubPlan), igual que el `IN (SELECT …)` que genera Prisma para
 * {@link vendixActorAuditWhere}.
 */
export function vendixActorAuditSql(userIdColumn: string): Prisma.Sql {
  const column = qualifiedColumn(userIdColumn);
  return Prisma.sql`(${column} IS NULL OR ${column} IN (SELECT vu_ur.user_id FROM user_roles vu_ur JOIN roles vu_r ON vu_r.id = vu_ur.role_id WHERE vu_r.name <> ${CUSTOMER_ROLE_NAME}))`;
}

/**
 * Regla de negocio: qué filas de `login_attempts` son inicios de sesión del
 * personal.
 *
 * `login_attempts` no guarda `user_id`, solo `email` y `store_id`, y el login
 * de cliente (`loginCustomer`, `registerCustomer`) escribe la fila con la misma
 * forma que el de personal. La única señal es el correo, y un mismo correo
 * puede ser cliente en una organización y personal en otra. Por eso el intento
 * cuenta solo si su correo es de un usuario de Vendix DE LA ORGANIZACIÓN de la
 * tienda; si la fila no tiene tienda, basta un usuario de Vendix cualquiera.
 * Un correo que no es de nadie no cuenta.
 *
 * La comparación de correo es insensible a mayúsculas, como `emailEquals`: hay
 * usuarios legados con el correo en mayúsculas.
 */
export function vendixLoginAttemptSql(loginAttemptAlias: string): Prisma.Sql {
  if (!SQL_ALIAS.test(loginAttemptAlias)) {
    throw new Error(
      `vendix-user.util: '${loginAttemptAlias}' no es un alias SQL válido`,
    );
  }
  const email = Prisma.raw(`${loginAttemptAlias}.email`);
  const storeId = Prisma.raw(`${loginAttemptAlias}.store_id`);
  return Prisma.sql`EXISTS (SELECT 1 FROM users vla_u WHERE lower(vla_u.email) = lower(${email}) AND (${storeId} IS NULL OR vla_u.organization_id = (SELECT vla_s.organization_id FROM stores vla_s WHERE vla_s.id = ${storeId})) AND ${vendixUserSql('vla_u.id')})`;
}
