import { Prisma } from '@prisma/client';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';

/**
 * QUI-72 — Contrato ÚNICO de alcance de roles.
 *
 * El alcance NO se persiste: se deriva de `is_system_role`, `organization_id` y
 * `store_id`. Guardar una columna de tipo sería redundante y se desincronizaría
 * de las FKs en cuanto alguien moviera un rol de nivel.
 *
 * Los tres niveles (superadmin / organization / store) DEBEN derivar, filtrar y
 * autorizar a través de este archivo. Si cada dominio reimplementa la matriz, las
 * tres pantallas divergen y el 403 se vuelve opinión en vez de contrato.
 */

export type RoleScope = 'system' | 'organization' | 'store';

/** Nivel desde el que se está consultando o editando. */
export type RoleActorLevel = 'superadmin' | 'organization' | 'store';

/** Forma mínima de un rol para derivar su alcance. */
export interface RoleScopeSource {
  is_system_role?: boolean | null;
  organization_id?: number | null;
  store_id?: number | null;
}

export interface RoleActor {
  level: RoleActorLevel;
  organization_id?: number | null;
  store_id?: number | null;
  /**
   * QUI-581 — Nombres de rol del actor autenticado, para la matriz de ASIGNACIÓN.
   *
   * Origen: `RequestContextService.getRoles()`, que el `RequestContextInterceptor`
   * llena desde `req.user.roles`. Ese valor lo produce `JwtStrategy.validate()`
   * leyendo `user_roles` de la base con `buildActiveUserRolesWhere(...)` — NO del
   * payload del token, que sólo transporta `sub`/`organization_id`/`store_id`/
   * `app_type`. Por eso no es falsificable ni por body ni por token, y viene ya
   * scopeado a la tienda activa: un `owner` org-wide (`store_id` NULL) resuelve
   * `owner` en cualquier tienda, y quien lo tenga sólo en la tienda A no se eleva
   * en la B.
   *
   * Opcional a propósito: un constructor de actor que lo omita cae al allowlist
   * de su propio nivel (fail-closed), nunca al elevado.
   */
  actor_roles?: readonly string[];
}

/** Roles núcleo que jamás se exponen ni se asignan desde UIs de tienda/organización. */
export const HIDDEN_ROLE_NAMES: readonly string[] = ['owner', 'super_admin'];

/**
 * QUI-581 — Matriz de ASIGNACIÓN de roles de sistema, distinta de la de EDICIÓN.
 *
 * `canEditRole` responde "¿puede este actor cambiar QUÉ SIGNIFICA este rol?" y para
 * un rol de sistema (`organization_id` NULL, compartido por TODOS los tenants) la
 * respuesta correcta sigue siendo no: editarlo filtraría el cambio a cada
 * organización de Vendix. `canAssignRole` responde algo completamente distinto:
 * "¿puede este actor DARLE este rol a un usuario de su alcance?" — una operación
 * local, cotidiana y necesaria para gestionar personal.
 *
 * QUI-72 colapsó ambas preguntas en `deriveRoleScope(role) === 'system'`. Como el
 * seed crea los diez roles canónicos con `is_system_role: true, organization_id:
 * null`, el catálogo operativo COMPLETO quedó no asignable y la gestión de personal
 * se bloqueó de raíz (QUI-581). La escalada de privilegios real la cierra el paso 1
 * de `validateAssignment` con `HIDDEN_ROLE_NAMES`, no esta matriz.
 *
 * `customer` no aparece en ninguna fila a propósito: el listado de staff excluye a
 * quien lo tenga (`store-user-management.service.ts`), así que asignarlo desde esa
 * pantalla haría desaparecer al usuario de la tabla desde la que se le asignó.
 *
 * Allowlist por INCLUSIÓN, nunca por exclusión: un rol de sistema nuevo nace no
 * asignable y hace falta una decisión explícita para abrirlo.
 */
export const ASSIGNABLE_SYSTEM_ROLES: Record<
  'organization' | 'store',
  readonly string[]
> = {
  organization: [
    'admin',
    'fiscal_supervisor',
    'manager',
    'supervisor',
    'employee',
    'cashier',
    'carrier',
    // QUI-727 (A.1) — roles de operación restaurante, asignables desde
    // organización y tienda.
    'mesero',
    'cocina',
  ],
  store: [
    'manager',
    'supervisor',
    'employee',
    'cashier',
    'carrier',
    // QUI-727 (A.1) — roles de operación restaurante, asignables en tienda.
    'mesero',
    'cocina',
  ],
};

/**
 * Nivel EFECTIVO para la matriz de asignación (no para visibilidad ni edición).
 *
 * El `owner` asigna como si hablara por la organización, mire el panel que mire.
 * Razón de negocio: la mayoría de los tenants son de tienda única
 * (`account_type: SINGLE_STORE`, `operating_scope: STORE`) y NUNCA ven la app
 * ORG_ADMIN, así que para ellos no existe ningún panel alternativo desde el cual
 * asignar `admin` o `fiscal_supervisor`. Sin esta elevación el fix de QUI-581
 * dejaría a la mayoría del padrón exactamente igual de bloqueada.
 *
 * Se eleva la IDENTIDAD (tener rol `owner`), no la topología del tenant: un `admin`
 * de tienda comprometido no gana capacidad nueva, y el `owner` de una organización
 * multi-tienda queda cubierto también cuando entra por el panel de tienda.
 *
 * Nunca eleva a `superadmin`: `owner` y `super_admin` siguen reservados al nivel de
 * plataforma vía `HIDDEN_ROLE_NAMES`, así que un owner no puede crear otro owner.
 */
export function resolveAssignmentLevel(actor: RoleActor): RoleActorLevel {
  if (actor.level === 'superadmin') return 'superadmin';
  if (actor.actor_roles?.includes('owner')) return 'organization';
  return actor.level;
}

/**
 * ¿Puede `actor` asignar/quitar `role` a un usuario de su alcance?
 *
 * Sólo decide sobre el eje de ALCANCE del rol. La pertenencia del usuario destino
 * al tenant, los roles núcleo y la resolución de la tienda de la asignación siguen
 * siendo responsabilidad de `UserRoleAssignmentService.validateAssignment`.
 */
export function canAssignRole(
  role: RoleScopeSource & { name: string },
  actor: RoleActor,
): boolean {
  const level = resolveAssignmentLevel(actor);
  if (level === 'superadmin') return true;

  // Los roles núcleo nunca se asignan fuera de plataforma, ni siendo owner.
  if (HIDDEN_ROLE_NAMES.includes(role.name.toLowerCase())) return false;

  if (deriveRoleScope(role) !== 'system') {
    // Roles de organización y de tienda ya los gobierna la visibilidad
    // (`isRoleVisible`), que el servicio valida antes de llegar aquí.
    return true;
  }

  return ASSIGNABLE_SYSTEM_ROLES[level].includes(role.name.toLowerCase());
}

/**
 * Deriva el alcance de un rol a partir de sus FKs.
 *
 * `store_id` sin `organization_id` es un estado inválido a nivel de datos (lo
 * bloquea el CHECK `roles_store_requires_organization`); si aun así llegara,
 * se trata como rol de tienda para no ampliar visibilidad por accidente.
 */
export function deriveRoleScope(role: RoleScopeSource): RoleScope {
  if (role.store_id != null) return 'store';
  if (role.is_system_role && role.organization_id == null) return 'system';
  if (role.organization_id != null) return 'organization';
  // Rol sin organización y sin flag de sistema: dato inconsistente. Se degrada a
  // 'system' porque es el alcance de MENOR capacidad de edición (sólo superadmin).
  return 'system';
}

/** Añade `scope` a la fila para que el frontend no tenga que re-derivarlo. */
export function withRoleScope<T extends RoleScopeSource>(
  role: T,
): T & { scope: RoleScope } {
  return { ...role, scope: deriveRoleScope(role) };
}

/**
 * Filtro de VISIBILIDAD por nivel (qué roles se listan).
 *
 * | Nivel        | Sistema | Su organización | Tienda                 |
 * | ------------ | ------- | --------------- | ---------------------- |
 * | superadmin   | todos   | todas las orgs  | todas las tiendas      |
 * | organization | sí      | los suyos       | los de SUS tiendas     |
 * | store        | sí      | los de su org   | SÓLO los de su tienda  |
 *
 * Ojo: el nivel `store` ve los roles de organización porque son heredados y
 * asignables, pero en SÓLO LECTURA (ver `assertRoleEditable`). Visibilidad y
 * edición son dos matrices distintas y no deben colapsarse en una sola.
 */
export function buildRoleVisibilityWhere(
  actor: RoleActor,
): Prisma.rolesWhereInput {
  if (actor.level === 'superadmin') {
    return {};
  }

  if (actor.level === 'organization') {
    if (actor.organization_id == null) {
      throw new VendixHttpException(ErrorCodes.ROLE_SCOPE_002);
    }
    return {
      OR: [
        { is_system_role: true, organization_id: null },
        { organization_id: actor.organization_id },
      ],
    };
  }

  // store
  if (actor.organization_id == null) {
    throw new VendixHttpException(ErrorCodes.ROLE_SCOPE_002);
  }
  if (actor.store_id == null) {
    // Fail closed: sin tienda en contexto, un `store_id: undefined` colapsaría el
    // filtro a "cualquier tienda" y reintroduciría exactamente la fuga de QUI-72.
    throw new VendixHttpException(ErrorCodes.ROLE_SCOPE_003);
  }
  return {
    OR: [
      { is_system_role: true, organization_id: null },
      { organization_id: actor.organization_id, store_id: null },
      { organization_id: actor.organization_id, store_id: actor.store_id },
    ],
  };
}

/**
 * Versión en memoria del filtro de visibilidad, para validar un rol ya cargado
 * sin repetir el query. DEBE mantenerse equivalente a `buildRoleVisibilityWhere`.
 */
export function isRoleVisible(role: RoleScopeSource, actor: RoleActor): boolean {
  if (actor.level === 'superadmin') return true;

  const scope = deriveRoleScope(role);
  if (scope === 'system') return true;

  if (actor.organization_id == null) return false;
  if (role.organization_id !== actor.organization_id) return false;

  if (actor.level === 'organization') return true;

  // store: roles de su organización (heredados) + los de su propia tienda
  return role.store_id == null || role.store_id === actor.store_id;
}

/**
 * Filtro de `user_roles` para RESOLVER permisos en la tienda activa.
 *
 * `store_id` NULL = asignación org-wide, aplica en todas las tiendas.
 * `store_id` = tienda activa = asignación específica de esa tienda.
 * Sin tienda activa (contexto puramente organizacional) sólo aplican las org-wide.
 */
export function buildActiveUserRolesWhere(
  userId: number,
  activeStoreId?: number | null,
): Prisma.user_rolesWhereInput {
  if (activeStoreId == null) {
    return { user_id: userId, store_id: null };
  }
  return {
    user_id: userId,
    OR: [{ store_id: null }, { store_id: activeStoreId }],
  };
}

/**
 * Matriz de EDICIÓN (crear/editar/borrar/permisos del rol).
 *
 * | Rol \ Actor  | Superadmin | Org admin                | Store admin        |
 * | ------------ | ---------- | ------------------------ | ------------------ |
 * | Sistema      | editar     | sólo lectura             | sólo lectura       |
 * | Organización | editar     | editar (la suya)         | sólo lectura       |
 * | Tienda       | editar     | editar (sus tiendas)     | editar (la suya)   |
 */
export function canEditRole(role: RoleScopeSource, actor: RoleActor): boolean {
  const scope = deriveRoleScope(role);

  if (actor.level === 'superadmin') return true;
  if (scope === 'system') return false;

  if (actor.organization_id == null) return false;
  if (role.organization_id !== actor.organization_id) return false;

  if (actor.level === 'organization') return true;

  // store admin: sólo roles de SU tienda; los de organización son heredados.
  return scope === 'store' && role.store_id === actor.store_id;
}

/** Igual que `canEditRole`, pero lanza 403 tipado en vez de devolver false. */
export function assertRoleEditable(
  role: RoleScopeSource,
  actor: RoleActor,
): void {
  if (!canEditRole(role, actor)) {
    throw new VendixHttpException(ErrorCodes.ROLE_SCOPE_001, undefined, {
      scope: deriveRoleScope(role),
      actor_level: actor.level,
    });
  }
}

/**
 * Resuelve el `(organization_id, store_id)` que debe llevar un rol NUEVO creado
 * desde `actor`. Aquí es donde se arregla el bug original: el nivel tienda deja
 * de crear roles de organización.
 */
export function resolveNewRoleOwnership(actor: RoleActor): {
  organization_id: number | null;
  store_id: number | null;
} {
  if (actor.level === 'store') {
    if (actor.organization_id == null) {
      throw new VendixHttpException(ErrorCodes.ROLE_SCOPE_002);
    }
    if (actor.store_id == null) {
      throw new VendixHttpException(ErrorCodes.ROLE_SCOPE_003);
    }
    return {
      organization_id: actor.organization_id,
      store_id: actor.store_id,
    };
  }

  if (actor.level === 'organization') {
    if (actor.organization_id == null) {
      throw new VendixHttpException(ErrorCodes.ROLE_SCOPE_002);
    }
    return { organization_id: actor.organization_id, store_id: null };
  }

  // superadmin: la propiedad la decide el DTO, no el contexto.
  return { organization_id: null, store_id: null };
}
