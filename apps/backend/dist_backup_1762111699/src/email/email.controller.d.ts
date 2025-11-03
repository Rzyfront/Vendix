import { EmailService } from './email.service';
export declare class EmailController {
    private readonly emailService;
    constructor(emailService: EmailService);
    getEmailConfig(user: any): Promise<{
        message: string;
        data?: undefined;
    } | {
        message: string;
        data: {
            isConfigured: boolean;
            provider: string;
            apiKey?: string;
            domain?: string;
            fromEmail: string;
            fromName: string;
            smtp?: {
                host: string;
                port: number;
                secure: boolean;
                auth: {
                    user: string;
                    pass: string;
                };
            };
        };
    }>;
    testEmailService(user: any): Promise<{
        message: string;
        data?: undefined;
    } | {
        message: string;
        data: {
            success: boolean;
            message: string;
        };
    }>;
    testEmailTemplate(user: any, body: {
        type: 'verification' | 'password-reset' | 'welcome' | 'onboarding';
        email?: string;
        username?: string;
        step?: string;
    }): Promise<{
        message: string;
        data?: undefined;
    } | {
        message: string;
        data: any;
    }>;
    switchProvider(user: any, body: {
        provider: 'resend' | 'sendgrid' | 'console';
        apiKey?: string;
    }): Promise<{
        message: string;
        data?: undefined;
    } | {
        message: string;
        data: {
            provider: string;
            isConfigured: boolean;
        };
    }>;
}
