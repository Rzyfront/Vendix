import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of } from 'rxjs';
import { map, mergeMap, catchError, tap } from 'rxjs/operators';
import * as BaseActions from './base.actions';

@Injectable()
export class BaseEffects {
  private actions$ = inject(Actions);

  // Base effects that can be extended by feature modules
  // These are template effects that should be overridden in concrete implementations

  loadData$ = createEffect(() =>
    this.actions$.pipe(
      ofType(BaseActions.loadData),
      mergeMap(() =>
        // This should be overridden in concrete implementations
        of(BaseActions.loadDataFailure({
          error: 'loadData$ effect must be overridden in concrete implementation'
        }))
      )
    )
  );

  createData$ = createEffect(() =>
    this.actions$.pipe(
      ofType(BaseActions.createData),
      mergeMap(() =>
        of(BaseActions.createDataFailure({
          error: 'createData$ effect must be overridden in concrete implementation'
        }))
      )
    )
  );

  updateData$ = createEffect(() =>
    this.actions$.pipe(
      ofType(BaseActions.updateData),
      mergeMap(() =>
        of(BaseActions.updateDataFailure({
          error: 'updateData$ effect must be overridden in concrete implementation'
        }))
      )
    )
  );

  deleteData$ = createEffect(() =>
    this.actions$.pipe(
      ofType(BaseActions.deleteData),
      mergeMap(() =>
        of(BaseActions.deleteDataFailure({
          error: 'deleteData$ effect must be overridden in concrete implementation'
        }))
      )
    )
  );

  // Logging effects
  loadDataSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(BaseActions.loadDataSuccess),
      tap(({ data, id }) => {
        console.log(`[Base Effects] Data loaded successfully:`, { data, id });
      })
    ),
    { dispatch: false }
  );

  loadDataFailure$ = createEffect(() =>
    this.actions$.pipe(
      ofType(BaseActions.loadDataFailure),
      tap(({ error, id }) => {
        console.error(`[Base Effects] Failed to load data:`, { error, id });
      })
    ),
    { dispatch: false }
  );

  createDataSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(BaseActions.createDataSuccess),
      tap(({ data }) => {
        console.log(`[Base Effects] Data created successfully:`, data);
      })
    ),
    { dispatch: false }
  );

  createDataFailure$ = createEffect(() =>
    this.actions$.pipe(
      ofType(BaseActions.createDataFailure),
      tap(({ error }) => {
        console.error(`[Base Effects] Failed to create data:`, error);
      })
    ),
    { dispatch: false }
  );

  updateDataSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(BaseActions.updateDataSuccess),
      tap(({ data }) => {
        console.log(`[Base Effects] Data updated successfully:`, data);
      })
    ),
    { dispatch: false }
  );

  updateDataFailure$ = createEffect(() =>
    this.actions$.pipe(
      ofType(BaseActions.updateDataFailure),
      tap(({ error }) => {
        console.error(`[Base Effects] Failed to update data:`, error);
      })
    ),
    { dispatch: false }
  );

  deleteDataSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(BaseActions.deleteDataSuccess),
      tap(({ id }) => {
        console.log(`[Base Effects] Data deleted successfully:`, id);
      })
    ),
    { dispatch: false }
  );

  deleteDataFailure$ = createEffect(() =>
    this.actions$.pipe(
      ofType(BaseActions.deleteDataFailure),
      tap(({ error }) => {
        console.error(`[Base Effects] Failed to delete data:`, error);
      })
    ),
    { dispatch: false }
  );
}