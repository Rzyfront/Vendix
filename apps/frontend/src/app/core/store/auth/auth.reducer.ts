import { createReducer, on } from '@ngrx/store';
import * as AuthActions from './auth.actions';
import { extractApiErrorMessage, NormalizedApiPayload } from '../../utils/api-error-handler';

export interface AuthState {
  user: any | null;
  tokens: { accessToken: string; refreshToken: string } | null;
  permissions: string[];
  roles: string[];
  loading: boolean;
  error: NormalizedApiPayload | string | null;
  isAuthenticated: boolean;
}

export const initialAuthState: AuthState = {
  user: null,
  tokens: null,
  permissions: [],
  roles: [],
  loading: false,
  error: null,
  isAuthenticated: false
};

export const authReducer = createReducer(
  initialAuthState,

  on(AuthActions.login, (state) => ({
    ...state,
    loading: true,
    error: null
  })),

  on(AuthActions.loginSuccess, (state, { user, tokens, permissions, roles }) => ({
    ...state,
    user,
    tokens,
    permissions: permissions || [],
    roles: roles || [],
    loading: false,
    error: null,
    isAuthenticated: true
  })),

  on(AuthActions.loginFailure, (state, { error }) => ({
    ...state,
    loading: false,
    // error may already be normalized by effects, but ensure fallback to string
    error: typeof error === 'string' ? error : (error as NormalizedApiPayload) || extractApiErrorMessage(error),
    isAuthenticated: false
  })),

  on(AuthActions.logout, (state) => ({
    ...state,
    loading: true
  })),

  on(AuthActions.logoutSuccess, (state) => ({
    ...initialAuthState
  })),

  on(AuthActions.refreshToken, (state) => ({
    ...state,
    loading: true
  })),

  on(AuthActions.refreshTokenSuccess, (state, { tokens }) => ({
    ...state,
    tokens,
    loading: false,
    error: null
  })),

  on(AuthActions.refreshTokenFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error: typeof error === 'string' ? error : (error as NormalizedApiPayload) || extractApiErrorMessage(error),
    isAuthenticated: false
  })),

  on(AuthActions.loadUser, (state) => ({
    ...state,
    loading: true
  })),

  on(AuthActions.loadUserSuccess, (state, { user }) => ({
    ...state,
    user,
    loading: false,
    error: null
  })),

  on(AuthActions.loadUserFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error: typeof error === 'string' ? error : (error as NormalizedApiPayload) || extractApiErrorMessage(error)
  })),

  on(AuthActions.updateUser, (state, { user }) => ({
    ...state,
    user
  })),

  on(AuthActions.clearAuthState, (state) => ({
    ...initialAuthState
  })),

  on(AuthActions.setLoading, (state, { loading }) => ({
    ...state,
    loading
  })),

  on(AuthActions.setError, (state, { error }) => ({
    ...state,
    error
  })),

  on(AuthActions.restoreAuthState, (state, { user, tokens, permissions, roles }) => ({
    ...state,
    user,
    tokens,
    permissions: permissions || [],
    roles: roles || [],
    isAuthenticated: true,
    loading: false,
    error: null
  })),

  // Forgot Owner Password
  on(AuthActions.forgotOwnerPassword, (state) => ({
    ...state,
    loading: true,
    error: null
  })),

  on(AuthActions.forgotOwnerPasswordSuccess, (state) => ({
    ...state,
    loading: false,
    error: null
  })),

  on(AuthActions.forgotOwnerPasswordFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error: typeof error === 'string' ? error : (error as NormalizedApiPayload) || extractApiErrorMessage(error)
  })),

  // Reset Owner Password
  on(AuthActions.resetOwnerPassword, (state) => ({
    ...state,
    loading: true,
    error: null
  })),

  on(AuthActions.resetOwnerPasswordSuccess, (state) => ({
    ...state,
    loading: false,
    error: null
  })),

  on(AuthActions.resetOwnerPasswordFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error: typeof error === 'string' ? error : (error as NormalizedApiPayload) || extractApiErrorMessage(error)
  }))
);