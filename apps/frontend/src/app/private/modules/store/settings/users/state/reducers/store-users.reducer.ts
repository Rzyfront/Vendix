import { createReducer, on } from '@ngrx/store';
import { StoreUsersState, initialStoreUsersState } from '../store-users.state';
import * as StoreUsersActions from '../actions/store-users.actions';

export const storeUsersReducer = createReducer(
  initialStoreUsersState,

  // ── Load Users ──────────────────────────────────────────────────
  on(StoreUsersActions.loadUsers, (state) => ({
    ...state,
    users_loading: true,
    error: null,
  })),
  on(StoreUsersActions.loadUsersSuccess, (state, { users, meta }) => ({
    ...state,
    users,
    meta,
    users_loading: false,
    error: null,
  })),
  on(StoreUsersActions.loadUsersFailure, (state, { error }) => ({
    ...state,
    users_loading: false,
    error,
  })),

  // ── Load Stats ──────────────────────────────────────────────────
  on(StoreUsersActions.loadStats, (state) => ({
    ...state,
    stats_loading: true,
  })),
  on(StoreUsersActions.loadStatsSuccess, (state, { stats }) => ({
    ...state,
    stats,
    stats_loading: false,
  })),
  on(StoreUsersActions.loadStatsFailure, (state, { error }) => ({
    ...state,
    stats_loading: false,
    error,
  })),

  // ── Load User Detail ────────────────────────────────────────────
  on(StoreUsersActions.loadUserDetail, (state) => ({
    ...state,
    detail_loading: true,
    error: null,
  })),
  on(StoreUsersActions.loadUserDetailSuccess, (state, { user }) => ({
    ...state,
    selected_user_detail: user,
    detail_loading: false,
  })),
  on(StoreUsersActions.loadUserDetailFailure, (state, { error }) => ({
    ...state,
    detail_loading: false,
    error,
  })),
  on(StoreUsersActions.clearUserDetail, (state) => ({
    ...state,
    selected_user_detail: null,
    detail_loading: false,
  })),

  // ── Create User ─────────────────────────────────────────────────
  on(StoreUsersActions.createUser, (state) => ({
    ...state,
    users_loading: true,
    error: null,
  })),
  on(StoreUsersActions.createUserSuccess, (state) => ({
    ...state,
    users_loading: false,
  })),
  on(StoreUsersActions.createUserFailure, (state, { error }) => ({
    ...state,
    users_loading: false,
    error,
  })),

  // ── Update User ─────────────────────────────────────────────────
  on(StoreUsersActions.updateUser, (state) => ({
    ...state,
    users_loading: true,
    error: null,
  })),
  on(StoreUsersActions.updateUserSuccess, (state) => ({
    ...state,
    users_loading: false,
  })),
  on(StoreUsersActions.updateUserFailure, (state, { error }) => ({
    ...state,
    users_loading: false,
    error,
  })),

  // ── Deactivate / Reactivate ─────────────────────────────────────
  on(StoreUsersActions.deactivateUser, StoreUsersActions.reactivateUser, (state) => ({
    ...state,
    users_loading: true,
    error: null,
  })),
  on(StoreUsersActions.deactivateUserSuccess, StoreUsersActions.reactivateUserSuccess, (state) => ({
    ...state,
    users_loading: false,
  })),
  on(StoreUsersActions.deactivateUserFailure, StoreUsersActions.reactivateUserFailure, (state, { error }) => ({
    ...state,
    users_loading: false,
    error,
  })),

  // ── Update Roles ────────────────────────────────────────────────
  on(StoreUsersActions.updateUserRoles, (state) => ({
    ...state,
    detail_loading: true,
    error: null,
  })),
  on(StoreUsersActions.updateUserRolesSuccess, (state, { user }) => ({
    ...state,
    selected_user_detail: user,
    detail_loading: false,
  })),
  on(StoreUsersActions.updateUserRolesFailure, (state, { error }) => ({
    ...state,
    detail_loading: false,
    error,
  })),

  // ── Update Panel UI ─────────────────────────────────────────────
  on(StoreUsersActions.updateUserPanelUI, (state) => ({
    ...state,
    detail_loading: true,
    error: null,
  })),
  on(StoreUsersActions.updateUserPanelUISuccess, (state, { user }) => ({
    ...state,
    selected_user_detail: user,
    detail_loading: false,
  })),
  on(StoreUsersActions.updateUserPanelUIFailure, (state, { error }) => ({
    ...state,
    detail_loading: false,
    error,
  })),

  // ── Reset Password ──────────────────────────────────────────────
  on(StoreUsersActions.resetPassword, (state) => ({
    ...state,
    detail_loading: true,
    error: null,
  })),
  on(StoreUsersActions.resetPasswordSuccess, (state) => ({
    ...state,
    detail_loading: false,
  })),
  on(StoreUsersActions.resetPasswordFailure, (state, { error }) => ({
    ...state,
    detail_loading: false,
    error,
  })),

  // ── Available Roles ─────────────────────────────────────────────
  on(StoreUsersActions.loadAvailableRolesSuccess, (state, { roles }) => ({
    ...state,
    available_roles: roles,
  })),

  // ── Filters ─────────────────────────────────────────────────────
  on(StoreUsersActions.setSearch, (state, { search }) => ({
    ...state,
    search,
    page: 1,
  })),
  on(StoreUsersActions.setPage, (state, { page }) => ({
    ...state,
    page,
  })),
  on(StoreUsersActions.setStateFilter, (state, { state_filter }) => ({
    ...state,
    state_filter,
    page: 1,
  })),
);
