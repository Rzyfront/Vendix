export interface EmailTemplateData {
    username: string;
    email: string;
    token?: string;
    verificationUrl?: string;
    resetUrl?: string;
    companyName?: string;
    supportEmail?: string;
    year?: number;
}
export declare class EmailTemplates {
    private static readonly BASE_URL;
    private static readonly COMPANY_NAME;
    private static readonly SUPPORT_EMAIL;
    static getVerificationTemplate(data: EmailTemplateData): {
        subject: string;
        html: string;
        text: string;
    };
    static getPasswordResetTemplate(data: EmailTemplateData): {
        subject: string;
        html: string;
        text: string;
    };
    static getWelcomeTemplate(data: EmailTemplateData): {
        subject: string;
        html: string;
        text: string;
    };
    static getOnboardingTemplate(data: EmailTemplateData & {
        step: string;
    }): {
        subject: string;
        html: string;
        text: string;
    };
}
