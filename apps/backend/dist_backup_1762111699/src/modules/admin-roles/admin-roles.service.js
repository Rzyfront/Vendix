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
exports.AdminRolesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
let AdminRolesService = class AdminRolesService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(createRoleDto) {
        const existingRole = await this.prisma.roles.findUnique({
            where: { name: createRoleDto.name },
        });
        if (existingRole) {
            throw new common_1.ConflictException('Role with this name already exists');
        }
        return this.prisma.roles.create({
            data: {
                name: createRoleDto.name,
                description: createRoleDto.description,
                is_system_role: createRoleDto.is_system_role || false,
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
    async findAll(query) {
        const { page = 1, limit = 10, search, is_system_role, organization_id, } = query;
        const skip = (page - 1) * limit;
        const where = {};
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
    async findOne(id) {
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
            throw new common_1.NotFoundException('Role not found');
        }
        return role;
    }
    async update(id, updateRoleDto) {
        const existingRole = await this.prisma.roles.findUnique({
            where: { id },
        });
        if (!existingRole) {
            throw new common_1.NotFoundException('Role not found');
        }
        if (updateRoleDto.name && updateRoleDto.name !== existingRole.name) {
            const nameExists = await this.prisma.roles.findFirst({
                where: {
                    name: updateRoleDto.name,
                    id: { not: id },
                },
            });
            if (nameExists) {
                throw new common_1.ConflictException('Role with this name already exists');
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
    async remove(id) {
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
            throw new common_1.NotFoundException('Role not found');
        }
        if (existingRole.is_system_role) {
            throw new common_1.ConflictException('Cannot delete system roles');
        }
        if (existingRole._count.role_permissions > 0 ||
            existingRole._count.user_roles > 0) {
            throw new common_1.ConflictException('Cannot delete role with existing permissions or users');
        }
        return this.prisma.roles.delete({
            where: { id },
        });
    }
    async assignPermissions(roleId, assignPermissionsDto) {
        const role = await this.prisma.roles.findUnique({
            where: { id: roleId },
        });
        if (!role) {
            throw new common_1.NotFoundException('Role not found');
        }
        const existingPermissions = await this.prisma.role_permissions.findMany({
            where: {
                role_id: roleId,
                permission_id: { in: assignPermissionsDto.permissionIds },
            },
        });
        if (existingPermissions.length > 0) {
            throw new common_1.ConflictException('Some permissions are already assigned to this role');
        }
        const rolePermissions = assignPermissionsDto.permissionIds.map((permissionId) => ({
            role_id: roleId,
            permission_id: permissionId,
        }));
        await this.prisma.role_permissions.createMany({
            data: rolePermissions,
        });
        return this.findOne(roleId);
    }
    async removePermissions(roleId, removePermissionsDto) {
        const role = await this.prisma.roles.findUnique({
            where: { id: roleId },
        });
        if (!role) {
            throw new common_1.NotFoundException('Role not found');
        }
        await this.prisma.role_permissions.deleteMany({
            where: {
                role_id: roleId,
                permission_id: { in: removePermissionsDto.permissionIds },
            },
        });
        return this.findOne(roleId);
    }
    async getDashboardStats() {
        const [totalRoles, systemRoles, customRoles, totalPermissions, rolesByUserCount, recentRoles,] = await Promise.all([
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
            small: 0,
            medium: 0,
            large: 0,
        };
        rolesByUserCount.forEach((role) => {
            const userCount = role._count.user_roles;
            if (userCount === 0)
                rolesByUserCountRanges.empty++;
            else if (userCount <= 5)
                rolesByUserCountRanges.small++;
            else if (userCount <= 20)
                rolesByUserCountRanges.medium++;
            else
                rolesByUserCountRanges.large++;
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
};
exports.AdminRolesService = AdminRolesService;
exports.AdminRolesService = AdminRolesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AdminRolesService);
//# sourceMappingURL=admin-roles.service.js.map