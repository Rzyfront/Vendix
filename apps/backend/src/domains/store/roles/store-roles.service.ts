import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import {
  CreateStoreRoleDto,
  UpdateStoreRoleDto,
  AssignPermissionsDto,
  RemovePermissionsDto,
} from './dto/store-role.dto';

@Injectable()
export class StoreRolesService {
  /** Core roles that are never exposed to store-level UIs */
  private readonly HIDDEN_ROLES = ['owner', 'super_admin'];

  constructor(
    private readonly prisma: StorePrismaService,
  ) {}

  // ===== PRIVATE HELPERS =====

  private transformRole(role: any) {
    return {
      id: role.id,
      name: role.name,
      description: role.description,
      is_system_role: role.is_system_role,
      organization_id: role.organization_id,
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
    const context = RequestContextService.getContext();
    const organization_id = context?.organization_id;

    if (!organization_id) {
      throw new ForbiddenException('Organization context required');
    }

    // Roles are NOT auto-scoped in StorePrismaService, so we filter manually.
    // Include both org-specific roles AND system roles, but exclude core hidden roles.
    const roles = await this.prisma.roles.findMany({
      where: {
        name: { notIn: this.HIDDEN_ROLES },
        OR: [
          { organization_id },
          { is_system_role: true },
        ],
      },
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
      orderBy: { name: 'asc' },
    });

    return roles.map((role) => this.transformRole(role));
  }

  async findOne(id: number) {
    const context = RequestContextService.getContext();
    const organization_id = context?.organization_id;

    const role = await this.prisma.roles.findFirst({
      where: {
        id,
        OR: [
          { organization_id },
          { is_system_role: true },
        ],
      },
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
    });

    if (!role) {
      throw new NotFoundException('Role not found');
    }

    return this.transformRole(role);
  }

  async create(dto: CreateStoreRoleDto) {
    const context = RequestContextService.getContext();
    const organization_id = context?.organization_id;

    if (!organization_id) {
      throw new ForbiddenException('Organization context required');
    }

    // Check name uniqueness within organization
    const existing = await this.prisma.roles.findFirst({
      where: {
        name: dto.name,
        OR: [
          { organization_id },
          { is_system_role: true },
        ],
      },
    });

    if (existing) {
      throw new ConflictException('A role with this name already exists');
    }

    // Store admins can NEVER create system roles
    const role = await this.prisma.roles.create({
      data: {
        name: dto.name,
        description: dto.description,
        is_system_role: false,
        organization_id,
      },
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
    });

    return this.transformRole(role);
  }

  async update(id: number, dto: UpdateStoreRoleDto) {
    const role = await this.findOne(id);

    if (role.is_system_role) {
      throw new ForbiddenException('System roles cannot be modified');
    }

    // Check name uniqueness if changing
    if (dto.name && dto.name !== role.name) {
      const context = RequestContextService.getContext();
      const existing = await this.prisma.roles.findFirst({
        where: {
          name: dto.name,
          OR: [
            { organization_id: context?.organization_id },
            { is_system_role: true },
          ],
        },
      });

      if (existing) {
        throw new ConflictException('A role with this name already exists');
      }
    }

    const updated = await this.prisma.roles.update({
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
            user_roles: true,
          },
        },
      },
    });

    return this.transformRole(updated);
  }

  async remove(id: number) {
    const role = await this.findOne(id);

    if (role.is_system_role) {
      throw new ForbiddenException('System roles cannot be deleted');
    }

    if (role._count?.user_roles > 0) {
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
    const role = await this.findOne(role_id);

    if (role.is_system_role) {
      throw new ForbiddenException(
        'Cannot modify permissions of system roles',
      );
    }

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
      throw new ForbiddenException(
        'Only store:* permissions can be assigned to store roles',
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
    const role = await this.findOne(role_id);

    if (role.is_system_role) {
      throw new ForbiddenException(
        'Cannot modify permissions of system roles',
      );
    }

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

  // ===== STATS =====

  async getStats() {
    const context = RequestContextService.getContext();
    const organization_id = context?.organization_id;

    if (!organization_id) {
      throw new ForbiddenException('Organization context required');
    }

    const [total_roles, system_roles, total_store_permissions] =
      await Promise.all([
        this.prisma.roles.count({
          where: {
            name: { notIn: this.HIDDEN_ROLES },
            OR: [
              { organization_id },
              { is_system_role: true },
            ],
          },
        }),
        this.prisma.roles.count({
          where: {
            is_system_role: true,
            name: { notIn: this.HIDDEN_ROLES },
          },
        }),
        this.prisma.permissions.count({
          where: {
            name: { startsWith: 'store:' },
            status: 'active',
          },
        }),
      ]);

    const custom_roles = total_roles - system_roles;

    return {
      total_roles,
      system_roles,
      custom_roles,
      total_store_permissions,
    };
  }
}
