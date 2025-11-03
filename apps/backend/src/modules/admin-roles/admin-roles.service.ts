import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateRoleDto,
  UpdateRoleDto,
  AssignPermissionsDto,
  RemovePermissionsDto,
} from '../roles/dto/role.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class AdminRolesService {
  constructor(private prisma: PrismaService) {}

  async create(createRoleDto: CreateRoleDto) {
    const existingRole = await this.prisma.roles.findUnique({
      where: { name: createRoleDto.name },
    });

    if (existingRole) {
      throw new ConflictException('Role with this name already exists');
    }

    return this.prisma.roles.create({
      data: {
        name: createRoleDto.name,
        description: createRoleDto.description,
        is_system_role: createRoleDto.system_role || false,
      },
      include: {
        role_permissions: {
          include: {
            permissions: {
              select: { id: true, name: true, description: true },
            },
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
        _count: {
          select: {
            role_permissions: true,
            user_roles: true,
          },
        },
      },
    });
  }

  async findAll(query: {
    page?: number;
    limit?: number;
    search?: string;
    is_system_role?: boolean;
    organization_id?: number;
  }) {
    const {
      page = 1,
      limit = 10,
      search,
      is_system_role,
      organization_id,
    } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.rolesWhereInput = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (is_system_role !== undefined) {
      where.is_system_role = is_system_role;
    }

    const [data, total] = await Promise.all([
      this.prisma.roles.findMany({
        where,
        skip,
        take: limit,
        include: {
          role_permissions: {
            include: {
              permissions: {
                select: { id: true, name: true, description: true },
              },
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
          _count: {
            select: {
              role_permissions: true,
              user_roles: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.roles.count({ where }),
    ]);

    return {
      data,
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
      include: {
        role_permissions: {
          include: {
            permissions: {
              select: { id: true, name: true, description: true },
            },
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
        _count: {
          select: {
            role_permissions: true,
            user_roles: true,
          },
        },
      },
    });

    if (!role) {
      throw new NotFoundException('Role not found');
    }

    return role;
  }

  async update(id: number, updateRoleDto: UpdateRoleDto) {
    const existingRole = await this.prisma.roles.findUnique({
      where: { id },
    });

    if (!existingRole) {
      throw new NotFoundException('Role not found');
    }

    if (updateRoleDto.name && updateRoleDto.name !== existingRole.name) {
      const nameExists = await this.prisma.roles.findFirst({
        where: {
          name: updateRoleDto.name,
          id: { not: id },
        },
      });

      if (nameExists) {
        throw new ConflictException('Role with this name already exists');
      }
    }

    return this.prisma.roles.update({
      where: { id },
      data: {
        ...updateRoleDto,
        updated_at: new Date(),
      },
      include: {
        role_permissions: {
          include: {
            permissions: {
              select: { id: true, name: true, description: true },
            },
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
        _count: {
          select: {
            role_permissions: true,
            user_roles: true,
          },
        },
      },
    });
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
      throw new NotFoundException('Role not found');
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
      throw new NotFoundException('Role not found');
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
      throw new NotFoundException('Role not found');
    }

    await this.prisma.role_permissions.deleteMany({
      where: {
        role_id: roleId,
        permission_id: { in: removePermissionsDto.permission_ids },
      },
    });

    return this.findOne(roleId);
  }

  async getDashboardStats() {
    const [
      totalRoles,
      systemRoles,
      customRoles,
      totalPermissions,
      rolesByUserCount,
      recentRoles,
    ] = await Promise.all([
      this.prisma.roles.count(),
      this.prisma.roles.count({ where: { is_system_role: true } }),
      this.prisma.roles.count({ where: { is_system_role: false } }),
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
      recentRoles,
    };
  }
}
