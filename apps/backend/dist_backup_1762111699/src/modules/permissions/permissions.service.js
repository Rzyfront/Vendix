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
exports.PermissionsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const audit_service_1 = require("../audit/audit.service");
let PermissionsService = class PermissionsService {
    constructor(prismaService, auditService) {
        this.prismaService = prismaService;
        this.auditService = auditService;
    }
    async create(createPermissionDto, userId) {
        const { name, description, path, method, status } = createPermissionDto;
        const existingPermission = await this.prismaService.permissions.findUnique({
            where: { name },
        });
        if (existingPermission) {
            throw new common_1.ConflictException('Ya existe un permiso con este nombre');
        }
        const existingPathMethod = await this.prismaService.permissions.findUnique({
            where: {
                path_method: {
                    path,
                    method,
                },
            },
        });
        if (existingPathMethod) {
            throw new common_1.ConflictException('Ya existe un permiso con esta ruta y método');
        }
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
        await this.auditService.log({
            userId,
            action: audit_service_1.AuditAction.CREATE,
            resource: audit_service_1.AuditResource.PERMISSIONS,
            resourceId: permission.id,
            newValues: { name, description, path, method, status },
            metadata: {
                action: 'create_permission',
                permission_name: name,
            },
        });
        return permission;
    }
    async findAll(filterDto, userId) {
        const { method, status, search } = filterDto || {};
        const whereClause = {};
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
    async findOne(id, userId) {
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
            throw new common_1.NotFoundException('Permiso no encontrado');
        }
        return permission;
    }
    async update(id, updatePermissionDto, userId) {
        const permission = await this.findOne(id);
        const { name, description, path, method, status } = updatePermissionDto;
        if (name && name !== permission.name) {
            const existingPermission = await this.prismaService.permissions.findUnique({
                where: { name },
            });
            if (existingPermission) {
                throw new common_1.ConflictException('Ya existe un permiso con este nombre');
            }
        }
        if ((path || method) &&
            (path !== permission.path || method !== permission.method)) {
            const newPath = path || permission.path;
            const newMethod = method || permission.method;
            const existingPathMethod = await this.prismaService.permissions.findUnique({
                where: {
                    path_method: {
                        path: newPath,
                        method: newMethod,
                    },
                },
            });
            if (existingPathMethod && existingPathMethod.id !== id) {
                throw new common_1.ConflictException('Ya existe un permiso con esta ruta y método');
            }
        }
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
        await this.auditService.log({
            userId,
            action: audit_service_1.AuditAction.UPDATE,
            resource: audit_service_1.AuditResource.PERMISSIONS,
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
    async remove(id, userId) {
        const permission = await this.findOne(id);
        if (permission.role_permissions.length > 0) {
            throw new common_1.BadRequestException('No se puede eliminar un permiso que tiene roles asignados');
        }
        await this.prismaService.permissions.delete({
            where: { id },
        });
        await this.auditService.log({
            userId,
            action: audit_service_1.AuditAction.DELETE,
            resource: audit_service_1.AuditResource.PERMISSIONS,
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
    async findByIds(ids) {
        return await this.prismaService.permissions.findMany({
            where: {
                id: { in: ids },
            },
        });
    }
    async findByName(name) {
        return await this.prismaService.permissions.findUnique({
            where: { name },
        });
    }
    async findByPathAndMethod(path, method) {
        return await this.prismaService.permissions.findUnique({
            where: {
                path_method: {
                    path,
                    method,
                },
            },
        });
    }
};
exports.PermissionsService = PermissionsService;
exports.PermissionsService = PermissionsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        audit_service_1.AuditService])
], PermissionsService);
//# sourceMappingURL=permissions.service.js.map