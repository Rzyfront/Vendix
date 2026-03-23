import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { map, switchMap, catchError, withLatestFrom } from 'rxjs/operators';
import { CreditsApiService } from '../../services/credits.service';
import * as CreditsActions from '../actions/credits.actions';
import { selectCreditsState } from '../selectors/credits.selectors';

@Injectable()
export class CreditsEffects {
  private actions$ = inject(Actions);
  private store = inject(Store);
  private credits_service = inject(CreditsApiService);

  loadCredits$ = createEffect(() =>
    this.actions$.pipe(
      ofType(CreditsActions.loadCredits),
      withLatestFrom(this.store.select(selectCreditsState)),
      switchMap(([, state]) =>
        this.credits_service
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
              CreditsActions.loadCreditsSuccess({
                credits: response.data,
                meta: (response as any).meta,
              }),
            ),
            catchError((error) =>
              of(CreditsActions.loadCreditsFailure({ error: error.error?.message || 'Error al cargar créditos' })),
            ),
          ),
      ),
    ),
  );

  registerPayment$ = createEffect(() =>
    this.actions$.pipe(
      ofType(CreditsActions.registerPayment),
      switchMap(({ credit_id, data }) =>
        this.credits_service.registerPayment(credit_id, data).pipe(
          map(() => CreditsActions.registerPaymentSuccess()),
          catchError((error) =>
            of(CreditsActions.registerPaymentFailure({ error: error.error?.message || 'Error al registrar pago' })),
          ),
        ),
      ),
    ),
  );

  cancelCredit$ = createEffect(() =>
    this.actions$.pipe(
      ofType(CreditsActions.cancelCredit),
      switchMap(({ credit_id, reason }) =>
        this.credits_service.cancel(credit_id, reason).pipe(
          map(() => CreditsActions.cancelCreditSuccess()),
          catchError((error) =>
            of(CreditsActions.cancelCreditFailure({ error: error.error?.message || 'Error al cancelar crédito' })),
          ),
        ),
      ),
    ),
  );

  loadStats$ = createEffect(() =>
    this.actions$.pipe(
      ofType(CreditsActions.loadStats),
      switchMap(() =>
        this.credits_service.getStats().pipe(
          map((response) => CreditsActions.loadStatsSuccess({ stats: response.data })),
          catchError((error) =>
            of(CreditsActions.loadStatsFailure({ error: error.error?.message || 'Error al cargar estadísticas' })),
          ),
        ),
      ),
    ),
  );

  // Reload after mutations
  mutationSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        CreditsActions.registerPaymentSuccess,
        CreditsActions.cancelCreditSuccess,
      ),
      switchMap(() => [CreditsActions.loadCredits(), CreditsActions.loadStats()]),
    ),
  );

  // Filter changes reload
  filterChanged$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        CreditsActions.setSearch,
        CreditsActions.setPage,
        CreditsActions.setSort,
        CreditsActions.setStateFilter,
      ),
      map(() => CreditsActions.loadCredits()),
    ),
  );
}
