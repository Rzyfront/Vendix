import { Component, inject, DestroyRef } from '@angular/core';
import { toSignal , takeUntilDestroyed} from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { Actions, ofType } from '@ngrx/effects';
import { Observable } from 'rxjs';
import { filter } from 'rxjs/operators';

import {
  loadPayrollRuns,
  loadPayrollRunStats,
  loadPayrollRun,
  cancelPayrollRunSuccess } from '../state/actions/payroll.actions';
import {
  selectPayrollRuns,
  selectPayrollRunsLoading,
  selectCurrentPayrollRun } from '../state/selectors/payroll.selectors';
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
    PayrollStatsComponent,
    PayrollRunListComponent,
    PayrollRunCreateComponent,
    PayrollRunDetailComponent,
  ],
  template: `
    <div class="w-full">
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <vendix-payroll-stats view="payroll-runs"></vendix-payroll-stats>
      </div>

      <app-payroll-run-list
        [payrollRuns]="payrollRuns() || []"
        [loading]="payrollRunsLoading() || false"
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
  ` })
export class PayrollRunsPageComponent {
  private store = inject(Store);
  private actions$ = inject(Actions);
  private currencyService = inject(CurrencyFormatService);
  private destroyRef = inject(DestroyRef);
readonly payrollRuns = toSignal(this.store.select(selectPayrollRuns), {
    initialValue: [] as PayrollRun[] });
  readonly payrollRunsLoading = toSignal(
    this.store.select(selectPayrollRunsLoading),
    { initialValue: false },
  );

  isPayrollRunCreateModalOpen = false;
  isPayrollRunDetailModalOpen = false;
  selectedPayrollRun: PayrollRun | null = null;

  constructor() {
    this.currencyService.loadCurrency();
    this.store.dispatch(loadPayrollRuns());
    this.store.dispatch(loadPayrollRunStats());

    this.store
      .select(selectCurrentPayrollRun)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        filter((run): run is PayrollRun => run !== null),
      )
      .subscribe((run) => {
        if (
          this.isPayrollRunDetailModalOpen &&
          this.selectedPayrollRun?.id === run.id
        ) {
          this.selectedPayrollRun = run;
        }
      });

    this.actions$
      .pipe(ofType(cancelPayrollRunSuccess), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.isPayrollRunDetailModalOpen = false;
      });

    this.destroyRef.onDestroy(() => {
    });
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
