import { createFeatureSelector, createSelector } from '@ngrx/store';
import { StoreUsersState } from '../store-users.state';

export const selectStoreUsersState =
  createFeatureSelector<StoreUsersState>('storeUsers');

export const selectUsers = createSelector(
  selectStoreUsersState,
  (state) => state.users,
);

export const selectUsersLoading = createSelector(
  selectStoreUsersState,
  (state) => state.users_loading,
);

export const selectStats = createSelector(
  selectStoreUsersState,
  (state) => state.stats,
);

export const selectStatsLoading = createSelector(
  selectStoreUsersState,
  (state) => state.stats_loading,
);

export const selectMeta = createSelector(
  selectStoreUsersState,
  (state) => state.meta,
);

export const selectError = createSelector(
  selectStoreUsersState,
  (state) => state.error,
);

export const selectSearch = createSelector(
  selectStoreUsersState,
  (state) => state.search,
);

export const selectPage = createSelector(
  selectStoreUsersState,
  (state) => state.page,
);

export const selectStateFilter = createSelector(
  selectStoreUsersState,
  (state) => state.state_filter,
);

export const selectUserDetail = createSelector(
  selectStoreUsersState,
  (state) => state.selected_user_detail,
);

export const selectDetailLoading = createSelector(
  selectStoreUsersState,
  (state) => state.detail_loading,
);

export const selectAvailableRoles = createSelector(
  selectStoreUsersState,
  (state) => state.available_roles,
);
