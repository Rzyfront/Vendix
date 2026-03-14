import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { map, switchMap, catchError, withLatestFrom } from 'rxjs/operators';
import { PromotionsService } from '../../services/promotions.service';
import { PromotionsActions } from '../actions/promotions.actions';
import { selectPromotionsState } from '../selectors/promotions.selectors';

@Injectable()
export class PromotionsEffects {
  private actions$ = inject(Actions);
  private store = inject(Store);
  private promotions_service = inject(PromotionsService);

  // ── Load Promotions ────────────────────────────────────────────────
  loadPromotions$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PromotionsActions.loadPromotions),
      withLatestFrom(this.store.select(selectPromotionsState)),
      switchMap(([, state]) =>
        this.promotions_service
          .getPromotions({
            page: state.page,
            limit: state.limit,
            search: state.search || undefined,
            sort_by: state.sort_by,
            sort_order: state.sort_order,
            state: state.state_filter || undefined,
            type: state.type_filter || undefined,
            scope: state.scope_filter || undefined,
          })
          .pipe(
            map((response) =>
              PromotionsActions.loadPromotionsSuccess({
                promotions: response.data,
                meta: response.meta,
              }),
            ),
            catchError((error) =>
              of(
                PromotionsActions.loadPromotionsFailure({
                  error:
                    error.error?.message ||
                    error.message ||
                    'Error al cargar promociones',
                }),
              ),
            ),
          ),
      ),
    ),
  );

  // ── Load Summary ───────────────────────────────────────────────────
  loadSummary$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PromotionsActions.loadSummary),
      switchMap(() =>
        this.promotions_service.getSummary().pipe(
          map((response) =>
            PromotionsActions.loadSummarySuccess({ summary: response.data }),
          ),
          catchError((error) =>
            of(
              PromotionsActions.loadSummaryFailure({
                error:
                  error.error?.message ||
                  error.message ||
                  'Error al cargar resumen',
              }),
            ),
          ),
        ),
      ),
    ),
  );

  // ── Create ─────────────────────────────────────────────────────────
  createPromotion$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PromotionsActions.createPromotion),
      switchMap(({ dto }) =>
        this.promotions_service.createPromotion(dto).pipe(
          map((response) =>
            PromotionsActions.createPromotionSuccess({
              promotion: response.data,
            }),
          ),
          catchError((error) =>
            of(
              PromotionsActions.createPromotionFailure({
                error:
                  error.error?.message ||
                  error.message ||
                  'Error al crear promocion',
              }),
            ),
          ),
        ),
      ),
    ),
  );

  // ── Update ─────────────────────────────────────────────────────────
  updatePromotion$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PromotionsActions.updatePromotion),
      switchMap(({ id, dto }) =>
        this.promotions_service.updatePromotion(id, dto).pipe(
          map((response) =>
            PromotionsActions.updatePromotionSuccess({
              promotion: response.data,
            }),
          ),
          catchError((error) =>
            of(
              PromotionsActions.updatePromotionFailure({
                error:
                  error.error?.message ||
                  error.message ||
                  'Error al actualizar promocion',
              }),
            ),
          ),
        ),
      ),
    ),
  );

  // ── Delete ─────────────────────────────────────────────────────────
  deletePromotion$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PromotionsActions.deletePromotion),
      switchMap(({ id }) =>
        this.promotions_service.deletePromotion(id).pipe(
          map(() => PromotionsActions.deletePromotionSuccess({ id })),
          catchError((error) =>
            of(
              PromotionsActions.deletePromotionFailure({
                error:
                  error.error?.message ||
                  error.message ||
                  'Error al eliminar promocion',
              }),
            ),
          ),
        ),
      ),
    ),
  );

  // ── Activate ───────────────────────────────────────────────────────
  activatePromotion$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PromotionsActions.activatePromotion),
      switchMap(({ id }) =>
        this.promotions_service.activatePromotion(id).pipe(
          map((response) =>
            PromotionsActions.activatePromotionSuccess({
              promotion: response.data,
            }),
          ),
          catchError((error) =>
            of(
              PromotionsActions.activatePromotionFailure({
                error:
                  error.error?.message ||
                  error.message ||
                  'Error al activar promocion',
              }),
            ),
          ),
        ),
      ),
    ),
  );

  // ── Pause ──────────────────────────────────────────────────────────
  pausePromotion$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PromotionsActions.pausePromotion),
      switchMap(({ id }) =>
        this.promotions_service.pausePromotion(id).pipe(
          map((response) =>
            PromotionsActions.pausePromotionSuccess({
              promotion: response.data,
            }),
          ),
          catchError((error) =>
            of(
              PromotionsActions.pausePromotionFailure({
                error:
                  error.error?.message ||
                  error.message ||
                  'Error al pausar promocion',
              }),
            ),
          ),
        ),
      ),
    ),
  );

  // ── Cancel ─────────────────────────────────────────────────────────
  cancelPromotion$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PromotionsActions.cancelPromotion),
      switchMap(({ id }) =>
        this.promotions_service.cancelPromotion(id).pipe(
          map((response) =>
            PromotionsActions.cancelPromotionSuccess({
              promotion: response.data,
            }),
          ),
          catchError((error) =>
            of(
              PromotionsActions.cancelPromotionFailure({
                error:
                  error.error?.message ||
                  error.message ||
                  'Error al cancelar promocion',
              }),
            ),
          ),
        ),
      ),
    ),
  );

  // ── Filter change triggers reload ──────────────────────────────────
  filterChanged$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        PromotionsActions.setSearch,
        PromotionsActions.setPage,
        PromotionsActions.setSort,
        PromotionsActions.setStateFilter,
        PromotionsActions.setTypeFilter,
        PromotionsActions.setScopeFilter,
        PromotionsActions.clearFilters,
      ),
      map(() => PromotionsActions.loadPromotions()),
    ),
  );

  // ── Mutation success reloads promotions + summary ──────────────────
  mutationSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        PromotionsActions.createPromotionSuccess,
        PromotionsActions.updatePromotionSuccess,
        PromotionsActions.deletePromotionSuccess,
        PromotionsActions.activatePromotionSuccess,
        PromotionsActions.pausePromotionSuccess,
        PromotionsActions.cancelPromotionSuccess,
      ),
      switchMap(() => [
        PromotionsActions.loadPromotions(),
        PromotionsActions.loadSummary(),
      ]),
    ),
  );
}
