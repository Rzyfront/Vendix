import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../email/email.service';
import { LoginDto } from './dto/login.dto';
import { RegisterOwnerDto } from './dto/register-owner.dto';
import { RegisterCustomerDto } from './dto/register-customer.dto';
import { RegisterStaffDto } from './dto/register-staff.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { AuditService } from '../audit/audit.service';
export declare class AuthService {
    private readonly prismaService;
    private readonly jwtService;
    private readonly emailService;
    private readonly configService;
    private readonly auditService;
    constructor(prismaService: PrismaService, jwtService: JwtService, emailService: EmailService, configService: ConfigService, auditService: AuditService);
    registerOwner(registerOwnerDto: RegisterOwnerDto, client_info?: {
        ip_address?: string;
        user_agent?: string;
    }): Promise<{
        wasExistingUser: any;
        access_token: string;
        refresh_token: string;
        token_type: string;
        expires_in: number;
        user: any;
    }>;
    registerCustomer(registerCustomerDto: RegisterCustomerDto, client_info?: {
        ip_address?: string;
        user_agent?: string;
    }, app?: string): Promise<{
        access_token: string;
        refresh_token: string;
        token_type: string;
        expires_in: number;
        user: any;
    }>;
    registerStaff(registerStaffDto: RegisterStaffDto, admin_user_id: number, app?: string): Promise<{
        message: string;
        user: any;
    }>;
    login(loginDto: LoginDto, client_info?: {
        ip_address?: string;
        user_agent?: string;
    }): Promise<{
        access_token: string;
        refresh_token: string;
        token_type: string;
        expires_in: number;
        user: any;
        user_settings: any;
    }>;
    refreshToken(refreshTokenDto: RefreshTokenDto, client_info?: {
        ip_address?: string;
        user_agent?: string;
    }): Promise<{
        user: any;
        access_token: string;
        refresh_token: string;
        token_type: string;
        expires_in: number;
    }>;
    getProfile(userId: number): Promise<any>;
    logout(user_id: number, refresh_token?: string, all_sessions?: boolean): Promise<{
        message: string;
        data: {
            sessions_revoked: any;
        };
    }>;
    sendEmailVerification(userId: number): Promise<void>;
    verifyEmail(token: string): Promise<{
        message: string;
    }>;
    resendEmailVerification(email: string): Promise<{
        message: string;
    }>;
    forgotPassword(email: string, organization_slug: string): Promise<{
        message: string;
    }>;
    resetPassword(token: string, newPassword: string): Promise<{
        message: string;
    }>;
    changePassword(user_id: number, current_password: string, new_password: string): Promise<{
        message: string;
    }>;
    verifyPasswordChangeToken(token: string): Promise<{
        message: string;
    }>;
    verifyUserEmailAsSuperAdmin(targetUserId: number, superAdminId: number): Promise<{
        message: string;
        user: any;
    }>;
    private validatePasswordStrength;
    canCreateOrganization(user_id: number): Promise<boolean>;
    getOnboardingStatus(user_id: number): Promise<{
        email_verified: boolean;
        can_create_organization: boolean;
        has_organization: boolean;
        organization_id?: number;
        next_step: string;
    }>;
    startOnboarding(user_id: number): Promise<{
        status: string;
        current_step: string;
        message: string;
        data?: any;
    }>;
    createOrganizationDuringOnboarding(user_id: number, organization_data: any): Promise<{
        success: boolean;
        message: string;
        organization?: any;
        nextStep?: string;
    }>;
    setupOrganization(user_id: number, organization_id: number, setup_data: any): Promise<{
        success: boolean;
        message: string;
        nextStep?: string;
    }>;
    createStoreDuringOnboarding(user_id: number, organization_id: number, store_data: any): Promise<{
        success: boolean;
        message: string;
        store?: any;
        nextStep?: string;
    }>;
    setupStore(user_id: number, store_id: number, setup_data: any): Promise<{
        success: boolean;
        message: string;
        nextStep?: string;
    }>;
    completeOnboarding(user_id: number): Promise<{
        success: boolean;
        message: string;
        data: any;
    }>;
    private validateOnboardingCompletion;
    private createOrUpdateOrganizationAddress;
    private createOrUpdateStoreAddress;
    private createOrUpdateStoreSettings;
    private generateSlugFromName;
    private generateRandomToken;
    private generateTokens;
    private createUserSession;
    private handleFailedLogin;
    private logLoginAttempt;
    validateUser(user_id: number): Promise<any>;
    getUserSessions(user_id: number): Promise<any>;
    revokeUserSession(user_id: number, session_id: number): Promise<{
        message: string;
        data: {
            session_revoked: number;
        };
    }>;
    private parseExpiryToSeconds;
    private parseExpiryToMilliseconds;
    private validateRefreshTokenSecurity;
    private extractBrowserFromUserAgent;
    private generateDeviceFingerprint;
    private extractOSFromUserAgent;
    private generateUniqueUsername;
    private parseDeviceInfo;
    private detectDeviceType;
    private getPermissionsFromRoles;
}
