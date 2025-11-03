"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminUsersService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const client_1 = require("@prisma/client");
const bcrypt = require("bcrypt");
let AdminUsersService = class AdminUsersService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(createUserDto) {
        const existingUser = await this.prisma.users.findUnique({
            where: { email: createUserDto.email },
        });
        if (existingUser) {
            throw new common_1.ConflictException('Email already exists');
        }
        const hashedPassword = await bcrypt.hash(createUserDto.password, 10);
        const user = await this.prisma.users.create({
            data: {
                ...createUserDto,
                password: hashedPassword,
            },
            include: {
                organization: true,
                user_roles: {
                    include: {
                        role: true,
                    },
                },
            },
        });
        const { password, ...userWithoutPassword } = user;
        return userWithoutPassword;
    }
    async findAll(query) {
        const { page = 1, limit = 10, search, state, organization_id } = query;
        const skip = (page - 1) * limit;
        const where = {};
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
            this.prisma.users.findMany({
                where,
                skip,
                take: limit,
                include: {
                    organization: true,
                    user_roles: {
                        include: {
                            role: true,
                        },
                    },
                },
                orderBy: {
                    created_at: 'desc',
                },
            }),
            this.prisma.users.count({ where }),
        ]);
        const usersWithoutPasswords = users.map((user) => {
            const { password, ...userWithoutPassword } = user;
            return userWithoutPassword;
        });
        return {
            data: usersWithoutPasswords,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };
    }
    async findOne(id) {
        const user = await this.prisma.users.findUnique({
            where: { id },
            include: {
                organization: true,
                user_roles: {
                    include: {
                        role: {
                            include: {
                                role_permissions: {
                                    include: {
                                        permission: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });
        if (!user) {
            throw new common_1.NotFoundException('User not found');
        }
        const { password, ...userWithoutPassword } = user;
        return userWithoutPassword;
    }
    async update(id, updateUserDto) {
        const user = await this.prisma.users.findUnique({
            where: { id },
        });
        if (!user) {
            throw new common_1.NotFoundException('User not found');
        }
        if (updateUserDto.email && updateUserDto.email !== user.email) {
            const existingUser = await this.prisma.users.findUnique({
                where: { email: updateUserDto.email },
            });
            if (existingUser) {
                throw new common_1.ConflictException('Email already exists');
            }
        }
        let updateData = { ...updateUserDto };
        if (updateUserDto.password) {
            updateData.password = await bcrypt.hash(updateUserDto.password, 10);
        }
        const updatedUser = await this.prisma.users.update({
            where: { id },
            data: updateData,
            include: {
                organization: true,
                user_roles: {
                    include: {
                        role: true,
                    },
                },
            },
        });
        const { password, ...userWithoutPassword } = updatedUser;
        return userWithoutPassword;
    }
    async remove(id) {
        const user = await this.prisma.users.findUnique({
            where: { id },
            include: {
                user_roles: true,
            },
        });
        if (!user) {
            throw new common_1.NotFoundException('User not found');
        }
        const hasSuperAdminRole = user.user_roles.some((userRole) => userRole.role?.name === 'super_admin');
        if (hasSuperAdminRole) {
            throw new common_1.ForbiddenException('Cannot delete super admin users');
        }
        const [ordersCount, auditLogsCount] = await Promise.all([
            this.prisma.orders.count({
                where: { created_by: id },
            }),
            this.prisma.audit_logs.count({
                where: { user_id: id },
            }),
        ]);
        if (ordersCount > 0 || auditLogsCount > 0) {
            return this.deactivateUser(id);
        }
        await this.prisma.users.delete({
            where: { id },
        });
        return { message: 'User deleted successfully' };
    }
    async activateUser(id) {
        const user = await this.prisma.users.findUnique({
            where: { id },
        });
        if (!user) {
            throw new common_1.NotFoundException('User not found');
        }
        await this.prisma.users.update({
            where: { id },
            data: { state: client_1.user_state_enum.active },
        });
        return { message: 'User activated successfully' };
    }
    async deactivateUser(id) {
        const user = await this.prisma.users.findUnique({
            where: { id },
        });
        if (!user) {
            throw new common_1.NotFoundException('User not found');
        }
        await this.prisma.users.update({
            where: { id },
            data: { state: client_1.user_state_enum.inactive },
        });
        return { message: 'User deactivated successfully' };
    }
    async assignRole(userId, roleId) {
        const user = await this.prisma.users.findUnique({
            where: { id: userId },
        });
        if (!user) {
            throw new common_1.NotFoundException('User not found');
        }
        const role = await this.prisma.roles.findUnique({
            where: { id: roleId },
        });
        if (!role) {
            throw new common_1.NotFoundException('Role not found');
        }
        const existingUserRole = await this.prisma.user_roles.findFirst({
            where: {
                user_id: userId,
                role_id: roleId,
            },
        });
        if (existingUserRole) {
            throw new common_1.ConflictException('Role already assigned to user');
        }
        await this.prisma.user_roles.create({
            data: {
                user_id: userId,
                role_id: roleId,
            },
        });
        return { message: 'Role assigned successfully' };
    }
    async removeRole(userId, roleId) {
        const user = await this.prisma.users.findUnique({
            where: { id: userId },
        });
        if (!user) {
            throw new common_1.NotFoundException('User not found');
        }
        const role = await this.prisma.roles.findUnique({
            where: { id: roleId },
        });
        if (!role) {
            throw new common_1.NotFoundException('Role not found');
        }
        if (role.name === 'super_admin') {
            throw new common_1.ForbiddenException('Cannot remove super admin role');
        }
        const userRole = await this.prisma.user_roles.findFirst({
            where: {
                user_id: userId,
                role_id: roleId,
            },
        });
        if (!userRole) {
            throw new common_1.NotFoundException('Role not assigned to user');
        }
        await this.prisma.user_roles.delete({
            where: { id: userRole.id },
        });
        return { message: 'Role removed successfully' };
    }
    async getDashboardStats() {
        const [totalUsers, activeUsers, inactiveUsers, pendingUsers, usersByRole, recentUsers,] = await Promise.all([
            this.prisma.users.count(),
            this.prisma.users.count({
                where: { state: client_1.user_state_enum.active },
            }),
            this.prisma.users.count({
                where: { state: client_1.user_state_enum.inactive },
            }),
            this.prisma.users.count({
                where: { state: client_1.user_state_enum.pending_verification },
            }),
            this.prisma.user_roles.groupBy({
                by: ['role_id'],
                _count: true,
            }),
            this.prisma.users.findMany({
                take: 5,
                orderBy: { created_at: 'desc' },
                include: {
                    organization: true,
                },
            }),
        ]);
        const roleIds = usersByRole.map((item) => item.role_id);
        const roles = await this.prisma.roles.findMany({
            where: { id: { in: roleIds } },
            select: { id: true, name: true },
        });
        const usersByRoleWithNames = usersByRole.map((item) => {
            const role = roles.find((r) => r.id === item.role_id);
            return {
                roleName: role?.name || 'Unknown',
                count: item._count,
            };
        });
        const recentUsersWithoutPasswords = recentUsers.map((user) => {
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
};
exports.AdminUsersService = AdminUsersService;
exports.AdminUsersService = AdminUsersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AdminUsersService);
//# sourceMappingURL=admin-users.service.js.map