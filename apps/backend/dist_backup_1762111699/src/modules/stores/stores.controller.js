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
exports.StoresController = void 0;
const common_1 = require("@nestjs/common");
const response_service_1 = require("../../common/responses/response.service");
const stores_service_1 = require("./stores.service");
const dto_1 = require("./dto");
const permissions_guard_1 = require("../auth/guards/permissions.guard");
const permissions_decorator_1 = require("../auth/decorators/permissions.decorator");
const request_context_decorator_1 = require("../../common/decorators/request-context.decorator");
let StoresController = class StoresController {
    constructor(storesService, responseService) {
        this.storesService = storesService;
        this.responseService = responseService;
    }
    async create(createStoreDto, user) {
        try {
            const store = await this.storesService.create(createStoreDto);
            return this.responseService.created(store, 'Tienda creada exitosamente');
        }
        catch (error) {
            if (error.code === 'P2002') {
                return this.responseService.conflict('La tienda ya existe en esta organización', error.meta?.target || 'Duplicate entry');
            }
            if (error.message.includes('Organization not found')) {
                return this.responseService.notFound('Organización no encontrada', 'Organization');
            }
            return this.responseService.error('Error al crear la tienda', error.message);
        }
    }
    async findAll(query, user) {
        try {
            const result = await this.storesService.findAll(query);
            return this.responseService.paginated(result.data, result.meta.total, result.meta.page, result.meta.limit, 'Tiendas obtenidas exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al obtener las tiendas', error.message);
        }
    }
    async getStats() {
        try {
            const result = await this.storesService.getGlobalDashboard();
            return this.responseService.success(result, 'Estadísticas de tiendas obtenidas exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al obtener las estadísticas de tiendas', error.message);
        }
    }
    async findOne(id) {
        try {
            const store = await this.storesService.findOne(id);
            return this.responseService.success(store, 'Tienda obtenida exitosamente');
        }
        catch (error) {
            if (error.message.includes('Store not found')) {
                return this.responseService.notFound('Tienda no encontrada', 'Store');
            }
            return this.responseService.error('Error al obtener la tienda', error.message);
        }
    }
    async update(id, updateStoreDto) {
        try {
            const store = await this.storesService.update(id, updateStoreDto);
            return this.responseService.updated(store, 'Tienda actualizada exitosamente');
        }
        catch (error) {
            if (error.message.includes('Store not found')) {
                return this.responseService.notFound('Tienda no encontrada', 'Store');
            }
            return this.responseService.error('Error al actualizar la tienda', error.message);
        }
    }
    async remove(id) {
        try {
            await this.storesService.remove(id);
            return this.responseService.deleted('Tienda eliminada exitosamente');
        }
        catch (error) {
            if (error.message.includes('Store not found')) {
                return this.responseService.notFound('Tienda no encontrada', 'Store');
            }
            if (error.message.includes('Cannot delete store with active orders')) {
                return this.responseService.conflict('No se puede eliminar la tienda porque tiene órdenes activas', error.message);
            }
            return this.responseService.error('Error al eliminar la tienda', error.message);
        }
    }
    async updateSettings(storeId, settingsDto) {
        try {
            const settings = await this.storesService.updateStoreSettings(storeId, settingsDto);
            return this.responseService.updated(settings, 'Configuración de tienda actualizada exitosamente');
        }
        catch (error) {
            if (error.message.includes('Store not found')) {
                return this.responseService.notFound('Tienda no encontrada', 'Store');
            }
            return this.responseService.error('Error al actualizar la configuración de la tienda', error.message);
        }
    }
    async getStoreStats(id, query) {
        try {
            const result = await this.storesService.getDashboard(id, query);
            return this.responseService.success(result, 'Estadísticas de tienda obtenidas exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al obtener las estadísticas de tienda', error.message);
        }
    }
};
exports.StoresController = StoresController;
__decorate([
    (0, common_1.Post)(),
    (0, permissions_decorator_1.Permissions)('stores:create'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.CreateStoreDto, Object]),
    __metadata("design:returntype", Promise)
], StoresController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, permissions_decorator_1.Permissions)('stores:read'),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.StoreQueryDto, Object]),
    __metadata("design:returntype", Promise)
], StoresController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('stats'),
    (0, permissions_decorator_1.Permissions)('stores:read'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], StoresController.prototype, "getStats", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, permissions_decorator_1.Permissions)('stores:read'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], StoresController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, permissions_decorator_1.Permissions)('stores:update'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, dto_1.UpdateStoreDto]),
    __metadata("design:returntype", Promise)
], StoresController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, permissions_decorator_1.Permissions)('stores:delete'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], StoresController.prototype, "remove", null);
__decorate([
    (0, common_1.Patch)(':id/settings'),
    (0, permissions_decorator_1.Permissions)('stores:update'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, dto_1.UpdateStoreSettingsDto]),
    __metadata("design:returntype", Promise)
], StoresController.prototype, "updateSettings", null);
__decorate([
    (0, common_1.Get)(':id/stats'),
    (0, permissions_decorator_1.Permissions)('stores:read'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, dto_1.StoreDashboardDto]),
    __metadata("design:returntype", Promise)
], StoresController.prototype, "getStoreStats", null);
exports.StoresController = StoresController = __decorate([
    (0, common_1.Controller)('stores'),
    (0, common_1.UseGuards)(permissions_guard_1.PermissionsGuard),
    __metadata("design:paramtypes", [stores_service_1.StoresService,
        response_service_1.ResponseService])
], StoresController);
//# sourceMappingURL=stores.controller.js.map