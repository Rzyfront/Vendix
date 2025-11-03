"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DomainsModule = void 0;
const common_1 = require("@nestjs/common");
const event_emitter_1 = require("@nestjs/event-emitter");
const domains_controller_1 = require("./domains.controller");
const domains_service_1 = require("./domains.service");
const prisma_module_1 = require("../../prisma/prisma.module");
const responses_1 = require("../../common/responses");
let DomainsModule = class DomainsModule {
};
exports.DomainsModule = DomainsModule;
exports.DomainsModule = DomainsModule = __decorate([
    (0, common_1.Module)({
        imports: [
            prisma_module_1.PrismaModule,
            event_emitter_1.EventEmitterModule.forRoot(),
            responses_1.ResponseModule,
        ],
        controllers: [domains_controller_1.DomainsController],
        providers: [domains_service_1.DomainsService],
        exports: [domains_service_1.DomainsService],
    })
], DomainsModule);
//# sourceMappingURL=domains.module.js.map