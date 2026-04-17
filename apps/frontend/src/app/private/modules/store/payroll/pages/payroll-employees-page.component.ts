import { Component, inject, DestroyRef } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { Observable, Subject } from 'rxjs';
import { takeUntil, filter } from 'rxjs/operators';

import {
  loadEmployees,
  loadEmployeeStats,
} from '../state/actions/payroll.actions';
import {
  selectEmployees,
  selectEmployeesLoading,
} from '../state/selectors/payroll.selectors';
import { Employee } from '../interfaces/payroll.interface';

import { PayrollStatsComponent } from '../components/payroll-stats/payroll-stats.component';
import { EmployeeListComponent } from '../components/employees/employee-list/employee-list.component';
import { EmployeeCreateComponent } from '../components/employees/employee-create/employee-create.component';
import { EmployeeDetailComponent } from '../components/employees/employee-detail/employee-detail.component';
import { EmployeeBulkUploadModalComponent } from '../components/employees/bulk-upload-modal/employee-bulk-upload-modal.component';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';

@Component({
  selector: 'vendix-payroll-employees-page',
  standalone: true,
  imports: [
    PayrollStatsComponent,
    EmployeeListComponent,
    EmployeeCreateComponent,
    EmployeeDetailComponent,
    EmployeeBulkUploadModalComponent,
  ],
  template: `
    <div class="w-full">
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <vendix-payroll-stats view="employees"></vendix-payroll-stats>
      </div>

      <app-employee-list
        [employees]="employees() || []"
        [loading]="employeesLoading() || false"
        (create)="openEmployeeCreateModal()"
        (edit)="editEmployee($event)"
        (detail)="viewEmployee($event)"
        (refresh)="refreshEmployees()"
        (bulkUpload)="openBulkUploadModal()"
      ></app-employee-list>

      <vendix-employee-create
        [(isOpen)]="isEmployeeCreateModalOpen"
      ></vendix-employee-create>

      <vendix-employee-detail
        [(isOpen)]="isEmployeeDetailModalOpen"
        [employee]="selectedEmployee"
      ></vendix-employee-detail>

      <app-employee-bulk-upload-modal
        [(isOpen)]="isEmployeeBulkUploadModalOpen"
        (uploadComplete)="onBulkUploadComplete()"
      ></app-employee-bulk-upload-modal>
    </div>
  `,
})
export class PayrollEmployeesPageComponent {
  private store = inject(Store);
  private currencyService = inject(CurrencyFormatService);
  private destroyRef = inject(DestroyRef);
  private destroy$ = new Subject<void>();

  readonly employees = toSignal(this.store.select(selectEmployees), {
    initialValue: [] as Employee[],
  });
  readonly employeesLoading = toSignal(
    this.store.select(selectEmployeesLoading),
    { initialValue: false },
  );

  isEmployeeCreateModalOpen = false;
  isEmployeeDetailModalOpen = false;
  isEmployeeBulkUploadModalOpen = false;
  selectedEmployee: Employee | null = null;

  constructor() {
    this.currencyService.loadCurrency();
    this.store.dispatch(loadEmployees());
    this.store.dispatch(loadEmployeeStats());

    this.destroyRef.onDestroy(() => {
      this.destroy$.next();
      this.destroy$.complete();
    });
  }

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
}
