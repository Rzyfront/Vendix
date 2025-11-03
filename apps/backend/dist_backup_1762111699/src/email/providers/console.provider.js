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
var ConsoleProvider_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConsoleProvider = void 0;
const common_1 = require("@nestjs/common");
const email_templates_1 = require("../templates/email-templates");
let ConsoleProvider = ConsoleProvider_1 = class ConsoleProvider {
    constructor(config) {
        this.config = config;
        this.logger = new common_1.Logger(ConsoleProvider_1.name);
        this.logger.warn('Using Console Email Provider - emails will only be logged to console');
    }
    async sendEmail(to, subject, html, text) {
        this.logger.log('========== EMAIL TO SEND ==========');
        this.logger.log(`From: ${this.config.fromName} <${this.config.fromEmail}>`);
        this.logger.log(`To: ${to}`);
        this.logger.log(`Subject: ${subject}`);
        this.logger.log('Text Content:');
        this.logger.log(text || 'No text content');
        this.logger.log('HTML Content:');
        this.logger.log(html);
        this.logger.log('===================================');
        return {
            success: true,
            messageId: `console-${Date.now()}-${Math.random().toString(36)}`,
        };
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
        this.logger.log(`🔗 VERIFICATION LINK: ${process.env.FRONTEND_URL || 'http://localhost:4200'}/auth/verify-email?token=${token}`);
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
        this.logger.log(`🔗 PASSWORD RESET LINK: ${process.env.FRONTEND_URL || 'http://localhost:4200'}/auth/reset-owner-password?token=${token}`);
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
exports.ConsoleProvider = ConsoleProvider;
exports.ConsoleProvider = ConsoleProvider = ConsoleProvider_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [Object])
], ConsoleProvider);
//# sourceMappingURL=console.provider.js.map