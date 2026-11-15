import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { map, switchMap, catchError, withLatestFrom } from 'rxjs/operators';
import { LayawayApiService } from '../../services/layaway.service';
import * as LayawayActions from '../actions/layaway.actions';
import { selectLayawayState } from '../selectors/layaway.selectors';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';

@Injectable()
export class LayawayEffects {
  private actions$ = inject(Actions);
  private store = inject(Store);
  private layaway_service = inject(LayawayApiService);

  loadLayaways$ = createEffect(() =>
    this.actions$.pipe(
      ofType(LayawayActions.loadLayaways),
      withLatestFrom(this.store.select(selectLayawayState)),
      switchMap(([, state]) =>
        this.layaway_service
          .getAll({
            page: state.page,
            limit: state.limit,
            search: state.search || undefined,
            sort_by: state.sort_by,
            sort_order: state.sort_order,
            state: state.state_filter || undefined,
          })
          .pipe(
            map((response) =>
              LayawayActions.loadLayawaysSuccess({
                layaways: response.data,
                meta: (response as any).meta,
              }),
            ),
            catchError((error) =>
              of(LayawayActions.loadLayawaysFailure({ error: extractApiErrorMessage(error) })),
            ),
          ),
      ),
    ),
  );

  createLayaway$ = createEffect(() =>
    this.actions$.pipe(
      ofType(LayawayActions.createLayaway),
      switchMap(({ data }) =>
        this.layaway_service.create(data).pipe(
          map((response) => LayawayActions.createLayawaySuccess({ layaway: response.data })),
          catchError((error) =>
            of(LayawayActions.createLayawayFailure({ error: extractApiErrorMessage(error) })),
          ),
        ),
      ),
    ),
  );

  makePayment$ = createEffect(() =>
    this.actions$.pipe(
      ofType(LayawayActions.makePayment),
      switchMap(({ plan_id, data }) =>
        this.layaway_service.makePayment(plan_id, data).pipe(
          map(() => LayawayActions.makePaymentSuccess()),
          catchError((error) =>
            of(LayawayActions.makePaymentFailure({ error: extractApiErrorMessage(error) })),
          ),
        ),
      ),
    ),
  );

  cancelLayaway$ = createEffect(() =>
    this.actions$.pipe(
      ofType(LayawayActions.cancelLayaway),
      switchMap(({ plan_id, data }) =>
        this.layaway_service.cancel(plan_id, data).pipe(
          map(() => LayawayActions.cancelLayawaySuccess()),
          catchError((error) =>
            of(LayawayActions.cancelLayawayFailure({ error: extractApiErrorMessage(error) })),
          ),
        ),
      ),
    ),
  );

  loadStats$ = createEffect(() =>
    this.actions$.pipe(
      ofType(LayawayActions.loadStats),
      switchMap(() =>
        this.layaway_service.getStats().pipe(
          map((response) => LayawayActions.loadStatsSuccess({ stats: response.data })),
          catchError((error) =>
            of(LayawayActions.loadStatsFailure({ error: extractApiErrorMessage(error) })),
          ),
        ),
      ),
    ),
  );

  // Reload after mutations
  mutationSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        LayawayActions.createLayawaySuccess,
        LayawayActions.makePaymentSuccess,
        LayawayActions.cancelLayawaySuccess,
      ),
      switchMap(() => [LayawayActions.loadLayaways(), LayawayActions.loadStats()]),
    ),
  );

  // Filter changes reload
  filterChanged$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        LayawayActions.setSearch,
        LayawayActions.setPage,
        LayawayActions.setSort,
        LayawayActions.setStateFilter,
      ),
      map(() => LayawayActions.loadLayaways()),
    ),
  );
}
