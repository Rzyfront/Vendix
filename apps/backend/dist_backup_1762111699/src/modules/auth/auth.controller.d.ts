import { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterOwnerDto } from './dto/register-owner.dto';
import { RegisterCustomerDto } from './dto/register-customer.dto';
import { RegisterStaffDto } from './dto/register-staff.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ChangePasswordDto, ForgotPasswordDto, ResetPasswordDto } from './dto/password.dto';
import { ResponseService } from '../../common/responses/response.service';
export declare class AuthController {
    private readonly authService;
    private readonly responseService;
    constructor(authService: AuthService, responseService: ResponseService);
    registerOwner(registerOwnerDto: RegisterOwnerDto, request: Request): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        wasExistingUser: any;
        access_token: string;
        refresh_token: string;
        token_type: string;
        expires_in: number;
        user: any;
    }>>;
    registerCustomer(registerCustomerDto: RegisterCustomerDto, request: Request): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        access_token: string;
        refresh_token: string;
        token_type: string;
        expires_in: number;
        user: any;
    }>>;
    registerStaff(registerStaffDto: RegisterStaffDto, user: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    login(loginDto: LoginDto, request: Request): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        access_token: string;
        refresh_token: string;
        token_type: string;
        expires_in: number;
        user: any;
        user_settings: any;
    }>>;
    refreshToken(refreshTokenDto: RefreshTokenDto, request: Request): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        user: any;
        access_token: string;
        refresh_token: string;
        token_type: string;
        expires_in: number;
    }>>;
    getProfile(user: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    logout(user: any, body?: {
        refresh_token?: string;
        all_sessions?: boolean;
    }): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        sessions_revoked: any;
    }>>;
    getCurrentUser(user: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    verifyEmail(verifyEmailDto: {
        token: string;
    }): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        message: string;
    }>>;
    resendVerification(resendDto: {
        email: string;
    }): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        message: string;
    }>>;
    forgotOwnerPassword(forgotDto: ForgotPasswordDto): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        message: string;
    }>>;
    resetOwnerPassword(resetDto: ResetPasswordDto): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        message: string;
    }>>;
    changePassword(user: any, changeDto: ChangePasswordDto): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        message: string;
    }>>;
    getUserSessions(user: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    revokeSession(user: any, session_id: string): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        session_revoked: number;
    }>>;
    getOnboardingStatus(user: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        email_verified: boolean;
        can_create_organization: boolean;
        has_organization: boolean;
        organization_id?: number;
        next_step: string;
    }>>;
    createOrganizationOnboarding(user: any, organizationData: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        success: boolean;
        message: string;
        organization?: any;
        nextStep?: string;
    }>>;
    setupOrganization(user: any, organization_id: string, setup_data: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        success: boolean;
        message: string;
        nextStep?: string;
    }>>;
    createStoreOnboarding(user: any, organization_id: string, store_data: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        success: boolean;
        message: string;
        store?: any;
        nextStep?: string;
    }>>;
    setupStore(user: any, store_id: string, setup_data: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<{
        success: boolean;
        message: string;
        nextStep?: string;
    }>>;
    completeOnboarding(user: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
    verifyUserEmailAsSuperAdmin(userId: number, user: any): Promise<import("../../common").ErrorResponse | import("../../common").SuccessResponse<any>>;
}
