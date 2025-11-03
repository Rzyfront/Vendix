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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RolesController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const roles_service_1 = require("./roles.service");
const role_dto_1 = require("./dto/role.dto");
const permissions_guard_1 = require("../auth/guards/permissions.guard");
const roles_decorator_1 = require("../auth/decorators/roles.decorator");
const permissions_decorator_1 = require("../auth/decorators/permissions.decorator");
const user_role_enum_1 = require("../auth/enums/user-role.enum");
const response_service_1 = require("../../common/responses/response.service");
let RolesController = class RolesController {
    constructor(rolesService, responseService) {
        this.rolesService = rolesService;
        this.responseService = responseService;
    }
    async create(createRoleDto, req) {
        try {
            const result = await this.rolesService.create(createRoleDto, req.user.id);
            return this.responseService.success(result, 'Rol creado exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al crear el rol', error.message);
        }
    }
    async findAll(req) {
        try {
            const result = await this.rolesService.findAll(req.user.id);
            return this.responseService.success(result, 'Lista de roles obtenida exitosamente', req.url);
        }
        catch (error) {
            return this.responseService.error('Error al obtener los roles', error.message);
        }
    }
    async getStats(req) {
        try {
            const result = await this.rolesService.getDashboardStats(req.user.id);
            return this.responseService.success(result, 'Estadísticas obtenidas exitosamente', req.url);
        }
        catch (error) {
            return this.responseService.error('Error al obtener las estadísticas', error.message);
        }
    }
    async getRolePermissions(id, req) {
        try {
            const result = await this.rolesService.getRolePermissions(id, req.user.id);
            return this.responseService.success(result, 'IDs de permisos obtenidos exitosamente', req.url);
        }
        catch (error) {
            return this.responseService.error('Error al obtener los IDs de permisos del rol', error.message);
        }
    }
    async assignPermissions(roleId, assignPermissionsDto, req) {
        try {
            const result = await this.rolesService.assignPermissions(roleId, assignPermissionsDto, req.user.id);
            return this.responseService.success(result, 'Permisos asignados exitosamente', req.url);
        }
        catch (error) {
            return this.responseService.error('Error al asignar permisos', error.message);
        }
    }
    async removePermissions(roleId, removePermissionsDto, req) {
        try {
            const result = await this.rolesService.removePermissions(roleId, removePermissionsDto, req.user.id);
            return this.responseService.success(result, 'Permisos removidos exitosamente', req.url);
        }
        catch (error) {
            return this.responseService.error('Error al remover permisos', error.message);
        }
    }
    async findOne(id, req) {
        try {
            const result = await this.rolesService.findOne(id, req.user.id);
            return this.responseService.success(result, 'Rol encontrado', req.url);
        }
        catch (error) {
            return this.responseService.error('Error al obtener el rol', error.message);
        }
    }
    async update(id, updateRoleDto, req) {
        try {
            const result = await this.rolesService.update(id, updateRoleDto, req.user.id);
            return this.responseService.success(result, 'Rol actualizado exitosamente', req.url);
        }
        catch (error) {
            return this.responseService.error('Error al actualizar el rol', error.message);
        }
    }
    async remove(id, req) {
        try {
            const result = await this.rolesService.remove(id, req.user.id);
            return this.responseService.success(result, 'Rol eliminado exitosamente', req.url);
        }
        catch (error) {
            return this.responseService.error('Error al eliminar el rol', error.message);
        }
    }
    async assignRoleToUser(assignRoleToUserDto, req) {
        try {
            const result = await this.rolesService.assignRoleToUser(assignRoleToUserDto, req.user.id);
            return this.responseService.success(result, 'Rol asignado exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al asignar el rol al usuario', error.message);
        }
    }
    async removeRoleFromUser(removeRoleFromUserDto, req) {
        try {
            const result = await this.rolesService.removeRoleFromUser(removeRoleFromUserDto, req.user.id);
            return this.responseService.success(result, 'Rol removido exitosamente', req.url);
        }
        catch (error) {
            return this.responseService.error('Error al remover el rol del usuario', error.message);
        }
    }
    async getUserPermissions(userId, req) {
        try {
            const result = await this.rolesService.getUserPermissions(userId);
            return this.responseService.success(result, 'Permisos obtenidos exitosamente', req.url);
        }
        catch (error) {
            return this.responseService.error('Error al obtener los permisos del usuario', error.message);
        }
    }
    async getUserRoles(userId, req) {
        try {
            const result = await this.rolesService.getUserRoles(userId);
            return this.responseService.success(result, 'Roles obtenidos exitosamente', req.url);
        }
        catch (error) {
            return this.responseService.error('Error al obtener los roles del usuario', error.message);
        }
    }
};
exports.RolesController = RolesController;
__decorate([
    (0, common_1.Post)(),
    (0, roles_decorator_1.Roles)(user_role_enum_1.UserRole.SUPER_ADMIN, user_role_enum_1.UserRole.ADMIN),
    (0, swagger_1.ApiOperation)({ summary: 'Crear un nuevo rol' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Rol creado exitosamente' }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Datos inválidos' }),
    (0, swagger_1.ApiResponse)({ status: 409, description: 'Ya existe un rol con este nombre' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [role_dto_1.CreateRoleDto, Object]),
    __metadata("design:returntype", Promise)
], RolesController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, roles_decorator_1.Roles)(user_role_enum_1.UserRole.SUPER_ADMIN, user_role_enum_1.UserRole.ADMIN, user_role_enum_1.UserRole.MANAGER),
    (0, swagger_1.ApiOperation)({ summary: 'Obtener todos los roles' }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'Lista de roles obtenida exitosamente',
    }),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], RolesController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('stats'),
    (0, roles_decorator_1.Roles)(user_role_enum_1.UserRole.SUPER_ADMIN),
    (0, swagger_1.ApiOperation)({ summary: 'Obtener estadísticas de roles' }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'Estadísticas obtenidas exitosamente',
    }),
    (0, swagger_1.ApiResponse)({
        status: 403,
        description: 'No tienes permisos para ver estas estadísticas',
    }),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], RolesController.prototype, "getStats", null);
__decorate([
    (0, common_1.Get)(':id/permissions'),
    (0, roles_decorator_1.Roles)(user_role_enum_1.UserRole.SUPER_ADMIN, user_role_enum_1.UserRole.ADMIN, user_role_enum_1.UserRole.MANAGER),
    (0, permissions_decorator_1.Permissions)('roles.permissions.read'),
    (0, swagger_1.ApiOperation)({ summary: 'Obtener IDs de permisos de un rol' }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'IDs de permisos obtenidos exitosamente',
    }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Rol no encontrado' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", Promise)
], RolesController.prototype, "getRolePermissions", null);
__decorate([
    (0, common_1.Post)(':id/permissions'),
    (0, roles_decorator_1.Roles)(user_role_enum_1.UserRole.SUPER_ADMIN, user_role_enum_1.UserRole.ADMIN),
    (0, swagger_1.ApiOperation)({ summary: 'Asignar permisos a un rol' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Permisos asignados exitosamente' }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Datos inválidos' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Rol no encontrado' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, role_dto_1.AssignPermissionsDto, Object]),
    __metadata("design:returntype", Promise)
], RolesController.prototype, "assignPermissions", null);
__decorate([
    (0, common_1.Delete)(':id/permissions'),
    (0, roles_decorator_1.Roles)(user_role_enum_1.UserRole.SUPER_ADMIN, user_role_enum_1.UserRole.ADMIN),
    (0, swagger_1.ApiOperation)({ summary: 'Remover permisos de un rol' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Permisos removidos exitosamente' }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Datos inválidos' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Rol no encontrado' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, role_dto_1.RemovePermissionsDto, Object]),
    __metadata("design:returntype", Promise)
], RolesController.prototype, "removePermissions", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, roles_decorator_1.Roles)(user_role_enum_1.UserRole.SUPER_ADMIN, user_role_enum_1.UserRole.ADMIN, user_role_enum_1.UserRole.MANAGER),
    (0, swagger_1.ApiOperation)({ summary: 'Obtener un rol por ID' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Rol encontrado' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Rol no encontrado' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", Promise)
], RolesController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, roles_decorator_1.Roles)(user_role_enum_1.UserRole.SUPER_ADMIN, user_role_enum_1.UserRole.ADMIN),
    (0, swagger_1.ApiOperation)({ summary: 'Actualizar un rol' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Rol actualizado exitosamente' }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Datos inválidos' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Rol no encontrado' }),
    (0, swagger_1.ApiResponse)({ status: 409, description: 'Ya existe un rol con este nombre' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, role_dto_1.UpdateRoleDto, Object]),
    __metadata("design:returntype", Promise)
], RolesController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, roles_decorator_1.Roles)(user_role_enum_1.UserRole.SUPER_ADMIN, user_role_enum_1.UserRole.ADMIN),
    (0, swagger_1.ApiOperation)({ summary: 'Eliminar un rol' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Rol eliminado exitosamente' }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'No se puede eliminar el rol' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Rol no encontrado' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", Promise)
], RolesController.prototype, "remove", null);
__decorate([
    (0, common_1.Post)('assign-to-user'),
    (0, roles_decorator_1.Roles)(user_role_enum_1.UserRole.SUPER_ADMIN, user_role_enum_1.UserRole.ADMIN),
    (0, swagger_1.ApiOperation)({ summary: 'Asignar un rol a un usuario' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Rol asignado exitosamente' }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Datos inválidos' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Usuario o rol no encontrado' }),
    (0, swagger_1.ApiResponse)({ status: 409, description: 'El usuario ya tiene este rol' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [role_dto_1.AssignRoleToUserDto, Object]),
    __metadata("design:returntype", Promise)
], RolesController.prototype, "assignRoleToUser", null);
__decorate([
    (0, common_1.Post)('remove-from-user'),
    (0, roles_decorator_1.Roles)(user_role_enum_1.UserRole.SUPER_ADMIN, user_role_enum_1.UserRole.ADMIN),
    (0, swagger_1.ApiOperation)({ summary: 'Remover un rol de un usuario' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Rol removido exitosamente' }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Datos inválidos' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Relación no encontrada' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [role_dto_1.RemoveRoleFromUserDto, Object]),
    __metadata("design:returntype", Promise)
], RolesController.prototype, "removeRoleFromUser", null);
__decorate([
    (0, common_1.Get)('user/:userId/permissions'),
    (0, roles_decorator_1.Roles)(user_role_enum_1.UserRole.SUPER_ADMIN, user_role_enum_1.UserRole.ADMIN, user_role_enum_1.UserRole.MANAGER),
    (0, swagger_1.ApiOperation)({ summary: 'Obtener permisos de un usuario' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Permisos obtenidos exitosamente' }),
    __param(0, (0, common_1.Param)('userId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", Promise)
], RolesController.prototype, "getUserPermissions", null);
__decorate([
    (0, common_1.Get)('user/:userId/roles'),
    (0, roles_decorator_1.Roles)(user_role_enum_1.UserRole.SUPER_ADMIN, user_role_enum_1.UserRole.ADMIN, user_role_enum_1.UserRole.MANAGER),
    (0, swagger_1.ApiOperation)({ summary: 'Obtener roles de un usuario' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Roles obtenidos exitosamente' }),
    __param(0, (0, common_1.Param)('userId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", Promise)
], RolesController.prototype, "getUserRoles", null);
exports.RolesController = RolesController = __decorate([
    (0, swagger_1.ApiTags)('Roles'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Controller)('roles'),
    (0, common_1.UseGuards)(permissions_guard_1.PermissionsGuard),
    __metadata("design:paramtypes", [roles_service_1.RolesService,
        response_service_1.ResponseService])
], RolesController);
//# sourceMappingURL=roles.controller.js.map