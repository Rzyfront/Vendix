import { createReducer, on } from '@ngrx/store';
import * as AuthActions from './auth.actions';

export interface AuthState {
  user: any | null;
  tokens: { accessToken: string; refreshToken: string } | null;
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
}

export const initialAuthState: AuthState = {
  user: null,
  tokens: null,
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

  on(AuthActions.loginSuccess, (state, { user, tokens }) => ({
    ...state,
    user,
    tokens,
    loading: false,
    error: null,
    isAuthenticated: true
  })),

  on(AuthActions.loginFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error: error?.error?.message || error?.message || 'Error de autenticación',
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
    error: error?.error?.message || error?.message || 'Error al refrescar token',
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
    error: error?.error?.message || error?.message || 'Error al cargar usuario'
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
  }))
);