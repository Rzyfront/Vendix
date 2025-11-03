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
exports.BrandsController = void 0;
const common_1 = require("@nestjs/common");
const brands_service_1 = require("./brands.service");
const dto_1 = require("./dto");
const permissions_guard_1 = require("../auth/guards/permissions.guard");
const permissions_decorator_1 = require("../auth/decorators/permissions.decorator");
const request_context_decorator_1 = require("../../common/decorators/request-context.decorator");
const response_service_1 = require("../../common/responses/response.service");
let BrandsController = class BrandsController {
    constructor(brandsService, responseService) {
        this.brandsService = brandsService;
        this.responseService = responseService;
    }
    async create(createBrandDto, user) {
        try {
            const brand = await this.brandsService.create(createBrandDto, user);
            return this.responseService.created(brand, 'Marca creada exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al crear marca', error.message);
        }
    }
    async findAll(query) {
        try {
            const result = await this.brandsService.findAll(query);
            if (result.data && result.meta) {
                return this.responseService.paginated(result.data, result.meta.total, result.meta.page, result.meta.limit, 'Marcas obtenidas exitosamente');
            }
            else {
                return this.responseService.success(result, 'Marcas obtenidas exitosamente');
            }
        }
        catch (error) {
            return this.responseService.error('Error al obtener marcas', error.message);
        }
    }
    async findByStore(storeId, query) {
        try {
            const result = await this.brandsService.findByStore(storeId, query);
            if (result.data && result.meta) {
                return this.responseService.paginated(result.data, result.meta.total, result.meta.page, result.meta.limit, 'Marcas de la tienda obtenidas exitosamente');
            }
            else {
                return this.responseService.success(result, 'Marcas de la tienda obtenidas exitosamente');
            }
        }
        catch (error) {
            return this.responseService.error('Error al obtener marcas de la tienda', error.message);
        }
    }
    async findOne(id, includeInactive) {
        try {
            const brand = await this.brandsService.findOne(id, {
                includeInactive: includeInactive === 'true',
            });
            return this.responseService.success(brand, 'Marca obtenida exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al obtener marca', error.message);
        }
    }
    async findBySlug(slug, storeId, includeInactive) {
        try {
            const brand = await this.brandsService.findBySlug(slug, storeId, {
                includeInactive: includeInactive === 'true',
            });
            return this.responseService.success(brand, 'Marca obtenida exitosamente por slug');
        }
        catch (error) {
            return this.responseService.error('Error al obtener marca por slug', error.message);
        }
    }
    async update(id, updateBrandDto, user) {
        try {
            const brand = await this.brandsService.update(id, updateBrandDto, user);
            return this.responseService.updated(brand, 'Marca actualizada exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al actualizar marca', error.message);
        }
    }
    async activate(id, user) {
        try {
            const brand = await this.brandsService.activate(id, user);
            return this.responseService.updated(brand, 'Marca activada exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al activar marca', error.message);
        }
    }
    async deactivate(id, user) {
        try {
            await this.brandsService.deactivate(id, user);
            return this.responseService.deleted('Marca desactivada exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al desactivar marca', error.message);
        }
    }
    async remove(id, user) {
        try {
            await this.brandsService.remove(id, user);
            return this.responseService.deleted('Marca eliminada exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al eliminar marca', error.message);
        }
    }
};
exports.BrandsController = BrandsController;
__decorate([
    (0, common_1.Post)(),
    (0, permissions_decorator_1.Permissions)('brands:create'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.CreateBrandDto, Object]),
    __metadata("design:returntype", Promise)
], BrandsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, permissions_decorator_1.Permissions)('brands:read'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.BrandQueryDto]),
    __metadata("design:returntype", Promise)
], BrandsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('store/:storeId'),
    (0, permissions_decorator_1.Permissions)('brands:read'),
    __param(0, (0, common_1.Param)('storeId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, dto_1.BrandQueryDto]),
    __metadata("design:returntype", Promise)
], BrandsController.prototype, "findByStore", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, permissions_decorator_1.Permissions)('brands:read'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Query)('include_inactive')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, String]),
    __metadata("design:returntype", Promise)
], BrandsController.prototype, "findOne", null);
__decorate([
    (0, common_1.Get)('slug/:slug/store/:storeId'),
    (0, permissions_decorator_1.Permissions)('brands:read'),
    __param(0, (0, common_1.Param)('slug')),
    __param(1, (0, common_1.Param)('storeId', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Query)('include_inactive')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Number, String]),
    __metadata("design:returntype", Promise)
], BrandsController.prototype, "findBySlug", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, permissions_decorator_1.Permissions)('brands:update'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, dto_1.UpdateBrandDto, Object]),
    __metadata("design:returntype", Promise)
], BrandsController.prototype, "update", null);
__decorate([
    (0, common_1.Patch)(':id/activate'),
    (0, permissions_decorator_1.Permissions)('brands:update'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", Promise)
], BrandsController.prototype, "activate", null);
__decorate([
    (0, common_1.Patch)(':id/deactivate'),
    (0, permissions_decorator_1.Permissions)('brands:delete'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", Promise)
], BrandsController.prototype, "deactivate", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, permissions_decorator_1.Permissions)('brands:admin_delete'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", Promise)
], BrandsController.prototype, "remove", null);
exports.BrandsController = BrandsController = __decorate([
    (0, common_1.Controller)('brands'),
    (0, common_1.UseGuards)(permissions_guard_1.PermissionsGuard),
    __metadata("design:paramtypes", [brands_service_1.BrandsService,
        response_service_1.ResponseService])
], BrandsController);
//# sourceMappingURL=brands.controller.js.map