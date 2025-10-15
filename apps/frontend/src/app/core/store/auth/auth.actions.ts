import { createAction, props } from '@ngrx/store';

export const login = createAction(
  '[Auth] Login',
  props<{ email: string; password: string; store_slug?: string; organization_slug?: string }>()
);

export const loginSuccess = createAction(
  '[Auth] Login Success',
  props<{ user: any; tokens: { accessToken: string; refreshToken: string }; permissions?: string[]; roles?: string[] }>()
);

export const loginFailure = createAction(
  '[Auth] Login Failure',
  props<{ error: any }>()
);

export const logout = createAction('[Auth] Logout');

export const logoutSuccess = createAction('[Auth] Logout Success');

export const refreshToken = createAction(
  '[Auth] Refresh Token',
  props<{ refreshToken: string }>()
);

export const refreshTokenSuccess = createAction(
  '[Auth] Refresh Token Success',
  props<{ tokens: { accessToken: string; refreshToken: string } }>()
);

export const refreshTokenFailure = createAction(
  '[Auth] Refresh Token Failure',
  props<{ error: any }>()
);

export const loadUser = createAction('[Auth] Load User');

export const loadUserSuccess = createAction(
  '[Auth] Load User Success',
  props<{ user: any }>()
);

export const loadUserFailure = createAction(
  '[Auth] Load User Failure',
  props<{ error: any }>()
);

export const updateUser = createAction(
  '[Auth] Update User',
  props<{ user: any }>()
);

export const clearAuthState = createAction('[Auth] Clear Auth State');

export const checkAuthStatus = createAction('[Auth] Check Auth Status');

export const restoreAuthState = createAction(
  '[Auth] Restore Auth State',
  props<{ user: any; tokens: { accessToken: string; refreshToken: string }; permissions?: string[]; roles?: string[] }>()
);

export const setLoading = createAction(
  '[Auth] Set Loading',
  props<{ loading: boolean }>()
);

export const setError = createAction(
  '[Auth] Set Error',
  props<{ error: string | null }>()
);