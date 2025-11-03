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
exports.ReturnOrdersController = void 0;
const common_1 = require("@nestjs/common");
const return_orders_service_1 = require("./return-orders.service");
const create_return_order_dto_1 = require("./dto/create-return-order.dto");
const update_return_order_dto_1 = require("./dto/update-return-order.dto");
const return_order_query_dto_1 = require("./dto/return-order-query.dto");
let ReturnOrdersController = class ReturnOrdersController {
    constructor(returnOrdersService) {
        this.returnOrdersService = returnOrdersService;
    }
    create(createReturnOrderDto) {
        return this.returnOrdersService.create(createReturnOrderDto);
    }
    findAll(query) {
        return this.returnOrdersService.findAll(query);
    }
    findDrafts(query) {
        return this.returnOrdersService.findByStatus('draft', query);
    }
    findProcessed(query) {
        return this.returnOrdersService.findByStatus('processed', query);
    }
    findPurchaseReturns(query) {
        return this.returnOrdersService.findByType('refund', query);
    }
    findSalesReturns(query) {
        return this.returnOrdersService.findByType('replacement', query);
    }
    findByPartner(partnerId, query) {
        return this.returnOrdersService.findByPartner(+partnerId, query);
    }
    findOne(id) {
        return this.returnOrdersService.findOne(+id);
    }
    update(id, updateReturnOrderDto) {
        return this.returnOrdersService.update(+id, updateReturnOrderDto);
    }
    process(id, processData) {
        return this.returnOrdersService.process(+id, processData.items);
    }
    cancel(id) {
        return this.returnOrdersService.cancel(+id);
    }
    remove(id) {
        return this.returnOrdersService.remove(+id);
    }
};
exports.ReturnOrdersController = ReturnOrdersController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_return_order_dto_1.CreateReturnOrderDto]),
    __metadata("design:returntype", void 0)
], ReturnOrdersController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [return_order_query_dto_1.ReturnOrderQueryDto]),
    __metadata("design:returntype", void 0)
], ReturnOrdersController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('draft'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [return_order_query_dto_1.ReturnOrderQueryDto]),
    __metadata("design:returntype", void 0)
], ReturnOrdersController.prototype, "findDrafts", null);
__decorate([
    (0, common_1.Get)('processed'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [return_order_query_dto_1.ReturnOrderQueryDto]),
    __metadata("design:returntype", void 0)
], ReturnOrdersController.prototype, "findProcessed", null);
__decorate([
    (0, common_1.Get)('purchase-returns'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [return_order_query_dto_1.ReturnOrderQueryDto]),
    __metadata("design:returntype", void 0)
], ReturnOrdersController.prototype, "findPurchaseReturns", null);
__decorate([
    (0, common_1.Get)('sales-returns'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [return_order_query_dto_1.ReturnOrderQueryDto]),
    __metadata("design:returntype", void 0)
], ReturnOrdersController.prototype, "findSalesReturns", null);
__decorate([
    (0, common_1.Get)('partner/:partnerId'),
    __param(0, (0, common_1.Param)('partnerId')),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, return_order_query_dto_1.ReturnOrderQueryDto]),
    __metadata("design:returntype", void 0)
], ReturnOrdersController.prototype, "findByPartner", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ReturnOrdersController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_return_order_dto_1.UpdateReturnOrderDto]),
    __metadata("design:returntype", void 0)
], ReturnOrdersController.prototype, "update", null);
__decorate([
    (0, common_1.Patch)(':id/process'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], ReturnOrdersController.prototype, "process", null);
__decorate([
    (0, common_1.Patch)(':id/cancel'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ReturnOrdersController.prototype, "cancel", null);
__decorate([
    (0, common_1.Delete)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ReturnOrdersController.prototype, "remove", null);
exports.ReturnOrdersController = ReturnOrdersController = __decorate([
    (0, common_1.Controller)('orders/return-orders'),
    __metadata("design:paramtypes", [return_orders_service_1.ReturnOrdersService])
], ReturnOrdersController);
//# sourceMappingURL=return-orders.controller.js.map