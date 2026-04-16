import { Component, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { Store } from '@ngrx/store';
import { Observable, map } from 'rxjs';
import { selectStats, selectLoadingStats } from '../../state/selectors/invoicing.selectors';
import { InvoiceStats } from '../../interfaces/invoice.interface';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';

@Component({
  selector: 'vendix-invoice-stats',
  standalone: true,
  imports: [AsyncPipe, StatsComponent],
  styleUrls: ['./invoice-stats.component.scss'],
  template: `
    <ng-container>
      <app-stats
        title="Total Facturado"
        [value]="formatCurrency((totalInvoiced$ | async) || 0)"
        [smallText]="(totalCount$ | async) + ' facturas'"
        iconName="file-text"
        iconBgColor="bg-blue-100"
        iconColor="text-blue-600"
      ></app-stats>

      <app-stats
        title="Pendientes"
        [value]="(pendingCount$ | async) || 0"
        [smallText]="formatCurrency((pendingAmount$ | async) || 0)"
        iconName="clock"
        iconBgColor="bg-yellow-100"
        iconColor="text-yellow-600"
      ></app-stats>

      <app-stats
        title="Aceptadas"
        [value]="(acceptedCount$ | async) || 0"
        [smallText]="formatCurrency((acceptedAmount$ | async) || 0)"
        iconName="check-circle"
        iconBgColor="bg-green-100"
        iconColor="text-green-600"
      ></app-stats>

      <app-stats
        title="Rechazadas"
        [value]="(rejectedCount$ | async) || 0"
        smallText="Requieren atención"
        iconName="x-circle"
        iconBgColor="bg-red-100"
        iconColor="text-red-600"
      ></app-stats>
    </ng-container>
  `
})
export class InvoiceStatsComponent {
  private store = inject(Store);
  private currencyService = inject(CurrencyFormatService);

  constructor() {
    this.currencyService.loadCurrency();
  }

  // All stats derived from backend stats (NOT from client-side array)
  stats$: Observable<InvoiceStats | null> = this.store.select(selectStats);

  totalInvoiced$ = this.stats$.pipe(map(s => s?.total_accepted_amount || 0));
  totalCount$ = this.stats$.pipe(map(s => (s?.total_accepted_count || 0) + (s?.total_pending_count || 0)));
  pendingCount$ = this.stats$.pipe(map(s => s?.total_pending_count || 0));
  pendingAmount$ = this.stats$.pipe(map(s => s?.total_pending_amount || 0));
  acceptedCount$ = this.stats$.pipe(map(s => s?.total_accepted_count || 0));
  acceptedAmount$ = this.stats$.pipe(map(s => s?.total_accepted_amount || 0));
  rejectedCount$ = this.stats$.pipe(map(s => s?.counts_by_status?.['rejected']?.count || 0));

  formatCurrency(value: number): string {
    return this.currencyService.format(value || 0);
  }
}
