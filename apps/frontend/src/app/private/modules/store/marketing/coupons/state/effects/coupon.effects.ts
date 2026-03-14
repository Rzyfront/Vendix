import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { map, switchMap, catchError, withLatestFrom } from 'rxjs/operators';
import { CouponsApiService } from '../../services/coupons.service';
import * as CouponActions from '../actions/coupon.actions';
import { selectCouponState } from '../selectors/coupon.selectors';

@Injectable()
export class CouponEffects {
  private actions$ = inject(Actions);
  private store = inject(Store);
  private couponsService = inject(CouponsApiService);

  loadCoupons$ = createEffect(() =>
    this.actions$.pipe(
      ofType(CouponActions.loadCoupons),
      withLatestFrom(this.store.select(selectCouponState)),
      switchMap(([, state]) =>
        this.couponsService
          .getAll({
            page: state.page,
            limit: state.limit,
            search: state.search || undefined,
            sort_by: state.sort_by,
            sort_order: state.sort_order,
            is_active:
              state.is_active_filter !== null
                ? state.is_active_filter
                : undefined,
          })
          .pipe(
            map((response) =>
              CouponActions.loadCouponsSuccess({
                coupons: response.data,
                meta: (response as any).meta,
              }),
            ),
            catchError((error) =>
              of(
                CouponActions.loadCouponsFailure({
                  error:
                    error.error?.message ||
                    error.message ||
                    'Error loading coupons',
                }),
              ),
            ),
          ),
      ),
    ),
  );

  createCoupon$ = createEffect(() =>
    this.actions$.pipe(
      ofType(CouponActions.createCoupon),
      switchMap(({ coupon }) =>
        this.couponsService.create(coupon).pipe(
          map((response) =>
            CouponActions.createCouponSuccess({ coupon: response.data }),
          ),
          catchError((error) =>
            of(
              CouponActions.createCouponFailure({
                error:
                  error.error?.message ||
                  error.message ||
                  'Error creating coupon',
              }),
            ),
          ),
        ),
      ),
    ),
  );

  updateCoupon$ = createEffect(() =>
    this.actions$.pipe(
      ofType(CouponActions.updateCoupon),
      switchMap(({ id, coupon }) =>
        this.couponsService.update(id, coupon).pipe(
          map((response) =>
            CouponActions.updateCouponSuccess({ coupon: response.data }),
          ),
          catchError((error) =>
            of(
              CouponActions.updateCouponFailure({
                error:
                  error.error?.message ||
                  error.message ||
                  'Error updating coupon',
              }),
            ),
          ),
        ),
      ),
    ),
  );

  deleteCoupon$ = createEffect(() =>
    this.actions$.pipe(
      ofType(CouponActions.deleteCoupon),
      switchMap(({ id }) =>
        this.couponsService.delete(id).pipe(
          map(() => CouponActions.deleteCouponSuccess({ id })),
          catchError((error) =>
            of(
              CouponActions.deleteCouponFailure({
                error:
                  error.error?.message ||
                  error.message ||
                  'Error deleting coupon',
              }),
            ),
          ),
        ),
      ),
    ),
  );

  loadStats$ = createEffect(() =>
    this.actions$.pipe(
      ofType(CouponActions.loadStats),
      switchMap(() =>
        this.couponsService.getStats().pipe(
          map((response) =>
            CouponActions.loadStatsSuccess({ stats: response.data }),
          ),
          catchError((error) =>
            of(
              CouponActions.loadStatsFailure({
                error:
                  error.error?.message ||
                  error.message ||
                  'Error loading stats',
              }),
            ),
          ),
        ),
      ),
    ),
  );

  // Reload after mutations
  couponMutationSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        CouponActions.createCouponSuccess,
        CouponActions.updateCouponSuccess,
        CouponActions.deleteCouponSuccess,
      ),
      switchMap(() => [CouponActions.loadCoupons(), CouponActions.loadStats()]),
    ),
  );

  // Filter changes reload
  filterChanged$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        CouponActions.setSearch,
        CouponActions.setPage,
        CouponActions.setSort,
        CouponActions.setActiveFilter,
        CouponActions.clearFilters,
      ),
      map(() => CouponActions.loadCoupons()),
    ),
  );
}
