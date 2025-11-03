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
var SendGridProvider_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SendGridProvider = void 0;
const common_1 = require("@nestjs/common");
const email_templates_1 = require("../templates/email-templates");
let SendGridProvider = SendGridProvider_1 = class SendGridProvider {
    constructor(config) {
        this.config = config;
        this.logger = new common_1.Logger(SendGridProvider_1.name);
        this.initializeSendGrid();
    }
    initializeSendGrid() {
        try {
            this.sgMail = require('@sendgrid/mail');
            this.sgMail.setApiKey(this.config.apiKey);
            this.logger.log('SendGrid provider initialized successfully');
        }
        catch (error) {
            this.logger.error('Failed to initialize SendGrid provider:', error);
            throw new Error('SendGrid provider initialization failed');
        }
    }
    async sendEmail(to, subject, html, text) {
        try {
            const msg = {
                to,
                from: {
                    email: this.config.fromEmail,
                    name: this.config.fromName,
                },
                subject,
                html,
                text: text || '',
            };
            const result = await this.sgMail.send(msg);
            this.logger.log(`Email sent successfully to ${to} via SendGrid`);
            return {
                success: true,
                messageId: result[0]?.headers?.['x-message-id'],
            };
        }
        catch (error) {
            this.logger.error('SendGrid send error:', error);
            return {
                success: false,
                error: error.message || 'Failed to send email via SendGrid',
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
exports.SendGridProvider = SendGridProvider;
exports.SendGridProvider = SendGridProvider = SendGridProvider_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [Object])
], SendGridProvider);
//# sourceMappingURL=sendgrid.provider.js.map