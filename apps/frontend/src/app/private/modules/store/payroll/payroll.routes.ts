import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { payrollReducer } from './state/reducers/payroll.reducer';
import { PayrollEffects } from './state/effects/payroll.effects';
import { ModuleTabsShellComponent } from '../../../../shared/components/module-tabs-shell/module-tabs-shell.component';

export const payrollRoutes: Routes = [
    {
        path: '',
        component: ModuleTabsShellComponent,
        // Centralized module: sub-sections render as internal sticky-header tabs.
        data: {
            moduleTitle: 'Nómina',
            moduleIcon: 'banknote',
            moduleBackRoute: '/admin/fiscal',
            moduleTabs: [
                {
                    id: 'employees',
                    label: 'Empleados',
                    icon: 'users',
                    route: '/admin/payroll/employees',
                },
                {
                    id: 'runs',
                    label: 'Períodos de Nómina',
                    shortLabel: 'Períodos',
                    icon: 'calendar-days',
                    route: '/admin/payroll/runs',
                },
                {
                    id: 'settlements',
                    label: 'Liquidaciones',
                    icon: 'file-check',
                    route: '/admin/payroll/settlements',
                },
                {
                    id: 'advances',
                    label: 'Adelantos',
                    icon: 'hand-coins',
                    route: '/admin/payroll/advances',
                },
                {
                    id: 'settings',
                    label: 'Configuración',
                    shortLabel: 'Config.',
                    icon: 'settings',
                    route: '/admin/payroll/settings',
                },
            ],
        },
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
