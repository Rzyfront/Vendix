"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminDomainsModule = void 0;
const common_1 = require("@nestjs/common");
const admin_domains_controller_1 = require("./admin-domains.controller");
const admin_domains_service_1 = require("./admin-domains.service");
const prisma_module_1 = require("../../prisma/prisma.module");
const response_service_1 = require("../../common/responses/response.service");
let AdminDomainsModule = class AdminDomainsModule {
};
exports.AdminDomainsModule = AdminDomainsModule;
exports.AdminDomainsModule = AdminDomainsModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule],
        controllers: [admin_domains_controller_1.AdminDomainsController],
        providers: [admin_domains_service_1.AdminDomainsService, response_service_1.ResponseService],
        exports: [admin_domains_service_1.AdminDomainsService],
    })
], AdminDomainsModule);
//# sourceMappingURL=admin-domains.module.js.map