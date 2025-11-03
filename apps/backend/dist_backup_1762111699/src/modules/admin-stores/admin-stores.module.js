"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminStoresModule = void 0;
const common_1 = require("@nestjs/common");
const admin_stores_controller_1 = require("./admin-stores.controller");
const admin_stores_service_1 = require("./admin-stores.service");
const prisma_module_1 = require("../../prisma/prisma.module");
const response_service_1 = require("../../common/responses/response.service");
let AdminStoresModule = class AdminStoresModule {
};
exports.AdminStoresModule = AdminStoresModule;
exports.AdminStoresModule = AdminStoresModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule],
        controllers: [admin_stores_controller_1.AdminStoresController],
        providers: [admin_stores_service_1.AdminStoresService, response_service_1.ResponseService],
        exports: [admin_stores_service_1.AdminStoresService],
    })
], AdminStoresModule);
//# sourceMappingURL=admin-stores.module.js.map