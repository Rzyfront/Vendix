import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { payrollReducer } from './state/reducers/payroll.reducer';
import { PayrollEffects } from './state/effects/payroll.effects';

export const payrollRoutes: Routes = [
    {
        path: '',
        providers: [
            provideState({ name: 'payroll', reducer: payrollReducer }),
            provideEffects(PayrollEffects),
        ],
        children: [
            {
                path: '',
                pathMatch: 'full',
                redirectTo: 'employees',
            },
            {
                path: 'employees',
                loadComponent: () =>
                    import('./pages/payroll-employees-page.component').then(
                        (c) => c.PayrollEmployeesPageComponent,
                    ),
            },
            {
                path: 'runs',
                loadComponent: () =>
                    import('./pages/payroll-runs-page.component').then(
                        (c) => c.PayrollRunsPageComponent,
                    ),
            },
            {
                path: 'settlements',
                loadComponent: () =>
                    import('./pages/payroll-settlements-page.component').then(
                        (c) => c.PayrollSettlementsPageComponent,
                    ),
            },
            {
                path: 'advances',
                loadComponent: () =>
                    import('./pages/payroll-advances-page.component').then(
                        (c) => c.PayrollAdvancesPageComponent,
                    ),
            },
            {
                path: 'settings',
                loadComponent: () =>
                    import('./components/payroll-settings/payroll-settings.component').then(
                        (c) => c.PayrollSettingsComponent,
                    ),
            },
        ],
    },
];
