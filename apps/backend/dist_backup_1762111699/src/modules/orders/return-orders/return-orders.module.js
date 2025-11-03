"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReturnOrdersModule = void 0;
const common_1 = require("@nestjs/common");
const return_orders_controller_1 = require("./return-orders.controller");
const return_orders_service_1 = require("./return-orders.service");
const prisma_module_1 = require("../../../prisma/prisma.module");
let ReturnOrdersModule = class ReturnOrdersModule {
};
exports.ReturnOrdersModule = ReturnOrdersModule;
exports.ReturnOrdersModule = ReturnOrdersModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule],
        controllers: [return_orders_controller_1.ReturnOrdersController],
        providers: [return_orders_service_1.ReturnOrdersService],
        exports: [return_orders_service_1.ReturnOrdersService],
    })
], ReturnOrdersModule);
//# sourceMappingURL=return-orders.module.js.map