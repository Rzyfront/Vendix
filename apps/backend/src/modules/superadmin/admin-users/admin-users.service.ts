import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  CreateUserDto,
  UpdateUserDto,
  UserQueryDto,
} from 'src/modules/users/dto';
import { user_state_enum } from '@prisma/client';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createUserDto: CreateUserDto) {
    // Check if email already exists
    const existingUser = await (
      this.prisma.withoutScope() as any
    ).users.findUnique({
      where: { email: createUserDto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

    const user = await (this.prisma.withoutScope() as any).users.create({
      data: {
        ...createUserDto,
        password: hashedPassword,
      },
      include: {
        organizations: true,
        user_roles: {
          include: {
            roles: true,
          },
        },
      },
    });

    // Remove password from response
    const { password, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  async findAll(query: UserQueryDto) {
    const { page = 1, limit = 10, search, state, organization_id } = query;
    const skip = (page - 1) * Number(limit);

    const where: any = {};

    if (search) {
      where.OR = [
        { first_name: { contains: search, mode: 'insensitive' } },
        { last_name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (state) {
      where.state = state;
    }

    if (organization_id) {
      where.organization_id = organization_id;
    }

    const [users, total] = await Promise.all([
      (this.prisma.withoutScope() as any).users.findMany({
        where,
        skip,
        take: Number(limit),
        include: {
          organizations: true,
          user_roles: {
            include: {
              roles: true,
            },
          },
        },
        orderBy: {
          created_at: 'desc',
        },
      }),
      (this.prisma.withoutScope() as any).users.count({ where }),
    ]);

    // Remove passwords from response
    const usersWithoutPasswords = users.map((user: any) => {
      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword;
    });

    return {
      data: usersWithoutPasswords,
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    };
  }

  async findOne(id: number) {
    const user = await (this.prisma.withoutScope() as any).users.findUnique({
      where: { id },
      include: {
        organizations: true,
        user_roles: {
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
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Remove password from response
    const { password, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  async update(id: number, updateUserDto: UpdateUserDto) {
    const user = await (this.prisma.withoutScope() as any).users.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check if email is being changed and if it already exists
    if (updateUserDto.email && updateUserDto.email !== user.email) {
      const existingUser = await (
        this.prisma.withoutScope() as any
      ).users.findUnique({
        where: { email: updateUserDto.email },
      });

      if (existingUser) {
        throw new ConflictException('Email already exists');
      }
    }

    // Hash password if it's being updated
    const updateData = { ...updateUserDto };
    if (updateUserDto.password) {
      updateData.password = await bcrypt.hash(updateUserDto.password, 10);
    }

    const updatedUser = await (this.prisma.withoutScope() as any).users.update({
      where: { id },
      data: updateData,
      include: {
        organizations: true,
        user_roles: {
          include: {
            roles: true,
          },
        },
      },
    });

    // Remove password from response
    const { password, ...userWithoutPassword } = updatedUser;
    return userWithoutPassword;
  }

  async remove(id: number) {
    const user = await (this.prisma.withoutScope() as any).users.findUnique({
      where: { id },
      include: {
        user_roles: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check if user is a super admin
    const hasSuperAdminRole = user.user_roles.some(
      (userRole: any) => userRole.roles?.name === 'super_admin',
    );

    if (hasSuperAdminRole) {
      throw new ForbiddenException('Cannot delete super admin users');
    }

    // Check if user has important data that shouldn't be deleted
    const [ordersCount, auditLogsCount] = await Promise.all([
      (this.prisma.withoutScope() as any).orders.count({
        where: { created_by: id },
      }),
      (this.prisma.withoutScope() as any).audit_logs.count({
        where: { user_id: id },
      }),
    ]);

    if (ordersCount > 0 || auditLogsCount > 0) {
      // Instead of deleting, deactivate the user
      return this.deactivateUser(id);
    }

    await (this.prisma.withoutScope() as any).users.delete({
      where: { id },
    });

    return { message: 'User deleted successfully' };
  }

  async activateUser(id: number) {
    const user = await (this.prisma.withoutScope() as any).users.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await (this.prisma.withoutScope() as any).users.update({
      where: { id },
      data: { state: user_state_enum.active },
    });

    return { message: 'User activated successfully' };
  }

  async deactivateUser(id: number) {
    const user = await (this.prisma.withoutScope() as any).users.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await (this.prisma.withoutScope() as any).users.update({
      where: { id },
      data: { state: user_state_enum.inactive },
    });

    return { message: 'User deactivated successfully' };
  }

  async assignRole(userId: number, roleId: number) {
    const user = await (this.prisma.withoutScope() as any).users.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const role = await (this.prisma.withoutScope() as any).roles.findUnique({
      where: { id: roleId },
    });

    if (!role) {
      throw new NotFoundException('Role not found');
    }

    // Check if role is already assigned
    const existingUserRole = await this.prisma
      .withoutScope()
      .user_roles.findFirst({
        where: {
          user_id: userId,
          role_id: roleId,
        },
      });

    if (existingUserRole) {
      throw new ConflictException('Role already assigned to user');
    }

    await (this.prisma.withoutScope() as any).user_roles.create({
      data: {
        user_id: userId,
        role_id: roleId,
      },
    });

    return { message: 'Role assigned successfully' };
  }

  async removeRole(userId: number, roleId: number) {
    const user = await (this.prisma.withoutScope() as any).users.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const role = await (this.prisma.withoutScope() as any).roles.findUnique({
      where: { id: roleId },
    });

    if (!role) {
      throw new NotFoundException('Role not found');
    }

    // Check if user is trying to remove super_admin role from themselves
    if (role.name === 'super_admin') {
      throw new ForbiddenException('Cannot remove super admin role');
    }

    const userRole = await (
      this.prisma.withoutScope() as any
    ).user_roles.findFirst({
      where: {
        user_id: userId,
        role_id: roleId,
      },
    });

    if (!userRole) {
      throw new NotFoundException('Role not assigned to user');
    }

    await (this.prisma.withoutScope() as any).user_roles.delete({
      where: { id: userRole.id },
    });

    return { message: 'Role removed successfully' };
  }

  async getDashboardStats() {
    const [
      totalUsers,
      activeUsers,
      inactiveUsers,
      pendingUsers,
      usersByRole,
      recentUsers,
    ] = await Promise.all([
      (this.prisma.withoutScope() as any).users.count(),
      (this.prisma.withoutScope() as any).users.count({
        where: { state: user_state_enum.active },
      }),
      (this.prisma.withoutScope() as any).users.count({
        where: { state: user_state_enum.inactive },
      }),
      (this.prisma.withoutScope() as any).users.count({
        where: { state: user_state_enum.pending_verification },
      }),
      (this.prisma.withoutScope() as any).user_roles.groupBy({
        by: ['role_id'],
        _count: true,
      }),
      (this.prisma.withoutScope() as any).users.findMany({
        take: 5,
        orderBy: { created_at: 'desc' },
        include: {
          organizations: true,
        },
      }),
    ]);

    // Get role details for usersByRole
    const roleIds = usersByRole.map((item: any) => item.role_id);
    const roles = await (this.prisma.withoutScope() as any).roles.findMany({
      where: { id: { in: roleIds } },
      select: { id: true, name: true },
    });

    const usersByRoleWithNames = usersByRole.map((item: any) => {
      const role = roles.find((r: any) => r.id === item.role_id);
      return {
        roleName: role?.name || 'Unknown',
        count: item._count,
      };
    });

    // Remove passwords from recent users
    const recentUsersWithoutPasswords = recentUsers.map((user: any) => {
      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword;
    });

    return {
      totalUsers,
      activeUsers,
      inactiveUsers,
      pendingUsers,
      usersByRole: usersByRoleWithNames,
      recentUsers: recentUsersWithoutPasswords,
    };
  }
}
