import { createSelector, createFeatureSelector } from '@ngrx/store';
import { AuthState } from './auth.reducer';

export const selectAuthState = createFeatureSelector<AuthState>('auth');

export const selectUser = createSelector(
  selectAuthState,
  (state: AuthState) => state.user
);

export const selectPermissions = createSelector(
  selectAuthState,
  (state: AuthState) => state.permissions
);

export const selectRoles = createSelector(
  selectAuthState,
  (state: AuthState) => state.roles
);

export const selectTokens = createSelector(
  selectAuthState,
  (state: AuthState) => state.tokens
);

export const selectAccessToken = createSelector(
  selectTokens,
  (tokens: any) => tokens?.accessToken || null
);

export const selectRefreshToken = createSelector(
  selectTokens,
  (tokens: any) => tokens?.refreshToken || null
);

export const selectIsAuthenticated = createSelector(
  selectUser,
  (user: any) => !!user
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
  (user: any) => {
    // Handle both role (string) and roles (array) formats
    if (user?.role) {
      return user.role;
    }
    if (user?.roles && Array.isArray(user.roles) && user.roles.length > 0) {
      // Return the first role or the highest priority role
      return user.roles[0];
    }
    // Handle user_roles structure from backend
    if (user?.user_roles && Array.isArray(user.user_roles) && user.user_roles.length > 0) {
      const firstRole = user.user_roles[0]?.roles?.name;
      return firstRole;
    }
    return null;
  }
);

export const selectUserId = createSelector(
  selectUser,
  (user: any) => user?.id || null
);

export const selectUserEmail = createSelector(
  selectUser,
  (user: any) => user?.email || null
);

export const selectUserName = createSelector(
  selectUser,
  (user: any) => user?.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : user?.name || null
);

export const selectIsAdmin = createSelector(
  selectUserRole,
  (role: string) => role === 'super_admin' || role === 'admin' || role === 'SUPER_ADMIN' || role === 'ADMIN'
);

export const selectIsOwner = createSelector(
  selectUserRole,
  (role: string) => role === 'owner' || role === 'OWNER'
);

export const selectIsManager = createSelector(
  selectUserRole,
  (role: string) => role === 'manager' || role === 'MANAGER'
);

export const selectIsEmployee = createSelector(
  selectUserRole,
  (role: string) => role === 'employee' || role === 'cashier' || role === 'EMPLOYEE' || role === 'CASHIER'
);

export const selectIsCustomer = createSelector(
  selectUserRole,
  (role: string) => role === 'customer' || role === 'viewer' || role === 'CUSTOMER' || role === 'VIEWER'
);

export const selectHasPermission = (permission: string) => createSelector(
  selectPermissions,
  (permissions: string[]) => permissions.includes(permission)
);

export const selectHasAnyPermission = (permissions: string[]) => createSelector(
  selectPermissions,
  (userPermissions: string[]) => permissions.some(permission => userPermissions.includes(permission))
);

export const selectHasRole = (role: string) => createSelector(
  selectRoles,
  (roles: string[]) => roles.includes(role)
);

export const selectHasAnyRole = (roles: string[]) => createSelector(
  selectRoles,
  (userRoles: string[]) => roles.some(role => userRoles.includes(role))
);

export const selectAuthInfo = createSelector(
  selectUser,
  selectIsAuthenticated,
  selectAuthLoading,
  selectPermissions,
  selectRoles,
  (user: any, isAuthenticated: boolean, loading: boolean, permissions: string[], roles: string[]) => ({
    user,
    isAuthenticated,
    loading,
    permissions,
    roles
  })
);