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
exports.EmailController = void 0;
const common_1 = require("@nestjs/common");
const email_service_1 = require("./email.service");
const request_context_decorator_1 = require("../common/decorators/request-context.decorator");
let EmailController = class EmailController {
    constructor(emailService) {
        this.emailService = emailService;
    }
    async getEmailConfig(user) {
        if (!user.roles?.includes('admin')) {
            return { message: 'Access denied' };
        }
        return {
            message: 'Email configuration',
            data: {
                ...this.emailService.getConfig(),
                isConfigured: this.emailService.isConfigured(),
                provider: this.emailService.getProviderName(),
            },
        };
    }
    async testEmailService(user) {
        if (!user.roles?.includes('admin')) {
            return { message: 'Access denied' };
        }
        const result = await this.emailService.testConnection();
        return {
            message: 'Email service test completed',
            data: result,
        };
    }
    async testEmailTemplate(user, body) {
        if (!user.roles?.includes('admin')) {
            return { message: 'Access denied' };
        }
        const email = body.email || user.email;
        const username = body.username || user.first_name || 'Test User';
        const token = 'test-token-' + Date.now();
        let result;
        switch (body.type) {
            case 'verification':
                result = await this.emailService.sendVerificationEmail(email, token, username);
                break;
            case 'password-reset':
                result = await this.emailService.sendPasswordResetEmail(email, token, username);
                break;
            case 'welcome':
                result = await this.emailService.sendWelcomeEmail(email, username);
                break;
            case 'onboarding':
                result = await this.emailService.sendOnboardingEmail(email, username, body.step || 'create_organization');
                break;
            default:
                return { message: 'Invalid template type' };
        }
        return {
            message: `${body.type} email template test sent`,
            data: result,
        };
    }
    async switchProvider(user, body) {
        if (!user.roles?.includes('admin')) {
            return { message: 'Access denied' };
        }
        this.emailService.switchProvider(body.provider, body.apiKey);
        return {
            message: `Email provider switched to ${body.provider}`,
            data: {
                provider: this.emailService.getProviderName(),
                isConfigured: this.emailService.isConfigured(),
            },
        };
    }
};
exports.EmailController = EmailController;
__decorate([
    (0, common_1.Get)('config'),
    __param(0, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], EmailController.prototype, "getEmailConfig", null);
__decorate([
    (0, common_1.Post)('test'),
    __param(0, (0, request_context_decorator_1.RequestContext)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], EmailController.prototype, "testEmailService", null);
__decorate([
    (0, common_1.Post)('test-template'),
    __param(0, (0, request_context_decorator_1.RequestContext)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], EmailController.prototype, "testEmailTemplate", null);
__decorate([
    (0, common_1.Post)('switch-provider'),
    __param(0, (0, request_context_decorator_1.RequestContext)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], EmailController.prototype, "switchProvider", null);
exports.EmailController = EmailController = __decorate([
    (0, common_1.Controller)('email'),
    __metadata("design:paramtypes", [email_service_1.EmailService])
], EmailController);
//# sourceMappingURL=email.controller.js.map