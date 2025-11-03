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
var ResendProvider_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResendProvider = void 0;
const common_1 = require("@nestjs/common");
const email_templates_1 = require("../templates/email-templates");
let ResendProvider = ResendProvider_1 = class ResendProvider {
    constructor(config) {
        this.config = config;
        this.logger = new common_1.Logger(ResendProvider_1.name);
        this.initializeResend();
    }
    initializeResend() {
        try {
            const { Resend } = require('resend');
            this.resend = new Resend(this.config.apiKey);
            this.logger.log('Resend provider initialized successfully');
        }
        catch (error) {
            this.logger.error('Failed to initialize Resend provider:', error);
            throw new Error('Resend provider initialization failed');
        }
    }
    async sendEmail(to, subject, html, text) {
        try {
            const result = await this.resend.emails.send({
                from: this.config.fromEmail,
                to: [to],
                subject,
                html,
                text,
            });
            if (result.error) {
                this.logger.error('Resend email error:', result.error);
                return {
                    success: false,
                    error: result.error.message || 'Failed to send email',
                };
            }
            this.logger.log(`Email sent successfully to ${to}, ID: ${result.data?.id}`);
            return {
                success: true,
                messageId: result.data?.id,
            };
        }
        catch (error) {
            this.logger.error('Resend send error:', error);
            return {
                success: false,
                error: error.message || 'Failed to send email',
            };
        }
    }
    async sendVerificationEmail(to, token, username) {
        const templateData = {
            username,
            email: to,
            token,
            companyName: 'Vendix',
            supportEmail: this.config.fromEmail,
            year: new Date().getFullYear(),
        };
        const template = email_templates_1.EmailTemplates.getVerificationTemplate(templateData);
        return this.sendEmail(to, template.subject, template.html, template.text);
    }
    async sendPasswordResetEmail(to, token, username) {
        const templateData = {
            username,
            email: to,
            token,
            companyName: 'Vendix',
            supportEmail: this.config.fromEmail,
            year: new Date().getFullYear(),
        };
        const template = email_templates_1.EmailTemplates.getPasswordResetTemplate(templateData);
        return this.sendEmail(to, template.subject, template.html, template.text);
    }
    async sendWelcomeEmail(to, username) {
        const templateData = {
            username,
            email: to,
            companyName: 'Vendix',
            supportEmail: this.config.fromEmail,
            year: new Date().getFullYear(),
        };
        const template = email_templates_1.EmailTemplates.getWelcomeTemplate(templateData);
        return this.sendEmail(to, template.subject, template.html, template.text);
    }
    async sendOnboardingEmail(to, username, step) {
        const templateData = {
            username,
            email: to,
            step,
            companyName: 'Vendix',
            supportEmail: this.config.fromEmail,
            year: new Date().getFullYear(),
        };
        const template = email_templates_1.EmailTemplates.getOnboardingTemplate(templateData);
        return this.sendEmail(to, template.subject, template.html, template.text);
    }
};
exports.ResendProvider = ResendProvider;
exports.ResendProvider = ResendProvider = ResendProvider_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [Object])
], ResendProvider);
//# sourceMappingURL=resend.provider.js.map