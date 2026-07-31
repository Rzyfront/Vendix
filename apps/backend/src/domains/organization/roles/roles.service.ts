import { Injectable } from '@nestjs/common';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import {
  AuditService,
  AuditAction,
  AuditResource,
} from '../../../common/audit/audit.service';
import { RequestContextService } from '@common/context/request-context.service';
import { UserRoleAssignmentService } from '@common/services/user-role-assignment.service';
import {
  RoleActor,
  assertRoleEditable,
  buildRoleVisibilityWhere,
  deriveRoleScope,
  resolveNewRoleOwnership,
} from '@common/utils/role-scope.util';
import {
  CreateRoleDto,
  UpdateRoleDto,
  AssignPermissionsDto,
  RemovePermissionsDto,
  AssignRoleToUserDto,
  RemoveRoleFromUserDto,
} from './dto/role.dto';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { Prisma } from '@prisma/client';
import {
  RoleDashboardStatsDto,
  RoleWithPermissionDescriptionsDto,
} from './dto/role.dto';

/** `include` común: todo lo que necesita `transformRoleWithPermissionDescriptions`. */
const ROLE_DETAIL_INCLUDE = {
  role_permissions: { include: { permissions: true } },
  stores: { select: { id: true, name: true } },
  _count: { select: { user_roles: true } },
} as const;

@Injectable()
export class RolesService {
  constructor(
    private readonly prismaService: OrganizationPrismaService,
    private readonly auditService: AuditService,
    private readonly userRoleAssignment: UserRoleAssignmentService,
  ) {}

  // ===== UTILIDADES PRIVADAS =====

  /**
   * QUI-72 — actor de nivel ORGANIZACIÓN.
   *
   * Todo este dominio vive bajo `/organization/*`, así que el nivel es fijo; lo
   * único variable es la organización del contexto. Sin ella se falla cerrado:
   * un `organization_id: undefined` colapsaría los filtros de visibilidad a
   * "todas las organizaciones", que es exactamente la fuga que cierra QUI-72.
   */
  private getActor(): RoleActor {
    const organization_id = RequestContextService.getContext()?.organization_id;
    if (organization_id == null) {
      throw new VendixHttpException(ErrorCodes.ROLE_SCOPE_002);
    }
    // QUI-581 — `actor_roles` alimenta la matriz de ASIGNACIÓN (`canAssignRole`),
    // no la de edición. Ver `RoleActor.actor_roles` para el origen y por qué no es
    // falsificable.
    return {
      level: 'organization',
      organization_id,
      actor_roles: RequestContextService.getRoles(),
    };
  }

  /**
   * Carga un rol aplicando la matriz de VISIBILIDAD del actor.
   *
   * El filtro va envuelto en `AND` a propósito: `OrganizationPrismaService`
   * inyecta su propio `OR` de nivel superior sobre el modelo `roles`
   * (`{...where, OR: [...]}`) y sobrescribiría un `OR` puesto por el llamador.
   * Con `AND` los dos filtros se componen en vez de pisarse.
   */
  private async loadVisibleRoleRow(id: number, actor: RoleActor) {
    const role = await this.prismaService.roles.findFirst({
      where: { AND: [{ id }, buildRoleVisibilityWhere(actor)] },
      include: {
        ...ROLE_DETAIL_INCLUDE,
        user_roles: {
          include: {
            users: {
              select: {
                id: true,
                email: true,
                first_name: true,
                last_name: true,
                state: true,
              },
            },
            stores: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!role) {
      // Mismo 404 para "no existe" y "no visible": distinguirlos permitiría
      // enumerar roles de otros tenants por ID (IDOR de lectura).
      throw new VendixHttpException(ErrorCodes.ROLE_SCOPE_004);
    }

    return role;
  }

  /**
   * Valida que una tienda exista y pertenezca a la organización del actor.
   *
   * `this.prismaService.stores` ya está org-scoped, así que una tienda de otra
   * organización devuelve `null` y no hay forma de distinguir "no existe" de
   * "no es tuya" desde fuera.
   */
  private async assertStoreBelongsToActor(
    store_id: number,
    actor: RoleActor,
  ): Promise<number> {
    const store = await this.prismaService.stores.findFirst({
      where: { id: store_id },
      select: { id: true },
    });

    if (!store) {
      throw new VendixHttpException(ErrorCodes.ROLE_ASSIGN_007, undefined, {
        store_id,
        organization_id: actor.organization_id,
        reason: 'store_not_in_organization',
      });
    }

    return store.id;
  }

  /**
   * Transforma un rol con permisos completos a un rol con solo descripciones de permisos
   */
  private transformRoleWithPermissionDescriptions(
    role: any,
  ): RoleWithPermissionDescriptionsDto {
    return {
      id: role.id,
      name: role.name,
      // QUI-473: expose organization_id so callers (e.g. the update()
      // pre-check) know which org owns the role. NULL for system roles.
      organization_id: role.organization_id,
      description: role.description,
      system_role: role.is_system_role,
      // QUI-72: alcance derivado + tienda dueña, para que la UI pueda etiquetar
      // "Sistema / Organización / Tienda X" sin re-derivar la matriz.
      scope: deriveRoleScope(role),
      store_id: role.store_id ?? null,
      store_name: role.stores?.name ?? null,
      created_at: role.created_at,
      updated_at: role.updated_at,
      permissions:
        role.role_permissions
          ?.map((rp: any) => rp.permissions?.description)
          .filter(Boolean) || [],
      user_roles: role.user_roles,
      _count: role._count,
    };
  }

  // ===== CRUD ROLES =====

  async create(createRoleDto: CreateRoleDto, userId: number) {
    const { name, description, store_id } = createRoleDto;
    const actor = this.getActor();

    // QUI-72: la propiedad del rol la decide el CONTEXTO, no el body. El nivel
    // organización jamás crea roles de sistema (`is_system_role` del DTO se
    // ignora) ni roles de otra organización.
    const ownership = resolveNewRoleOwnership(actor);

    // El admin de organización SÍ puede crear un rol de alcance tienda, pero
    // sólo para una de SUS tiendas.
    const target_store_id =
      store_id != null
        ? await this.assertStoreBelongsToActor(store_id, actor)
        : null;

    // QUI-473 + QUI-72: la unicidad es por (organization_id, store_id, name).
    // Dos cosas que la base NO puede hacer sola y por eso se validan aquí:
    //
    // 1. El índice único deja convivir `(org_x, NULL, 'carrier')` con
    //    `(NULL, NULL, 'carrier')` (rol de sistema). Un rol de organización que
    //    se llame igual que uno de sistema rompería la resolución por nombre,
    //    así que se rechaza en aplicación.
    // 2. El `AND` es obligatorio: `OrganizationPrismaService` reescribe el `OR`
    //    de primer nivel sobre `roles`. Un `OR` suelto aquí sería descartado y
    //    la pre-verificación pasaría a comprobar otra cosa.
    const existingRole = await this.prismaService.roles.findFirst({
      where: {
        AND: [
          { name },
          {
            OR: [
              {
                organization_id: ownership.organization_id,
                store_id: target_store_id,
              },
              { is_system_role: true, organization_id: null },
            ],
          },
        ],
      },
      select: { id: true },
    });

    if (existingRole) {
      throw new VendixHttpException(ErrorCodes.ORG_ROLE_001);
    }

    // Create the role. QUI-473: catch P2002 (race between this pre-check and
    // the INSERT below) and translate the raw Prisma error into the same
    // domain error the pre-check raises, so the UI gets a clean 409.
    let role;
    try {
      role = await this.prismaService.roles.create({
        data: {
          name,
          description,
          is_system_role: false,
          organization_id: ownership.organization_id,
          store_id: target_store_id,
        },
        include: ROLE_DETAIL_INCLUDE,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new VendixHttpException(ErrorCodes.ORG_ROLE_001);
      }
      throw err;
    }

    // Registrar auditoría
    await this.auditService.log({
      userId,
      action: AuditAction.CREATE,
      resource: AuditResource.ROLES,
      resourceId: role.id,
      newValues: {
        name,
        description,
        is_system_role: false,
        organization_id: role.organization_id,
        store_id: role.store_id,
      },
      metadata: {
        action: 'create_role',
        role_name: name,
        scope: deriveRoleScope(role),
      },
    });

    return this.transformRoleWithPermissionDescriptions(role);
  }

  /**
   * QUI-72 — listado con la matriz de visibilidad del nivel organización:
   * roles de sistema (sólo lectura) + TODOS los de la organización, incluidos
   * los de alcance tienda de sus tiendas.
   *
   * Antes esta consulta corría prácticamente sin filtro propio y dependía sólo
   * del scope implícito del cliente Prisma, lo que dejaba pasar filas de otras
   * organizaciones en cuanto el contexto quedaba a medias. Ahora el filtro es
   * explícito y falla cerrado.
   */
  async findAll(user_id: number) {
    const actor = this.getActor();

    const user_roles = await this.prismaService.user_roles.findMany({
      where: { user_id: user_id },
      include: {
        roles: true,
      },
    });

    const is_owner_or_admin = user_roles.some(
      (ur) => ur.roles?.name === 'owner' || ur.roles?.name === 'admin',
    );

    // Visibilidad de tenant (obligatoria) + ocultamiento de owner/admin para
    // quien no lo es (regla de producto preexistente, no de seguridad).
    const and_filters: Prisma.rolesWhereInput[] = [
      buildRoleVisibilityWhere(actor),
    ];
    if (!is_owner_or_admin) {
      and_filters.push({ name: { notIn: ['owner', 'admin'] } });
    }

    const roles = await this.prismaService.roles.findMany({
      where: { AND: and_filters },
      include: ROLE_DETAIL_INCLUDE,
      orderBy: {
        name: 'asc',
      },
    });

    // Transformar cada rol para incluir solo las descripciones de los permisos
    return roles.map((role) =>
      this.transformRoleWithPermissionDescriptions(role),
    );
  }

  async findOne(id: number, userId?: number) {
    const actor = this.getActor();
    const role = await this.loadVisibleRoleRow(id, actor);

    // Si se proporciona userId, verificar permisos de acceso
    if (userId) {
      const userRoles = await this.prismaService.user_roles.findMany({
        where: { user_id: userId },
        include: {
          roles: true,
        },
      });

      const isSuperAdmin = userRoles.some(
        (ur) => ur.roles?.name === 'super_admin',
      );

      // Si el rol es super_admin y el usuario no es super_admin, devolver 404
      if (role.name === 'super_admin' && !isSuperAdmin) {
        throw new VendixHttpException(ErrorCodes.ROLE_SCOPE_004);
      }
    }

    return this.transformRoleWithPermissionDescriptions(role);
  }

  async update(id: number, updateRoleDto: UpdateRoleDto, userId: number) {
    const actor = this.getActor();
    const role = await this.loadVisibleRoleRow(id, actor);
    const { name, description } = updateRoleDto;

    // QUI-72: la matriz de edición sustituye al chequeo ad-hoc `system_role`.
    // Un rol de sistema (o de otra organización) responde 403 ROLE_SCOPE_001,
    // nunca un 200 silencioso que aparenta haber guardado.
    assertRoleEditable(role, actor);

    // Verificar que el nombre no exista (si se está cambiando)
    // QUI-473 + QUI-72: la clave es (organization_id, store_id, name), así que
    // el rename sólo colisiona dentro del MISMO alcance del rol. Se sigue
    // bloqueando la colisión contra nombres de roles de sistema (misma razón
    // que en `create()`). El `AND` evita que el `OR` lo pise el scope de
    // OrganizationPrismaService.
    if (name && name !== role.name) {
      const existingRole = await this.prismaService.roles.findFirst({
        where: {
          AND: [
            { name },
            { id: { not: id } },
            {
              OR: [
                {
                  organization_id: role.organization_id,
                  store_id: role.store_id,
                },
                { is_system_role: true, organization_id: null },
              ],
            },
          ],
        },
        select: { id: true },
      });

      if (existingRole) {
        throw new VendixHttpException(ErrorCodes.ORG_ROLE_001);
      }
    }

    // Actualizar el rol. QUI-473: catch P2002 from the new composite unique
    // so a concurrent rename cannot leak the raw Prisma error.
    let updatedRole;
    try {
      updatedRole = await this.prismaService.roles.update({
        where: { id },
        data: {
          ...(name && { name }),
          ...(description !== undefined && { description }),
        },
        include: ROLE_DETAIL_INCLUDE,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new VendixHttpException(ErrorCodes.ORG_ROLE_001);
      }
      throw err;
    }

    // Registrar auditoría. Estaba DESPUÉS de un `return`, o sea muerta: ninguna
    // edición de rol quedaba auditada.
    await this.auditService.log({
      userId,
      action: AuditAction.UPDATE,
      resource: AuditResource.ROLES,
      resourceId: id,
      oldValues: { name: role.name, description: role.description },
      newValues: {
        name: updatedRole.name,
        description: updatedRole.description,
      },
      metadata: {
        action: 'update_role',
        role_name: updatedRole.name,
        scope: deriveRoleScope(updatedRole),
      },
    });

    return this.transformRoleWithPermissionDescriptions(updatedRole);
  }

  async remove(id: number, userId: number) {
    const actor = this.getActor();
    const role = await this.loadVisibleRoleRow(id, actor);

    // QUI-72: roles de sistema y de otras organizaciones → 403 tipado.
    assertRoleEditable(role, actor);

    // Verificar que no tenga usuarios asignados
    if (role.user_roles && role.user_roles.length > 0) {
      throw new VendixHttpException(ErrorCodes.ORG_ROLE_001);
    }

    // Eliminar el rol
    await this.prismaService.roles.delete({
      where: { id },
    });

    // Registrar auditoría
    await this.auditService.log({
      userId,
      action: AuditAction.DELETE,
      resource: AuditResource.ROLES,
      resourceId: id,
      oldValues: { name: role.name, description: role.description },
      metadata: {
        action: 'delete_role',
        role_name: role.name,
      },
    });

    return { message: 'Rol eliminado exitosamente' };
  }

  // ===== GESTIÓN DE PERMISOS =====

  async assignPermissions(
    role_id: number,
    assignPermissionsDto: AssignPermissionsDto,
    userId: number,
  ) {
    const actor = this.getActor();
    const role = await this.loadVisibleRoleRow(role_id, actor);
    const { permission_ids } = assignPermissionsDto;

    // QUI-72: los permisos de un rol son parte de su definición, así que se
    // rigen por la MISMA matriz de edición que el rol.
    assertRoleEditable(role, actor);

    // Verificar que los permisos existan
    const permissions = await this.prismaService.permissions.findMany({
      where: {
        id: { in: permission_ids },
        status: 'active',
      },
      select: {
        id: true,
        is_system_permission: true,
      },
    });

    if (permissions.length !== permission_ids.length) {
      throw new VendixHttpException(ErrorCodes.AUTH_VALIDATE_001);
    }

    // Verificar que no se asignen permisos del sistema
    const systemPermission = permissions.find((p) => p.is_system_permission);
    if (systemPermission) {
      throw new VendixHttpException(ErrorCodes.ORG_PERM_001);
    }

    // Crear las relaciones role_permissions
    const rolePermissions = permission_ids.map((permissionId) => ({
      role_id: role_id,
      permission_id: permissionId,
      granted: true,
    }));

    await this.prismaService.role_permissions.createMany({
      data: rolePermissions,
      skipDuplicates: true, // Evitar duplicados
    });

    // Obtener el rol actualizado
    const updatedRole = await this.prismaService.roles.findFirst({
      where: { id: role_id },
      include: ROLE_DETAIL_INCLUDE,
    });

    // Registrar auditoría
    await this.auditService.log({
      userId,
      action: AuditAction.PERMISSION_CHANGE,
      resource: AuditResource.ROLES,
      resourceId: role_id,
      newValues: { assigned_permissions: permission_ids },
      metadata: {
        action: 'assign_permissions_to_role',
        role_name: role.name,
        permissions_count: permission_ids.length,
      },
    });

    return this.transformRoleWithPermissionDescriptions(updatedRole);
  }

  async removePermissions(
    role_id: number,
    removePermissionsDto: RemovePermissionsDto,
    userId: number,
  ) {
    const actor = this.getActor();
    const role = await this.loadVisibleRoleRow(role_id, actor);
    const { permission_ids } = removePermissionsDto;

    // QUI-72: misma matriz de edición que `assignPermissions`.
    assertRoleEditable(role, actor);

    // Verificar que no se remuevan permisos del sistema
    const permissions = await this.prismaService.permissions.findMany({
      where: {
        id: { in: permission_ids },
        status: 'active',
      },
      select: {
        id: true,
        is_system_permission: true,
      },
    });

    const systemPermission = permissions.find((p) => p.is_system_permission);
    if (systemPermission) {
      throw new VendixHttpException(ErrorCodes.ORG_PERM_001);
    }

    // Verificar que no se remuevan permisos del sistema
    const permissionsToRemove = await this.prismaService.permissions.findMany({
      where: {
        id: { in: permission_ids },
        status: 'active',
      },
      select: {
        id: true,
        is_system_permission: true,
      },
    });

    const systemPerm = permissionsToRemove.find((p) => p.is_system_permission);
    if (systemPerm) {
      throw new VendixHttpException(ErrorCodes.ORG_PERM_001);
    }

    // Eliminar las relaciones role_permissions
    const result = await this.prismaService.role_permissions.deleteMany({
      where: {
        role_id: role_id,
        permission_id: { in: permission_ids },
      },
    });

    // Obtener el rol actualizado
    const updatedRole = await this.prismaService.roles.findFirst({
      where: { id: role_id },
      include: ROLE_DETAIL_INCLUDE,
    });

    // Registrar auditoría
    await this.auditService.log({
      userId,
      action: AuditAction.PERMISSION_CHANGE,
      resource: AuditResource.ROLES,
      resourceId: role_id,
      oldValues: { removed_permissions: permission_ids },
      metadata: {
        action: 'remove_permissions_from_role',
        role_name: role.name,
        permissions_removed: result.count,
      },
    });

    return this.transformRoleWithPermissionDescriptions(updatedRole);
  }

  async getRolePermissions(role_id: number, userId?: number) {
    // QUI-72: el rol debe existir Y ser visible para este nivel; si no, 404.
    const actor = this.getActor();
    const role = await this.prismaService.roles.findFirst({
      where: { AND: [{ id: role_id }, buildRoleVisibilityWhere(actor)] },
      select: { id: true, name: true },
    });

    if (!role) {
      throw new VendixHttpException(ErrorCodes.ROLE_SCOPE_004);
    }

    // Si se proporciona userId, verificar permisos de acceso
    if (userId) {
      const userRoles = await this.prismaService.user_roles.findMany({
        where: { user_id: userId },
        include: {
          roles: true,
        },
      });

      const isSuperAdmin = userRoles.some(
        (ur) => ur.roles?.name === 'super_admin',
      );

      // Si el rol es super_admin y el usuario no es super_admin, devolver 404
      if (role.name === 'super_admin' && !isSuperAdmin) {
        throw new VendixHttpException(ErrorCodes.ROLE_SCOPE_004);
      }
    }

    // Obtener los IDs de los permisos del rol
    const rolePermissions = await this.prismaService.role_permissions.findMany({
      where: { role_id: role_id },
      select: { permission_id: true },
      orderBy: { permission_id: 'asc' },
    });

    // Extraer solo los IDs de los permisos
    const permissionIds = rolePermissions.map((rp) => rp.permission_id);

    return {
      role_id: role_id,
      permission_ids: permissionIds,
      total_permissions: permissionIds.length,
    };
  }

  // ===== GESTIÓN DE USUARIOS =====

  /**
   * QUI-72 — asignación rol→usuario.
   *
   * Toda la matriz (visibilidad del rol, roles núcleo, roles de sistema,
   * pertenencia del usuario al tenant, tienda destino, 409 por duplicado) vive
   * en `UserRoleAssignmentService`. Este método NO escribe `user_roles`: si lo
   * hiciera, esta dirección y la de `/organization/users/:id/roles/:roleId`
   * aplicarían reglas distintas sobre la misma tabla y las dos pantallas
   * mostrarían estados incompatibles.
   *
   * Se conservan la ruta, el 403 de privilegio para `super_admin` y las claves
   * `id`/`user_id`/`role_id`/`users`/`roles` de la respuesta para no romper al
   * frontend actual; `store_id` y `scope` son aditivos.
   */
  async assignRoleToUser(
    assignRoleToUserDto: AssignRoleToUserDto,
    adminUserId: number,
  ) {
    const actor = this.getActor();
    const { user_id, role_id, store_id } = assignRoleToUserDto;

    await this.assertSuperAdminGrantAllowed(role_id, adminUserId);

    const assignment = await this.userRoleAssignment.assign({
      user_id,
      role_id,
      actor,
      store_id: store_id ?? null,
    });

    const [user, role] = await Promise.all([
      this.prismaService.users.findFirst({
        where: { id: user_id },
        select: {
          id: true,
          email: true,
          first_name: true,
          last_name: true,
        },
      }),
      this.prismaService.roles.findFirst({
        where: { id: role_id },
        include: { stores: { select: { id: true, name: true } } },
      }),
    ]);

    // Registrar auditoría
    await this.auditService.log({
      userId: adminUserId,
      action: AuditAction.PERMISSION_CHANGE,
      resource: AuditResource.USERS,
      resourceId: user_id,
      newValues: {
        assigned_role: role?.name,
        store_id: assignment.store_id,
      },
      metadata: {
        action: 'assign_role_to_user',
        target_user: user?.email,
        role_name: role?.name,
        scope: assignment.scope,
      },
    });

    return {
      id: assignment.assignment_id,
      assignment_id: assignment.assignment_id,
      user_id,
      role_id,
      store_id: assignment.store_id,
      store_name: role?.stores?.name ?? null,
      scope: assignment.scope,
      users: user,
      roles: role,
    };
  }

  /**
   * QUI-72 — remoción rol→usuario, espejo exacto de `assignRoleToUser`.
   *
   * `store_id` omitido remueve la asignación org-wide, NO las de tienda: son
   * filas distintas desde que el unique es (user_id, role_id, store_id).
   */
  async removeRoleFromUser(
    removeRoleFromUserDto: RemoveRoleFromUserDto,
    adminUserId: number,
  ) {
    const actor = this.getActor();
    const { user_id, role_id, store_id } = removeRoleFromUserDto;

    const role = await this.prismaService.roles.findFirst({
      where: { id: role_id },
      select: { id: true, name: true, is_system_role: true },
    });

    // Regla preexistente: no dejar al usuario sin ningún rol al quitarle uno
    // de sistema. Se conserva porque `UserRoleAssignmentService` no la conoce
    // (es una regla de este dominio, no de la matriz de alcance).
    if (role?.is_system_role) {
      const userRoleCount = await this.prismaService.user_roles.count({
        where: { user_id: user_id },
      });

      if (userRoleCount === 1) {
        throw new VendixHttpException(ErrorCodes.ORG_PERM_001);
      }
    }

    const removed = await this.userRoleAssignment.remove({
      user_id,
      role_id,
      actor,
      store_id: store_id ?? null,
    });

    // Registrar auditoría
    await this.auditService.log({
      userId: adminUserId,
      action: AuditAction.PERMISSION_CHANGE,
      resource: AuditResource.USERS,
      resourceId: user_id,
      oldValues: { removed_role: role?.name, store_id: removed.store_id },
      metadata: {
        action: 'remove_role_from_user',
        role_name: role?.name,
      },
    });

    return {
      message: 'Rol removido del usuario exitosamente',
      user_id,
      role_id,
      store_id: removed.store_id,
    };
  }

  /**
   * Preserva la validación histórica de privilegio para `super_admin`.
   *
   * `UserRoleAssignmentService` ya bloquea `super_admin` para cualquier actor
   * que no sea superadmin (ROLE_ASSIGN_002), pero este pre-chequeo se mantiene
   * para no cambiar el código de error que el frontend ya mapea y para
   * conservar la invariante "sólo puede existir un super_admin".
   */
  private async assertSuperAdminGrantAllowed(
    role_id: number,
    adminUserId: number,
  ) {
    const role = await this.prismaService.roles.findFirst({
      where: { id: role_id },
      select: { id: true, name: true },
    });

    if (!role) {
      throw new VendixHttpException(ErrorCodes.ROLE_SCOPE_004);
    }

    if (role.name !== 'super_admin') return;

    const adminUserRoles = await this.prismaService.user_roles.findMany({
      where: { user_id: adminUserId },
      include: { roles: true },
    });

    const isSuperAdmin = adminUserRoles.some(
      (ur) => ur.roles?.name === 'super_admin',
    );

    if (!isSuperAdmin) {
      throw new VendixHttpException(ErrorCodes.ORG_PERM_001);
    }

    // Verificar que no exista ya un super admin
    const existingSuperAdmin = await this.prismaService.user_roles.findFirst({
      where: { roles: { name: 'super_admin' } },
      select: { id: true },
    });

    if (existingSuperAdmin) {
      throw new VendixHttpException(ErrorCodes.ORG_ROLE_001);
    }
  }

  // ===== UTILIDADES =====

  async getUserPermissions(userId: number) {
    const userRoles = await this.prismaService.user_roles.findMany({
      where: { user_id: userId },
      include: {
        roles: {
          include: {
            role_permissions: {
              include: {
                permissions: true,
              },
            },
          },
        },
      },
    });

    const permissions = userRoles.flatMap(
      (userRole) =>
        userRole.roles?.role_permissions?.map((rp) => rp.permissions) || [],
    );

    // Remover duplicados
    const uniquePermissions = permissions.filter(
      (permission, index, self) =>
        index === self.findIndex((p) => p.id === permission.id),
    );

    return uniquePermissions;
  }

  /**
   * QUI-72 — asignaciones del usuario CON su `store_id`.
   *
   * Sin el `store_id` la lista es ambigua: "Cajero" no dice si aplica en toda
   * la organización o sólo en una tienda, y la UI no puede ofrecer quitar la
   * asignación correcta. Delega en el servicio único para que esta lectura y
   * la de `/organization/roles/:id` describan exactamente las mismas filas.
   */
  async getUserRoles(userId: number) {
    const actor = this.getActor();
    return this.userRoleAssignment.listUserRoles(userId, actor);
  }

  // ===== DASHBOARD STATS =====

  async getDashboardStats(userId: number): Promise<RoleDashboardStatsDto> {
    // Verificar si el usuario es super_admin
    const userRoles = await this.prismaService.user_roles.findMany({
      where: { user_id: userId },
      include: {
        roles: true,
      },
    });

    const isSuperAdmin = userRoles.some(
      (ur) => ur.roles?.name === 'super_admin',
    );

    // Si no es super_admin, no puede ver estadísticas completas
    if (!isSuperAdmin) {
      throw new VendixHttpException(ErrorCodes.ORG_PERM_001);
    }

    // Obtener el total de roles
    const totalRoles = await this.prismaService.roles.count();

    // Obtener el total de roles del sistema
    const systemRoles = await this.prismaService.roles.count({
      where: { is_system_role: true },
    });

    // Calcular roles personalizados
    const customRoles = totalRoles - systemRoles;

    // Obtener el total de permisos
    const totalPermissions = await this.prismaService.permissions.count({
      where: { status: 'active' },
    });

    return {
      total_roles: totalRoles,
      system_roles: systemRoles,
      custom_roles: customRoles,
      total_permissions: totalPermissions,
    };
  }
}
