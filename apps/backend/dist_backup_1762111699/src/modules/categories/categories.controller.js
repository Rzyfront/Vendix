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
exports.CategoriesController = void 0;
const common_1 = require("@nestjs/common");
const categories_service_1 = require("./categories.service");
const dto_1 = require("./dto");
const permissions_guard_1 = require("../auth/guards/permissions.guard");
const permissions_decorator_1 = require("../auth/decorators/permissions.decorator");
const request_context_decorator_1 = require("../../common/decorators/request-context.decorator");
const response_service_1 = require("../../common/responses/response.service");
let CategoriesController = class CategoriesController {
    constructor(categoriesService, responseService) {
        this.categoriesService = categoriesService;
        this.responseService = responseService;
    }
    async create(createCategoryDto, user) {
        try {
            const result = await this.categoriesService.create(createCategoryDto, user);
            return this.responseService.created(result, 'Categoría creada exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al crear la categoría', error.response?.message || error.message, error.status || 400);
        }
    }
    async findAll(query) {
        try {
            const result = await this.categoriesService.findAll(query);
            if (result.data && result.meta) {
                return this.responseService.paginated(result.data, result.meta.total, result.meta.page, result.meta.limit, 'Categorías obtenidas exitosamente');
            }
            return this.responseService.success(result, 'Categorías obtenidas exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener las categorías', error.response?.message || error.message, error.status || 400);
        }
    }
    async findOne(id, includeInactive) {
        try {
            const result = await this.categoriesService.findOne(id, {
                includeInactive: includeInactive === 'true',
            });
            return this.responseService.success(result, 'Categoría obtenida exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener la categoría', error.response?.message || error.message, error.status || 400);
        }
    }
    async update(id, updateCategoryDto, user) {
        try {
            const result = await this.categoriesService.update(id, updateCategoryDto, user);
            return this.responseService.updated(result, 'Categoría actualizada exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al actualizar la categoría', error.response?.message || error.message, error.status || 400);
        }
    }
    async remove(id, user) {
        try {
            await this.categoriesService.remove(id, user);
            return this.responseService.deleted('Categoría eliminada exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al eliminar la categoría', error.response?.message || error.message, error.status || 400);
        }
    }
};
exports.CategoriesController = CategoriesController;
__decorate([
    (0, common_1.Post)(),
    (0, permissions_decorator_1.Permissions)('categories:create'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.CreateCategoryDto, Object]),
    __metadata("design:returntype", Promise)
], CategoriesController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, permissions_decorator_1.Permissions)('categories:read'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.CategoryQueryDto]),
    __metadata("design:returntype", Promise)
], CategoriesController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, permissions_decorator_1.Permissions)('categories:read'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Query)('include_inactive')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, String]),
    __metadata("design:returntype", Promise)
], CategoriesController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, permissions_decorator_1.Permissions)('categories:update'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, dto_1.UpdateCategoryDto, Object]),
    __metadata("design:returntype", Promise)
], CategoriesController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, permissions_decorator_1.Permissions)('categories:delete'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", Promise)
], CategoriesController.prototype, "remove", null);
exports.CategoriesController = CategoriesController = __decorate([
    (0, common_1.Controller)('categories'),
    (0, common_1.UseGuards)(permissions_guard_1.PermissionsGuard),
    __metadata("design:paramtypes", [categories_service_1.CategoriesService,
        response_service_1.ResponseService])
], CategoriesController);
//# sourceMappingURL=categories.controller.js.map