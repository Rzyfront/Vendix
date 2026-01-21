import { createReducer, on } from '@ngrx/store';
import * as AuthActions from './auth.actions';
import {
  extractApiErrorMessage,
  NormalizedApiPayload,
} from '../../utils/api-error-handler';
import { saveAuthState, clearAuthState } from '../persistence';

export interface AuthState {
  user: any | null;
  user_settings: any | null;
  tokens: { access_token: string; refresh_token: string } | null;
  permissions: string[];
  roles: string[];
  loading: boolean;
  error: NormalizedApiPayload | string | null;
  is_authenticated: boolean;
  onboarding_completed: boolean;
  onboarding_current_step?: string;
  onboarding_completed_steps: string[];
}

export const initialAuthState: AuthState = {
  user: null,
  user_settings: null,
  tokens: null,
  permissions: [],
  roles: [],
  loading: true,
  error: null,
  is_authenticated: false,
  onboarding_completed: false,
  onboarding_completed_steps: [],
};

export const authReducer = createReducer(
  initialAuthState,

  on(AuthActions.login, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(
    AuthActions.loginSuccess,
    (state, { user, user_settings, tokens, permissions, roles }) => {
      const newState = {
        ...state,
        user,
        user_settings,
        tokens,
        permissions: permissions || [],
        roles: roles || [],
        loading: false,
        error: null,
        is_authenticated: true,
      };
      // Save to localStorage for persistence
      saveAuthState(newState);
      return newState;
    },
  ),

  on(AuthActions.loginFailure, (state, { error }) => ({
    ...state,
    loading: false,
    // error may already be normalized by effects, but ensure fallback to string
    error:
      typeof error === 'string'
        ? error
        : (error as NormalizedApiPayload) || extractApiErrorMessage(error),
    is_authenticated: false,
  })),

  on(AuthActions.logout, (state) => ({
    ...state,
    loading: true,
  })),

  on(AuthActions.logoutSuccess, (state) => {
    // Clear localStorage
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('vendix_user_environment');
        localStorage.removeItem('vendix_logged_out_recently');
        localStorage.removeItem('vendix_app_config');
        localStorage.removeItem('auth_state');
      }
    } catch (error) {
      console.error('[AuthReducer] Error clearing localStorage:', error);
    }

    return {
      ...initialAuthState,
    };
  }),

  on(AuthActions.refreshToken, (state) => ({
    ...state,
    loading: true,
  })),

  on(AuthActions.refreshTokenSuccess, (state, { tokens }) => {
    const newState = {
      ...state,
      tokens,
      loading: false,
      error: null,
    };
    // Save updated tokens to localStorage
    saveAuthState(newState);
    return newState;
  }),

  on(AuthActions.refreshTokenFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error:
      typeof error === 'string'
        ? error
        : (error as NormalizedApiPayload) || extractApiErrorMessage(error),
    is_authenticated: false,
  })),

  on(AuthActions.loadUser, (state) => ({
    ...state,
    loading: true,
  })),

  on(AuthActions.loadUserSuccess, (state, { user }) => ({
    ...state,
    user,
    loading: false,
    error: null,
  })),

  on(AuthActions.loadUserFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error:
      typeof error === 'string'
        ? error
        : (error as NormalizedApiPayload) || extractApiErrorMessage(error),
  })),

  on(AuthActions.updateUser, (state, { user }) => ({
    ...state,
    user,
  })),

  on(AuthActions.clearAuthState, (state) => ({
    ...initialAuthState,
  })),

  on(AuthActions.setLoading, (state, { loading }) => ({
    ...state,
    loading,
  })),

  on(AuthActions.setError, (state, { error }) => ({
    ...state,
    error,
  })),

  on(
    AuthActions.restoreAuthState,
    (state, { user, user_settings, tokens, permissions, roles }) => {
      const newState = {
        ...state,
        user,
        user_settings,
        tokens,
        permissions: permissions || [],
        roles: roles || [],
        is_authenticated: true,
        loading: false,
        error: null,
      };
      // Save to localStorage to ensure consistency
      saveAuthState(newState);
      return newState;
    },
  ),

  // Forgot Owner Password
  on(AuthActions.forgotOwnerPassword, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(AuthActions.forgotOwnerPasswordSuccess, (state) => ({
    ...state,
    loading: false,
    error: null,
  })),

  on(AuthActions.forgotOwnerPasswordFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error:
      typeof error === 'string'
        ? error
        : (error as NormalizedApiPayload) || extractApiErrorMessage(error),
  })),

  // Reset Owner Password
  on(AuthActions.resetOwnerPassword, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(AuthActions.resetOwnerPasswordSuccess, (state) => ({
    ...state,
    loading: false,
    error: null,
  })),

  on(AuthActions.resetOwnerPasswordFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error:
      typeof error === 'string'
        ? error
        : (error as NormalizedApiPayload) || extractApiErrorMessage(error),
  })),

  // Verify Email
  on(AuthActions.verifyEmail, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(AuthActions.verifyEmailSuccess, (state) => ({
    ...state,
    loading: false,
    error: null,
  })),

  on(AuthActions.verifyEmailFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error:
      typeof error === 'string'
        ? error
        : (error as NormalizedApiPayload) || extractApiErrorMessage(error),
  })),

  // Resend Verification Email
  on(AuthActions.resendVerificationEmail, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(AuthActions.resendVerificationEmailSuccess, (state) => ({
    ...state,
    loading: false,
    error: null,
  })),

  on(AuthActions.resendVerificationEmailFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error:
      typeof error === 'string'
        ? error
        : (error as NormalizedApiPayload) || extractApiErrorMessage(error),
  })),

  // Register Customer
  on(AuthActions.registerCustomer, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(
    AuthActions.registerCustomerSuccess,
    (state, { user, user_settings, tokens, permissions, roles }) => {
      const newState = {
        ...state,
        user,
        user_settings,
        tokens,
        permissions: permissions || [],
        roles: roles || [],
        loading: false,
        error: null,
        is_authenticated: true,
      };
      // Save to localStorage for persistence
      saveAuthState(newState);
      return newState;
    },
  ),

  on(AuthActions.registerCustomerFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error:
      typeof error === 'string'
        ? error
        : (error as NormalizedApiPayload) || extractApiErrorMessage(error),
    is_authenticated: false,
  })),

  // Onboarding Actions
  on(AuthActions.checkOnboardingStatus, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(
    AuthActions.checkOnboardingStatusSuccess,
    (state, { onboardingCompleted, currentStep, completedSteps }) => ({
      ...state,
      loading: false,
      error: null,
      onboarding_completed: onboardingCompleted,
      onboarding_current_step: currentStep,
      onboarding_completed_steps: completedSteps || [],
    }),
  ),

  on(AuthActions.checkOnboardingStatusFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error:
      typeof error === 'string'
        ? error
        : (error as NormalizedApiPayload) || extractApiErrorMessage(error),
  })),

  on(AuthActions.setOnboardingCompleted, (state, { completed }) => ({
    ...state,
    onboarding_completed: completed,
  })),

  // Update User Settings
  on(AuthActions.updateUserSettings, (state) => ({
    ...state,
    loading: true,
  })),

  on(AuthActions.updateUserSettingsSuccess, (state, { user_settings }) => {
    const newState = {
      ...state,
      user_settings,
      loading: false,
      error: null,
    };
    // Save to localStorage to persist changes
    saveAuthState(newState);
    return newState;
  }),

  on(AuthActions.updateUserSettingsFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error:
      typeof error === 'string'
        ? error
        : (error as NormalizedApiPayload) || extractApiErrorMessage(error),
  })),
);
