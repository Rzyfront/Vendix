import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { map, switchMap, catchError, withLatestFrom } from 'rxjs/operators';
import { LayawayApiService } from '../../services/layaway.service';
import * as LayawayActions from '../actions/layaway.actions';
import { selectLayawayState } from '../selectors/layaway.selectors';

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
              of(LayawayActions.loadLayawaysFailure({ error: error.error?.message || 'Error al cargar planes' })),
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
            of(LayawayActions.createLayawayFailure({ error: error.error?.message || 'Error al crear plan' })),
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
            of(LayawayActions.makePaymentFailure({ error: error.error?.message || 'Error al registrar pago' })),
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
            of(LayawayActions.cancelLayawayFailure({ error: error.error?.message || 'Error al cancelar plan' })),
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
            of(LayawayActions.loadStatsFailure({ error: error.error?.message || 'Error al cargar estadisticas' })),
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
