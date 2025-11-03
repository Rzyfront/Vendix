export declare class ForgotPasswordDto {
    email: string;
    organization_slug: string;
}
export declare class ResetPasswordDto {
    token: string;
    new_password: string;
}
export declare class ChangePasswordDto {
    current_password: string;
    new_password: string;
}
