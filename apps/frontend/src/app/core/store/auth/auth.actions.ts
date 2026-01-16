import { createAction, props } from '@ngrx/store';
import { NormalizedApiPayload } from '../../utils/api-error-handler';

export const login = createAction(
  '[Auth] Login',
  props<{
    email: string;
    password: string;
    store_slug?: string;
    organization_slug?: string;
  }>(),
);

export const loginSuccess = createAction(
  '[Auth] Login Success',
  props<{
    user: any;
    user_settings?: any;
    tokens: { access_token: string; refresh_token: string };
    permissions?: string[];
    roles?: string[];
    message?: string;
    updated_environment?: string;
  }>(),
);

export const loginFailure = createAction(
  '[Auth] Login Failure',
  props<{ error: NormalizedApiPayload | string }>(),
);

export const logout = createAction('[Auth] Logout');

export const logoutSuccess = createAction('[Auth] Logout Success');

export const refreshToken = createAction(
  '[Auth] Refresh Token',
  props<{ refresh_token: string }>(),
);

export const refreshTokenSuccess = createAction(
  '[Auth] Refresh Token Success',
  props<{ tokens: { access_token: string; refresh_token: string } }>(),
);

export const refreshTokenFailure = createAction(
  '[Auth] Refresh Token Failure',
  props<{ error: NormalizedApiPayload | string }>(),
);

export const loadUser = createAction('[Auth] Load User');

export const loadUserSuccess = createAction(
  '[Auth] Load User Success',
  props<{ user: any }>(),
);

export const loadUserFailure = createAction(
  '[Auth] Load User Failure',
  props<{ error: NormalizedApiPayload | string }>(),
);

export const updateUser = createAction(
  '[Auth] Update User',
  props<{ user: any }>(),
);

export const clearAuthState = createAction('[Auth] Clear Auth State');

export const checkAuthStatus = createAction('[Auth] Check Auth Status');

export const restoreAuthState = createAction(
  '[Auth] Restore Auth State',
  props<{
    user: any;
    user_settings?: any;
    tokens: { access_token: string; refresh_token: string };
    permissions?: string[];
    roles?: string[];
  }>(),
);

export const setLoading = createAction(
  '[Auth] Set Loading',
  props<{ loading: boolean }>(),
);

export const setError = createAction(
  '[Auth] Set Error',

  props<{ error: string | null }>(),
);

// Forgot Owner Password

export const forgotOwnerPassword = createAction(
  '[Auth] Forgot Owner Password',

  props<{ organization_slug: string; email: string }>(),
);

export const forgotOwnerPasswordSuccess = createAction(
  '[Auth] Forgot Owner Password Success',
);

export const forgotOwnerPasswordFailure = createAction(
  '[Auth] Forgot Owner Password Failure',
  props<{ error: NormalizedApiPayload | string }>(),
);

// Reset Owner Password

export const resetOwnerPassword = createAction(
  '[Auth] Reset Owner Password',

  props<{ token: string; new_password: string }>(),
);

export const resetOwnerPasswordSuccess = createAction(
  '[Auth] Reset Owner Password Success',
);

export const resetOwnerPasswordFailure = createAction(
  '[Auth] Reset Owner Password Failure',
  props<{ error: NormalizedApiPayload | string }>(),
);

// Verify Email
export const verifyEmail = createAction(
  '[Auth] Verify Email',
  props<{ token: string }>(),
);

export const verifyEmailSuccess = createAction('[Auth] Verify Email Success');

export const verifyEmailFailure = createAction(
  '[Auth] Verify Email Failure',
  props<{ error: NormalizedApiPayload | string }>(),
);

// Resend Verification Email
export const resendVerificationEmail = createAction(
  '[Auth] Resend Verification Email',
  props<{ email: string }>(),
);

export const resendVerificationEmailSuccess = createAction(
  '[Auth] Resend Verification Email Success',
);

export const resendVerificationEmailFailure = createAction(
  '[Auth] Resend Verification Email Failure',
  props<{ error: NormalizedApiPayload | string }>(),
);

// Onboarding Actions
export const checkOnboardingStatus = createAction(
  '[Auth] Check Onboarding Status',
);

export const checkOnboardingStatusSuccess = createAction(
  '[Auth] Check Onboarding Status Success',
  props<{
    onboardingCompleted: boolean;
    currentStep?: string;
    completedSteps: string[];
  }>(),
);

export const checkOnboardingStatusFailure = createAction(
  '[Auth] Check Onboarding Status Failure',
  props<{ error: NormalizedApiPayload | string }>(),
);

export const setOnboardingCompleted = createAction(
  '[Auth] Set Onboarding Completed',
  props<{ completed: boolean }>(),
);

// Update User Settings Actions
export const updateUserSettings = createAction(
  '[Auth] Update User Settings',
  props<{ user_settings: any }>(),
);

export const updateUserSettingsSuccess = createAction(
  '[Auth] Update User Settings Success',
  props<{ user_settings: any }>(),
);

export const updateUserSettingsFailure = createAction(
  '[Auth] Update User Settings Failure',
  props<{ error: NormalizedApiPayload | string }>(),
);
