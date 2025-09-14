import { createAction, props } from '@ngrx/store';

// Generic base actions that can be extended by feature modules
export const loadData = createAction(
  '[Base] Load Data',
  props<{ id?: string; params?: any }>()
);

export const loadDataSuccess = createAction(
  '[Base] Load Data Success',
  props<{ data: any; id?: string }>()
);

export const loadDataFailure = createAction(
  '[Base] Load Data Failure',
  props<{ error: any; id?: string }>()
);

export const createData = createAction(
  '[Base] Create Data',
  props<{ data: any }>()
);

export const createDataSuccess = createAction(
  '[Base] Create Data Success',
  props<{ data: any }>()
);

export const createDataFailure = createAction(
  '[Base] Create Data Failure',
  props<{ error: any }>()
);

export const updateData = createAction(
  '[Base] Update Data',
  props<{ id: string; data: any }>()
);

export const updateDataSuccess = createAction(
  '[Base] Update Data Success',
  props<{ data: any }>()
);

export const updateDataFailure = createAction(
  '[Base] Update Data Failure',
  props<{ error: any }>()
);

export const deleteData = createAction(
  '[Base] Delete Data',
  props<{ id: string }>()
);

export const deleteDataSuccess = createAction(
  '[Base] Delete Data Success',
  props<{ id: string }>()
);

export const deleteDataFailure = createAction(
  '[Base] Delete Data Failure',
  props<{ error: any }>()
);

export const clearData = createAction(
  '[Base] Clear Data'
);

export const setLoading = createAction(
  '[Base] Set Loading',
  props<{ loading: boolean }>()
);

export const setError = createAction(
  '[Base] Set Error',
  props<{ error: any }>()
);

export const clearError = createAction(
  '[Base] Clear Error'
);