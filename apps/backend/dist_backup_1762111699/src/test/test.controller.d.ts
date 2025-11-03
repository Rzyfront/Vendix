import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { ResponseService } from '../common/responses/response.service';
export declare class TestController {
    private readonly emailService;
    private readonly prismaService;
    private readonly responseService;
    constructor(emailService: EmailService, prismaService: PrismaService, responseService: ResponseService);
    getEmailConfig(): import("../common").ErrorResponse | import("../common").SuccessResponse<{
        provider: string;
        isConfigured: boolean;
        config: import("../email").EmailConfig;
    }>;
    testQuickEmail(body: {
        email: string;
    }): Promise<import("../common").ErrorResponse | import("../common").SuccessResponse<import("../email").EmailResult>>;
    testVerificationEmail(body: {
        email: string;
        username: string;
    }): Promise<{
        message: string;
        data: {
            testToken: string;
            userId: any;
            success: boolean;
            messageId?: string;
            error?: string;
        };
    }>;
    getPublicData(): {
        message: string;
        data: string;
    };
    getProtectedData(user: any): {
        message: string;
        user: {
            id: any;
            email: any;
            role: any;
        };
    };
    getAdminData(user: any): {
        message: string;
        user: {
            id: any;
            email: any;
            role: any;
        };
    };
    getUsersData(user: any): {
        message: string;
        user: {
            id: any;
            email: any;
            permissions: any;
        };
    };
    getManagerData(user: any): {
        message: string;
        user: {
            id: any;
            email: any;
            role: any;
        };
    };
    sendEmail(body: {
        to: string;
        subject: string;
        text: string;
    }): Promise<{
        message: string;
    }>;
}
