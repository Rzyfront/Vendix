import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';
import {
  HIDDEN_ROLE_NAMES,
  RoleActor,
  deriveRoleScope,
  isRoleVisible,
} from '@common/utils/role-scope.util';

/**
 * QUI-72 — Servicio ÚNICO de asignación rol↔usuario.
 *
 * El ticket documenta que cada nivel implementaba UNA sola dirección, y una
 * distinta en cada nivel (superadmin sólo usuario→roles, organización sólo
 * roles→usuario, tienda sólo usuario→roles). Al agregar las direcciones que
 * faltan, el riesgo real no es escribir los endpoints sino que cada uno escriba
 * `user_roles` por su cuenta y las dos vistas del mismo dato diverjan.
 *
 * Por eso TODA escritura sobre `user_roles` en los tres niveles pasa por aquí.
 * Los controladores/servicios de dominio aportan el `RoleActor` (nivel + tenant)
 * y este servicio aplica la misma matriz de autorización para todos.
 */

export interface AssignRoleInput {
  user_id: number;
  role_id: number;
  actor: RoleActor;
  /**
   * Tienda en la que aplica la asignación. `undefined` deja que el servicio la
   * derive del actor y del alcance del rol; `null` fuerza asignación org-wide
   * (sólo permitido a niveles organization/superadmin).
   */
  store_id?: number | null;
}

export interface ReplaceUserRolesInput {
  user_id: number;
  role_ids: number[];
  actor: RoleActor;
  store_id?: number | null;
}

type RoleRow = {
  id: number;
  name: string;
  is_system_role: boolean;
  organization_id: number | null;
  store_id: number | null;
};

@Injectable()
export class UserRoleAssignmentService {
  constructor(private readonly prisma: GlobalPrismaService) {}

  // ===== READ =====

  /** Usuarios asignados a un rol, en el alcance visible para el actor. */
  async listRoleUsers(role_id: number, actor: RoleActor) {
    const role = await this.loadVisibleRole(role_id, actor);

    const assignments = await this.prisma.user_roles.findMany({
      where: {
        role_id: role.id,
        ...this.buildActorAssignmentFilter(actor),
      },
      include: {
        users: {
          select: {
            id: true,
            email: true,
            first_name: true,
            last_name: true,
            state: true,
            organization_id: true,
          },
        },
        stores: { select: { id: true, name: true } },
      },
      orderBy: { id: 'asc' },
    });

    return assignments.map((a) => ({
      assignment_id: a.id,
      store_id: a.store_id,
      store_name: a.stores?.name ?? null,
      user: a.users,
    }));
  }

  /** Roles asignados a un usuario, con el `store_id` de cada asignación. */
  async listUserRoles(user_id: number, actor: RoleActor) {
    const assignments = await this.prisma.user_roles.findMany({
      where: {
        user_id,
        ...this.buildActorAssignmentFilter(actor),
      },
      include: {
        roles: {
          select: {
            id: true,
            name: true,
            description: true,
            is_system_role: true,
            organization_id: true,
            store_id: true,
          },
        },
        stores: { select: { id: true, name: true } },
      },
      orderBy: { id: 'asc' },
    });

    return assignments
      .filter((a) => a.roles && isRoleVisible(a.roles, actor))
      .map((a) => ({
        assignment_id: a.id,
        store_id: a.store_id,
        store_name: a.stores?.name ?? null,
        role: a.roles
          ? { ...a.roles, scope: deriveRoleScope(a.roles) }
          : null,
      }));
  }

  // ===== WRITE =====

  async assign(input: AssignRoleInput) {
    const { role, target_store_id } = await this.validateAssignment(input);

    try {
      const created = await this.prisma.user_roles.create({
        data: {
          user_id: input.user_id,
          role_id: role.id,
          store_id: target_store_id,
        },
      });
      return {
        assignment_id: created.id,
        user_id: input.user_id,
        role_id: role.id,
        store_id: created.store_id,
        scope: deriveRoleScope(role),
      };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Race: dos requests concurrentes pasan la pre-verificación y ambas
        // llegan al INSERT. El índice único con NULLS NOT DISTINCT hace fallar
        // la segunda; se traduce a 409 en vez de filtrar internals de Prisma.
        throw new VendixHttpException(ErrorCodes.ROLE_ASSIGN_005);
      }
      throw err;
    }
  }

  async remove(input: AssignRoleInput) {
    const { target_store_id } = await this.validateAssignment(input, {
      allowExisting: true,
    });

    const existing = await this.prisma.user_roles.findFirst({
      where: {
        user_id: input.user_id,
        role_id: input.role_id,
        store_id: target_store_id,
      },
      select: { id: true },
    });

    if (!existing) {
      throw new VendixHttpException(ErrorCodes.ROLE_ASSIGN_004);
    }

    await this.prisma.user_roles.delete({ where: { id: existing.id } });

    return {
      user_id: input.user_id,
      role_id: input.role_id,
      store_id: target_store_id,
      removed: true,
    };
  }

  /**
   * Reemplaza el conjunto de roles de un usuario DENTRO del alcance del actor.
   *
   * Un actor de tienda sólo toca las asignaciones de SU tienda: las org-wide
   * (`store_id = NULL`) son heredadas y sólo se administran desde organización.
   * Sin esta separación, la pantalla de usuarios de una tienda revocaría
   * silenciosamente permisos que el usuario tiene en las tiendas hermanas.
   */
  async replaceUserRoles(input: ReplaceUserRolesInput) {
    const scopeStoreId = this.resolveScopeStoreId(input.actor, input.store_id);

    // Validar TODOS los roles antes de escribir nada.
    const validated: Array<{ role: RoleRow; store_id: number | null }> = [];
    for (const role_id of input.role_ids) {
      const { role, target_store_id } = await this.validateAssignment({
        user_id: input.user_id,
        role_id,
        actor: input.actor,
        store_id: scopeStoreId,
      });
      validated.push({ role, store_id: target_store_id });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user_roles.deleteMany({
        where: {
          user_id: input.user_id,
          store_id: scopeStoreId,
          roles: { name: { notIn: [...HIDDEN_ROLE_NAMES] } },
        },
      });

      if (validated.length > 0) {
        await tx.user_roles.createMany({
          data: validated.map((v) => ({
            user_id: input.user_id,
            role_id: v.role.id,
            store_id: v.store_id,
          })),
          skipDuplicates: true,
        });
      }
    });

    return this.listUserRoles(input.user_id, input.actor);
  }

  /**
   * Asignación idempotente SIN matriz de autorización.
   *
   * Sólo para rutas de aprovisionamiento del sistema (onboarding, seeds,
   * staff-provisioning) donde no hay un actor humano cuyo nivel validar. Toda
   * ruta expuesta por API debe usar `assign()`.
   *
   * Existe además por una limitación real de Prisma: al incorporar `store_id`
   * (nullable) al unique compuesto, `user_rolesWhereUniqueInput` lo tipa como
   * `number` NO nulo, así que `upsert({ where: { user_id_role_id_store_id } })`
   * NO puede expresar una asignación org-wide. El equivalente correcto es
   * findFirst + create, centralizado aquí.
   */
  async ensureAssignmentUnchecked(params: {
    user_id: number;
    role_id: number;
    store_id?: number | null;
  }) {
    const store_id = params.store_id ?? null;

    const existing = await this.prisma.user_roles.findFirst({
      where: {
        user_id: params.user_id,
        role_id: params.role_id,
        store_id,
      },
      select: { id: true },
    });

    if (existing) return existing;

    try {
      return await this.prisma.user_roles.create({
        data: {
          user_id: params.user_id,
          role_id: params.role_id,
          store_id,
        },
        select: { id: true },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Carrera con otro provisioning concurrente: la fila ya existe.
        const raced = await this.prisma.user_roles.findFirst({
          where: {
            user_id: params.user_id,
            role_id: params.role_id,
            store_id,
          },
          select: { id: true },
        });
        if (raced) return raced;
      }
      throw err;
    }
  }

  // ===== PRIVATE =====

  /**
   * Alcance de tienda en el que ESCRIBE el actor.
   * - store: siempre su propia tienda, nunca org-wide.
   * - organization/superadmin: lo que pidan (incluido `null` = org-wide).
   */
  private resolveScopeStoreId(
    actor: RoleActor,
    requested?: number | null,
  ): number | null {
    if (actor.level === 'store') {
      if (actor.store_id == null) {
        throw new VendixHttpException(ErrorCodes.ROLE_SCOPE_003);
      }
      if (requested != null && requested !== actor.store_id) {
        throw new VendixHttpException(ErrorCodes.ROLE_ASSIGN_007);
      }
      return actor.store_id;
    }
    return requested ?? null;
  }

  /** Restringe las lecturas de `user_roles` al tenant del actor. */
  private buildActorAssignmentFilter(
    actor: RoleActor,
  ): Prisma.user_rolesWhereInput {
    if (actor.level === 'superadmin') return {};

    if (actor.organization_id == null) {
      throw new VendixHttpException(ErrorCodes.ROLE_SCOPE_002);
    }

    if (actor.level === 'organization') {
      return { users: { organization_id: actor.organization_id } };
    }

    if (actor.store_id == null) {
      throw new VendixHttpException(ErrorCodes.ROLE_SCOPE_003);
    }
    return {
      users: { store_users: { some: { store_id: actor.store_id } } },
      OR: [{ store_id: null }, { store_id: actor.store_id }],
    };
  }

  private async loadVisibleRole(
    role_id: number,
    actor: RoleActor,
  ): Promise<RoleRow> {
    const role = await this.prisma.roles.findUnique({
      where: { id: role_id },
      select: {
        id: true,
        name: true,
        is_system_role: true,
        organization_id: true,
        store_id: true,
      },
    });

    if (!role || !isRoleVisible(role, actor)) {
      // Mismo 404 para "no existe" y "no visible": distinguirlos permitiría
      // enumerar roles de otros tenants por ID (IDOR de lectura).
      throw new VendixHttpException(ErrorCodes.ROLE_SCOPE_004);
    }

    return role;
  }

  private async validateAssignment(
    input: AssignRoleInput,
    options: { allowExisting?: boolean } = {},
  ): Promise<{ role: RoleRow; target_store_id: number | null }> {
    void options;

    const role = await this.loadVisibleRole(input.role_id, input.actor);

    // 1. Roles núcleo: nunca por API de gestión, sólo por seed/superadmin.
    if (
      HIDDEN_ROLE_NAMES.includes(role.name.toLowerCase()) &&
      input.actor.level !== 'superadmin'
    ) {
      throw new VendixHttpException(ErrorCodes.ROLE_ASSIGN_002);
    }

    // 2. Roles de sistema: sólo superadmin. Cierra la escalada de privilegios
    //    "me asigno a mí mismo un rol de sistema" desde tienda u organización.
    if (
      deriveRoleScope(role) === 'system' &&
      input.actor.level !== 'superadmin'
    ) {
      throw new VendixHttpException(ErrorCodes.ROLE_ASSIGN_003);
    }

    // 3. El usuario destino debe existir y pertenecer al tenant del actor.
    const user = await this.prisma.users.findUnique({
      where: { id: input.user_id },
      select: {
        id: true,
        organization_id: true,
        store_users: { select: { store_id: true } },
      },
    });

    if (!user) {
      throw new VendixHttpException(ErrorCodes.ROLE_ASSIGN_006);
    }

    if (input.actor.level !== 'superadmin') {
      if (user.organization_id !== input.actor.organization_id) {
        throw new VendixHttpException(ErrorCodes.ROLE_ASSIGN_006);
      }
      if (input.actor.level === 'store') {
        const belongs = user.store_users.some(
          (su) => su.store_id === input.actor.store_id,
        );
        if (!belongs) {
          throw new VendixHttpException(ErrorCodes.ROLE_ASSIGN_006);
        }
      }
    }

    // 4. El rol de organización sólo se asigna a usuarios de esa organización.
    if (
      role.organization_id != null &&
      user.organization_id !== role.organization_id
    ) {
      throw new VendixHttpException(ErrorCodes.ROLE_ASSIGN_001);
    }

    // 5. Resolver la tienda de la asignación.
    const requested = this.resolveScopeStoreId(input.actor, input.store_id);
    let target_store_id: number | null;

    if (role.store_id != null) {
      // Rol de tienda: la asignación vive forzosamente en ESA tienda.
      if (requested != null && requested !== role.store_id) {
        throw new VendixHttpException(ErrorCodes.ROLE_ASSIGN_007);
      }
      target_store_id = role.store_id;
    } else {
      target_store_id = requested;
    }

    // 6. La tienda de la asignación debe pertenecer a la organización del rol.
    if (target_store_id != null) {
      const store = await this.prisma.stores.findUnique({
        where: { id: target_store_id },
        select: { id: true, organization_id: true },
      });
      if (!store) {
        throw new VendixHttpException(ErrorCodes.ROLE_ASSIGN_007);
      }
      if (
        role.organization_id != null &&
        store.organization_id !== role.organization_id
      ) {
        throw new VendixHttpException(ErrorCodes.ROLE_ASSIGN_007);
      }
      if (
        input.actor.level !== 'superadmin' &&
        store.organization_id !== input.actor.organization_id
      ) {
        throw new VendixHttpException(ErrorCodes.ROLE_ASSIGN_007);
      }
    }

    return { role, target_store_id };
  }
}
