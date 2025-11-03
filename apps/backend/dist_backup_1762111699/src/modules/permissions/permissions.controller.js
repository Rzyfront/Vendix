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
exports.PermissionsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const permissions_service_1 = require("./permissions.service");
const permission_dto_1 = require("./dto/permission.dto");
const roles_guard_1 = require("../auth/guards/roles.guard");
const roles_decorator_1 = require("../auth/decorators/roles.decorator");
const user_role_enum_1 = require("../auth/enums/user-role.enum");
const response_service_1 = require("../../common/responses/response.service");
let PermissionsController = class PermissionsController {
    constructor(permissionsService, responseService) {
        this.permissionsService = permissionsService;
        this.responseService = responseService;
    }
    async create(createPermissionDto, req) {
        try {
            const result = await this.permissionsService.create(createPermissionDto, req.user.id);
            return this.responseService.success(result, 'Permiso creado exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al crear el permiso', error.message);
        }
    }
    async findAll(filterDto, req) {
        try {
            const result = await this.permissionsService.findAll(filterDto, req.user.id);
            return this.responseService.success(result, 'Lista de permisos obtenida exitosamente', req.url);
        }
        catch (error) {
            return this.responseService.error('Error al obtener los permisos', error.message);
        }
    }
    async findOne(id, req) {
        try {
            const result = await this.permissionsService.findOne(id, req.user.id);
            return this.responseService.success(result, 'Permiso encontrado', req.url);
        }
        catch (error) {
            return this.responseService.error('Error al obtener el permiso', error.message);
        }
    }
    async update(id, updatePermissionDto, req) {
        try {
            const result = await this.permissionsService.update(id, updatePermissionDto, req.user.id);
            return this.responseService.success(result, 'Permiso actualizado exitosamente', req.url);
        }
        catch (error) {
            return this.responseService.error('Error al actualizar el permiso', error.message);
        }
    }
    async remove(id, req) {
        try {
            const result = await this.permissionsService.remove(id, req.user.id);
            return this.responseService.success(result, 'Permiso eliminado exitosamente', req.url);
        }
        catch (error) {
            return this.responseService.error('Error al eliminar el permiso', error.message);
        }
    }
    async findByName(name, req) {
        try {
            const result = await this.permissionsService.findByName(name);
            if (!result) {
                throw new common_1.NotFoundException('Permiso no encontrado');
            }
            return this.responseService.success(result, 'Permiso encontrado', req.url);
        }
        catch (error) {
            return this.responseService.error('Error al buscar el permiso', error.message);
        }
    }
    async findByPathAndMethod(path, method, req) {
        try {
            if (!path || !method) {
                throw new common_1.BadRequestException('Se requieren los parámetros path y method');
            }
            const result = await this.permissionsService.findByPathAndMethod(path, method);
            if (!result) {
                throw new common_1.NotFoundException('Permiso no encontrado');
            }
            return this.responseService.success(result, 'Permiso encontrado', req.url);
        }
        catch (error) {
            return this.responseService.error('Error al buscar el permiso', error.message);
        }
    }
};
exports.PermissionsController = PermissionsController;
__decorate([
    (0, common_1.Post)(),
    (0, roles_decorator_1.Roles)(user_role_enum_1.UserRole.SUPER_ADMIN, user_role_enum_1.UserRole.ADMIN),
    (0, swagger_1.ApiOperation)({ summary: 'Crear un nuevo permiso' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Permiso creado exitosamente' }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Datos inválidos' }),
    (0, swagger_1.ApiResponse)({
        status: 409,
        description: 'Ya existe un permiso con este nombre o ruta/método',
    }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [permission_dto_1.CreatePermissionDto, Object]),
    __metadata("design:returntype", Promise)
], PermissionsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, roles_decorator_1.Roles)(user_role_enum_1.UserRole.SUPER_ADMIN, user_role_enum_1.UserRole.ADMIN, user_role_enum_1.UserRole.MANAGER),
    (0, swagger_1.ApiOperation)({ summary: 'Obtener todos los permisos' }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'Lista de permisos obtenida exitosamente',
    }),
    (0, swagger_1.ApiQuery)({
        name: 'method',
        required: false,
        enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
    }),
    (0, swagger_1.ApiQuery)({
        name: 'status',
        required: false,
        enum: ['active', 'inactive', 'deprecated'],
    }),
    (0, swagger_1.ApiQuery)({
        name: 'search',
        required: false,
        description: 'Buscar por nombre, descripción o ruta',
    }),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [permission_dto_1.PermissionFilterDto, Object]),
    __metadata("design:returntype", Promise)
], PermissionsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, roles_decorator_1.Roles)(user_role_enum_1.UserRole.SUPER_ADMIN, user_role_enum_1.UserRole.ADMIN, user_role_enum_1.UserRole.MANAGER),
    (0, swagger_1.ApiOperation)({ summary: 'Obtener un permiso por ID' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Permiso encontrado' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Permiso no encontrado' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", Promise)
], PermissionsController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, roles_decorator_1.Roles)(user_role_enum_1.UserRole.SUPER_ADMIN, user_role_enum_1.UserRole.ADMIN),
    (0, swagger_1.ApiOperation)({ summary: 'Actualizar un permiso' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Permiso actualizado exitosamente' }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Datos inválidos' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Permiso no encontrado' }),
    (0, swagger_1.ApiResponse)({
        status: 409,
        description: 'Ya existe un permiso con este nombre o ruta/método',
    }),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, permission_dto_1.UpdatePermissionDto, Object]),
    __metadata("design:returntype", Promise)
], PermissionsController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, roles_decorator_1.Roles)(user_role_enum_1.UserRole.SUPER_ADMIN, user_role_enum_1.UserRole.ADMIN),
    (0, swagger_1.ApiOperation)({ summary: 'Eliminar un permiso' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Permiso eliminado exitosamente' }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'No se puede eliminar el permiso' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Permiso no encontrado' }),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", Promise)
], PermissionsController.prototype, "remove", null);
__decorate([
    (0, common_1.Get)('search/by-name/:name'),
    (0, roles_decorator_1.Roles)(user_role_enum_1.UserRole.SUPER_ADMIN, user_role_enum_1.UserRole.ADMIN, user_role_enum_1.UserRole.MANAGER),
    (0, swagger_1.ApiOperation)({ summary: 'Buscar permiso por nombre' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Permiso encontrado' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Permiso no encontrado' }),
    __param(0, (0, common_1.Param)('name')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], PermissionsController.prototype, "findByName", null);
__decorate([
    (0, common_1.Get)('search/by-path-method'),
    (0, roles_decorator_1.Roles)(user_role_enum_1.UserRole.SUPER_ADMIN, user_role_enum_1.UserRole.ADMIN, user_role_enum_1.UserRole.MANAGER),
    (0, swagger_1.ApiOperation)({ summary: 'Buscar permiso por ruta y método' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Permiso encontrado' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Permiso no encontrado' }),
    (0, swagger_1.ApiQuery)({ name: 'path', required: true, description: 'Ruta del endpoint' }),
    (0, swagger_1.ApiQuery)({
        name: 'method',
        required: true,
        enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
    }),
    __param(0, (0, common_1.Query)('path')),
    __param(1, (0, common_1.Query)('method')),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], PermissionsController.prototype, "findByPathAndMethod", null);
exports.PermissionsController = PermissionsController = __decorate([
    (0, swagger_1.ApiTags)('Permissions'),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Controller)('permissions'),
    (0, common_1.UseGuards)(roles_guard_1.RolesGuard),
    __metadata("design:paramtypes", [permissions_service_1.PermissionsService,
        response_service_1.ResponseService])
], PermissionsController);
//# sourceMappingURL=permissions.controller.js.map