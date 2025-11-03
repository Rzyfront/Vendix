"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminOrganizationsModule = void 0;
const common_1 = require("@nestjs/common");
const admin_organizations_controller_1 = require("./admin-organizations.controller");
const admin_organizations_service_1 = require("./admin-organizations.service");
const prisma_module_1 = require("../../prisma/prisma.module");
const response_service_1 = require("../../common/responses/response.service");
let AdminOrganizationsModule = class AdminOrganizationsModule {
};
exports.AdminOrganizationsModule = AdminOrganizationsModule;
exports.AdminOrganizationsModule = AdminOrganizationsModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule],
        controllers: [admin_organizations_controller_1.AdminOrganizationsController],
        providers: [admin_organizations_service_1.AdminOrganizationsService, response_service_1.ResponseService],
        exports: [admin_organizations_service_1.AdminOrganizationsService],
    })
], AdminOrganizationsModule);
//# sourceMappingURL=admin-organizations.module.js.map