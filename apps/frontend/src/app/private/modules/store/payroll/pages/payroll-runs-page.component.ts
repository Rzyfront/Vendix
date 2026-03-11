import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store } from '@ngrx/store';
import { Observable, Subject } from 'rxjs';
import { takeUntil, filter } from 'rxjs/operators';

import {
  loadPayrollRuns,
  loadPayrollRunStats,
  loadPayrollRun,
} from '../state/actions/payroll.actions';
import {
  selectPayrollRuns,
  selectPayrollRunsLoading,
  selectCurrentPayrollRun,
} from '../state/selectors/payroll.selectors';
import { PayrollRun } from '../interfaces/payroll.interface';

import { PayrollStatsComponent } from '../components/payroll-stats/payroll-stats.component';
import { PayrollRunListComponent } from '../components/payroll-runs/payroll-run-list/payroll-run-list.component';
import { PayrollRunCreateComponent } from '../components/payroll-runs/payroll-run-create/payroll-run-create.component';
import { PayrollRunDetailComponent } from '../components/payroll-runs/payroll-run-detail/payroll-run-detail.component';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';

@Component({
  selector: 'vendix-payroll-runs-page',
  standalone: true,
  imports: [
    CommonModule,
    PayrollStatsComponent,
    PayrollRunListComponent,
    PayrollRunCreateComponent,
    PayrollRunDetailComponent,
  ],
  template: `
    <div class="w-full">
      <div class="stats-container !mb-0 md:!mb-8 sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <vendix-payroll-stats view="payroll-runs"></vendix-payroll-stats>
      </div>

      <app-payroll-run-list
        [payrollRuns]="(payrollRuns$ | async) || []"
        [loading]="(payrollRunsLoading$ | async) || false"
        (create)="openPayrollRunCreateModal()"
        (detail)="viewPayrollRun($event)"
        (refresh)="refreshPayrollRuns()"
      ></app-payroll-run-list>

      <vendix-payroll-run-create
        [(isOpen)]="isPayrollRunCreateModalOpen"
      ></vendix-payroll-run-create>

      <vendix-payroll-run-detail
        [(isOpen)]="isPayrollRunDetailModalOpen"
        [payrollRun]="selectedPayrollRun"
      ></vendix-payroll-run-detail>
    </div>
  `,
})
export class PayrollRunsPageComponent implements OnInit, OnDestroy {
  private store = inject(Store);
  private currencyService = inject(CurrencyFormatService);
  private destroy$ = new Subject<void>();

  payrollRuns$: Observable<PayrollRun[]> = this.store.select(selectPayrollRuns);
  payrollRunsLoading$: Observable<boolean> = this.store.select(selectPayrollRunsLoading);

  isPayrollRunCreateModalOpen = false;
  isPayrollRunDetailModalOpen = false;
  selectedPayrollRun: PayrollRun | null = null;

  constructor() {
    this.store.select(selectCurrentPayrollRun).pipe(
      takeUntil(this.destroy$),
      filter((run): run is PayrollRun => run !== null),
    ).subscribe((run) => {
      if (this.isPayrollRunDetailModalOpen && this.selectedPayrollRun?.id === run.id) {
        this.selectedPayrollRun = run;
      }
    });
  }

  ngOnInit(): void {
    this.currencyService.loadCurrency();
    this.store.dispatch(loadPayrollRuns());
    this.store.dispatch(loadPayrollRunStats());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  openPayrollRunCreateModal(): void {
    this.isPayrollRunCreateModalOpen = true;
  }

  viewPayrollRun(payrollRun: PayrollRun): void {
    this.selectedPayrollRun = payrollRun;
    this.isPayrollRunDetailModalOpen = true;
    this.store.dispatch(loadPayrollRun({ id: payrollRun.id }));
  }

  refreshPayrollRuns(): void {
    this.store.dispatch(loadPayrollRuns());
    this.store.dispatch(loadPayrollRunStats());
  }
}
