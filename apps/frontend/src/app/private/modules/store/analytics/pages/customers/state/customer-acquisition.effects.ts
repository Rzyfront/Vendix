import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { map, mergeMap, catchError, withLatestFrom, tap } from 'rxjs/operators';
import { AnalyticsService } from '../../../services/analytics.service';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import * as AcquisitionActions from './customer-acquisition.actions';
import { AcquisitionChannel } from './customer-acquisition.actions';
import { selectDateRange, selectGranularity } from './customer-acquisition.selectors';
import { CustomersAnalyticsQueryDto } from '../../../interfaces/customers-analytics.interface';

@Injectable()
export class CustomerAcquisitionEffects {
  private actions$ = inject(Actions);
  private store = inject(Store);
  private analyticsService = inject(AnalyticsService);
  private toastService = inject(ToastService);

  loadSummary$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AcquisitionActions.loadAcquisitionSummary),
      withLatestFrom(
        this.store.select(selectDateRange),
      ),
      mergeMap(([, dateRange]) => {
        const query: CustomersAnalyticsQueryDto = {
          date_range: dateRange,
        };
        return this.analyticsService.getCustomersSummary(query).pipe(
          map((response) => {
            const summary = response.data;
            const conversionRate = summary.total_customers > 0
              ? (summary.new_customers / summary.total_customers) * 100
              : 0;
            const acquisitionCost = summary.new_customers > 0
              ? summary.average_spend / summary.new_customers
              : 0;

            return AcquisitionActions.loadAcquisitionSummarySuccess({
              newCustomers: summary.new_customers,
              conversionRate: Math.round(conversionRate * 100) / 100,
              acquisitionCost: Math.round(acquisitionCost * 100) / 100,
              bestChannel: 'Directo',
            });
          }),
          catchError((error) =>
            of(AcquisitionActions.loadAcquisitionSummaryFailure({
              error: error.error?.message || error.message || 'Error al cargar el resumen de adquisición',
            })),
          ),
        );
      }),
    ),
  );

  loadTrends$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AcquisitionActions.loadAcquisitionTrends),
      withLatestFrom(
        this.store.select(selectDateRange),
        this.store.select(selectGranularity),
      ),
      mergeMap(([, dateRange, granularity]) => {
        const query: CustomersAnalyticsQueryDto = {
          date_range: dateRange,
          granularity: granularity as any,
        };
        return this.analyticsService.getCustomersTrends(query).pipe(
          map((response) =>
            AcquisitionActions.loadAcquisitionTrendsSuccess({ trends: response.data }),
          ),
          catchError((error) =>
            of(AcquisitionActions.loadAcquisitionTrendsFailure({
              error: error.error?.message || error.message || 'Error al cargar las tendencias de adquisición',
            })),
          ),
        );
      }),
    ),
  );

  loadChannels$ = createEffect(() =>
    this.actions$.pipe(
      ofType(AcquisitionActions.loadAcquisitionChannels),
      withLatestFrom(
        this.store.select(selectDateRange),
      ),
      mergeMap(([, dateRange]) => {
        const query: CustomersAnalyticsQueryDto = {
          date_range: dateRange,
        };
        return this.analyticsService.getCustomersChannels(query).pipe(
          map((response) => {
            const channelsData = response.data?.channels || response.data || [];
            return AcquisitionActions.loadAcquisitionChannelsSuccess({
              channels: channelsData.map((c: any) => ({
                channel: c.channel || c.display_name || 'Unknown',
                display_name: c.display_name || c.channel || 'Unknown',
                new_customers: c.new_customers || 0,
                conversion_rate: c.conversion_rate || (c.average_order_value > 0 ? (c.new_customers / c.total_orders) * 100 : 0),
                spend: c.spend || c.revenue || 0,
              })),
            });
          }),
          catchError((error) => {
            console.error('Channels error:', error);
            return of(AcquisitionActions.loadAcquisitionChannelsFailure({
              error: error.error?.message || error.message || 'Error al cargar los canales de adquisición',
            }));
          }),
        );
      }),
    ),
  );

  filterChanged$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        AcquisitionActions.setDateRange,
        AcquisitionActions.setGranularity,
      ),
      mergeMap(() => [
        AcquisitionActions.loadAcquisitionSummary(),
        AcquisitionActions.loadAcquisitionTrends(),
        AcquisitionActions.loadAcquisitionChannels(),
      ]),
    ),
  );

  showError$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(
          AcquisitionActions.loadAcquisitionSummaryFailure,
          AcquisitionActions.loadAcquisitionTrendsFailure,
          AcquisitionActions.loadAcquisitionChannelsFailure,
        ),
        tap(({ error }) => this.toastService.error(error)),
      ),
    { dispatch: false },
  );
}
