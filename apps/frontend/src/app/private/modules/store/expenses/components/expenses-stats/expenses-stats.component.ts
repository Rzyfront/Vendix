import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { Observable, map } from 'rxjs';
import {
  selectSummary,
  selectLoadingSummary,
} from '../../state/selectors/expenses.selectors';
import { ExpenseSummary } from '../../interfaces/expense.interface';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';

@Component({
  selector: 'vendix-expenses-stats',
  standalone: true,
  imports: [StatsComponent],
  styleUrls: ['./expenses-stats.component.scss'],
  template: `
    <ng-container>
      <app-stats
        title="Total Gastos"
        [value]="formatCurrency(totalAmount() || 0)"
        [smallText]="totalCount() + ' registros'"
        iconName="dollar-sign"
        iconBgColor="bg-blue-100"
        iconColor="text-blue-600"
      ></app-stats>

      <app-stats
        title="Pendientes"
        [value]="pendingCount() || 0"
        smallText="Por aprobar"
        iconName="clock"
        iconBgColor="bg-yellow-100"
        iconColor="text-yellow-600"
      ></app-stats>

      <app-stats
        title="Aprobados"
        [value]="approvedCount() || 0"
        smallText="Listos para pago"
        iconName="check-circle"
        iconBgColor="bg-green-100"
        iconColor="text-green-600"
      ></app-stats>

      <app-stats
        title="Pagados"
        [value]="paidCount() || 0"
        smallText="Gastos liquidados"
        iconName="wallet"
        iconBgColor="bg-purple-100"
        iconColor="text-purple-600"
      ></app-stats>
    </ng-container>
  `,
})
export class ExpensesStatsComponent {
  private store = inject(Store);
  private currencyService = inject(CurrencyFormatService);

  constructor() {
    this.currencyService.loadCurrency();
  }

  private summary$: Observable<ExpenseSummary | null> =
    this.store.select(selectSummary);

  readonly totalAmount = toSignal(
    this.summary$.pipe(map((s) => s?.total_amount || 0)),
    { initialValue: 0 },
  );
  readonly totalCount = toSignal(
    this.summary$.pipe(map((s) => s?.total_count || 0)),
    { initialValue: 0 },
  );
  readonly pendingCount = toSignal(
    this.summary$.pipe(map((s) => s?.counts_by_state?.pending || 0)),
    { initialValue: 0 },
  );
  readonly approvedCount = toSignal(
    this.summary$.pipe(map((s) => s?.counts_by_state?.approved || 0)),
    { initialValue: 0 },
  );
  readonly paidCount = toSignal(
    this.summary$.pipe(map((s) => s?.counts_by_state?.paid || 0)),
    { initialValue: 0 },
  );
  readonly refundedCount = toSignal(
    this.summary$.pipe(map((s) => s?.counts_by_state?.refunded || 0)),
    { initialValue: 0 },
  );

  formatCurrency(value: number): string {
    return this.currencyService.format(value || 0);
  }
}
