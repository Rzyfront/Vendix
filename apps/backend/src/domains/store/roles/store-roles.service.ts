import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import {
  OperatingScopeService,
  OrganizationOperatingScope,
} from '@common/services/operating-scope.service';
import { UserRoleAssignmentService } from '@common/services/user-role-assignment.service';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';
import {
  HIDDEN_ROLE_NAMES,
  RoleActor,
  assertRoleEditable,
  buildRoleVisibilityWhere,
  deriveRoleScope,
  resolveNewRoleOwnership,
} from '@common/utils/role-scope.util';
import {
  CreateStoreRoleDto,
  UpdateStoreRoleDto,
  AssignPermissionsDto,
  RemovePermissionsDto,
} from './dto/store-role.dto';

@Injectable()
export class StoreRolesService {
  /**
   * Core roles that are never exposed to store-level UIs.
   * QUI-72: the canonical list lives in `role-scope.util` so the three levels
   * (superadmin / organization / store) hide exactly the same rows.
   */
  private readonly HIDDEN_ROLES: string[] = [...HIDDEN_ROLE_NAMES];

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly operatingScope: OperatingScopeService,
    private readonly userRoleAssignment: UserRoleAssignmentService,
  ) {}

  // ===== PRIVATE HELPERS =====

  /**
   * QUI-72 — Actor de este dominio. SIEMPRE nivel `store`: la pantalla de roles
   * de tienda no puede hablar en nombre de la organización.
   *
   * Fail-closed en ambos IDs: sin organización no hay tenant y sin tienda el
   * filtro de visibilidad colapsaría a "cualquier tienda", que es exactamente
   * la fuga que reporta el ticket.
   */
  private buildActor(): RoleActor & {
    organization_id: number;
    store_id: number;
  } {
    const context = RequestContextService.getContext();
    const organization_id = context?.organization_id;
    const store_id = context?.store_id;

    if (!organization_id) {
      throw new VendixHttpException(ErrorCodes.ROLE_SCOPE_002);
    }
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.ROLE_SCOPE_003);
    }

    // QUI-581 — `actor_roles` alimenta la matriz de ASIGNACIÓN (`canAssignRole`),
    // no la de edición: un `owner` sigue sin poder editar un rol de sistema.
    return {
      level: 'store',
      organization_id,
      store_id,
      actor_roles: RequestContextService.getRoles(),
    };
  }

  /**
   * Builds the tenant filter applied to the nested `user_roles` `_count`.
   *
   * System roles (`is_system_role=true`, `organization_id=null`) are shared
   * platform-wide, so an unfiltered `_count` aggregates users from EVERY
   * tenant. Nested `_count` selects are NOT intercepted by the scoped Prisma
   * extensions, so the tenant predicate must be applied explicitly here.
   *
   * QUI-72: la asignación ya tiene dimensión propia (`user_roles.store_id`), así
   * que a nivel tienda no basta con "usuarios de esta tienda": hay que contar
   * SÓLO las asignaciones aplicables aquí — las org-wide (`store_id` NULL, que
   * son heredadas) y las de esta misma tienda. Sin ese segundo filtro, el
   * contador sumaría asignaciones hechas en tiendas hermanas.
   */
  private buildUserRolesCountWhere(
    scope: OrganizationOperatingScope,
    storeId: number | undefined,
    organizationId: number | undefined,
  ): Prisma.user_rolesWhereInput {
    if (scope === 'ORGANIZATION') {
      return { users: { organization_id: organizationId } };
    }
    // STORE: users linked to the context store via store_users. Fail closed if
    // there is no store context — a `store_id: undefined` would collapse the
    // filter to "any store" and re-introduce the cross-tenant leak.
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.ROLE_SCOPE_003);
    }
    return {
      users: { store_users: { some: { store_id: storeId } } },
      OR: [{ store_id: null }, { store_id: storeId }],
    };
  }

  private transformRole(role: any) {
    return {
      id: role.id,
      name: role.name,
      description: role.description,
      is_system_role: role.is_system_role,
      organization_id: role.organization_id,
      store_id: role.store_id ?? null,
      // QUI-72: el alcance NO se persiste, se deriva. Se expone ya derivado para
      // que el frontend no reimplemente la matriz (y se desincronice).
      scope: deriveRoleScope(role),
      created_at: role.created_at,
      updated_at: role.updated_at,
      permissions:
        role.role_permissions
          ?.map((rp: any) => rp.permissions?.description)
          .filter(Boolean) || [],
      _count: role._count,
    };
  }

  // ===== CRUD =====

  async findAll() {
    const actor = this.buildActor();
    const { organization_id, store_id } = actor;

    const scope = await this.operatingScope.getOperatingScope(organization_id);
    const userRolesCountWhere = this.buildUserRolesCountWhere(
      scope,
      store_id,
      organization_id,
    );

    // Roles are NOT auto-scoped in StorePrismaService, so we filter manually.
    // QUI-72: el filtro sale del contrato compartido — sistema + roles de la
    // organización (heredados, sólo lectura) + SÓLO los de esta tienda. El
    // `OR: [{ organization_id }, { is_system_role: true }]` anterior no tenía
    // dimensión de tienda, por eso un rol creado en la tienda A aparecía en B.
    const roles = await this.prisma.roles.findMany({
      where: {
        name: { notIn: this.HIDDEN_ROLES },
        ...buildRoleVisibilityWhere(actor),
      },
      include: {
        role_permissions: {
          include: {
            permissions: true,
          },
        },
        _count: {
          select: {
            user_roles: { where: userRolesCountWhere },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return roles.map((role) => this.transformRole(role));
  }

  async findOne(id: number) {
    const actor = this.buildActor();
    const { organization_id, store_id } = actor;

    const scope = await this.operatingScope.getOperatingScope(organization_id);
    const userRolesCountWhere = this.buildUserRolesCountWhere(
      scope,
      store_id,
      organization_id,
    );

    const role = await this.prisma.roles.findFirst({
      where: {
        id,
        ...buildRoleVisibilityWhere(actor),
      },
      include: {
        role_permissions: {
          include: {
            permissions: true,
          },
        },
        _count: {
          select: {
            user_roles: { where: userRolesCountWhere },
          },
        },
      },
    });

    if (!role) {
      // Mismo 404 para "no existe" y "no visible": distinguirlos permitiría
      // enumerar roles de otras tiendas/tenants por ID (IDOR de lectura).
      throw new VendixHttpException(ErrorCodes.ROLE_SCOPE_004);
    }

    return this.transformRole(role);
  }

  async create(dto: CreateStoreRoleDto) {
    const actor = this.buildActor();
    const { organization_id, store_id } = actor;

    // QUI-72 — RAÍZ DEL BUG: un rol creado desde la tienda nacía como rol de
    // ORGANIZACIÓN (`store_id` inexistente), así que aparecía en las tiendas
    // hermanas. La propiedad ahora la resuelve el contrato compartido.
    const ownership = resolveNewRoleOwnership(actor);

    // Unicidad por (organization_id, store_id, name) — que es exactamente el
    // unique de la tabla. QUI-473: se CONSERVA la guarda anti-colisión contra
    // los roles de SISTEMA globales (is_system_role=true, organization_id NULL),
    // que comparten espacio de nombres con todas las tiendas.
    // QUI-72: la guarda cubre además los roles HEREDADOS que ya se ven en esta
    // tienda (los de organización con store_id NULL). El unique de la tabla no
    // los detecta —(org, NULL, 'Cajero') y (org, 7, 'Cajero') son filas
    // distintas— pero para el usuario de la tienda serían dos filas con el mismo
    // nombre y distinto alcance, imposibles de distinguir al asignar.
    const existing = await this.prisma.roles.findFirst({
      where: {
        name: dto.name,
        OR: [
          {
            organization_id: ownership.organization_id,
            store_id: ownership.store_id,
          },
          { organization_id: ownership.organization_id, store_id: null },
          { is_system_role: true, organization_id: null },
        ],
      },
      select: { id: true, is_system_role: true, store_id: true },
    });

    if (existing) {
      const conflictScope = deriveRoleScope(existing);
      throw new VendixHttpException(
        ErrorCodes.SYS_CONFLICT_001,
        conflictScope === 'store'
          ? 'Ya existe un rol con este nombre en esta tienda'
          : 'Ya existe un rol heredado con este nombre visible en esta tienda',
        { name: dto.name, conflict_scope: conflictScope },
      );
    }

    const scope = await this.operatingScope.getOperatingScope(organization_id);
    const userRolesCountWhere = this.buildUserRolesCountWhere(
      scope,
      store_id,
      organization_id,
    );

    // Store admins can NEVER create system roles.
    // QUI-473: catch P2002 (race condition: two concurrent requests pass the
    // pre-check above and both reach INSERT; with the composite unique on
    // (organization_id, store_id, name) the second one will fail). Translate the
    // raw Prisma error into a clean typed 409 so the UI can show a useful
    // message instead of leaking Prisma internals.
    let role;
    try {
      role = await this.prisma.roles.create({
        data: {
          name: dto.name,
          description: dto.description,
          is_system_role: false,
          organization_id: ownership.organization_id,
          store_id: ownership.store_id,
        },
        include: {
          role_permissions: {
            include: {
              permissions: true,
            },
          },
          _count: {
            select: {
              user_roles: { where: userRolesCountWhere },
            },
          },
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new VendixHttpException(
          ErrorCodes.SYS_CONFLICT_001,
          'Ya existe un rol con este nombre en esta tienda',
          { name: dto.name },
        );
      }
      throw err;
    }

    return this.transformRole(role);
  }

  async update(id: number, dto: UpdateStoreRoleDto) {
    const actor = this.buildActor();
    const { organization_id, store_id } = actor;

    const role = await this.findOne(id);

    // QUI-72: la matriz de edición sustituye al chequeo ad-hoc de
    // `is_system_role`. Además de los roles de sistema, bloquea editar roles de
    // ORGANIZACIÓN desde la tienda: son heredados y sólo lectura aquí.
    assertRoleEditable(role, actor);

    // Check name uniqueness if changing. QUI-473 + QUI-72: la colisión se evalúa
    // en el mismo espacio que el unique de la tabla — (organization_id,
    // store_id, name) — más los roles de sistema globales.
    if (dto.name && dto.name !== role.name) {
      const existing = await this.prisma.roles.findFirst({
        where: {
          name: dto.name,
          id: { not: id },
          OR: [
            { organization_id: role.organization_id, store_id: role.store_id },
            // Mismo criterio que en create(): un rol de tienda tampoco puede
            // pasar a llamarse igual que un rol heredado visible aquí.
            { organization_id: role.organization_id, store_id: null },
            { is_system_role: true, organization_id: null },
          ],
        },
        select: { id: true, is_system_role: true, store_id: true },
      });

      if (existing) {
        const conflictScope = deriveRoleScope(existing);
        throw new VendixHttpException(
          ErrorCodes.SYS_CONFLICT_001,
          conflictScope === 'store'
            ? 'Ya existe un rol con este nombre en esta tienda'
            : 'Ya existe un rol heredado con este nombre visible en esta tienda',
          { name: dto.name, conflict_scope: conflictScope },
        );
      }
    }

    const scope = await this.operatingScope.getOperatingScope(organization_id);
    const userRolesCountWhere = this.buildUserRolesCountWhere(
      scope,
      store_id,
      organization_id,
    );

    let updated;
    try {
      updated = await this.prisma.roles.update({
        where: { id },
        data: {
          ...(dto.name && { name: dto.name }),
          ...(dto.description !== undefined && { description: dto.description }),
        },
        include: {
          role_permissions: {
            include: {
              permissions: true,
            },
          },
          _count: {
            select: {
              user_roles: { where: userRolesCountWhere },
            },
          },
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new VendixHttpException(
          ErrorCodes.SYS_CONFLICT_001,
          'Ya existe un rol con este nombre en esta tienda',
          { name: dto.name },
        );
      }
      throw err;
    }

    return this.transformRole(updated);
  }

  async remove(id: number) {
    const actor = this.buildActor();
    const organization_id = actor.organization_id;

    const role = await this.findOne(id);

    assertRoleEditable(role, actor);

    // Deleting a role cascades to its `user_roles` across the ENTIRE
    // organization, so the delete guard must count org-wide, never by the
    // current store context (which would let a role still assigned in a
    // sibling store be deleted).
    const assigned_users = await this.prisma.user_roles.count({
      where: {
        role_id: id,
        ...this.buildUserRolesCountWhere(
          'ORGANIZATION',
          undefined,
          organization_id,
        ),
      },
    });

    if (assigned_users > 0) {
      throw new BadRequestException(
        'Cannot delete a role that has users assigned',
      );
    }

    await this.prisma.roles.delete({ where: { id } });

    return { message: 'Role deleted successfully' };
  }

  // ===== PERMISSIONS MANAGEMENT =====

  async getAvailablePermissions() {
    const permissions = await this.prisma.permissions.findMany({
      where: {
        name: { startsWith: 'store:' },
        status: 'active',
      },
      orderBy: { name: 'asc' },
    });

    return permissions;
  }

  async getRolePermissions(role_id: number) {
    // Verify role exists and is accessible
    await this.findOne(role_id);

    const role_permissions = await this.prisma.role_permissions.findMany({
      where: { role_id },
      select: { permission_id: true },
      orderBy: { permission_id: 'asc' },
    });

    const permission_ids = role_permissions.map((rp) => rp.permission_id);

    return {
      role_id,
      permission_ids,
      total_permissions: permission_ids.length,
    };
  }

  async assignPermissions(role_id: number, dto: AssignPermissionsDto) {
    const actor = this.buildActor();
    const role = await this.findOne(role_id);

    // QUI-72: sistema Y organización son sólo lectura desde la tienda.
    assertRoleEditable(role, actor);

    // Validate all permissions exist and have store: prefix
    const permissions = await this.prisma.permissions.findMany({
      where: {
        id: { in: dto.permission_ids },
        status: 'active',
      },
    });

    if (permissions.length !== dto.permission_ids.length) {
      throw new BadRequestException('One or more permissions not found');
    }

    const non_store_permissions = permissions.filter(
      (p) => !p.name.startsWith('store:'),
    );

    if (non_store_permissions.length > 0) {
      throw new VendixHttpException(
        ErrorCodes.AUTH_PERM_001,
        'Solo se pueden asignar permisos store:* a roles de tienda',
        { invalid: non_store_permissions.map((p) => p.name) },
      );
    }

    // Create role_permissions entries
    const data = dto.permission_ids.map((permission_id) => ({
      role_id,
      permission_id,
      granted: true,
    }));

    await this.prisma.role_permissions.createMany({
      data,
      skipDuplicates: true,
    });

    // Return updated role
    const updated_role = await this.findOne(role_id);
    return updated_role;
  }

  async removePermissions(role_id: number, dto: RemovePermissionsDto) {
    const actor = this.buildActor();
    const role = await this.findOne(role_id);

    assertRoleEditable(role, actor);

    await this.prisma.role_permissions.deleteMany({
      where: {
        role_id,
        permission_id: { in: dto.permission_ids },
      },
    });

    // Return updated role
    const updated_role = await this.findOne(role_id);
    return updated_role;
  }

  // ===== ROLE -> USER ASSIGNMENTS (QUI-72) =====
  //
  // Dirección que faltaba en el nivel tienda: desde el ROL hacia los usuarios.
  // Toda escritura sobre `user_roles` se delega en `UserRoleAssignmentService`
  // para que las dos vistas del mismo dato (usuario→roles y rol→usuarios) no
  // diverjan, y para que la matriz de autorización se aplique una sola vez.

  async listRoleUsers(role_id: number) {
    return this.userRoleAssignment.listRoleUsers(role_id, this.buildActor());
  }

  async assignRoleToUser(role_id: number, user_id: number) {
    return this.userRoleAssignment.assign({
      user_id,
      role_id,
      actor: this.buildActor(),
    });
  }

  async removeRoleFromUser(role_id: number, user_id: number) {
    return this.userRoleAssignment.remove({
      user_id,
      role_id,
      actor: this.buildActor(),
    });
  }

  // ===== STATS =====

  async getStats() {
    const actor = this.buildActor();
    const { organization_id, store_id } = actor;

    // Mismo universo visible que `findAll()`: sistema + organización + ESTA
    // tienda, sin los roles núcleo ocultos.
    const visibleWhere: Prisma.rolesWhereInput = {
      name: { notIn: this.HIDDEN_ROLES },
      ...buildRoleVisibilityWhere(actor),
    };

    const [
      total_roles,
      system_roles,
      organization_roles,
      store_roles,
      total_store_permissions,
    ] = await Promise.all([
      this.prisma.roles.count({ where: visibleWhere }),
      this.prisma.roles.count({
        where: { ...visibleWhere, is_system_role: true, organization_id: null },
      }),
      this.prisma.roles.count({
        where: { ...visibleWhere, organization_id, store_id: null },
      }),
      this.prisma.roles.count({
        where: { ...visibleWhere, organization_id, store_id },
      }),
      this.prisma.permissions.count({
        where: {
          name: { startsWith: 'store:' },
          status: 'active',
        },
      }),
    ]);

    // `custom_roles` se conserva por compatibilidad con el frontend actual y
    // sigue valiendo lo mismo: todo lo que no es de sistema (organización +
    // tienda). Los tres alcances se reportan aparte.
    const custom_roles = organization_roles + store_roles;

    return {
      total_roles,
      system_roles,
      custom_roles,
      organization_roles,
      store_roles,
      total_store_permissions,
    };
  }
}
