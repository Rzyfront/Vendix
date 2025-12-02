import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import {
  AuditService,
  AuditAction,
  AuditResource,
} from '../audit/audit.service';
import {
  CreatePermissionDto,
  UpdatePermissionDto,
  PermissionFilterDto,
} from './dto/permission.dto';
import { http_method_enum } from '@prisma/client';

@Injectable()
export class PermissionsService {
  constructor(
    private readonly prismaService: OrganizationPrismaService,
    private readonly auditService: AuditService,
  ) {}

  // ===== CRUD PERMISSIONS =====

  async create(createPermissionDto: CreatePermissionDto, userId: number) {
    const { name, description, path, method, status } = createPermissionDto;

    // Verificar que el nombre no exista
    const existingPermission = await this.prismaService.permissions.findUnique({
      where: { name },
    });

    if (existingPermission) {
      throw new ConflictException('Ya existe un permiso con este nombre');
    }

    // Verificar que la combinación path-method no exista
    const existingPathMethod = await this.prismaService.permissions.findUnique({
      where: {
        path_method: {
          path,
          method,
        },
      },
    });

    if (existingPathMethod) {
      throw new ConflictException(
        'Ya existe un permiso con esta ruta y método',
      );
    }

    // Crear el permiso
    const permission = await this.prismaService.permissions.create({
      data: {
        name,
        description,
        path,
        method,
        status: status || 'active',
      },
      include: {
        role_permissions: {
          include: {
            roles: true,
          },
        },
      },
    });

    // Registrar auditoría
    await this.auditService.log({
      userId,
      action: AuditAction.CREATE,
      resource: AuditResource.PERMISSIONS,
      resourceId: permission.id,
      newValues: { name, description, path, method, status },
      metadata: {
        action: 'create_permission',
        permission_name: name,
      },
    });

    return permission;
  }

  async findAll(filterDto?: PermissionFilterDto, userId?: number) {
    const { method, status, search } = filterDto || {};

    const whereClause: any = {};

    if (method) {
      whereClause.method = method;
    }

    if (status) {
      whereClause.status = status;
    }

    if (search) {
      whereClause.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { path: { contains: search, mode: 'insensitive' } },
      ];
    }

    return await this.prismaService.permissions.findMany({
      where: whereClause,
      include: {
        role_permissions: {
          include: {
            roles: true,
          },
        },
        _count: {
          select: {
            role_permissions: true,
          },
        },
      },
      orderBy: {
        name: 'asc',
      },
    });
  }

  async findOne(id: number, userId?: number) {
    const permission = await this.prismaService.permissions.findUnique({
      where: { id },
      include: {
        role_permissions: {
          include: {
            roles: true,
          },
        },
        _count: {
          select: {
            role_permissions: true,
          },
        },
      },
    });

    if (!permission) {
      throw new NotFoundException('Permiso no encontrado');
    }

    return permission;
  }

  async update(
    id: number,
    updatePermissionDto: UpdatePermissionDto,
    userId: number,
  ) {
    const permission = await this.findOne(id);
    const { name, description, path, method, status } = updatePermissionDto;

    // Verificar que el nombre no exista (si se está cambiando)
    if (name && name !== permission.name) {
      const existingPermission =
        await this.prismaService.permissions.findUnique({
          where: { name },
        });

      if (existingPermission) {
        throw new ConflictException('Ya existe un permiso con este nombre');
      }
    }

    // Verificar que la combinación path-method no exista (si se están cambiando)
    if (
      (path || method) &&
      (path !== permission.path || method !== permission.method)
    ) {
      const newPath = path || permission.path;
      const newMethod = method || permission.method;

      const existingPathMethod =
        await this.prismaService.permissions.findUnique({
          where: {
            path_method: {
              path: newPath,
              method: newMethod,
            },
          },
        });

      if (existingPathMethod && existingPathMethod.id !== id) {
        throw new ConflictException(
          'Ya existe un permiso con esta ruta y método',
        );
      }
    }

    // Actualizar el permiso
    const updatedPermission = await this.prismaService.permissions.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(path && { path }),
        ...(method && { method }),
        ...(status && { status }),
      },
      include: {
        role_permissions: {
          include: {
            roles: true,
          },
        },
      },
    });

    // Registrar auditoría
    await this.auditService.log({
      userId,
      action: AuditAction.UPDATE,
      resource: AuditResource.PERMISSIONS,
      resourceId: id,
      oldValues: {
        name: permission.name,
        description: permission.description,
        path: permission.path,
        method: permission.method,
        status: permission.status,
      },
      newValues: {
        name: updatedPermission.name,
        description: updatedPermission.description,
        path: updatedPermission.path,
        method: updatedPermission.method,
        status: updatedPermission.status,
      },
      metadata: {
        action: 'update_permission',
        permission_name: updatedPermission.name,
      },
    });

    return updatedPermission;
  }

  async remove(id: number, userId: number) {
    const permission = await this.findOne(id);

    // Verificar que no tenga roles asignados
    if (permission.role_permissions.length > 0) {
      throw new BadRequestException(
        'No se puede eliminar un permiso que tiene roles asignados',
      );
    }

    // Eliminar el permiso
    await this.prismaService.permissions.delete({
      where: { id },
    });

    // Registrar auditoría
    await this.auditService.log({
      userId,
      action: AuditAction.DELETE,
      resource: AuditResource.PERMISSIONS,
      resourceId: id,
      oldValues: {
        name: permission.name,
        description: permission.description,
        path: permission.path,
        method: permission.method,
        status: permission.status,
      },
      metadata: {
        action: 'delete_permission',
        permission_name: permission.name,
      },
    });

    return { message: 'Permiso eliminado exitosamente' };
  }

  // ===== UTILIDADES =====

  async findByIds(ids: number[]) {
    return await this.prismaService.permissions.findMany({
      where: {
        id: { in: ids },
      },
    });
  }

  async findByName(name: string) {
    return await this.prismaService.permissions.findUnique({
      where: { name },
    });
  }

  async findByPathAndMethod(path: string, method: http_method_enum) {
    return await this.prismaService.permissions.findUnique({
      where: {
        path_method: {
          path,
          method,
        },
      },
    });
  }
}
