import { Routes } from '@angular/router';
import { provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { reportsReducer } from './state/reports.reducer';
import { ReportsEffects } from './state/reports.effects';
import { accountingReducer } from '../accounting/state/reducers/accounting.reducer';
import { AccountingEffects } from '../accounting/state/effects/accounting.effects';

export const reportsRoutes: Routes = [
  {
    path: '',
    providers: [
      provideState({ name: 'reports', reducer: reportsReducer }),
      provideEffects(ReportsEffects),
      provideState({ name: 'accounting', reducer: accountingReducer }),
      provideEffects(AccountingEffects),
    ],
    loadComponent: () =>
      import('./reports.component').then((c) => c.ReportsComponent),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/report-list/report-list.component').then(
            (c) => c.ReportListComponent,
          ),
      },
      {
        path: ':reportId',
        loadComponent: () =>
          import('./pages/report-detail/report-detail.component').then(
            (c) => c.ReportDetailComponent,
          ),
      },
    ],
  },
];
