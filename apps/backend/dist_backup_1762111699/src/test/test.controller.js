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
exports.TestController = void 0;
const common_1 = require("@nestjs/common");
const roles_guard_1 = require("../modules/auth/guards/roles.guard");
const permissions_guard_1 = require("../modules/auth/guards/permissions.guard");
const roles_decorator_1 = require("../modules/auth/decorators/roles.decorator");
const permissions_decorator_1 = require("../modules/auth/decorators/permissions.decorator");
const request_context_decorator_1 = require("../common/decorators/request-context.decorator");
const public_decorator_1 = require("../modules/auth/decorators/public.decorator");
const email_service_1 = require("../email/email.service");
const prisma_service_1 = require("../prisma/prisma.service");
const response_service_1 = require("../common/responses/response.service");
let TestController = class TestController {
    constructor(emailService, prismaService, responseService) {
        this.emailService = emailService;
        this.prismaService = prismaService;
        this.responseService = responseService;
    }
    getEmailConfig() {
        try {
            const config = {
                provider: this.emailService.getProviderName(),
                isConfigured: this.emailService.isConfigured(),
                config: this.emailService.getConfig(),
            };
            return this.responseService.success(config, 'Configuración de email obtenida exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error al obtener configuración de email', error.message);
        }
    }
    async testQuickEmail(body) {
        try {
            const result = await this.emailService.sendEmail(body.email, 'Prueba Rápida de Vendix', '<h1>🎉 ¡Email funcionando!</h1><p>Tu configuración de email con Resend está trabajando perfectamente.</p>', 'Email funcionando! Tu configuración de email con Resend está trabajando perfectamente.');
            return this.responseService.success(result, 'Prueba rápida de email completada exitosamente');
        }
        catch (error) {
            return this.responseService.error('Error en prueba rápida de email', error.message);
        }
    }
    async testVerificationEmail(body) {
        const user = await this.prismaService.users.findFirst({
            where: { email: body.email },
        });
        if (!user) {
            throw new Error('Usuario no encontrado');
        }
        await this.prismaService.email_verification_tokens.updateMany({
            where: { user_id: user.id, verified: false },
            data: { verified: true },
        });
        const testToken = 'test-token-' + Date.now();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await this.prismaService.email_verification_tokens.create({
            data: {
                user_id: user.id,
                token: testToken,
                expires_at: expiresAt,
            },
        });
        const result = await this.emailService.sendVerificationEmail(body.email, testToken, body.username);
        return {
            message: 'Verification email test sent and token created in database',
            data: {
                ...result,
                testToken,
                userId: user.id,
            },
        };
    }
    getPublicData() {
        return {
            message: 'Este endpoint es público - no requiere autenticación',
            data: 'Cualquiera puede acceder a esto',
        };
    }
    getProtectedData(user) {
        return {
            message: 'Este endpoint requiere autenticación',
            user: {
                id: user.id,
                email: user.email,
                role: user.roles,
            },
        };
    }
    getAdminData(user) {
        return {
            message: 'Solo administradores pueden ver esto',
            user: {
                id: user.id,
                email: user.email,
                role: user.roles,
            },
        };
    }
    getUsersData(user) {
        return {
            message: 'Requiere permiso específico: users.read',
            user: {
                id: user.id,
                email: user.email,
                permissions: user.permissions,
            },
        };
    }
    getManagerData(user) {
        return {
            message: 'Accesible por administradores y gerentes',
            user: {
                id: user.id,
                email: user.email,
                role: user.roles,
            },
        };
    }
    async sendEmail(body) {
        const { to, subject, text } = body;
        await this.emailService.sendEmail(to, subject, text);
        return {
            message: 'Email enviado',
        };
    }
};
exports.TestController = TestController;
__decorate([
    (0, public_decorator_1.Public)(),
    (0, common_1.Get)('email-config'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], TestController.prototype, "getEmailConfig", null);
__decorate([
    (0, public_decorator_1.Public)(),
    (0, common_1.Post)('email-quick'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], TestController.prototype, "testQuickEmail", null);
__decorate([
    (0, public_decorator_1.Public)(),
    (0, common_1.Post)('email-verification-test'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], TestController.prototype, "testVerificationEmail", null);
__decorate([
    (0, public_decorator_1.Public)(),
    (0, common_1.Get)('public'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], TestController.prototype, "getPublicData", null);
__decorate([
    (0, common_1.Get)('protected'),
    __param(0, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], TestController.prototype, "getProtectedData", null);
__decorate([
    (0, common_1.Get)('admin-only'),
    (0, common_1.UseGuards)(roles_guard_1.RolesGuard),
    (0, roles_decorator_1.Roles)('admin'),
    __param(0, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], TestController.prototype, "getAdminData", null);
__decorate([
    (0, common_1.Get)('users-permission'),
    (0, common_1.UseGuards)(permissions_guard_1.PermissionsGuard),
    (0, permissions_decorator_1.RequirePermissions)('users.read'),
    __param(0, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], TestController.prototype, "getUsersData", null);
__decorate([
    (0, common_1.Get)('manager-or-admin'),
    (0, common_1.UseGuards)(roles_guard_1.RolesGuard),
    (0, roles_decorator_1.Roles)('admin', 'manager'),
    __param(0, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], TestController.prototype, "getManagerData", null);
__decorate([
    (0, common_1.Post)('send-email'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], TestController.prototype, "sendEmail", null);
exports.TestController = TestController = __decorate([
    (0, common_1.Controller)('test'),
    __metadata("design:paramtypes", [email_service_1.EmailService,
        prisma_service_1.PrismaService,
        response_service_1.ResponseService])
], TestController);
//# sourceMappingURL=test.controller.js.map