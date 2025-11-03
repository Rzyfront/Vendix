import { ConfigService } from '@nestjs/config';
import { EmailResult, EmailConfig } from './interfaces/email.interface';
export declare class EmailService {
    private configService;
    private readonly logger;
    private provider;
    private config;
    constructor(configService: ConfigService);
    private initializeConfig;
    private initializeProvider;
    switchProvider(newProvider: 'resend' | 'sendgrid' | 'console', apiKey?: string): void;
    sendEmail(to: string, subject: string, html: string, text?: string): Promise<EmailResult>;
    sendVerificationEmail(to: string, token: string, username: string): Promise<EmailResult>;
    sendPasswordResetEmail(to: string, token: string, username: string): Promise<EmailResult>;
    sendWelcomeEmail(to: string, username: string): Promise<EmailResult>;
    sendOnboardingEmail(to: string, username: string, step: string): Promise<EmailResult>;
    getConfig(): EmailConfig;
    getProviderName(): string;
    isConfigured(): boolean;
    testConnection(): Promise<{
        success: boolean;
        message: string;
    }>;
}
