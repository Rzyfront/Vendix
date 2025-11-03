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
exports.AdminUsersController = void 0;
const common_1 = require("@nestjs/common");
const admin_users_service_1 = require("./admin-users.service");
const dto_1 = require("../users/dto");
const super_admin_decorator_1 = require("../auth/decorators/super-admin.decorator");
const super_admin_guard_1 = require("../auth/guards/super-admin.guard");
const swagger_1 = require("@nestjs/swagger");
const response_service_1 = require("../../common/responses/response.service");
let AdminUsersController = class AdminUsersController {
    constructor(adminUsersService, responseService) {
        this.adminUsersService = adminUsersService;
        this.responseService = responseService;
    }
    async create(createUserDto) {
        try {
            const result = await this.adminUsersService.create(createUserDto);
            return this.responseService.created(result, 'Usuario creado exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al crear el usuario', error.response?.message || error.message, error.status || 400);
        }
    }
    async findAll(query) {
        try {
            const result = await this.adminUsersService.findAll(query);
            if (result.data && result.meta) {
                return this.responseService.paginated(result.data, result.meta.total, result.meta.page, result.meta.limit, 'Usuarios obtenidos exitosamente');
            }
            return this.responseService.success(result, 'Usuarios obtenidos exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener los usuarios', error.response?.message || error.message, error.status || 400);
        }
    }
    async getDashboardStats() {
        try {
            const result = await this.adminUsersService.getDashboardStats();
            return this.responseService.success(result, 'Estadísticas del dashboard obtenidas exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener las estadísticas del dashboard', error.response?.message || error.message, error.status || 400);
        }
    }
    async findOne(id) {
        try {
            const result = await this.adminUsersService.findOne(+id);
            return this.responseService.success(result, 'Usuario obtenido exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener el usuario', error.response?.message || error.message, error.status || 400);
        }
    }
    async update(id, updateUserDto) {
        try {
            const result = await this.adminUsersService.update(+id, updateUserDto);
            return this.responseService.updated(result, 'Usuario actualizado exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al actualizar el usuario', error.response?.message || error.message, error.status || 400);
        }
    }
    async remove(id) {
        try {
            await this.adminUsersService.remove(+id);
            return this.responseService.deleted('Usuario eliminado exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al eliminar el usuario', error.response?.message || error.message, error.status || 400);
        }
    }
    async activate(id) {
        try {
            const result = await this.adminUsersService.activateUser(+id);
            return this.responseService.success(result, 'Usuario activado exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al activar el usuario', error.response?.message || error.message, error.status || 400);
        }
    }
    async deactivate(id) {
        try {
            const result = await this.adminUsersService.deactivateUser(+id);
            return this.responseService.success(result, 'Usuario desactivado exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al desactivar el usuario', error.response?.message || error.message, error.status || 400);
        }
    }
    async assignRole(userId, roleId) {
        try {
            const result = await this.adminUsersService.assignRole(+userId, +roleId);
            return this.responseService.success(result, 'Rol asignado exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al asignar el rol', error.response?.message || error.message, error.status || 400);
        }
    }
    async removeRole(userId, roleId) {
        try {
            const result = await this.adminUsersService.removeRole(+userId, +roleId);
            return this.responseService.success(result, 'Rol removido exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al remover el rol', error.response?.message || error.message, error.status || 400);
        }
    }
};
exports.AdminUsersController = AdminUsersController;
__decorate([
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({ summary: 'Create a new user' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'User created successfully' }),
    (0, swagger_1.ApiResponse)({ status: 409, description: 'Email already exists' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.CreateUserDto]),
    __metadata("design:returntype", Promise)
], AdminUsersController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'Get all users with pagination and filtering' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Users retrieved successfully' }),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.UserQueryDto]),
    __metadata("design:returntype", Promise)
], AdminUsersController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('dashboard'),
    (0, swagger_1.ApiOperation)({ summary: 'Get dashboard statistics for users' }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'Dashboard statistics retrieved successfully',
    }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminUsersController.prototype, "getDashboardStats", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Get a user by ID' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'User retrieved successfully' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'User not found' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminUsersController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Update a user' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'User updated successfully' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'User not found' }),
    (0, swagger_1.ApiResponse)({ status: 409, description: 'Email already exists' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, dto_1.UpdateUserDto]),
    __metadata("design:returntype", Promise)
], AdminUsersController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Delete a user' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'User deleted successfully' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'User not found' }),
    (0, swagger_1.ApiResponse)({
        status: 403,
        description: 'Cannot delete super admin users',
    }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminUsersController.prototype, "remove", null);
__decorate([
    (0, common_1.Post)(':id/activate'),
    (0, swagger_1.ApiOperation)({ summary: 'Activate a user' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'User activated successfully' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'User not found' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminUsersController.prototype, "activate", null);
__decorate([
    (0, common_1.Post)(':id/deactivate'),
    (0, swagger_1.ApiOperation)({ summary: 'Deactivate a user' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'User deactivated successfully' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'User not found' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminUsersController.prototype, "deactivate", null);
__decorate([
    (0, common_1.Post)(':userId/roles/:roleId'),
    (0, swagger_1.ApiOperation)({ summary: 'Assign a role to a user' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Role assigned successfully' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'User or role not found' }),
    (0, swagger_1.ApiResponse)({ status: 409, description: 'Role already assigned to user' }),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Param)('roleId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], AdminUsersController.prototype, "assignRole", null);
__decorate([
    (0, common_1.Delete)(':userId/roles/:roleId'),
    (0, swagger_1.ApiOperation)({ summary: 'Remove a role from a user' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Role removed successfully' }),
    (0, swagger_1.ApiResponse)({
        status: 404,
        description: 'User, role, or assignment not found',
    }),
    (0, swagger_1.ApiResponse)({
        status: 403,
        description: 'Cannot remove super admin role',
    }),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Param)('roleId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], AdminUsersController.prototype, "removeRole", null);
exports.AdminUsersController = AdminUsersController = __decorate([
    (0, swagger_1.ApiTags)('Admin Users'),
    (0, common_1.Controller)('admin/users'),
    (0, common_1.UseGuards)(super_admin_guard_1.SuperAdminGuard),
    (0, super_admin_decorator_1.SuperAdmin)(),
    __metadata("design:paramtypes", [admin_users_service_1.AdminUsersService,
        response_service_1.ResponseService])
], AdminUsersController);
//# sourceMappingURL=admin-users.controller.js.map