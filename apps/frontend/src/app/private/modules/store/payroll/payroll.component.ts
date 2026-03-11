import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
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
import { ScrollableTabsComponent, ScrollableTab } from '../../../../shared/components/scrollable-tabs/scrollable-tabs.component';
import { CurrencyFormatService } from '../../../../shared/pipes/currency';

@Component({
  selector: 'vendix-payroll',
  standalone: true,
  imports: [
    CommonModule,
    PayrollStatsComponent,
    EmployeeListComponent,
    EmployeeCreateComponent,
    EmployeeDetailComponent,
    PayrollRunListComponent,
    PayrollRunCreateComponent,
    PayrollRunDetailComponent,
    PayrollSettingsComponent,
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
      <div *ngIf="activeTab !== 'settings'" class="stats-container !mb-0 md:!mb-8 sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <vendix-payroll-stats [view]="activeTab"></vendix-payroll-stats>
      </div>

      <!-- Employees Tab -->
      <ng-container *ngIf="activeTab === 'employees'">
        <app-employee-list
          [employees]="(employees$ | async) || []"
          [loading]="(employeesLoading$ | async) || false"
          (create)="openEmployeeCreateModal()"
          (edit)="editEmployee($event)"
          (detail)="viewEmployee($event)"
          (refresh)="refreshEmployees()"
        ></app-employee-list>

        <vendix-employee-create
          [(isOpen)]="isEmployeeCreateModalOpen"
        ></vendix-employee-create>

        <vendix-employee-detail
          [(isOpen)]="isEmployeeDetailModalOpen"
          [employee]="selectedEmployee"
        ></vendix-employee-detail>
      </ng-container>

      <!-- Payroll Runs Tab -->
      <ng-container *ngIf="activeTab === 'payroll-runs'">
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
      </ng-container>

      <!-- Settings Tab -->
      <ng-container *ngIf="activeTab === 'settings'">
        <vendix-payroll-settings></vendix-payroll-settings>
      </ng-container>
    </div>
  `,
})
export class PayrollComponent implements OnInit, OnDestroy {
  private currencyService = inject(CurrencyFormatService);
  private destroy$ = new Subject<void>();

  employees$: Observable<Employee[]>;
  employeesLoading$: Observable<boolean>;
  payrollRuns$: Observable<PayrollRun[]>;
  payrollRunsLoading$: Observable<boolean>;

  // Tab state
  tabs: ScrollableTab[] = [
    { id: 'employees', label: 'Empleados', icon: 'users' },
    { id: 'payroll-runs', label: 'Nóminas', icon: 'file-text' },
    { id: 'settings', label: 'Configuración', icon: 'settings' },
  ];
  activeTab: 'employees' | 'payroll-runs' | 'settings' = 'employees';

  // Modal states
  isEmployeeCreateModalOpen = false;
  isEmployeeDetailModalOpen = false;
  isPayrollRunCreateModalOpen = false;
  isPayrollRunDetailModalOpen = false;

  selectedEmployee: Employee | null = null;
  selectedPayrollRun: PayrollRun | null = null;

  constructor(private store: Store) {
    this.employees$ = this.store.select(selectEmployees);
    this.employeesLoading$ = this.store.select(selectEmployeesLoading);
    this.payrollRuns$ = this.store.select(selectPayrollRuns);
    this.payrollRunsLoading$ = this.store.select(selectPayrollRunsLoading);

    // Keep detail modal in sync with store after state transitions
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
    this.store.dispatch(loadEmployees());
    this.store.dispatch(loadEmployeeStats());
    this.store.dispatch(loadPayrollRuns());
    this.store.dispatch(loadPayrollRunStats());
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

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  refreshPayrollRuns(): void {
    this.store.dispatch(loadPayrollRuns());
    this.store.dispatch(loadPayrollRunStats());
  }
}
