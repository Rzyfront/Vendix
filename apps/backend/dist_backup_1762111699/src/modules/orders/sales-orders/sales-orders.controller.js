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
exports.SalesOrdersController = void 0;
const common_1 = require("@nestjs/common");
const sales_orders_service_1 = require("./sales-orders.service");
const create_sales_order_dto_1 = require("./dto/create-sales-order.dto");
const update_sales_order_dto_1 = require("./dto/update-sales-order.dto");
const sales_order_query_dto_1 = require("./dto/sales-order-query.dto");
let SalesOrdersController = class SalesOrdersController {
    constructor(salesOrdersService) {
        this.salesOrdersService = salesOrdersService;
    }
    create(createSalesOrderDto) {
        return this.salesOrdersService.create(createSalesOrderDto);
    }
    findAll(query) {
        return this.salesOrdersService.findAll(query);
    }
    findDrafts(query) {
        return this.salesOrdersService.findByStatus('draft', query);
    }
    findConfirmed(query) {
        return this.salesOrdersService.findByStatus('confirmed', query);
    }
    findShipped(query) {
        return this.salesOrdersService.findByStatus('shipped', query);
    }
    findByCustomer(customerId, query) {
        return this.salesOrdersService.findByCustomer(+customerId, query);
    }
    findOne(id) {
        return this.salesOrdersService.findOne(+id);
    }
    update(id, updateSalesOrderDto) {
        return this.salesOrdersService.update(+id, updateSalesOrderDto);
    }
    confirm(id) {
        return this.salesOrdersService.confirm(+id);
    }
    ship(id, shipData) {
        return this.salesOrdersService.ship(+id, shipData.items);
    }
    invoice(id) {
        return this.salesOrdersService.invoice(+id);
    }
    cancel(id) {
        return this.salesOrdersService.cancel(+id);
    }
    remove(id) {
        return this.salesOrdersService.remove(+id);
    }
};
exports.SalesOrdersController = SalesOrdersController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_sales_order_dto_1.CreateSalesOrderDto]),
    __metadata("design:returntype", void 0)
], SalesOrdersController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [sales_order_query_dto_1.SalesOrderQueryDto]),
    __metadata("design:returntype", void 0)
], SalesOrdersController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('draft'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [sales_order_query_dto_1.SalesOrderQueryDto]),
    __metadata("design:returntype", void 0)
], SalesOrdersController.prototype, "findDrafts", null);
__decorate([
    (0, common_1.Get)('confirmed'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [sales_order_query_dto_1.SalesOrderQueryDto]),
    __metadata("design:returntype", void 0)
], SalesOrdersController.prototype, "findConfirmed", null);
__decorate([
    (0, common_1.Get)('shipped'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [sales_order_query_dto_1.SalesOrderQueryDto]),
    __metadata("design:returntype", void 0)
], SalesOrdersController.prototype, "findShipped", null);
__decorate([
    (0, common_1.Get)('customer/:customerId'),
    __param(0, (0, common_1.Param)('customerId')),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, sales_order_query_dto_1.SalesOrderQueryDto]),
    __metadata("design:returntype", void 0)
], SalesOrdersController.prototype, "findByCustomer", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], SalesOrdersController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_sales_order_dto_1.UpdateSalesOrderDto]),
    __metadata("design:returntype", void 0)
], SalesOrdersController.prototype, "update", null);
__decorate([
    (0, common_1.Patch)(':id/confirm'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], SalesOrdersController.prototype, "confirm", null);
__decorate([
    (0, common_1.Patch)(':id/ship'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], SalesOrdersController.prototype, "ship", null);
__decorate([
    (0, common_1.Patch)(':id/invoice'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], SalesOrdersController.prototype, "invoice", null);
__decorate([
    (0, common_1.Patch)(':id/cancel'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], SalesOrdersController.prototype, "cancel", null);
__decorate([
    (0, common_1.Delete)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], SalesOrdersController.prototype, "remove", null);
exports.SalesOrdersController = SalesOrdersController = __decorate([
    (0, common_1.Controller)('orders/sales-orders'),
    __metadata("design:paramtypes", [sales_orders_service_1.SalesOrdersService])
], SalesOrdersController);
//# sourceMappingURL=sales-orders.controller.js.map