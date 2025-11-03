"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BypassEmailModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const prisma_module_1 = require("../../prisma/prisma.module");
const bypass_email_controller_1 = require("./bypass-email.controller");
const development_only_guard_1 = require("../../common/guards/development-only.guard");
let BypassEmailModule = class BypassEmailModule {
};
exports.BypassEmailModule = BypassEmailModule;
exports.BypassEmailModule = BypassEmailModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule],
        controllers: [bypass_email_controller_1.BypassEmailController],
        providers: [config_1.ConfigService, development_only_guard_1.DevelopmentOnlyGuard],
    })
], BypassEmailModule);
//# sourceMappingURL=bypass-email.module.js.map