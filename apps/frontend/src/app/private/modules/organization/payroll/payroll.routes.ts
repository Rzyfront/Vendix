import { Routes } from '@angular/router';

export const orgPayrollRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./payroll.component').then((c) => c.OrgPayrollComponent),
  },
];
