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
var EmailService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const resend_provider_1 = require("./providers/resend.provider");
const sendgrid_provider_1 = require("./providers/sendgrid.provider");
const console_provider_1 = require("./providers/console.provider");
let EmailService = EmailService_1 = class EmailService {
    constructor(configService) {
        this.configService = configService;
        this.logger = new common_1.Logger(EmailService_1.name);
        this.initializeConfig();
        this.initializeProvider();
    }
    initializeConfig() {
        this.config = {
            provider: (this.configService.get('EMAIL_PROVIDER') ||
                'console'),
            apiKey: this.configService.get('EMAIL_API_KEY'),
            domain: this.configService.get('EMAIL_DOMAIN'),
            fromEmail: this.configService.get('EMAIL_FROM') || 'noreply@vendix.online',
            fromName: this.configService.get('EMAIL_FROM_NAME') || 'Vendix',
            smtp: {
                host: this.configService.get('SMTP_HOST') || '',
                port: parseInt(this.configService.get('SMTP_PORT') || '587'),
                secure: this.configService.get('SMTP_SECURE') === 'true',
                auth: {
                    user: this.configService.get('SMTP_USER') || '',
                    pass: this.configService.get('SMTP_PASS') || '',
                },
            },
        };
        this.logger.log(`Email service configured with provider: ${this.config.provider}`);
    }
    initializeProvider() {
        if (process.env.NODE_ENV === 'development' && !this.config.apiKey) {
            this.logger.warn('Development environment: forcing console email provider (no API key)');
            this.provider = new console_provider_1.ConsoleProvider(this.config);
            return;
        }
        switch (this.config.provider) {
            case 'resend':
                if (!this.config.apiKey) {
                    this.logger.warn('Resend API key not found, falling back to console provider');
                    this.provider = new console_provider_1.ConsoleProvider(this.config);
                }
                else {
                    try {
                        this.provider = new resend_provider_1.ResendProvider(this.config);
                    }
                    catch (error) {
                        this.logger.error('Failed to initialize Resend provider, falling back to console:', error);
                        this.provider = new console_provider_1.ConsoleProvider(this.config);
                    }
                }
                break;
            case 'sendgrid':
                if (!this.config.apiKey) {
                    this.logger.warn('SendGrid API key not found, falling back to console provider');
                    this.provider = new console_provider_1.ConsoleProvider(this.config);
                }
                else {
                    try {
                        this.provider = new sendgrid_provider_1.SendGridProvider(this.config);
                    }
                    catch (error) {
                        this.logger.error('Failed to initialize SendGrid provider, falling back to console:', error);
                        this.provider = new console_provider_1.ConsoleProvider(this.config);
                    }
                }
                break;
            default:
                this.logger.log('Using console email provider for development');
                this.provider = new console_provider_1.ConsoleProvider(this.config);
                break;
        }
    }
    switchProvider(newProvider, apiKey) {
        this.logger.log(`Switching email provider to: ${newProvider}`);
        if (apiKey) {
            this.config.apiKey = apiKey;
        }
        this.config.provider = newProvider;
        this.initializeProvider();
    }
    async sendEmail(to, subject, html, text) {
        try {
            const result = await this.provider.sendEmail(to, subject, html, text);
            if (result.success) {
                this.logger.log(`Email sent successfully to ${to} using ${this.config.provider}`);
            }
            else {
                this.logger.error(`Failed to send email to ${to}: ${result.error}`);
            }
            return result;
        }
        catch (error) {
            this.logger.error('Email service error:', error);
            return {
                success: false,
                error: error.message || 'Unknown email service error',
            };
        }
    }
    async sendVerificationEmail(to, token, username) {
        this.logger.log(`Sending verification email to ${to}`);
        return this.provider.sendVerificationEmail(to, token, username);
    }
    async sendPasswordResetEmail(to, token, username) {
        this.logger.log(`Sending password reset email to ${to}`);
        return this.provider.sendPasswordResetEmail(to, token, username);
    }
    async sendWelcomeEmail(to, username) {
        this.logger.log(`Sending welcome email to ${to}`);
        return this.provider.sendWelcomeEmail(to, username);
    }
    async sendOnboardingEmail(to, username, step) {
        this.logger.log(`Sending onboarding email to ${to} for step: ${step}`);
        return this.provider.sendOnboardingEmail(to, username, step);
    }
    getConfig() {
        return {
            ...this.config,
            apiKey: this.config.apiKey ? '***HIDDEN***' : undefined,
        };
    }
    getProviderName() {
        return this.config.provider;
    }
    isConfigured() {
        if (this.config.provider === 'console') {
            return true;
        }
        return !!(this.config.apiKey && this.config.fromEmail);
    }
    async testConnection() {
        try {
            const testResult = await this.sendEmail(this.config.fromEmail, 'Test Email - Connection Check', '<h1>Test Email</h1><p>This is a test email to verify the email service configuration.</p>', 'Test Email - This is a test email to verify the email service configuration.');
            return {
                success: testResult.success,
                message: testResult.success
                    ? `Email service is working correctly with ${this.config.provider}`
                    : `Email service test failed: ${testResult.error}`,
            };
        }
        catch (error) {
            return {
                success: false,
                message: `Email service test error: ${error.message}`,
            };
        }
    }
};
exports.EmailService = EmailService;
exports.EmailService = EmailService = EmailService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], EmailService);
//# sourceMappingURL=email.service.js.map