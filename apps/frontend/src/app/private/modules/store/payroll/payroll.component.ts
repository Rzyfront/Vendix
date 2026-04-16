import { Component, inject, DestroyRef } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { Store } from '@ngrx/store';
import { Observable, Subject } from 'rxjs';
import { takeUntil, filter } from 'rxjs/operators';

import {
  loadEmployees,
  loadEmployeeStats,
  loadPayrollRuns,
  loadPayrollRunStats,
  loadPayrollRun,
} from './state/actions/payroll.actions';
import {
  selectEmployees,
  selectEmployeesLoading,
  selectPayrollRuns,
  selectPayrollRunsLoading,
  selectCurrentPayrollRun,
} from './state/selectors/payroll.selectors';
import { Employee, PayrollRun } from './interfaces/payroll.interface';

import { PayrollStatsComponent } from './components/payroll-stats/payroll-stats.component';
import { EmployeeListComponent } from './components/employees/employee-list/employee-list.component';
import { EmployeeCreateComponent } from './components/employees/employee-create/employee-create.component';
import { EmployeeDetailComponent } from './components/employees/employee-detail/employee-detail.component';
import { PayrollRunListComponent } from './components/payroll-runs/payroll-run-list/payroll-run-list.component';
import { PayrollRunCreateComponent } from './components/payroll-runs/payroll-run-create/payroll-run-create.component';
import { PayrollRunDetailComponent } from './components/payroll-runs/payroll-run-detail/payroll-run-detail.component';
import { PayrollSettingsComponent } from './components/payroll-settings/payroll-settings.component';
import { EmployeeBulkUploadModalComponent } from './components/employees/bulk-upload-modal/employee-bulk-upload-modal.component';
import {
  ScrollableTabsComponent,
  ScrollableTab,
} from '../../../../shared/components/scrollable-tabs/scrollable-tabs.component';
import { CurrencyFormatService } from '../../../../shared/pipes/currency';

@Component({
  selector: 'vendix-payroll',
  standalone: true,
  imports: [
    AsyncPipe,
    PayrollStatsComponent,
    EmployeeListComponent,
    EmployeeCreateComponent,
    EmployeeDetailComponent,
    PayrollRunListComponent,
    PayrollRunCreateComponent,
    PayrollRunDetailComponent,
    PayrollSettingsComponent,
    EmployeeBulkUploadModalComponent,
    ScrollableTabsComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Tab Navigation -->
      <div class="px-2 md:px-0 mb-0 md:mb-4">
        <app-scrollable-tabs
          [tabs]="tabs"
          [activeTab]="activeTab"
          size="md"
          (tabChange)="switchTab($event)"
        ></app-scrollable-tabs>
      </div>

      <!-- Stats: Sticky on mobile, static on desktop (hidden on settings tab) -->
      @if (activeTab === 'employees' || activeTab === 'payroll-runs') {
        <div
          class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
        >
          <vendix-payroll-stats [view]="activeTab"></vendix-payroll-stats>
        </div>
      }

      <!-- Employees Tab -->
      @if (activeTab === 'employees') {
        <app-employee-list
          [employees]="(employees$ | async) || []"
          [loading]="(employeesLoading$ | async) || false"
          (create)="openEmployeeCreateModal()"
          (edit)="editEmployee($event)"
          (detail)="viewEmployee($event)"
          (refresh)="refreshEmployees()"
          (bulkUpload)="openBulkUploadModal()"
        ></app-employee-list>
        @defer (when isEmployeeCreateModalOpen) {
          <vendix-employee-create
            [(isOpen)]="isEmployeeCreateModalOpen"
          ></vendix-employee-create>
        }
        @defer (when isEmployeeDetailModalOpen) {
          <vendix-employee-detail
            [(isOpen)]="isEmployeeDetailModalOpen"
            [employee]="selectedEmployee"
          ></vendix-employee-detail>
        }
        @defer (when isEmployeeBulkUploadModalOpen) {
          <app-employee-bulk-upload-modal
            [(isOpen)]="isEmployeeBulkUploadModalOpen"
            (uploadComplete)="onBulkUploadComplete()"
          ></app-employee-bulk-upload-modal>
        }
      }

      <!-- Payroll Runs Tab -->
      @if (activeTab === 'payroll-runs') {
        <app-payroll-run-list
          [payrollRuns]="(payrollRuns$ | async) || []"
          [loading]="(payrollRunsLoading$ | async) || false"
          (create)="openPayrollRunCreateModal()"
          (detail)="viewPayrollRun($event)"
          (refresh)="refreshPayrollRuns()"
        ></app-payroll-run-list>
        @defer (when isPayrollRunCreateModalOpen) {
          <vendix-payroll-run-create
            [(isOpen)]="isPayrollRunCreateModalOpen"
          ></vendix-payroll-run-create>
        }
        @defer (when isPayrollRunDetailModalOpen) {
          <vendix-payroll-run-detail
            [(isOpen)]="isPayrollRunDetailModalOpen"
            [payrollRun]="selectedPayrollRun"
          ></vendix-payroll-run-detail>
        }
      }

      <!-- Settings Tab -->
      @if (activeTab === 'settings') {
        <vendix-payroll-settings></vendix-payroll-settings>
      }
    </div>
  `,
})
export class PayrollComponent {
  private currencyService = inject(CurrencyFormatService);
  private destroyRef = inject(DestroyRef);
  private destroy$ = new Subject<void>();

  employees$: Observable<Employee[]>;
  employeesLoading$: Observable<boolean>;
  payrollRuns$: Observable<PayrollRun[]>;
  payrollRunsLoading$: Observable<boolean>;

  // Tab state
  tabs: ScrollableTab[] = [
    { id: 'employees', label: 'Empleados', icon: 'users' },
    { id: 'payroll-runs', label: 'Nóminas', icon: 'file-text' },
    { id: 'settlements', label: 'Liquidaciones', icon: 'file-minus' },
    { id: 'advances', label: 'Adelantos', icon: 'hand-coins' },
    { id: 'settings', label: 'Configuración', icon: 'settings' },
  ];
  activeTab:
    | 'employees'
    | 'payroll-runs'
    | 'settlements'
    | 'advances'
    | 'settings' = 'employees';

  // Modal states
  isEmployeeCreateModalOpen = false;
  isEmployeeDetailModalOpen = false;
  isEmployeeBulkUploadModalOpen = false;
  isPayrollRunCreateModalOpen = false;
  isPayrollRunDetailModalOpen = false;

  selectedEmployee: Employee | null = null;
  selectedPayrollRun: PayrollRun | null = null;

  constructor(private store: Store) {
    this.employees$ = this.store.select(selectEmployees);
    this.employeesLoading$ = this.store.select(selectEmployeesLoading);
    this.payrollRuns$ = this.store.select(selectPayrollRuns);
    this.payrollRunsLoading$ = this.store.select(selectPayrollRunsLoading);

    this.currencyService.loadCurrency();
    this.store.dispatch(loadEmployees());
    this.store.dispatch(loadEmployeeStats());
    this.store.dispatch(loadPayrollRuns());
    this.store.dispatch(loadPayrollRunStats());

    // Keep detail modal in sync with store after state transitions
    this.store
      .select(selectCurrentPayrollRun)
      .pipe(
        takeUntil(this.destroy$),
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

    this.destroyRef.onDestroy(() => {
      this.destroy$.next();
      this.destroy$.complete();
    });
  }

  switchTab(tab: string): void {
    this.activeTab = tab as 'employees' | 'payroll-runs' | 'settings';
  }

  // Employee handlers
  openEmployeeCreateModal(): void {
    this.isEmployeeCreateModalOpen = true;
  }

  editEmployee(employee: Employee): void {
    this.selectedEmployee = employee;
    this.isEmployeeDetailModalOpen = true;
  }

  viewEmployee(employee: Employee): void {
    this.selectedEmployee = employee;
    this.isEmployeeDetailModalOpen = true;
  }

  openBulkUploadModal(): void {
    this.isEmployeeBulkUploadModalOpen = true;
  }

  onBulkUploadComplete(): void {
    this.refreshEmployees();
  }

  refreshEmployees(): void {
    this.store.dispatch(loadEmployees());
    this.store.dispatch(loadEmployeeStats());
  }

  // Payroll Run handlers
  openPayrollRunCreateModal(): void {
    this.isPayrollRunCreateModalOpen = true;
  }

  viewPayrollRun(payrollRun: PayrollRun): void {
    this.selectedPayrollRun = payrollRun;
    this.isPayrollRunDetailModalOpen = true;
    // Fetch full detail with payroll_items (list endpoint doesn't include items)
    this.store.dispatch(loadPayrollRun({ id: payrollRun.id }));
  }

  refreshPayrollRuns(): void {
    this.store.dispatch(loadPayrollRuns());
    this.store.dispatch(loadPayrollRunStats());
  }
}
