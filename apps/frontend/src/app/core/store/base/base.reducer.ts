import { createReducer, on } from '@ngrx/store';
import * as BaseActions from './base.actions';

export interface BaseState<T = any> {
  data: T | null;
  loading: boolean;
  error: any;
  lastUpdated: Date | null;
}

export const initialBaseState: BaseState = {
  data: null,
  loading: false,
  error: null,
  lastUpdated: null
};

export function createBaseReducer<T>(
  featureName: string,
  additionalReducers?: any
) {
  return createReducer(
    initialBaseState,

    // Load actions
    on(BaseActions.loadData, (state) => ({
      ...state,
      loading: true,
      error: null
    })),

    on(BaseActions.loadDataSuccess, (state, { data }) => ({
      ...state,
      data,
      loading: false,
      error: null,
      lastUpdated: new Date()
    })),

    on(BaseActions.loadDataFailure, (state, { error }) => ({
      ...state,
      loading: false,
      error
    })),

    // Create actions
    on(BaseActions.createData, (state) => ({
      ...state,
      loading: true,
      error: null
    })),

    on(BaseActions.createDataSuccess, (state, { data }) => ({
      ...state,
      data,
      loading: false,
      error: null,
      lastUpdated: new Date()
    })),

    on(BaseActions.createDataFailure, (state, { error }) => ({
      ...state,
      loading: false,
      error
    })),

    // Update actions
    on(BaseActions.updateData, (state) => ({
      ...state,
      loading: true,
      error: null
    })),

    on(BaseActions.updateDataSuccess, (state, { data }) => ({
      ...state,
      data,
      loading: false,
      error: null,
      lastUpdated: new Date()
    })),

    on(BaseActions.updateDataFailure, (state, { error }) => ({
      ...state,
      loading: false,
      error
    })),

    // Delete actions
    on(BaseActions.deleteData, (state) => ({
      ...state,
      loading: true,
      error: null
    })),

    on(BaseActions.deleteDataSuccess, (state) => ({
      ...state,
      data: null,
      loading: false,
      error: null,
      lastUpdated: new Date()
    })),

    on(BaseActions.deleteDataFailure, (state, { error }) => ({
      ...state,
      loading: false,
      error
    })),

    // Utility actions
    on(BaseActions.clearData, (state) => ({
      ...state,
      data: null,
      error: null,
      lastUpdated: null
    })),

    on(BaseActions.setLoading, (state, { loading }) => ({
      ...state,
      loading
    })),

    on(BaseActions.setError, (state, { error }) => ({
      ...state,
      error
    })),

    on(BaseActions.clearError, (state) => ({
      ...state,
      error: null
    })),

    // Allow additional reducers to be passed in
    ...(additionalReducers || [])
  );
}