import { Injectable, NotFoundException, ConflictException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, AuditAction, AuditResource } from '../audit/audit.service';
import { CreateRoleDto, UpdateRoleDto, AssignPermissionsDto, RemovePermissionsDto, AssignRoleToUserDto, RemoveRoleFromUserDto } from './dto/role.dto';

@Injectable()
export class RolesService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  // ===== CRUD ROLES =====

  async create(createRoleDto: CreateRoleDto, userId: number) {
    const { name, description, is_system_role } = createRoleDto;

    // Verificar que el nombre no exista
    const existingRole = await this.prismaService.roles.findUnique({
      where: { name },
    });

    if (existingRole) {
      throw new ConflictException('Ya existe un rol con este nombre');
    }

    // Crear el rol
    const role = await this.prismaService.roles.create({
      data: {
        name,
        description,
        is_system_role: is_system_role || false,
      },
      include: {
        role_permissions: {
          include: {
            permissions: true,
          },
        },
        user_roles: {
          include: {
            users: {
              select: {
                id: true,
                email: true,
                first_name: true,
                last_name: true,
              },
            },
          },
        },
      },
    });

    // Registrar auditoría
    await this.auditService.log({
      userId,
      action: AuditAction.CREATE,
      resource: AuditResource.ROLES,
      resourceId: role.id,
      newValues: { name, description, is_system_role },
      metadata: {
        action: 'create_role',
        role_name: name,
      },
    });

    return role;
  }

  async findAll(userId: number) {
    // Verificar si el usuario es super_admin
    const userRoles = await this.prismaService.user_roles.findMany({
      where: { user_id: userId },
      include: {
        roles: true,
      },
    });

    const isSuperAdmin = userRoles.some(ur => ur.roles?.name === 'super_admin');

    // Si no es super_admin, filtrar el rol super_admin de los resultados
    const whereClause = isSuperAdmin ? {} : {
      name: {
        not: 'super_admin'
      }
    };

    return await this.prismaService.roles.findMany({
      where: whereClause,
      include: {
        role_permissions: {
          include: {
            permissions: true,
          },
        },
        _count: {
          select: {
            user_roles: true,
          },
        },
      },
      orderBy: {
        name: 'asc',
      },
    });
  }

  async findOne(id: number, userId?: number) {
    const role = await this.prismaService.roles.findUnique({
      where: { id },
      include: {
        role_permissions: {
          include: {
            permissions: true,
          },
        },
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
          },
        },
        _count: {
          select: {
            user_roles: true,
          },
        },
      },
    });

    if (!role) {
      throw new NotFoundException('Rol no encontrado');
    }

    // Si se proporciona userId, verificar permisos de acceso
    if (userId) {
      const userRoles = await this.prismaService.user_roles.findMany({
        where: { user_id: userId },
        include: {
          roles: true,
        },
      });

      const isSuperAdmin = userRoles.some(ur => ur.roles?.name === 'super_admin');

      // Si el rol es super_admin y el usuario no es super_admin, devolver 404
      if (role.name === 'super_admin' && !isSuperAdmin) {
        throw new NotFoundException('Rol no encontrado');
      }
    }

    return role;
  }

  async update(id: number, updateRoleDto: UpdateRoleDto, userId: number) {
    const role = await this.findOne(id);
    const { name, description } = updateRoleDto;

    // Verificar que el nombre no exista (si se está cambiando)
    if (name && name !== role.name) {
      const existingRole = await this.prismaService.roles.findUnique({
        where: { name },
      });

      if (existingRole) {
        throw new ConflictException('Ya existe un rol con este nombre');
      }
    }

    // No permitir cambiar roles del sistema
    if (role.is_system_role && (name || description)) {
      throw new BadRequestException('No se pueden modificar roles del sistema');
    }

    // Actualizar el rol
    const updatedRole = await this.prismaService.roles.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
      },
      include: {
        role_permissions: {
          include: {
            permissions: true,
          },
        },
      },
    });

    // Registrar auditoría
    await this.auditService.log({
      userId,
      action: AuditAction.UPDATE,
      resource: AuditResource.ROLES,
      resourceId: id,
      oldValues: { name: role.name, description: role.description },
      newValues: { name: updatedRole.name, description: updatedRole.description },
      metadata: {
        action: 'update_role',
        role_name: updatedRole.name,
      },
    });

    return updatedRole;
  }

  async remove(id: number, userId: number) {
    const role = await this.findOne(id);

    // No permitir eliminar roles del sistema
    if (role.is_system_role) {
      throw new BadRequestException('No se pueden eliminar roles del sistema');
    }

    // Verificar que no tenga usuarios asignados
    if (role.user_roles.length > 0) {
      throw new BadRequestException('No se puede eliminar un rol que tiene usuarios asignados');
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

  async assignPermissions(roleId: number, assignPermissionsDto: AssignPermissionsDto, userId: number) {
    const role = await this.findOne(roleId);
    const { permissionIds } = assignPermissionsDto;

    // Verificar que los permisos existan
    const permissions = await this.prismaService.permissions.findMany({
      where: {
        id: { in: permissionIds },
        status: 'active',
      },
    });

    if (permissions.length !== permissionIds.length) {
      throw new BadRequestException('Uno o más permisos no existen o están inactivos');
    }

    // Crear las relaciones role_permissions
    const rolePermissions = permissionIds.map(permissionId => ({
      role_id: roleId,
      permission_id: permissionId,
      granted: true,
    }));

    await this.prismaService.role_permissions.createMany({
      data: rolePermissions,
      skipDuplicates: true, // Evitar duplicados
    });

    // Obtener el rol actualizado
    const updatedRole = await this.findOne(roleId);

    // Registrar auditoría
    await this.auditService.log({
      userId,
      action: AuditAction.PERMISSION_CHANGE,
      resource: AuditResource.ROLES,
      resourceId: roleId,
      newValues: { assigned_permissions: permissionIds },
      metadata: {
        action: 'assign_permissions_to_role',
        role_name: role.name,
        permissions_count: permissionIds.length,
      },
    });

    return updatedRole;
  }

  async removePermissions(roleId: number, removePermissionsDto: RemovePermissionsDto, userId: number) {
    const role = await this.findOne(roleId);
    const { permissionIds } = removePermissionsDto;

    // Eliminar las relaciones role_permissions
    const result = await this.prismaService.role_permissions.deleteMany({
      where: {
        role_id: roleId,
        permission_id: { in: permissionIds },
      },
    });

    // Obtener el rol actualizado
    const updatedRole = await this.findOne(roleId);

    // Registrar auditoría
    await this.auditService.log({
      userId,
      action: AuditAction.PERMISSION_CHANGE,
      resource: AuditResource.ROLES,
      resourceId: roleId,
      oldValues: { removed_permissions: permissionIds },
      metadata: {
        action: 'remove_permissions_from_role',
        role_name: role.name,
        permissions_removed: result.count,
      },
    });

    return updatedRole;
  }

  // ===== GESTIÓN DE USUARIOS =====

  async assignRoleToUser(assignRoleToUserDto: AssignRoleToUserDto, adminUserId: number) {
    const { userId, roleId } = assignRoleToUserDto;

    // Verificar que el usuario existe
    const user = await this.prismaService.users.findUnique({
      where: { id: userId },
      select: { id: true, email: true, first_name: true, last_name: true },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    // Verificar que el rol existe
    const role = await this.prismaService.roles.findUnique({
      where: { id: roleId },
      select: { id: true, name: true },
    });

    if (!role) {
      throw new NotFoundException('Rol no encontrado');
    }

    // Verificar permisos para asignar el rol super_admin
    if (role.name === 'super_admin') {
      const adminUserRoles = await this.prismaService.user_roles.findMany({
        where: { user_id: adminUserId },
        include: {
          roles: true,
        },
      });

      const isSuperAdmin = adminUserRoles.some(ur => ur.roles?.name === 'super_admin');

      if (!isSuperAdmin) {
        throw new ForbiddenException('Solo los super administradores pueden asignar el rol super_admin');
      }

      // Verificar que no exista ya un super admin
      const existingSuperAdmin = await this.prismaService.user_roles.findFirst({
        where: {
          roles: {
            name: 'super_admin'
          }
        },
        include: {
          users: {
            select: { id: true, email: true, first_name: true, last_name: true }
          }
        }
      });

      if (existingSuperAdmin) {
        throw new ConflictException(`Ya existe un super administrador: ${existingSuperAdmin.users?.email}. Solo puede existir un super administrador en el sistema.`);
      }
    }

    // Verificar que no tenga ya este rol
    const existingUserRole = await this.prismaService.user_roles.findUnique({
      where: {
        user_id_role_id: {
          user_id: userId,
          role_id: roleId,
        },
      },
    });

    if (existingUserRole) {
      throw new ConflictException('El usuario ya tiene este rol asignado');
    }

    // Asignar el rol
    const userRole = await this.prismaService.user_roles.create({
      data: {
        user_id: userId,
        role_id: roleId,
      },
      include: {
        users: {
          select: {
            id: true,
            email: true,
            first_name: true,
            last_name: true,
          },
        },
        roles: true,
      },
    });

    // Registrar auditoría
    await this.auditService.log({
      userId: adminUserId,
      action: AuditAction.PERMISSION_CHANGE,
      resource: AuditResource.USERS,
      resourceId: userId,
      newValues: { assigned_role: role.name },
      metadata: {
        action: 'assign_role_to_user',
        target_user: user.email,
        role_name: role.name,
      },
    });

    return userRole;
  }

  async removeRoleFromUser(removeRoleFromUserDto: RemoveRoleFromUserDto, adminUserId: number) {
    const { userId, roleId } = removeRoleFromUserDto;

    // Verificar que la relación existe
    const userRole = await this.prismaService.user_roles.findUnique({
      where: {
        user_id_role_id: {
          user_id: userId,
          role_id: roleId,
        },
      },
      include: {
        users: {
          select: { id: true, email: true, first_name: true, last_name: true },
        },
        roles: {
          select: { id: true, name: true, is_system_role: true },
        },
      },
    });

    if (!userRole) {
      throw new NotFoundException('El usuario no tiene este rol asignado');
    }

    // No permitir remover roles del sistema si es el último rol del usuario
    if (userRole.roles?.is_system_role) {
      const userRoleCount = await this.prismaService.user_roles.count({
        where: { user_id: userId },
      });

      if (userRoleCount === 1) {
        throw new BadRequestException('No se puede remover el último rol del sistema de un usuario');
      }
    }

    // Remover el rol
    await this.prismaService.user_roles.delete({
      where: {
        user_id_role_id: {
          user_id: userId,
          role_id: roleId,
        },
      },
    });

    // Registrar auditoría
    await this.auditService.log({
      userId: adminUserId,
      action: AuditAction.PERMISSION_CHANGE,
      resource: AuditResource.USERS,
      resourceId: userId,
      oldValues: { removed_role: userRole.roles?.name },
      metadata: {
        action: 'remove_role_from_user',
        target_user: userRole.users?.email,
        role_name: userRole.roles?.name,
      },
    });

    return { message: 'Rol removido del usuario exitosamente' };
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

    const permissions = userRoles.flatMap(userRole =>
      userRole.roles?.role_permissions?.map(rp => rp.permissions) || []
    );

    // Remover duplicados
    const uniquePermissions = permissions.filter(
      (permission, index, self) =>
        index === self.findIndex(p => p.id === permission.id)
    );

    return uniquePermissions;
  }

  async getUserRoles(userId: number) {
    return await this.prismaService.user_roles.findMany({
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
  }
}
