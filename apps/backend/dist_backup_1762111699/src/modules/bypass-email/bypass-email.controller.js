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
exports.BypassEmailController = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const prisma_service_1 = require("../../prisma/prisma.service");
const development_only_guard_1 = require("../../common/guards/development-only.guard");
const public_decorator_1 = require("../../common/decorators/public.decorator");
const response_service_1 = require("../../common/responses/response.service");
let BypassEmailController = class BypassEmailController {
    constructor(prisma, configService, responseService) {
        this.prisma = prisma;
        this.configService = configService;
        this.responseService = responseService;
    }
    async verifyEmail(body) {
        const { user_id } = body;
        if (!user_id) {
            return this.responseService.error('User ID is required', 'Falta el ID del usuario');
        }
        try {
            const updatedUser = await this.prisma.users.update({
                where: { id: user_id },
                data: {
                    email_verified: true,
                    state: 'active',
                },
                select: {
                    id: true,
                    email: true,
                    email_verified: true,
                    state: true,
                    first_name: true,
                    last_name: true,
                },
            });
            return this.responseService.success(updatedUser, 'Email verificado exitosamente (bypass desarrollo)');
        }
        catch (error) {
            if (error.code === 'P2025') {
                return this.responseService.error('Usuario no encontrado', 'El usuario especificado no existe');
            }
            return this.responseService.error('Error al verificar email', error.message);
        }
    }
};
exports.BypassEmailController = BypassEmailController;
__decorate([
    (0, common_1.Post)('verify'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BypassEmailController.prototype, "verifyEmail", null);
exports.BypassEmailController = BypassEmailController = __decorate([
    (0, common_1.Controller)('bypass-email'),
    (0, common_1.UseGuards)(development_only_guard_1.DevelopmentOnlyGuard),
    (0, public_decorator_1.Public)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService,
        response_service_1.ResponseService])
], BypassEmailController);
//# sourceMappingURL=bypass-email.controller.js.map