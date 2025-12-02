import { createFeatureSelector, createSelector } from '@ngrx/store';
import { BaseState } from './base.reducer';

export function createBaseSelectors<T>(featureName: string) {
  const selectFeatureState = createFeatureSelector<BaseState<T>>(featureName);

  const selectData = createSelector(
    selectFeatureState,
    (state: BaseState<T>): T | null => state.data,
  );

  const selectLoading = createSelector(
    selectFeatureState,
    (state: BaseState<T>): boolean => state.loading,
  );

  const selectError = createSelector(
    selectFeatureState,
    (state: BaseState<T>): any => state.error,
  );

  const selectLastUpdated = createSelector(
    selectFeatureState,
    (state: BaseState<T>): Date | null => state.lastUpdated,
  );

  const selectHasData = createSelector(
    selectData,
    (data: T | null): boolean => data !== null,
  );

  const selectIsLoading = createSelector(
    selectLoading,
    (loading: boolean): boolean => loading,
  );

  const selectHasError = createSelector(
    selectError,
    (error: any): boolean => error !== null,
  );

  const selectState = createSelector(
    selectFeatureState,
    (state: BaseState<T>) => state,
  );

  return {
    selectFeatureState,
    selectData,
    selectLoading,
    selectError,
    selectLastUpdated,
    selectHasData,
    selectIsLoading,
    selectHasError,
    selectState,
  };
}

// Utility selectors for common patterns
export const selectDataById = (id: string) =>
  createSelector(
    (state: any) => state.data,
    (data: any[]) => data?.find((item) => item.id === id) || null,
  );

export const selectDataByProperty = (property: string, value: any) =>
  createSelector(
    (state: any) => state.data,
    (data: any[]) => data?.filter((item) => item[property] === value) || [],
  );

export const selectDataCount = createSelector(
  (state: any) => state.data,
  (data: any[]) => data?.length || 0,
);
