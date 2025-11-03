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
exports.TaxesController = void 0;
const common_1 = require("@nestjs/common");
const taxes_service_1 = require("./taxes.service");
const dto_1 = require("./dto");
const permissions_guard_1 = require("../auth/guards/permissions.guard");
const permissions_decorator_1 = require("../auth/decorators/permissions.decorator");
const request_context_decorator_1 = require("../../common/decorators/request-context.decorator");
const response_service_1 = require("../../common/responses/response.service");
let TaxesController = class TaxesController {
    constructor(taxesService, responseService) {
        this.taxesService = taxesService;
        this.responseService = responseService;
    }
    async create(createTaxCategoryDto, user) {
        try {
            const tax = await this.taxesService.create(createTaxCategoryDto, user);
            return this.responseService.created(tax, 'Categoría de impuesto creada exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al crear categoría de impuesto', error.message);
        }
    }
    async findAll(query) {
        try {
            const result = await this.taxesService.findAll(query);
            if (result.data && result.meta) {
                return this.responseService.paginated(result.data, result.meta.total, result.meta.page, result.meta.limit, 'Categorías de impuestos obtenidas exitosamente');
            }
            else {
                return this.responseService.success(result, 'Categorías de impuestos obtenidas exitosamente');
            }
        }
        catch (error) {
            return this.responseService.error('Error al obtener categorías de impuestos', error.message);
        }
    }
    async findOne(id, user) {
        try {
            const tax = await this.taxesService.findOne(id, user);
            return this.responseService.success(tax, 'Categoría de impuesto obtenida exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al obtener categoría de impuesto', error.message);
        }
    }
    async update(id, updateTaxCategoryDto, user) {
        try {
            const tax = await this.taxesService.update(id, updateTaxCategoryDto, user);
            return this.responseService.updated(tax, 'Categoría de impuesto actualizada exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al actualizar categoría de impuesto', error.message);
        }
    }
    async remove(id, user) {
        try {
            await this.taxesService.remove(id, user);
            return this.responseService.deleted('Categoría de impuesto eliminada exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al eliminar categoría de impuesto', error.message);
        }
    }
};
exports.TaxesController = TaxesController;
__decorate([
    (0, common_1.Post)(),
    (0, permissions_decorator_1.Permissions)('taxes:create'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.CreateTaxCategoryDto, Object]),
    __metadata("design:returntype", Promise)
], TaxesController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    (0, permissions_decorator_1.Permissions)('taxes:read'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [dto_1.TaxCategoryQueryDto]),
    __metadata("design:returntype", Promise)
], TaxesController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, permissions_decorator_1.Permissions)('taxes:read'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", Promise)
], TaxesController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, permissions_decorator_1.Permissions)('taxes:update'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, dto_1.UpdateTaxCategoryDto, Object]),
    __metadata("design:returntype", Promise)
], TaxesController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, permissions_decorator_1.Permissions)('taxes:delete'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", Promise)
], TaxesController.prototype, "remove", null);
exports.TaxesController = TaxesController = __decorate([
    (0, common_1.Controller)('taxes'),
    (0, common_1.UseGuards)(permissions_guard_1.PermissionsGuard),
    __metadata("design:paramtypes", [taxes_service_1.TaxesService,
        response_service_1.ResponseService])
], TaxesController);
//# sourceMappingURL=taxes.controller.js.map