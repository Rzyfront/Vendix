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
exports.AdminStoresController = void 0;
const common_1 = require("@nestjs/common");
const admin_stores_service_1 = require("./admin-stores.service");
const dto_1 = require("../stores/dto");
const super_admin_decorator_1 = require("../auth/decorators/super-admin.decorator");
const super_admin_guard_1 = require("../auth/guards/super-admin.guard");
const swagger_1 = require("@nestjs/swagger");
const response_service_1 = require("../../common/responses/response.service");
let AdminStoresController = class AdminStoresController {
    constructor(adminStoresService, responseService) {
        this.adminStoresService = adminStoresService;
        this.responseService = responseService;
    }
    async create(createStoreDto) {
        try {
            const result = await this.adminStoresService.create(createStoreDto);
            return this.responseService.created(result, 'Tienda creada exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al crear la tienda', error.response?.message || error.message, error.status || 400);
        }
    }
    async findAll(query) {
        try {
            const result = await this.adminStoresService.findAll(query);
            if (result.data && result.meta) {
                return this.responseService.paginated(result.data, result.meta.total, result.meta.page, result.meta.limit, 'Tiendas obtenidas exitosamente');
            }
            return this.responseService.success(result, 'Tiendas obtenidas exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener las tiendas', error.response?.message || error.message, error.status || 400);
        }
    }
    async getDashboardStats() {
        try {
            const result = await this.adminStoresService.getDashboardStats();
            return this.responseService.success(result, 'Estadísticas del dashboard obtenidas exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener las estadísticas del dashboard', error.response?.message || error.message, error.status || 400);
        }
    }
    async findOne(id) {
        try {
            const result = await this.adminStoresService.findOne(+id);
            return this.responseService.success(result, 'Tienda obtenida exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener la tienda', error.response?.message || error.message, error.status || 400);
        }
    }
    async update(id, updateStoreDto) {
        try {
            const result = await this.adminStoresService.update(+id, updateStoreDto);
            return this.responseService.updated(result, 'Tienda actualizada exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al actualizar la tienda', error.response?.message || error.message, error.status || 400);
        }
    }
    async remove(id) {
        try {
            await this.adminStoresService.remove(+id);
            return this.responseService.deleted('Tienda eliminada exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al eliminar la tienda', error.response?.message || error.message, error.status || 400);
        }
    }
};
exports.AdminStoresController = AdminStoresController;
__decorate([
    (0, common_1.Post)(),
    (0, swagger_1.ApiOperation)({ summary: 'Create a new store' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Store created successfully' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.CreateStoreDto]),
    __metadata("design:returntype", Promise)
], AdminStoresController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, swagger_1.ApiOperation)({ summary: 'Get all stores with pagination and filtering' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Stores retrieved successfully' }),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.AdminStoreQueryDto]),
    __metadata("design:returntype", Promise)
], AdminStoresController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('dashboard'),
    (0, swagger_1.ApiOperation)({ summary: 'Get dashboard statistics for stores' }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'Dashboard statistics retrieved successfully',
    }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AdminStoresController.prototype, "getDashboardStats", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Get a store by ID' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Store retrieved successfully' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Store not found' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminStoresController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Update a store' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Store updated successfully' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Store not found' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, dto_1.UpdateStoreDto]),
    __metadata("design:returntype", Promise)
], AdminStoresController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, swagger_1.ApiOperation)({ summary: 'Delete a store' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Store deleted successfully' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Store not found' }),
    (0, swagger_1.ApiResponse)({
        status: 409,
        description: 'Cannot delete store with existing data',
    }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminStoresController.prototype, "remove", null);
exports.AdminStoresController = AdminStoresController = __decorate([
    (0, swagger_1.ApiTags)('Admin Stores'),
    (0, common_1.Controller)('admin/stores'),
    (0, common_1.UseGuards)(super_admin_guard_1.SuperAdminGuard),
    (0, super_admin_decorator_1.SuperAdmin)(),
    __metadata("design:paramtypes", [admin_stores_service_1.AdminStoresService,
        response_service_1.ResponseService])
], AdminStoresController);
//# sourceMappingURL=admin-stores.controller.js.map