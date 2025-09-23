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
  (tokens: any) => tokens?.accessToken || null
);

export const selectRefreshToken = createSelector(
  selectTokens,
  (tokens: any) => tokens?.refreshToken || null
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
  (user: any) => {
    console.log('selectUserRole - user object:', user);
    console.log('selectUserRole - user.roles:', user?.roles);
    console.log('selectUserRole - user.role:', user?.role);
    console.log('selectUserRole - user.user_roles:', user?.user_roles);
    
    // Handle both role (string) and roles (array) formats
    if (user?.role) {
      console.log('selectUserRole - returning user.role:', user.role);
      return user.role;
    }
    if (user?.roles && Array.isArray(user.roles) && user.roles.length > 0) {
      console.log('selectUserRole - returning user.roles[0]:', user.roles[0]);
      // Return the first role or the highest priority role
      return user.roles[0];
    }
    // Handle user_roles structure from backend
    if (user?.user_roles && Array.isArray(user.user_roles) && user.user_roles.length > 0) {
      const firstRole = user.user_roles[0]?.roles?.name;
      console.log('selectUserRole - returning user.user_roles[0].roles.name:', firstRole);
      return firstRole;
    }
    console.log('selectUserRole - returning null');
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

export const selectAuthInfo = createSelector(
  selectUser,
  selectIsAuthenticated,
  selectAuthLoading,
  (user: any, isAuthenticated: boolean, loading: boolean) => ({
    user,
    isAuthenticated,
    loading
  })
);