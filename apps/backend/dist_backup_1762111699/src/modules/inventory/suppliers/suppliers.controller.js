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
exports.SuppliersController = void 0;
const common_1 = require("@nestjs/common");
const suppliers_service_1 = require("./suppliers.service");
const create_supplier_dto_1 = require("./dto/create-supplier.dto");
const update_supplier_dto_1 = require("./dto/update-supplier.dto");
const supplier_query_dto_1 = require("./dto/supplier-query.dto");
const response_service_1 = require("../../../common/responses/response.service");
let SuppliersController = class SuppliersController {
    constructor(suppliersService, responseService) {
        this.suppliersService = suppliersService;
        this.responseService = responseService;
    }
    async create(createSupplierDto) {
        try {
            const result = await this.suppliersService.create(createSupplierDto);
            return this.responseService.created(result, 'Proveedor creado exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al crear el proveedor', error.response?.message || error.message, error.status || 400);
        }
    }
    async findAll(query) {
        try {
            const result = await this.suppliersService.findAll(query);
            if (result.data && result.meta) {
                return this.responseService.paginated(result.data, result.meta.total, result.meta.page, result.meta.limit, 'Proveedores obtenidos exitosamente');
            }
            return this.responseService.success(result, 'Proveedores obtenidos exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener los proveedores', error.response?.message || error.message, error.status || 400);
        }
    }
    async findActive(query) {
        try {
            const result = await this.suppliersService.findActive(query);
            return this.responseService.success(result, 'Proveedores activos obtenidos exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener los proveedores activos', error.response?.message || error.message, error.status || 400);
        }
    }
    async findOne(id) {
        try {
            const result = await this.suppliersService.findOne(+id);
            return this.responseService.success(result, 'Proveedor obtenido exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener el proveedor', error.response?.message || error.message, error.status || 400);
        }
    }
    async findSupplierProducts(id) {
        try {
            const result = await this.suppliersService.findSupplierProducts(+id);
            return this.responseService.success(result, 'Productos del proveedor obtenidos exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener los productos del proveedor', error.response?.message || error.message, error.status || 400);
        }
    }
    async update(id, updateSupplierDto) {
        try {
            const result = await this.suppliersService.update(+id, updateSupplierDto);
            return this.responseService.updated(result, 'Proveedor actualizado exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al actualizar el proveedor', error.response?.message || error.message, error.status || 400);
        }
    }
    async remove(id) {
        try {
            await this.suppliersService.remove(+id);
            return this.responseService.deleted('Proveedor eliminado exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al eliminar el proveedor', error.response?.message || error.message, error.status || 400);
        }
    }
};
exports.SuppliersController = SuppliersController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_supplier_dto_1.CreateSupplierDto]),
    __metadata("design:returntype", Promise)
], SuppliersController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [supplier_query_dto_1.SupplierQueryDto]),
    __metadata("design:returntype", Promise)
], SuppliersController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('active'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [supplier_query_dto_1.SupplierQueryDto]),
    __metadata("design:returntype", Promise)
], SuppliersController.prototype, "findActive", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], SuppliersController.prototype, "findOne", null);
__decorate([
    (0, common_1.Get)(':id/products'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], SuppliersController.prototype, "findSupplierProducts", null);
__decorate([
    (0, common_1.Patch)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_supplier_dto_1.UpdateSupplierDto]),
    __metadata("design:returntype", Promise)
], SuppliersController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], SuppliersController.prototype, "remove", null);
exports.SuppliersController = SuppliersController = __decorate([
    (0, common_1.Controller)('inventory/suppliers'),
    __metadata("design:paramtypes", [suppliers_service_1.SuppliersService,
        response_service_1.ResponseService])
], SuppliersController);
//# sourceMappingURL=suppliers.controller.js.map