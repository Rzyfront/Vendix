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
exports.RolesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const audit_service_1 = require("../audit/audit.service");
let RolesService = class RolesService {
    constructor(prismaService, auditService) {
        this.prismaService = prismaService;
        this.auditService = auditService;
    }
    transformRoleWithPermissionDescriptions(role) {
        return {
            id: role.id,
            name: role.name,
            description: role.description,
            is_system_role: role.is_system_role,
            created_at: role.created_at,
            updated_at: role.updated_at,
            permissions: role.role_permissions
                ?.map((rp) => rp.permissions?.description)
                .filter(Boolean) || [],
            user_roles: role.user_roles,
            _count: role._count,
        };
    }
    async create(createRoleDto, userId) {
        const { name, description, is_system_role } = createRoleDto;
        const existingRole = await this.prismaService.roles.findUnique({
            where: { name },
        });
        if (existingRole) {
            throw new common_1.ConflictException('Ya existe un rol con este nombre');
        }
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
        await this.auditService.log({
            userId,
            action: audit_service_1.AuditAction.CREATE,
            resource: audit_service_1.AuditResource.ROLES,
            resourceId: role.id,
            newValues: { name, description, is_system_role },
            metadata: {
                action: 'create_role',
                role_name: name,
            },
        });
        return this.transformRoleWithPermissionDescriptions(role);
    }
    async findAll(userId) {
        const userRoles = await this.prismaService.user_roles.findMany({
            where: { user_id: userId },
            include: {
                roles: true,
            },
        });
        const isSuperAdmin = userRoles.some((ur) => ur.roles?.name === 'super_admin');
        const whereClause = isSuperAdmin
            ? {}
            : {
                name: {
                    not: 'super_admin',
                },
            };
        const roles = await this.prismaService.roles.findMany({
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
        return roles.map((role) => this.transformRoleWithPermissionDescriptions(role));
    }
    async findOne(id, userId) {
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
            throw new common_1.NotFoundException('Rol no encontrado');
        }
        if (userId) {
            const userRoles = await this.prismaService.user_roles.findMany({
                where: { user_id: userId },
                include: {
                    roles: true,
                },
            });
            const isSuperAdmin = userRoles.some((ur) => ur.roles?.name === 'super_admin');
            if (role.name === 'super_admin' && !isSuperAdmin) {
                throw new common_1.NotFoundException('Rol no encontrado');
            }
        }
        return this.transformRoleWithPermissionDescriptions(role);
    }
    async update(id, updateRoleDto, userId) {
        const role = await this.findOne(id);
        const { name, description } = updateRoleDto;
        if (name && name !== role.name) {
            const existingRole = await this.prismaService.roles.findUnique({
                where: { name },
            });
            if (existingRole) {
                throw new common_1.ConflictException('Ya existe un rol con este nombre');
            }
        }
        if (role.is_system_role && (name || description)) {
            throw new common_1.BadRequestException('No se pueden modificar roles del sistema');
        }
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
        return this.transformRoleWithPermissionDescriptions(updatedRole);
        await this.auditService.log({
            userId,
            action: audit_service_1.AuditAction.UPDATE,
            resource: audit_service_1.AuditResource.ROLES,
            resourceId: id,
            oldValues: { name: role.name, description: role.description },
            newValues: {
                name: updatedRole.name,
                description: updatedRole.description,
            },
            metadata: {
                action: 'update_role',
                role_name: updatedRole.name,
            },
        });
        return updatedRole;
    }
    async remove(id, userId) {
        const role = await this.findOne(id);
        if (role.is_system_role) {
            throw new common_1.BadRequestException('No se pueden eliminar roles del sistema');
        }
        if (role.user_roles && role.user_roles.length > 0) {
            throw new common_1.BadRequestException('No se puede eliminar un rol que tiene usuarios asignados');
        }
        await this.prismaService.roles.delete({
            where: { id },
        });
        await this.auditService.log({
            userId,
            action: audit_service_1.AuditAction.DELETE,
            resource: audit_service_1.AuditResource.ROLES,
            resourceId: id,
            oldValues: { name: role.name, description: role.description },
            metadata: {
                action: 'delete_role',
                role_name: role.name,
            },
        });
        return { message: 'Rol eliminado exitosamente' };
    }
    async assignPermissions(roleId, assignPermissionsDto, userId) {
        const role = await this.findOne(roleId);
        const { permissionIds } = assignPermissionsDto;
        const permissions = await this.prismaService.permissions.findMany({
            where: {
                id: { in: permissionIds },
                status: 'active',
            },
        });
        if (permissions.length !== permissionIds.length) {
            throw new common_1.BadRequestException('Uno o más permisos no existen o están inactivos');
        }
        const rolePermissions = permissionIds.map((permissionId) => ({
            role_id: roleId,
            permission_id: permissionId,
            granted: true,
        }));
        await this.prismaService.role_permissions.createMany({
            data: rolePermissions,
            skipDuplicates: true,
        });
        const updatedRole = await this.prismaService.roles.findUnique({
            where: { id: roleId },
            include: {
                role_permissions: {
                    include: {
                        permissions: true,
                    },
                },
            },
        });
        await this.auditService.log({
            userId,
            action: audit_service_1.AuditAction.PERMISSION_CHANGE,
            resource: audit_service_1.AuditResource.ROLES,
            resourceId: roleId,
            newValues: { assigned_permissions: permissionIds },
            metadata: {
                action: 'assign_permissions_to_role',
                role_name: role.name,
                permissions_count: permissionIds.length,
            },
        });
        return this.transformRoleWithPermissionDescriptions(updatedRole);
    }
    async removePermissions(roleId, removePermissionsDto, userId) {
        const role = await this.findOne(roleId);
        const { permissionIds } = removePermissionsDto;
        const result = await this.prismaService.role_permissions.deleteMany({
            where: {
                role_id: roleId,
                permission_id: { in: permissionIds },
            },
        });
        const updatedRole = await this.prismaService.roles.findUnique({
            where: { id: roleId },
            include: {
                role_permissions: {
                    include: {
                        permissions: true,
                    },
                },
            },
        });
        await this.auditService.log({
            userId,
            action: audit_service_1.AuditAction.PERMISSION_CHANGE,
            resource: audit_service_1.AuditResource.ROLES,
            resourceId: roleId,
            oldValues: { removed_permissions: permissionIds },
            metadata: {
                action: 'remove_permissions_from_role',
                role_name: role.name,
                permissions_removed: result.count,
            },
        });
        return this.transformRoleWithPermissionDescriptions(updatedRole);
    }
    async getRolePermissions(roleId, userId) {
        const role = await this.prismaService.roles.findUnique({
            where: { id: roleId },
            select: { id: true, name: true },
        });
        if (!role) {
            throw new common_1.NotFoundException('Rol no encontrado');
        }
        if (userId) {
            const userRoles = await this.prismaService.user_roles.findMany({
                where: { user_id: userId },
                include: {
                    roles: true,
                },
            });
            const isSuperAdmin = userRoles.some((ur) => ur.roles?.name === 'super_admin');
            if (role.name === 'super_admin' && !isSuperAdmin) {
                throw new common_1.NotFoundException('Rol no encontrado');
            }
        }
        const rolePermissions = await this.prismaService.role_permissions.findMany({
            where: { role_id: roleId },
            select: { permission_id: true },
            orderBy: { permission_id: 'asc' },
        });
        const permissionIds = rolePermissions.map((rp) => rp.permission_id);
        return {
            role_id: roleId,
            permission_ids: permissionIds,
            total_permissions: permissionIds.length,
        };
    }
    async assignRoleToUser(assignRoleToUserDto, adminUserId) {
        const { userId, roleId } = assignRoleToUserDto;
        const user = await this.prismaService.users.findUnique({
            where: { id: userId },
            select: { id: true, email: true, first_name: true, last_name: true },
        });
        if (!user) {
            throw new common_1.NotFoundException('Usuario no encontrado');
        }
        const role = await this.prismaService.roles.findUnique({
            where: { id: roleId },
            select: { id: true, name: true },
        });
        if (!role) {
            throw new common_1.NotFoundException('Rol no encontrado');
        }
        if (role.name === 'super_admin') {
            const adminUserRoles = await this.prismaService.user_roles.findMany({
                where: { user_id: adminUserId },
                include: {
                    roles: true,
                },
            });
            const isSuperAdmin = adminUserRoles.some((ur) => ur.roles?.name === 'super_admin');
            if (!isSuperAdmin) {
                throw new common_1.ForbiddenException('Solo los super administradores pueden asignar el rol super_admin');
            }
            const existingSuperAdmin = await this.prismaService.user_roles.findFirst({
                where: {
                    roles: {
                        name: 'super_admin',
                    },
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
                },
            });
            if (existingSuperAdmin) {
                throw new common_1.ConflictException(`Ya existe un super administrador: ${existingSuperAdmin.users?.email}. Solo puede existir un super administrador en el sistema.`);
            }
        }
        const existingUserRole = await this.prismaService.user_roles.findUnique({
            where: {
                user_id_role_id: {
                    user_id: userId,
                    role_id: roleId,
                },
            },
        });
        if (existingUserRole) {
            throw new common_1.ConflictException('El usuario ya tiene este rol asignado');
        }
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
        await this.auditService.log({
            userId: adminUserId,
            action: audit_service_1.AuditAction.PERMISSION_CHANGE,
            resource: audit_service_1.AuditResource.USERS,
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
    async removeRoleFromUser(removeRoleFromUserDto, adminUserId) {
        const { userId, roleId } = removeRoleFromUserDto;
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
            throw new common_1.NotFoundException('El usuario no tiene este rol asignado');
        }
        if (userRole.roles?.is_system_role) {
            const userRoleCount = await this.prismaService.user_roles.count({
                where: { user_id: userId },
            });
            if (userRoleCount === 1) {
                throw new common_1.BadRequestException('No se puede remover el último rol del sistema de un usuario');
            }
        }
        await this.prismaService.user_roles.delete({
            where: {
                user_id_role_id: {
                    user_id: userId,
                    role_id: roleId,
                },
            },
        });
        await this.auditService.log({
            userId: adminUserId,
            action: audit_service_1.AuditAction.PERMISSION_CHANGE,
            resource: audit_service_1.AuditResource.USERS,
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
    async getUserPermissions(userId) {
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
        const permissions = userRoles.flatMap((userRole) => userRole.roles?.role_permissions?.map((rp) => rp.permissions) || []);
        const uniquePermissions = permissions.filter((permission, index, self) => index === self.findIndex((p) => p.id === permission.id));
        return uniquePermissions;
    }
    async getUserRoles(userId) {
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
    async getDashboardStats(userId) {
        const userRoles = await this.prismaService.user_roles.findMany({
            where: { user_id: userId },
            include: {
                roles: true,
            },
        });
        const isSuperAdmin = userRoles.some((ur) => ur.roles?.name === 'super_admin');
        if (!isSuperAdmin) {
            throw new common_1.ForbiddenException('No tienes permisos para ver estas estadísticas');
        }
        const totalRoles = await this.prismaService.roles.count();
        const systemRoles = await this.prismaService.roles.count({
            where: { is_system_role: true },
        });
        const customRoles = totalRoles - systemRoles;
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
};
exports.RolesService = RolesService;
exports.RolesService = RolesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        audit_service_1.AuditService])
], RolesService);
//# sourceMappingURL=roles.service.js.map