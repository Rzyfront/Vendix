import { createSelector, createFeatureSelector } from '@ngrx/store';
import { AuthState } from './auth.reducer';

export const selectAuthState = createFeatureSelector<AuthState>('auth');

export const selectUser = createSelector(
  selectAuthState,
  (state: AuthState) => state.user
);

export const selectTokens = createSelector(
  selectAuthState,
  (state: AuthState) => state.tokens
);

export const selectAccessToken = createSelector(
  selectTokens,
  (tokens) => tokens?.accessToken || null
);

export const selectRefreshToken = createSelector(
  selectTokens,
  (tokens) => tokens?.refreshToken || null
);

export const selectIsAuthenticated = createSelector(
  selectAuthState,
  (state: AuthState) => state.isAuthenticated
);

export const selectAuthLoading = createSelector(
  selectAuthState,
  (state: AuthState) => state.loading
);

export const selectAuthError = createSelector(
  selectAuthState,
  (state: AuthState) => state.error
);

export const selectUserRole = createSelector(
  selectUser,
  (user) => user?.role || null
);

export const selectUserId = createSelector(
  selectUser,
  (user) => user?.id || null
);

export const selectUserEmail = createSelector(
  selectUser,
  (user) => user?.email || null
);

export const selectUserName = createSelector(
  selectUser,
  (user) => user?.name || null
);

export const selectIsAdmin = createSelector(
  selectUserRole,
  (role) => role === 'SUPER_ADMIN' || role === 'ADMIN'
);

export const selectIsOwner = createSelector(
  selectUserRole,
  (role) => role === 'OWNER'
);

export const selectIsManager = createSelector(
  selectUserRole,
  (role) => role === 'MANAGER'
);

export const selectIsEmployee = createSelector(
  selectUserRole,
  (role) => role === 'EMPLOYEE' || role === 'CASHIER'
);

export const selectIsCustomer = createSelector(
  selectUserRole,
  (role) => role === 'CUSTOMER' || role === 'VIEWER'
);

export const selectAuthInfo = createSelector(
  selectUser,
  selectIsAuthenticated,
  selectAuthLoading,
  (user, isAuthenticated, loading) => ({
    user,
    isAuthenticated,
    loading
  })
);