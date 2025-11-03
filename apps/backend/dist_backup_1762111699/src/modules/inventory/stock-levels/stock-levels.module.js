"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StockLevelsModule = void 0;
const common_1 = require("@nestjs/common");
const stock_levels_controller_1 = require("./stock-levels.controller");
const stock_levels_service_1 = require("./stock-levels.service");
const prisma_module_1 = require("../../../prisma/prisma.module");
const response_module_1 = require("../../../common/responses/response.module");
let StockLevelsModule = class StockLevelsModule {
};
exports.StockLevelsModule = StockLevelsModule;
exports.StockLevelsModule = StockLevelsModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule, response_module_1.ResponseModule],
        controllers: [stock_levels_controller_1.StockLevelsController],
        providers: [stock_levels_service_1.StockLevelsService],
        exports: [stock_levels_service_1.StockLevelsService],
    })
], StockLevelsModule);
//# sourceMappingURL=stock-levels.module.js.map