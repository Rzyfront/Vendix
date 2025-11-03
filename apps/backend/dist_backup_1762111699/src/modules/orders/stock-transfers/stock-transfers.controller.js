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
exports.StockTransfersController = void 0;
const common_1 = require("@nestjs/common");
const stock_transfers_service_1 = require("./stock-transfers.service");
const create_transfer_dto_1 = require("./dto/create-transfer.dto");
const update_transfer_dto_1 = require("./dto/update-transfer.dto");
const transfer_query_dto_1 = require("./dto/transfer-query.dto");
let StockTransfersController = class StockTransfersController {
    constructor(stockTransfersService) {
        this.stockTransfersService = stockTransfersService;
    }
    create(createTransferDto) {
        return this.stockTransfersService.create(createTransferDto);
    }
    findAll(query) {
        return this.stockTransfersService.findAll(query);
    }
    findDrafts(query) {
        return this.stockTransfersService.findByStatus('draft', query);
    }
    findInTransit(query) {
        return this.stockTransfersService.findByStatus('in_transit', query);
    }
    findByFromLocation(locationId, query) {
        return this.stockTransfersService.findByFromLocation(+locationId, query);
    }
    findByToLocation(locationId, query) {
        return this.stockTransfersService.findByToLocation(+locationId, query);
    }
    findOne(id) {
        return this.stockTransfersService.findOne(+id);
    }
    update(id, updateTransferDto) {
        return this.stockTransfersService.update(+id, updateTransferDto);
    }
    approve(id) {
        return this.stockTransfersService.approve(+id);
    }
    startTransfer(id) {
        return this.stockTransfersService.startTransfer(+id);
    }
    complete(id, completeData) {
        return this.stockTransfersService.complete(+id, completeData.items);
    }
    cancel(id) {
        return this.stockTransfersService.cancel(+id);
    }
    remove(id) {
        return this.stockTransfersService.remove(+id);
    }
};
exports.StockTransfersController = StockTransfersController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_transfer_dto_1.CreateTransferDto]),
    __metadata("design:returntype", void 0)
], StockTransfersController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [transfer_query_dto_1.TransferQueryDto]),
    __metadata("design:returntype", void 0)
], StockTransfersController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)('draft'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [transfer_query_dto_1.TransferQueryDto]),
    __metadata("design:returntype", void 0)
], StockTransfersController.prototype, "findDrafts", null);
__decorate([
    (0, common_1.Get)('in-transit'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [transfer_query_dto_1.TransferQueryDto]),
    __metadata("design:returntype", void 0)
], StockTransfersController.prototype, "findInTransit", null);
__decorate([
    (0, common_1.Get)('from-location/:locationId'),
    __param(0, (0, common_1.Param)('locationId')),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, transfer_query_dto_1.TransferQueryDto]),
    __metadata("design:returntype", void 0)
], StockTransfersController.prototype, "findByFromLocation", null);
__decorate([
    (0, common_1.Get)('to-location/:locationId'),
    __param(0, (0, common_1.Param)('locationId')),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, transfer_query_dto_1.TransferQueryDto]),
    __metadata("design:returntype", void 0)
], StockTransfersController.prototype, "findByToLocation", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], StockTransfersController.prototype, "findOne", null);
__decorate([
    (0, common_1.Patch)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_transfer_dto_1.UpdateTransferDto]),
    __metadata("design:returntype", void 0)
], StockTransfersController.prototype, "update", null);
__decorate([
    (0, common_1.Patch)(':id/approve'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], StockTransfersController.prototype, "approve", null);
__decorate([
    (0, common_1.Patch)(':id/start'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], StockTransfersController.prototype, "startTransfer", null);
__decorate([
    (0, common_1.Patch)(':id/complete'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], StockTransfersController.prototype, "complete", null);
__decorate([
    (0, common_1.Patch)(':id/cancel'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], StockTransfersController.prototype, "cancel", null);
__decorate([
    (0, common_1.Delete)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], StockTransfersController.prototype, "remove", null);
exports.StockTransfersController = StockTransfersController = __decorate([
    (0, common_1.Controller)('orders/stock-transfers'),
    __metadata("design:paramtypes", [stock_transfers_service_1.StockTransfersService])
], StockTransfersController);
//# sourceMappingURL=stock-transfers.controller.js.map