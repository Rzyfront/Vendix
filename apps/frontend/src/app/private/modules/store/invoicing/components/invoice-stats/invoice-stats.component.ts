import { Component, inject, computed } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable, map } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  selectStats,
  selectLoadingStats,
} from '../../state/selectors/invoicing.selectors';
import { InvoiceStats } from '../../interfaces/invoice.interface';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';

@Component({
  selector: 'vendix-invoice-stats',
  standalone: true,
  imports: [StatsComponent],
  styleUrls: ['./invoice-stats.component.scss'],
  template: `
    <ng-container>
      <app-stats
        title="Total Facturado"
        [value]="formatCurrency(totalInvoiced() || 0)"
        [smallText]="totalCount() + ' facturas'"
        iconName="file-text"
        iconBgColor="bg-blue-100"
        iconColor="text-blue-600"
      ></app-stats>

      <app-stats
        title="Pendientes"
        [value]="pendingCount() || 0"
        [smallText]="formatCurrency(pendingAmount() || 0)"
        iconName="clock"
        iconBgColor="bg-yellow-100"
        iconColor="text-yellow-600"
      ></app-stats>

      <app-stats
        title="Aceptadas"
        [value]="acceptedCount() || 0"
        [smallText]="formatCurrency(acceptedAmount() || 0)"
        iconName="check-circle"
        iconBgColor="bg-green-100"
        iconColor="text-green-600"
      ></app-stats>

      <app-stats
        title="Rechazadas"
        [value]="rejectedCount() || 0"
        smallText="Requieren atención"
        iconName="x-circle"
        iconBgColor="bg-red-100"
        iconColor="text-red-600"
      ></app-stats>
    </ng-container>
  `,
})
export class InvoiceStatsComponent {
  private store = inject(Store);
  private currencyService = inject(CurrencyFormatService);

  constructor() {
    this.currencyService.loadCurrency();
  }

  // All stats derived from backend stats (NOT from client-side array)
  // Signal-based state using computed derived from stats signal
  readonly stats = toSignal(this.store.select(selectStats), {
    initialValue: null as InvoiceStats | null,
  });

  // Computed stats from base stats signal
  readonly totalInvoiced = computed(
    () => this.stats()?.total_accepted_amount || 0,
  );
  readonly totalCount = computed(
    () =>
      (this.stats()?.total_accepted_count || 0) +
      (this.stats()?.total_pending_count || 0),
  );
  readonly pendingCount = computed(
    () => this.stats()?.total_pending_count || 0,
  );
  readonly pendingAmount = computed(
    () => this.stats()?.total_pending_amount || 0,
  );
  readonly acceptedCount = computed(
    () => this.stats()?.total_accepted_count || 0,
  );
  readonly acceptedAmount = computed(
    () => this.stats()?.total_accepted_amount || 0,
  );
  readonly rejectedCount = computed(
    () => this.stats()?.counts_by_status?.['rejected']?.count || 0,
  );

  formatCurrency(value: number): string {
    return this.currencyService.format(value || 0);
  }
}
