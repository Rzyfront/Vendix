import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store } from '@ngrx/store';
import { Observable, map } from 'rxjs';
import { selectExpenses } from '../../state/selectors/expenses.selectors';
import { Expense } from '../../interfaces/expense.interface';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';

@Component({
  selector: 'vendix-expenses-stats',
  standalone: true,
  imports: [CommonModule, StatsComponent],
  styleUrls: ['./expenses-stats.component.scss'],
  template: `
    <ng-container>
      <app-stats
        title="Total Gastos"
        [value]="formatCurrency((totalAmount$ | async) || 0)"
        [smallText]="(totalCount$ | async) + ' registros'"
        iconName="dollar-sign"
        iconBgColor="bg-blue-100"
        iconColor="text-blue-600"
      ></app-stats>

      <app-stats
        title="Pendientes"
        [value]="(pendingCount$ | async) || 0"
        smallText="Por aprobar"
        iconName="clock"
        iconBgColor="bg-yellow-100"
        iconColor="text-yellow-600"
      ></app-stats>

      <app-stats
        title="Aprobados"
        [value]="(approvedCount$ | async) || 0"
        smallText="Listos para pago"
        iconName="check-circle"
        iconBgColor="bg-green-100"
        iconColor="text-green-600"
      ></app-stats>

      <app-stats
        title="Pagados"
        [value]="(paidCount$ | async) || 0"
        smallText="Gastos liquidados"
        iconName="wallet"
        iconBgColor="bg-purple-100"
        iconColor="text-purple-600"
      ></app-stats>
    </ng-container>
  `
})
export class ExpensesStatsComponent implements OnInit {
  private store = inject(Store);
  private currencyService = inject(CurrencyFormatService);

  ngOnInit(): void {
    // Asegurar que la moneda esté cargada
    this.currencyService.loadCurrency();
  }

  expenses$: Observable<Expense[]> = this.store.select(selectExpenses);

  totalCount$ = this.expenses$.pipe(map(e => e.length));
  totalAmount$ = this.expenses$.pipe(
    map(expenses => expenses.reduce((acc, curr) => acc + Number(curr.amount), 0))
  );
  pendingCount$ = this.expenses$.pipe(map(e => e.filter(i => i.state === 'pending').length));
  approvedCount$ = this.expenses$.pipe(map(e => e.filter(i => i.state === 'approved').length));
  paidCount$ = this.expenses$.pipe(map(e => e.filter(i => i.state === 'paid').length));

  formatCurrency(value: number): string {
    return this.currencyService.format(value || 0);
  }
}
