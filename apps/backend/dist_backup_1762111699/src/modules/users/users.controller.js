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
exports.UsersController = void 0;
const common_1 = require("@nestjs/common");
const users_service_1 = require("./users.service");
const dto_1 = require("./dto");
const permissions_guard_1 = require("../auth/guards/permissions.guard");
const permissions_decorator_1 = require("../auth/decorators/permissions.decorator");
const request_context_decorator_1 = require("../../common/decorators/request-context.decorator");
const response_service_1 = require("../../common/responses/response.service");
let UsersController = class UsersController {
    constructor(usersService, responseService) {
        this.usersService = usersService;
        this.responseService = responseService;
    }
    async create(createUserDto, currentUser) {
        try {
            const user = await this.usersService.create(createUserDto);
            return this.responseService.created(user, 'Usuario creado exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al crear el usuario', error.response?.message || error.message, error.status || 400);
        }
    }
    async findAll(query, user) {
        try {
            const result = await this.usersService.findAll(query);
            if (result.data && result.meta) {
                return this.responseService.paginated(result.data, result.meta.total, result.meta.page, result.meta.limit, 'Usuarios obtenidos exitosamente');
            }
            return this.responseService.success(result, 'Usuarios obtenidos exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener los usuarios', error.response?.message || error.message, error.status || 400);
        }
    }
    async getStats(query) {
        try {
            const result = await this.usersService.getDashboard(query);
            return this.responseService.success(result.data, 'Estadísticas de usuarios obtenidas exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al obtener las estadísticas de usuarios', error.message);
        }
    }
    async findOne(id) {
        try {
            const user = await this.usersService.findOne(id);
            return this.responseService.success(user, 'Usuario obtenido exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener el usuario', error.response?.message || error.message, error.status || 400);
        }
    }
    async update(id, updateUserDto) {
        try {
            const result = await this.usersService.update(id, updateUserDto);
            return this.responseService.updated(result, 'Usuario actualizado exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al actualizar el usuario', error.response?.message || error.message, error.status || 400);
        }
    }
    async remove(id) {
        try {
            await this.usersService.remove(id);
            return this.responseService.deleted('Usuario eliminado exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al eliminar el usuario', error.response?.message || error.message, error.status || 400);
        }
    }
    async archive(id) {
        try {
            const result = await this.usersService.archive(id);
            return this.responseService.success(result, 'Usuario archivado exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al archivar el usuario', error.response?.message || error.message, error.status || 400);
        }
    }
    async reactivate(id) {
        try {
            const result = await this.usersService.reactivate(id);
            return this.responseService.success(result, 'Usuario reactivado exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al reactivar el usuario', error.response?.message || error.message, error.status || 400);
        }
    }
};
exports.UsersController = UsersController;
__decorate([
    (0, common_1.Post)(),
    (0, permissions_decorator_1.Permissions)('users:create'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.CreateUserDto, Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, permissions_decorator_1.Permissions)('users:read'),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.UserQueryDto, Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('stats'),
    (0, permissions_decorator_1.Permissions)('users:read'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.UsersDashboardDto]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "getStats", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, permissions_decorator_1.Permissions)('users:read'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, permissions_decorator_1.Permissions)('users:update'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, dto_1.UpdateUserDto]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, permissions_decorator_1.Permissions)('users:delete'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "remove", null);
__decorate([
    (0, common_1.Post)(':id/archive'),
    (0, permissions_decorator_1.Permissions)('users:delete'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "archive", null);
__decorate([
    (0, common_1.Post)(':id/reactivate'),
    (0, permissions_decorator_1.Permissions)('users:update'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "reactivate", null);
exports.UsersController = UsersController = __decorate([
    (0, common_1.Controller)('users'),
    (0, common_1.UseGuards)(permissions_guard_1.PermissionsGuard),
    __metadata("design:paramtypes", [users_service_1.UsersService,
        response_service_1.ResponseService])
], UsersController);
//# sourceMappingURL=users.controller.js.map