import { Injectable, Logger } from '@nestjs/common';
import {
    EmailProvider,
    EmailResult,
    EmailConfig,
} from '../interfaces/email.interface';
import {
    EmailTemplates,
    EmailTemplateData,
} from '../templates/email-templates';
import * as nodemailer from 'nodemailer';

@Injectable()
export class SesProvider implements EmailProvider {
    private readonly logger = new Logger(SesProvider.name);
    private transporter: nodemailer.Transporter;

    constructor(private config: EmailConfig) {
        this.initializeTransporter();
    }

    private initializeTransporter() {
        try {
            if (!this.config.smtp) {
                throw new Error('SMTP configuration is missing for SES provider');
            }

            this.transporter = nodemailer.createTransport({
                host: this.config.smtp.host,
                port: this.config.smtp.port,
                secure: this.config.smtp.secure, // true for 465, false for other ports
                auth: {
                    user: this.config.smtp.auth.user,
                    pass: this.config.smtp.auth.pass,
                },
            });

            this.logger.log('SES provider initialized successfully via SMTP');
        } catch (error) {
            this.logger.error('Failed to initialize SES provider:', error);
            throw new Error('SES provider initialization failed');
        }
    }

    async sendEmail(
        to: string,
        subject: string,
        html: string,
        text?: string,
    ): Promise<EmailResult> {
        try {
            const info = await this.transporter.sendMail({
                from: `"${this.config.fromName}" <${this.config.fromEmail}>`,
                to,
                subject,
                html,
                text,
            });

            this.logger.log(
                `Email sent successfully to ${to}, MessageId: ${info.messageId}`,
            );
            return {
                success: true,
                messageId: info.messageId,
            };
        } catch (error) {
            this.logger.error('SES send error:', error);
            return {
                success: false,
                error: error.message || 'Failed to send email',
            };
        }
    }

    async sendVerificationEmail(
        to: string,
        token: string,
        username: string,
        organizationSlug?: string,
    ): Promise<EmailResult> {
        const templateData: EmailTemplateData = {
            username,
            email: to,
            token,
            vlink: organizationSlug,
            companyName: 'Vendix',
            supportEmail: this.config.fromEmail,
            year: new Date().getFullYear(),
        };

        const template = EmailTemplates.getVerificationTemplate(templateData);
        return this.sendEmail(to, template.subject, template.html, template.text);
    }

    async sendPasswordResetEmail(
        to: string,
        token: string,
        username: string,
    ): Promise<EmailResult> {
        const templateData: EmailTemplateData = {
            username,
            email: to,
            token,
            companyName: 'Vendix',
            supportEmail: this.config.fromEmail,
            year: new Date().getFullYear(),
        };

        const template = EmailTemplates.getPasswordResetTemplate(templateData);
        return this.sendEmail(to, template.subject, template.html, template.text);
    }

    async sendWelcomeEmail(to: string, username: string): Promise<EmailResult> {
        const templateData: EmailTemplateData = {
            username,
            email: to,
            companyName: 'Vendix',
            supportEmail: this.config.fromEmail,
            year: new Date().getFullYear(),
        };

        const template = EmailTemplates.getWelcomeTemplate(templateData);
        return this.sendEmail(to, template.subject, template.html, template.text);
    }

    async sendOnboardingEmail(
        to: string,
        username: string,
        step: string,
    ): Promise<EmailResult> {
        const templateData: EmailTemplateData & { step: string } = {
            username,
            email: to,
            step,
            companyName: 'Vendix',
            supportEmail: this.config.fromEmail,
            year: new Date().getFullYear(),
        };

        const template = EmailTemplates.getOnboardingTemplate(templateData);
        return this.sendEmail(to, template.subject, template.html, template.text);
    }
}
