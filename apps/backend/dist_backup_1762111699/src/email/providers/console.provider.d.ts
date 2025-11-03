import { EmailProvider, EmailResult, EmailConfig } from '../interfaces/email.interface';
export declare class ConsoleProvider implements EmailProvider {
    private config;
    private readonly logger;
    constructor(config: EmailConfig);
    sendEmail(to: string, subject: string, html: string, text?: string): Promise<EmailResult>;
    sendVerificationEmail(to: string, token: string, username: string): Promise<EmailResult>;
    sendPasswordResetEmail(to: string, token: string, username: string): Promise<EmailResult>;
    sendWelcomeEmail(to: string, username: string): Promise<EmailResult>;
    sendOnboardingEmail(to: string, username: string, step: string): Promise<EmailResult>;
}
