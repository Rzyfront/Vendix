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
exports.ProductsController = void 0;
const common_1 = require("@nestjs/common");
const products_service_1 = require("./products.service");
const dto_1 = require("./dto");
const permissions_guard_1 = require("../auth/guards/permissions.guard");
const permissions_decorator_1 = require("../auth/decorators/permissions.decorator");
const request_context_decorator_1 = require("../../common/decorators/request-context.decorator");
const response_service_1 = require("../../common/responses/response.service");
let ProductsController = class ProductsController {
    constructor(productsService, responseService) {
        this.productsService = productsService;
        this.responseService = responseService;
    }
    async create(createProductDto, user) {
        try {
            const result = await this.productsService.create(createProductDto);
            return this.responseService.created(result, 'Producto creado exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al crear el producto', error.response?.message || error.message, error.status || 400);
        }
    }
    async findAll(query, user) {
        try {
            const result = await this.productsService.findAll(query);
            if (result.data && result.meta) {
                return this.responseService.paginated(result.data, result.meta.total, result.meta.page, result.meta.limit, 'Productos obtenidos exitosamente');
            }
            return this.responseService.success(result, 'Productos obtenidos exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener los productos', error.response?.message || error.message, error.status || 400);
        }
    }
    async findOne(id) {
        try {
            const result = await this.productsService.findOne(id);
            return this.responseService.success(result, 'Producto obtenido exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener el producto', error.response?.message || error.message, error.status || 400);
        }
    }
    async findByStore(storeId) {
        try {
            const result = await this.productsService.getProductsByStore(storeId);
            return this.responseService.success(result, 'Productos de la tienda obtenidos exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener los productos de la tienda', error.response?.message || error.message, error.status || 400);
        }
    }
    async findBySlug(slug, storeId) {
        try {
            const result = await this.productsService.findBySlug(storeId, slug);
            return this.responseService.success(result, 'Producto obtenido exitosamente por slug');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener el producto por slug', error.response?.message || error.message, error.status || 400);
        }
    }
    async update(id, updateProductDto) {
        try {
            const result = await this.productsService.update(id, updateProductDto);
            return this.responseService.updated(result, 'Producto actualizado exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al actualizar el producto', error.response?.message || error.message, error.status || 400);
        }
    }
    async deactivate(id) {
        try {
            await this.productsService.deactivate(id);
            return this.responseService.success(null, 'Producto desactivado exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al desactivar el producto', error.response?.message || error.message, error.status || 400);
        }
    }
    async remove(id) {
        try {
            await this.productsService.remove(id);
            return this.responseService.deleted('Producto eliminado exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al eliminar el producto', error.response?.message || error.message, error.status || 400);
        }
    }
    async createVariant(productId, createVariantDto) {
        try {
            createVariantDto.product_id = productId;
            const result = await this.productsService.createVariant(createVariantDto);
            return this.responseService.created(result, 'Variante de producto creada exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al crear la variante del producto', error.response?.message || error.message, error.status || 400);
        }
    }
    async updateVariant(variantId, updateVariantDto) {
        try {
            const result = await this.productsService.updateVariant(variantId, updateVariantDto);
            return this.responseService.updated(result, 'Variante de producto actualizada exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al actualizar la variante del producto', error.response?.message || error.message, error.status || 400);
        }
    }
    async removeVariant(variantId) {
        try {
            await this.productsService.removeVariant(variantId);
            return this.responseService.deleted('Variante de producto eliminada exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al eliminar la variante del producto', error.response?.message || error.message, error.status || 400);
        }
    }
    async addImage(productId, imageDto) {
        try {
            const result = await this.productsService.addImage(productId, imageDto);
            return this.responseService.created(result, 'Imagen de producto agregada exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al agregar la imagen del producto', error.response?.message || error.message, error.status || 400);
        }
    }
    async removeImage(imageId) {
        try {
            await this.productsService.removeImage(imageId);
            return this.responseService.deleted('Imagen de producto eliminada exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al eliminar la imagen del producto', error.response?.message || error.message, error.status || 400);
        }
    }
};
exports.ProductsController = ProductsController;
__decorate([
    (0, common_1.Post)(),
    (0, permissions_decorator_1.Permissions)('products:create'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.CreateProductDto, Object]),
    __metadata("design:returntype", Promise)
], ProductsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, permissions_decorator_1.Permissions)('products:read'),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.ProductQueryDto, Object]),
    __metadata("design:returntype", Promise)
], ProductsController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, permissions_decorator_1.Permissions)('products:read'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], ProductsController.prototype, "findOne", null);
__decorate([
    (0, common_1.Get)('store/:storeId'),
    (0, permissions_decorator_1.Permissions)('products:read'),
    __param(0, (0, common_1.Param)('storeId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], ProductsController.prototype, "findByStore", null);
__decorate([
    (0, common_1.Get)('slug/:slug/store/:storeId'),
    (0, permissions_decorator_1.Permissions)('products:read'),
    __param(0, (0, common_1.Param)('slug')),
    __param(1, (0, common_1.Param)('storeId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Number]),
    __metadata("design:returntype", Promise)
], ProductsController.prototype, "findBySlug", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, permissions_decorator_1.Permissions)('products:update'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, dto_1.UpdateProductDto]),
    __metadata("design:returntype", Promise)
], ProductsController.prototype, "update", null);
__decorate([
    (0, common_1.Patch)(':id/deactivate'),
    (0, permissions_decorator_1.Permissions)('products:delete'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], ProductsController.prototype, "deactivate", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, permissions_decorator_1.Permissions)('products:admin_delete'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], ProductsController.prototype, "remove", null);
__decorate([
    (0, common_1.Post)(':id/variants'),
    (0, permissions_decorator_1.Permissions)('products:create'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, dto_1.CreateProductVariantDto]),
    __metadata("design:returntype", Promise)
], ProductsController.prototype, "createVariant", null);
__decorate([
    (0, common_1.Patch)('variants/:variantId'),
    (0, permissions_decorator_1.Permissions)('products:update'),
    __param(0, (0, common_1.Param)('variantId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, dto_1.UpdateProductVariantDto]),
    __metadata("design:returntype", Promise)
], ProductsController.prototype, "updateVariant", null);
__decorate([
    (0, common_1.Delete)('variants/:variantId'),
    (0, permissions_decorator_1.Permissions)('products:delete'),
    __param(0, (0, common_1.Param)('variantId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], ProductsController.prototype, "removeVariant", null);
__decorate([
    (0, common_1.Post)(':id/images'),
    (0, permissions_decorator_1.Permissions)('products:update'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, dto_1.ProductImageDto]),
    __metadata("design:returntype", Promise)
], ProductsController.prototype, "addImage", null);
__decorate([
    (0, common_1.Delete)('images/:imageId'),
    (0, permissions_decorator_1.Permissions)('products:update'),
    __param(0, (0, common_1.Param)('imageId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], ProductsController.prototype, "removeImage", null);
exports.ProductsController = ProductsController = __decorate([
    (0, common_1.Controller)('products'),
    (0, common_1.UseGuards)(permissions_guard_1.PermissionsGuard),
    __metadata("design:paramtypes", [products_service_1.ProductsService,
        response_service_1.ResponseService])
], ProductsController);
//# sourceMappingURL=products.controller.js.map