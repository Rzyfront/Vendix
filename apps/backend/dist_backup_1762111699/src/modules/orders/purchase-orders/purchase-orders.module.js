"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PurchaseOrdersModule = void 0;
const common_1 = require("@nestjs/common");
const purchase_orders_controller_1 = require("./purchase-orders.controller");
const purchase_orders_service_1 = require("./purchase-orders.service");
const prisma_module_1 = require("../../../prisma/prisma.module");
const response_module_1 = require("../../../common/responses/response.module");
let PurchaseOrdersModule = class PurchaseOrdersModule {
};
exports.PurchaseOrdersModule = PurchaseOrdersModule;
exports.PurchaseOrdersModule = PurchaseOrdersModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule, response_module_1.ResponseModule],
        controllers: [purchase_orders_controller_1.PurchaseOrdersController],
        providers: [purchase_orders_service_1.PurchaseOrdersService],
        exports: [purchase_orders_service_1.PurchaseOrdersService],
    })
], PurchaseOrdersModule);
//# sourceMappingURL=purchase-orders.module.js.map