import { Component, input, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { Store } from '@ngrx/store';
import { Observable, map } from 'rxjs';
import {
  selectEmployeeStats,
  selectPayrollRunStats,
} from '../../state/selectors/payroll.selectors';
import { EmployeeStats, PayrollStats } from '../../interfaces/payroll.interface';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';

@Component({
  selector: 'vendix-payroll-stats',
  standalone: true,
  imports: [AsyncPipe, StatsComponent],
  styleUrls: ['./payroll-stats.component.scss'],
  template: `
@switch (view()) {
  <!-- Employee Stats -->
  @case ('employees') {
    <app-stats
      title="Empleados Activos"
      [value]="(activeEmployees$ | async) || 0"
      [smallText]="(totalEmployees$ | async) + ' en total'"
      iconName="users"
      iconBgColor="bg-blue-100"
      iconColor="text-blue-600"
    ></app-stats>
    <app-stats
      title="Salario Promedio"
      [value]="formatCurrency((avgSalary$ | async) || 0)"
      smallText="Base mensual"
      iconName="trending-up"
      iconBgColor="bg-green-100"
      iconColor="text-green-600"
    ></app-stats>
    <app-stats
      title="Inactivos"
      [value]="(inactiveEmployees$ | async) || 0"
      smallText="Sin actividad"
      iconName="user-x"
      iconBgColor="bg-yellow-100"
      iconColor="text-yellow-600"
    ></app-stats>
    <app-stats
      title="Departamentos"
      [value]="(departmentCount$ | async) || 0"
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
      [value]="formatCurrency((totalNetPay$ | async) || 0)"
      smallText="Pago neto acumulado"
      iconName="dollar-sign"
      iconBgColor="bg-blue-100"
      iconColor="text-blue-600"
    ></app-stats>
    <app-stats
      title="Empleados Activos"
      [value]="(runActiveEmployees$ | async) || 0"
      smallText="En nomina"
      iconName="users"
      iconBgColor="bg-green-100"
      iconColor="text-green-600"
    ></app-stats>
    <app-stats
      title="Costo Empleador"
      [value]="formatCurrency((totalEmployerCost$ | async) || 0)"
      smallText="Aportes patronales"
      iconName="briefcase"
      iconBgColor="bg-yellow-100"
      iconColor="text-yellow-600"
    ></app-stats>
    <app-stats
      title="Salario Promedio"
      [value]="formatCurrency((runAvgSalary$ | async) || 0)"
      smallText="Promedio por empleado"
      iconName="bar-chart-2"
      iconBgColor="bg-purple-100"
      iconColor="text-purple-600"
    ></app-stats>
  }
}
`
})
export class PayrollStatsComponent {
  readonly view = input<'employees' | 'payroll-runs'>('employees');

  private store = inject(Store);
  private currencyService = inject(CurrencyFormatService);

  constructor() {
    this.currencyService.loadCurrency();
  }

  // Employee stats
  private employeeStats$: Observable<EmployeeStats | null> = this.store.select(selectEmployeeStats);
  activeEmployees$ = this.employeeStats$.pipe(map(s => s?.active || 0));
  totalEmployees$ = this.employeeStats$.pipe(map(s => s?.total || 0));
  inactiveEmployees$ = this.employeeStats$.pipe(map(s => s?.inactive || 0));
  avgSalary$ = this.employeeStats$.pipe(map(s => s?.avg_salary || 0));
  departmentCount$ = this.employeeStats$.pipe(map(s => s?.by_department?.length || 0));

  // Payroll run stats
  private payrollRunStats$: Observable<PayrollStats | null> = this.store.select(selectPayrollRunStats);
  totalNetPay$ = this.payrollRunStats$.pipe(map(s => s?.total_net_pay || 0));
  runActiveEmployees$ = this.payrollRunStats$.pipe(map(s => s?.active_employees || 0));
  totalEmployerCost$ = this.payrollRunStats$.pipe(map(s => s?.total_employer_cost || 0));
  runAvgSalary$ = this.payrollRunStats$.pipe(map(s => s?.avg_salary || 0));

  formatCurrency(value: number): string {
    return this.currencyService.format(value || 0);
  }
}
