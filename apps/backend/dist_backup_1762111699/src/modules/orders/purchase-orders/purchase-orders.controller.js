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
exports.PurchaseOrdersController = void 0;
const common_1 = require("@nestjs/common");
const purchase_orders_service_1 = require("./purchase-orders.service");
const create_purchase_order_dto_1 = require("./dto/create-purchase-order.dto");
const update_purchase_order_dto_1 = require("./dto/update-purchase-order.dto");
const purchase_order_query_dto_1 = require("./dto/purchase-order-query.dto");
const response_service_1 = require("../../../common/responses/response.service");
let PurchaseOrdersController = class PurchaseOrdersController {
    constructor(purchaseOrdersService, responseService) {
        this.purchaseOrdersService = purchaseOrdersService;
        this.responseService = responseService;
    }
    async create(createPurchaseOrderDto) {
        try {
            const result = await this.purchaseOrdersService.create(createPurchaseOrderDto);
            return this.responseService.created(result, 'Orden de compra creada exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al crear la orden de compra', error.response?.message || error.message, error.status || 400);
        }
    }
    async findAll(query) {
        try {
            const result = await this.purchaseOrdersService.findAll(query);
            if (result.data && result.meta) {
                return this.responseService.paginated(result.data, result.meta.total, result.meta.page, result.meta.limit, 'Órdenes de compra obtenidas exitosamente');
            }
            return this.responseService.success(result, 'Órdenes de compra obtenidas exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener las órdenes de compra', error.response?.message || error.message, error.status || 400);
        }
    }
    async findDrafts(query) {
        try {
            const result = await this.purchaseOrdersService.findByStatus('draft', query);
            return this.responseService.success(result, 'Borradores de órdenes de compra obtenidos exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener los borradores de órdenes de compra', error.response?.message || error.message, error.status || 400);
        }
    }
    async findApproved(query) {
        try {
            const result = await this.purchaseOrdersService.findByStatus('approved', query);
            return this.responseService.success(result, 'Órdenes de compra aprobadas obtenidas exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener las órdenes de compra aprobadas', error.response?.message || error.message, error.status || 400);
        }
    }
    async findPending(query) {
        try {
            const result = await this.purchaseOrdersService.findPending(query);
            return this.responseService.success(result, 'Órdenes de compra pendientes obtenidas exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener las órdenes de compra pendientes', error.response?.message || error.message, error.status || 400);
        }
    }
    async findBySupplier(supplierId, query) {
        try {
            const result = await this.purchaseOrdersService.findBySupplier(+supplierId, query);
            return this.responseService.success(result, 'Órdenes de compra del proveedor obtenidas exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener las órdenes de compra del proveedor', error.response?.message || error.message, error.status || 400);
        }
    }
    async findOne(id) {
        try {
            const result = await this.purchaseOrdersService.findOne(+id);
            return this.responseService.success(result, 'Orden de compra obtenida exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al obtener la orden de compra', error.response?.message || error.message, error.status || 400);
        }
    }
    async update(id, updatePurchaseOrderDto) {
        try {
            const result = await this.purchaseOrdersService.update(+id, updatePurchaseOrderDto);
            return this.responseService.updated(result, 'Orden de compra actualizada exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al actualizar la orden de compra', error.response?.message || error.message, error.status || 400);
        }
    }
    async approve(id) {
        try {
            const result = await this.purchaseOrdersService.approve(+id);
            return this.responseService.success(result, 'Orden de compra aprobada exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al aprobar la orden de compra', error.response?.message || error.message, error.status || 400);
        }
    }
    async cancel(id) {
        try {
            const result = await this.purchaseOrdersService.cancel(+id);
            return this.responseService.success(result, 'Orden de compra cancelada exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al cancelar la orden de compra', error.response?.message || error.message, error.status || 400);
        }
    }
    async receive(id, receiveData) {
        try {
            const result = await this.purchaseOrdersService.receive(+id, receiveData.items);
            return this.responseService.success(result, 'Orden de compra recibida exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al recibir la orden de compra', error.response?.message || error.message, error.status || 400);
        }
    }
    async remove(id) {
        try {
            await this.purchaseOrdersService.remove(+id);
            return this.responseService.deleted('Orden de compra eliminada exitosamente');
        }
        catch (error) {
            return this.responseService.error(error.message || 'Error al eliminar la orden de compra', error.response?.message || error.message, error.status || 400);
        }
    }
};
exports.PurchaseOrdersController = PurchaseOrdersController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_purchase_order_dto_1.CreatePurchaseOrderDto]),
    __metadata("design:returntype", Promise)
], PurchaseOrdersController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [purchase_order_query_dto_1.PurchaseOrderQueryDto]),
    __metadata("design:returntype", Promise)
], PurchaseOrdersController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('draft'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [purchase_order_query_dto_1.PurchaseOrderQueryDto]),
    __metadata("design:returntype", Promise)
], PurchaseOrdersController.prototype, "findDrafts", null);
__decorate([
    (0, common_1.Get)('approved'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [purchase_order_query_dto_1.PurchaseOrderQueryDto]),
    __metadata("design:returntype", Promise)
], PurchaseOrdersController.prototype, "findApproved", null);
__decorate([
    (0, common_1.Get)('pending'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [purchase_order_query_dto_1.PurchaseOrderQueryDto]),
    __metadata("design:returntype", Promise)
], PurchaseOrdersController.prototype, "findPending", null);
__decorate([
    (0, common_1.Get)('supplier/:supplierId'),
    __param(0, (0, common_1.Param)('supplierId')),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, purchase_order_query_dto_1.PurchaseOrderQueryDto]),
    __metadata("design:returntype", Promise)
], PurchaseOrdersController.prototype, "findBySupplier", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PurchaseOrdersController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_purchase_order_dto_1.UpdatePurchaseOrderDto]),
    __metadata("design:returntype", Promise)
], PurchaseOrdersController.prototype, "update", null);
__decorate([
    (0, common_1.Patch)(':id/approve'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PurchaseOrdersController.prototype, "approve", null);
__decorate([
    (0, common_1.Patch)(':id/cancel'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PurchaseOrdersController.prototype, "cancel", null);
__decorate([
    (0, common_1.Patch)(':id/receive'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], PurchaseOrdersController.prototype, "receive", null);
__decorate([
    (0, common_1.Delete)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PurchaseOrdersController.prototype, "remove", null);
exports.PurchaseOrdersController = PurchaseOrdersController = __decorate([
    (0, common_1.Controller)('orders/purchase-orders'),
    __metadata("design:paramtypes", [purchase_orders_service_1.PurchaseOrdersService,
        response_service_1.ResponseService])
], PurchaseOrdersController);
//# sourceMappingURL=purchase-orders.controller.js.map