import { Injectable, ConflictException } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import {
  AssignPermissionsDto,
  RemovePermissionsDto,
} from '../../organization/roles/dto/role.dto';
import {
  RoleAssignmentScopeDto,
  SuperadminCreateRoleDto,
  SuperadminRoleQueryDto,
  SuperadminUpdateRoleDto,
} from './dto/role.dto';
import { Prisma } from '@prisma/client';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import {
  HIDDEN_ROLE_NAMES,
  RoleScope,
  assertRoleEditable,
  deriveRoleScope,
  resolveNewRoleOwnership,
  withRoleScope,
} from '@common/utils/role-scope.util';
import {
  SUPERADMIN_ROLE_ACTOR,
  SuperadminRoleAssignmentService,
} from './superadmin-role-assignment.service';

/**
 * Ownership resuelto de un rol: las dos FKs + el flag, que juntos determinan el
 * alcance derivado. Se valida SIEMPRE como un trío, nunca campo por campo: es
 * la combinación la que puede ser inválida, no cada valor por separado.
 */
interface RoleOwnership {
  is_system_role: boolean;
  organization_id: number | null;
  store_id: number | null;
}

const ROLE_INCLUDE: Prisma.rolesInclude = {
  organizations: { select: { id: true, name: true } },
  stores: { select: { id: true, name: true } },
  role_permissions: {
    include: {
      permissions: { select: { id: true, name: true, description: true } },
    },
  },
  user_roles: {
    include: {
      users: {
        select: { id: true, email: true, first_name: true, last_name: true },
      },
      stores: { select: { id: true, name: true } },
    },
  },
  _count: { select: { role_permissions: true, user_roles: true } },
};

/**
 * Traduce el alcance DERIVADO a un filtro Prisma sobre las FKs.
 *
 * Es la inversa exacta de `deriveRoleScope`: si una cambia sin la otra, el
 * filtro del listado deja de coincidir con la etiqueta que muestra la fila.
 */
function buildScopeFilter(scope: RoleScope): Prisma.rolesWhereInput {
  switch (scope) {
    case 'system':
      // Deliberadamente NO se filtra por `is_system_role`: `deriveRoleScope`
      // degrada a 'system' cualquier rol sin organización ni tienda, aunque
      // tenga el flag en false. Filtrar por el flag dejaría fuera de la lista
      // filas que la propia respuesta etiqueta como `scope: 'system'`.
      return { organization_id: null, store_id: null };
    case 'organization':
      return { organization_id: { not: null }, store_id: null };
    case 'store':
      return { store_id: { not: null } };
  }
}

@Injectable()
export class RolesService {
  constructor(
    private prisma: GlobalPrismaService,
    private readonly roleAssignments: SuperadminRoleAssignmentService,
  ) {}

  async create(createRoleDto: SuperadminCreateRoleDto) {
    const ownership = this.resolveCreateOwnership(createRoleDto);
    await this.assertOwnershipCoherent(ownership);

    // QUI-473 + QUI-72: la unique compuesta es (organization_id, store_id,
    // name) con NULLS NOT DISTINCT. El pre-check debe usar EXACTAMENTE la misma
    // tripleta; si sólo mirara el nombre rechazaría un `cajero` legítimo de otra
    // tienda, y si mirara menos columnas dejaría pasar un duplicado real.
    const existingRole = await this.prisma.roles.findFirst({
      where: {
        name: createRoleDto.name,
        organization_id: ownership.organization_id,
        store_id: ownership.store_id,
      },
    });

    if (existingRole) {
      throw new ConflictException('Role with this name already exists');
    }

    let role;
    try {
      role = await this.prisma.roles.create({
        data: {
          name: createRoleDto.name,
          description: createRoleDto.description,
          is_system_role: ownership.is_system_role,
          organization_id: ownership.organization_id,
          store_id: ownership.store_id,
        },
        include: ROLE_INCLUDE,
      });
    } catch (err) {
      // Carrera entre el pre-check y el INSERT: la unique compuesta decide.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('Role with this name already exists');
      }
      throw err;
    }

    return this.mapToResponse(role);
  }

  async findAll(query: SuperadminRoleQueryDto) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;
    const { search, is_system_role, scope, organization_id, store_id } = query;
    const skip = (page - 1) * limit;

    const filters: Prisma.rolesWhereInput[] = [];

    if (search) {
      filters.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    if (is_system_role !== undefined) {
      filters.push({ is_system_role });
    }

    if (scope) {
      filters.push(buildScopeFilter(scope));
    }

    if (organization_id !== undefined) {
      filters.push({ organization_id });
    }

    if (store_id !== undefined) {
      filters.push({ store_id });
    }

    // Se acumulan en AND explícito porque `search` ya ocupa la clave `OR` del
    // objeto raíz: mezclarlos en un solo nivel haría que el filtro de alcance
    // se pisara con la búsqueda y devolviera roles de otros alcances.
    const where: Prisma.rolesWhereInput =
      filters.length > 0 ? { AND: filters } : {};

    const [data, total] = await Promise.all([
      this.prisma.roles.findMany({
        where,
        skip,
        take: limit,
        include: ROLE_INCLUDE,
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.roles.count({ where }),
    ]);

    return {
      data: data.map((role) => this.mapToResponse(role)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number) {
    const role = await this.prisma.roles.findUnique({
      where: { id },
      include: ROLE_INCLUDE,
    });

    if (!role) {
      throw new VendixHttpException(ErrorCodes.SUP_ADMIN_ROLE_001);
    }

    return this.mapToResponse(role);
  }

  async update(id: number, updateRoleDto: SuperadminUpdateRoleDto) {
    const existingRole = await this.prisma.roles.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        is_system_role: true,
        organization_id: true,
        store_id: true,
      },
    });

    if (!existingRole) {
      throw new VendixHttpException(ErrorCodes.SUP_ADMIN_ROLE_001);
    }

    // Superadmin edita los tres alcances, pero la comprobación se hace igual
    // que en los otros dos niveles para que la matriz viva en un solo sitio.
    assertRoleEditable(existingRole, SUPERADMIN_ROLE_ACTOR);

    const ownership = this.resolveUpdateOwnership(existingRole, updateRoleDto);
    const targetName = updateRoleDto.name ?? existingRole.name;

    this.assertCoreRoleIdentityUntouched(existingRole, targetName, ownership);
    await this.assertOwnershipCoherent(ownership);

    // La unique es la tripleta completa: mover el rol de alcance sin cambiarle
    // el nombre TAMBIÉN puede colisionar, así que el pre-check se dispara ante
    // cualquier cambio en (organization_id, store_id, name).
    const tupleChanged =
      targetName !== existingRole.name ||
      ownership.organization_id !== existingRole.organization_id ||
      ownership.store_id !== existingRole.store_id;

    if (tupleChanged) {
      const nameExists = await this.prisma.roles.findFirst({
        where: {
          name: targetName,
          organization_id: ownership.organization_id,
          store_id: ownership.store_id,
          id: { not: id },
        },
      });

      if (nameExists) {
        throw new ConflictException('Role with this name already exists');
      }
    }

    let role;
    try {
      role = await this.prisma.roles.update({
        where: { id },
        data: {
          name: targetName,
          ...(updateRoleDto.description !== undefined && {
            description: updateRoleDto.description,
          }),
          is_system_role: ownership.is_system_role,
          organization_id: ownership.organization_id,
          store_id: ownership.store_id,
          updated_at: new Date(),
        },
        include: ROLE_INCLUDE,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('Role with this name already exists');
      }
      throw err;
    }

    return this.mapToResponse(role);
  }

  async remove(id: number) {
    const existingRole = await this.prisma.roles.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            role_permissions: true,
            user_roles: true,
          },
        },
      },
    });

    if (!existingRole) {
      throw new VendixHttpException(ErrorCodes.SUP_ADMIN_ROLE_001);
    }

    if (existingRole.is_system_role) {
      throw new ConflictException('Cannot delete system roles');
    }

    if (
      existingRole._count.role_permissions > 0 ||
      existingRole._count.user_roles > 0
    ) {
      throw new ConflictException(
        'Cannot delete role with existing permissions or users',
      );
    }

    return this.prisma.roles.delete({
      where: { id },
    });
  }

  async assignPermissions(
    roleId: number,
    assignPermissionsDto: AssignPermissionsDto,
  ) {
    const role = await this.prisma.roles.findUnique({
      where: { id: roleId },
    });

    if (!role) {
      throw new VendixHttpException(ErrorCodes.SUP_ADMIN_ROLE_001);
    }

    const existingPermissions = await this.prisma.role_permissions.findMany({
      where: {
        role_id: roleId,
        permission_id: { in: assignPermissionsDto.permission_ids },
      },
    });

    if (existingPermissions.length > 0) {
      throw new ConflictException(
        'Some permissions are already assigned to this role',
      );
    }

    const rolePermissions = assignPermissionsDto.permission_ids.map(
      (permissionId) => ({
        role_id: roleId,
        permission_id: permissionId,
      }),
    );

    await this.prisma.role_permissions.createMany({
      data: rolePermissions,
    });

    return this.findOne(roleId);
  }

  async removePermissions(
    roleId: number,
    removePermissionsDto: RemovePermissionsDto,
  ) {
    const role = await this.prisma.roles.findUnique({
      where: { id: roleId },
    });

    if (!role) {
      throw new VendixHttpException(ErrorCodes.SUP_ADMIN_ROLE_001);
    }

    await this.prisma.role_permissions.deleteMany({
      where: {
        role_id: roleId,
        permission_id: { in: removePermissionsDto.permission_ids },
      },
    });

    return this.findOne(roleId);
  }

  async getPermissions(roleId: number) {
    const rolePermissions = await this.prisma.role_permissions.findMany({
      where: { role_id: roleId },
      select: { permission_id: true },
    });

    return {
      permission_ids: rolePermissions.map((rp) => rp.permission_id),
    };
  }

  // ===== Dirección rol → usuarios (QUI-72) =====

  /**
   * Las tres operaciones delegan en la MISMA fachada que usa
   * `superadmin/users/:userId/roles/:roleId`. Es el punto del ticket: dos
   * direcciones, una sola escritura.
   */
  listRoleUsers(roleId: number) {
    return this.roleAssignments.listRoleUsers(roleId);
  }

  assignUser(roleId: number, userId: number, scope: RoleAssignmentScopeDto) {
    return this.roleAssignments.assign({
      user_id: userId,
      role_id: roleId,
      store_id: scope.store_id,
    });
  }

  removeUser(roleId: number, userId: number, scope: RoleAssignmentScopeDto) {
    return this.roleAssignments.remove({
      user_id: userId,
      role_id: roleId,
      store_id: scope.store_id,
    });
  }

  async getDashboardStats() {
    const [
      totalRoles,
      systemRoles,
      customRoles,
      totalPermissions,
      rolesByUserCount,
      recentRoles,
      organizationScopedRoles,
      storeScopedRoles,
    ] = await Promise.all([
      this.prisma.roles.count(),
      this.prisma.roles.count({
        where: { is_system_role: true },
      }),
      this.prisma.roles.count({
        where: { is_system_role: false },
      }),
      this.prisma.permissions.count(),
      this.prisma.roles.findMany({
        include: {
          _count: {
            select: { user_roles: true },
          },
        },
      }),
      this.prisma.roles.findMany({
        take: 5,
        orderBy: { created_at: 'desc' },
        include: {
          _count: {
            select: {
              role_permissions: true,
              user_roles: true,
            },
          },
        },
      }),
      this.prisma.roles.count({ where: buildScopeFilter('organization') }),
      this.prisma.roles.count({ where: buildScopeFilter('store') }),
    ]);

    const rolesByUserCountRanges = {
      empty: 0,
      small: 0, // 1-5 users
      medium: 0, // 6-20 users
      large: 0, // 21+ users
    };

    rolesByUserCount.forEach((role) => {
      const userCount = role._count.user_roles;
      if (userCount === 0) rolesByUserCountRanges.empty++;
      else if (userCount <= 5) rolesByUserCountRanges.small++;
      else if (userCount <= 20) rolesByUserCountRanges.medium++;
      else rolesByUserCountRanges.large++;
    });

    return {
      totalRoles,
      systemRoles,
      customRoles,
      totalPermissions,
      rolesByUserCountRanges,
      recentRoles: recentRoles.map((role) => withRoleScope(role)),
      // Aditivo: `systemRoles` es el flag crudo y ya lo consume el panel. El
      // desglose por alcance DERIVADO se publica aparte para no cambiar de
      // significado un campo existente.
      rolesByScope: {
        system: totalRoles - organizationScopedRoles - storeScopedRoles,
        organization: organizationScopedRoles,
        store: storeScopedRoles,
      },
    };
  }

  // ===== PRIVATE =====

  private resolveCreateOwnership(dto: SuperadminCreateRoleDto): RoleOwnership {
    // Para superadmin este helper devuelve (null, null): la propiedad la decide
    // el DTO, no el contexto. Se invoca igual para que el día que el contrato
    // del actor cambie no haya un nivel que se lo salte.
    const defaults = resolveNewRoleOwnership(SUPERADMIN_ROLE_ACTOR);

    return {
      is_system_role: dto.system_role ?? dto.is_system_role ?? false,
      organization_id: dto.organization_id ?? defaults.organization_id,
      store_id: dto.store_id ?? defaults.store_id,
    };
  }

  private resolveUpdateOwnership(
    existing: RoleOwnership,
    dto: SuperadminUpdateRoleDto,
  ): RoleOwnership {
    // `undefined` = campo ausente (conserva); `null` = desvincular de forma
    // explícita. Colapsar ambos con `??` haría imposible subir un rol de tienda
    // a alcance organización.
    const requestedSystemRole = dto.system_role ?? dto.is_system_role;

    return {
      is_system_role: requestedSystemRole ?? existing.is_system_role,
      organization_id:
        dto.organization_id !== undefined
          ? dto.organization_id
          : existing.organization_id,
      store_id:
        dto.store_id !== undefined ? dto.store_id : existing.store_id,
    };
  }

  /**
   * Valida la coherencia del alcance ANTES de tocar la DB.
   *
   * Los CHECK `roles_system_role_has_no_tenant` y
   * `roles_store_requires_organization` ya bloquean estas combinaciones, pero
   * Postgres responde con un error de driver sin `error_code` de Vendix. Se
   * valida antes para devolver un 422 tipado en lugar de un 500 opaco.
   */
  private async assertOwnershipCoherent(
    ownership: RoleOwnership,
  ): Promise<void> {
    if (
      ownership.is_system_role &&
      (ownership.organization_id != null || ownership.store_id != null)
    ) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'A system role cannot belong to an organization or a store',
        {
          is_system_role: true,
          organization_id: ownership.organization_id,
          store_id: ownership.store_id,
        },
      );
    }

    if (ownership.store_id != null && ownership.organization_id == null) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'store_id requires organization_id',
        { store_id: ownership.store_id },
      );
    }

    if (ownership.organization_id != null) {
      const organization = await this.prisma.organizations.findUnique({
        where: { id: ownership.organization_id },
        select: { id: true },
      });

      if (!organization) {
        throw new VendixHttpException(
          ErrorCodes.SYS_VALIDATION_001,
          'Organization not found',
          { organization_id: ownership.organization_id },
        );
      }
    }

    if (ownership.store_id != null) {
      const store = await this.prisma.stores.findUnique({
        where: { id: ownership.store_id },
        select: { id: true, organization_id: true },
      });

      if (!store) {
        throw new VendixHttpException(
          ErrorCodes.SYS_VALIDATION_001,
          'Store not found',
          { store_id: ownership.store_id },
        );
      }

      if (store.organization_id !== ownership.organization_id) {
        throw new VendixHttpException(
          ErrorCodes.SYS_VALIDATION_001,
          'Store does not belong to the given organization',
          {
            store_id: ownership.store_id,
            organization_id: ownership.organization_id,
            store_organization_id: store.organization_id,
          },
        );
      }
    }
  }

  /**
   * `owner` y `super_admin` se resuelven por NOMBRE en seeds, guards y
   * provisioning. Renombrarlos o moverlos de alcance rompe silenciosamente esas
   * búsquedas, así que sólo se les permite editar la descripción.
   */
  private assertCoreRoleIdentityUntouched(
    existing: RoleOwnership & { name: string },
    targetName: string,
    ownership: RoleOwnership,
  ): void {
    if (!HIDDEN_ROLE_NAMES.includes(existing.name.toLowerCase())) return;

    const identityChanged =
      targetName !== existing.name ||
      ownership.is_system_role !== existing.is_system_role ||
      ownership.organization_id !== existing.organization_id ||
      ownership.store_id !== existing.store_id;

    if (identityChanged) {
      throw new VendixHttpException(
        ErrorCodes.SUP_ADMIN_PERM_001,
        'Core roles cannot be renamed or moved to another scope',
        { role: existing.name, scope: deriveRoleScope(existing) },
      );
    }
  }

  /**
   * Aplana la respuesta y publica el alcance DERIVADO junto a las FKs, para que
   * el frontend no tenga que reimplementar `deriveRoleScope` y arriesgarse a
   * pintar una etiqueta distinta de la que autoriza el backend.
   */
  private mapToResponse(role: any) {
    if (!role) return role;

    const permissions =
      role.role_permissions?.map((rp) => rp.permissions) || [];

    // Se elimina role_permissions para limpiar la respuesta y evitar duplicidad
    const { role_permissions, organizations, stores, ...roleData } = role;

    return {
      ...withRoleScope(roleData),
      organization_id: roleData.organization_id ?? null,
      store_id: roleData.store_id ?? null,
      organization_name: organizations?.name ?? null,
      store_name: stores?.name ?? null,
      permissions,
    };
  }
}
