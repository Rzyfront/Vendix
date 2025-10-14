export interface AuthContext {
  type: 'vendix' | 'organization' | 'store';
  loginRoute: string;
  registerRoute: string;
  forgotPasswordRoute: string;
  resetPasswordRoute: string;
  branding: {
    logo?: string;
    primaryColor: string;
    secondaryColor: string;
    companyName: string;
  };
  features: {
    allowRegistration: boolean;
    allowSocialLogin: boolean;
    requireEmailVerification: boolean;
  };
}