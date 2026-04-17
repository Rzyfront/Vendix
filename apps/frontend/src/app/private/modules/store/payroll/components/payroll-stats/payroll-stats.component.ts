import { Component, input, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { Observable, map } from 'rxjs';
import {
  selectEmployeeStats,
  selectPayrollRunStats,
} from '../../state/selectors/payroll.selectors';
import {
  EmployeeStats,
  PayrollStats,
} from '../../interfaces/payroll.interface';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';

@Component({
  selector: 'vendix-payroll-stats',
  standalone: true,
  imports: [StatsComponent],
  styleUrls: ['./payroll-stats.component.scss'],
  template: `
    @switch (view()) {
      <!-- Employee Stats -->
      @case ('employees') {
        <app-stats
          title="Empleados Activos"
          [value]="activeEmployees() || 0"
          [smallText]="totalEmployees() + ' en total'"
          iconName="users"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>
        <app-stats
          title="Salario Promedio"
          [value]="formatCurrency(avgSalary() || 0)"
          smallText="Base mensual"
          iconName="trending-up"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>
        <app-stats
          title="Inactivos"
          [value]="inactiveEmployees() || 0"
          smallText="Sin actividad"
          iconName="user-x"
          iconBgColor="bg-yellow-100"
          iconColor="text-yellow-600"
        ></app-stats>
        <app-stats
          title="Departamentos"
          [value]="departmentCount() || 0"
          smallText="Areas activas"
          iconName="building"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
      }
      <!-- Payroll Run Stats -->
      @case ('payroll-runs') {
        <app-stats
          title="Neto Total"
          [value]="formatCurrency(totalNetPay() || 0)"
          smallText="Pago neto acumulado"
          iconName="dollar-sign"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>
        <app-stats
          title="Empleados Activos"
          [value]="runActiveEmployees() || 0"
          smallText="En nomina"
          iconName="users"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>
        <app-stats
          title="Costo Empleador"
          [value]="formatCurrency(totalEmployerCost() || 0)"
          smallText="Aportes patronales"
          iconName="briefcase"
          iconBgColor="bg-yellow-100"
          iconColor="text-yellow-600"
        ></app-stats>
        <app-stats
          title="Salario Promedio"
          [value]="formatCurrency(runAvgSalary() || 0)"
          smallText="Promedio por empleado"
          iconName="bar-chart-2"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
      }
    }
  `,
})
export class PayrollStatsComponent {
  readonly view = input<'employees' | 'payroll-runs'>('employees');

  private store = inject(Store);
  private currencyService = inject(CurrencyFormatService);

  constructor() {
    this.currencyService.loadCurrency();
  }

  private employeeStats$: Observable<EmployeeStats | null> =
    this.store.select(selectEmployeeStats);
  readonly activeEmployees = toSignal(
    this.employeeStats$.pipe(map((s) => s?.active || 0)),
    { initialValue: 0 },
  );
  readonly totalEmployees = toSignal(
    this.employeeStats$.pipe(map((s) => s?.total || 0)),
    { initialValue: 0 },
  );
  readonly inactiveEmployees = toSignal(
    this.employeeStats$.pipe(map((s) => s?.inactive || 0)),
    { initialValue: 0 },
  );
  readonly avgSalary = toSignal(
    this.employeeStats$.pipe(map((s) => s?.avg_salary || 0)),
    { initialValue: 0 },
  );
  readonly departmentCount = toSignal(
    this.employeeStats$.pipe(map((s) => s?.by_department?.length || 0)),
    { initialValue: 0 },
  );

  private payrollRunStats$: Observable<PayrollStats | null> = this.store.select(
    selectPayrollRunStats,
  );
  readonly totalNetPay = toSignal(
    this.payrollRunStats$.pipe(map((s) => s?.total_net_pay || 0)),
    { initialValue: 0 },
  );
  readonly runActiveEmployees = toSignal(
    this.payrollRunStats$.pipe(map((s) => s?.active_employees || 0)),
    { initialValue: 0 },
  );
  readonly totalEmployerCost = toSignal(
    this.payrollRunStats$.pipe(map((s) => s?.total_employer_cost || 0)),
    { initialValue: 0 },
  );
  readonly runAvgSalary = toSignal(
    this.payrollRunStats$.pipe(map((s) => s?.avg_salary || 0)),
    { initialValue: 0 },
  );

  formatCurrency(value: number): string {
    return this.currencyService.format(value || 0);
  }
}
