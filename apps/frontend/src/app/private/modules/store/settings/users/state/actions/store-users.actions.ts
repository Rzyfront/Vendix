import { createAction, props } from '@ngrx/store';
import {
  StoreUser,
  StoreUserStats,
  StoreUserDetail,
  CreateStoreUserDto,
  UpdateStoreUserDto,
  Role,
} from '../../interfaces/store-user.interface';

// ── Load Users ───────────────────────────────────────────────────
export const loadUsers = createAction('[StoreUsers] Load Users');
export const loadUsersSuccess = createAction(
  '[StoreUsers] Load Users Success',
  props<{ users: StoreUser[]; meta: any }>(),
);
export const loadUsersFailure = createAction(
  '[StoreUsers] Load Users Failure',
  props<{ error: string }>(),
);

// ── Load Stats ───────────────────────────────────────────────────
export const loadStats = createAction('[StoreUsers] Load Stats');
export const loadStatsSuccess = createAction(
  '[StoreUsers] Load Stats Success',
  props<{ stats: StoreUserStats }>(),
);
export const loadStatsFailure = createAction(
  '[StoreUsers] Load Stats Failure',
  props<{ error: string }>(),
);

// ── Load User Detail ─────────────────────────────────────────────
export const loadUserDetail = createAction(
  '[StoreUsers] Load User Detail',
  props<{ id: number }>(),
);
export const loadUserDetailSuccess = createAction(
  '[StoreUsers] Load User Detail Success',
  props<{ user: StoreUserDetail }>(),
);
export const loadUserDetailFailure = createAction(
  '[StoreUsers] Load User Detail Failure',
  props<{ error: string }>(),
);
export const clearUserDetail = createAction('[StoreUsers] Clear User Detail');

// ── Create User ──────────────────────────────────────────────────
export const createUser = createAction(
  '[StoreUsers] Create User',
  props<{ user: CreateStoreUserDto }>(),
);
export const createUserSuccess = createAction(
  '[StoreUsers] Create User Success',
  props<{ user: StoreUser }>(),
);
export const createUserFailure = createAction(
  '[StoreUsers] Create User Failure',
  props<{ error: string }>(),
);

// ── Update User ──────────────────────────────────────────────────
export const updateUser = createAction(
  '[StoreUsers] Update User',
  props<{ id: number; user: UpdateStoreUserDto }>(),
);
export const updateUserSuccess = createAction(
  '[StoreUsers] Update User Success',
  props<{ user: StoreUser }>(),
);
export const updateUserFailure = createAction(
  '[StoreUsers] Update User Failure',
  props<{ error: string }>(),
);

// ── Deactivate / Reactivate ──────────────────────────────────────
export const deactivateUser = createAction(
  '[StoreUsers] Deactivate User',
  props<{ id: number }>(),
);
export const deactivateUserSuccess = createAction('[StoreUsers] Deactivate User Success');
export const deactivateUserFailure = createAction(
  '[StoreUsers] Deactivate User Failure',
  props<{ error: string }>(),
);

export const reactivateUser = createAction(
  '[StoreUsers] Reactivate User',
  props<{ id: number }>(),
);
export const reactivateUserSuccess = createAction('[StoreUsers] Reactivate User Success');
export const reactivateUserFailure = createAction(
  '[StoreUsers] Reactivate User Failure',
  props<{ error: string }>(),
);

// ── Update Roles ─────────────────────────────────────────────────
export const updateUserRoles = createAction(
  '[StoreUsers] Update User Roles',
  props<{ id: number; role_ids: number[] }>(),
);
export const updateUserRolesSuccess = createAction(
  '[StoreUsers] Update User Roles Success',
  props<{ user: StoreUserDetail }>(),
);
export const updateUserRolesFailure = createAction(
  '[StoreUsers] Update User Roles Failure',
  props<{ error: string }>(),
);

// ── Update Panel UI ──────────────────────────────────────────────
export const updateUserPanelUI = createAction(
  '[StoreUsers] Update User Panel UI',
  props<{ id: number; panel_ui: Record<string, Record<string, boolean>> }>(),
);
export const updateUserPanelUISuccess = createAction(
  '[StoreUsers] Update User Panel UI Success',
  props<{ user: StoreUserDetail }>(),
);
export const updateUserPanelUIFailure = createAction(
  '[StoreUsers] Update User Panel UI Failure',
  props<{ error: string }>(),
);

// ── Reset Password ───────────────────────────────────────────────
export const resetPassword = createAction(
  '[StoreUsers] Reset Password',
  props<{ id: number; new_password: string; confirm_password: string }>(),
);
export const resetPasswordSuccess = createAction('[StoreUsers] Reset Password Success');
export const resetPasswordFailure = createAction(
  '[StoreUsers] Reset Password Failure',
  props<{ error: string }>(),
);

// ── Load Available Roles ─────────────────────────────────────────
export const loadAvailableRoles = createAction('[StoreUsers] Load Available Roles');
export const loadAvailableRolesSuccess = createAction(
  '[StoreUsers] Load Available Roles Success',
  props<{ roles: Role[] }>(),
);
export const loadAvailableRolesFailure = createAction(
  '[StoreUsers] Load Available Roles Failure',
  props<{ error: string }>(),
);

// ── Filters ──────────────────────────────────────────────────────
export const setSearch = createAction(
  '[StoreUsers] Set Search',
  props<{ search: string }>(),
);
export const setPage = createAction(
  '[StoreUsers] Set Page',
  props<{ page: number }>(),
);
export const setStateFilter = createAction(
  '[StoreUsers] Set State Filter',
  props<{ state_filter: string }>(),
);
