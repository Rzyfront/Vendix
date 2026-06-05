import { Routes } from '@angular/router';

import { FiscalCoreShellComponent } from './fiscal-core-shell.component';
import { FiscalOperationsComponent } from './fiscal-operations.component';
import { fiscalManagementGuard } from '../../../core/guards/fiscal-management.guard';

/**
 * Routing for the fiscal module.
 *
 * The shell (`FiscalCoreShellComponent`) is the single entry-point
 * rendered for `/admin/fiscal/**`. It decides, based on the
 * `fiscalStatus` signal, whether to show the *activation layer*
 * (panel + wizard CTA) or the *operation layer* (sticky-header +
 * <router-outlet>) that hosts the 7 fiscal tabs.
 *
 * Direct children:
 * - `''`           — pathMatch full redirect to `dashboard` (defensive
 *                    guard so a direct hit on the shell without a tab
 *                    doesn't render an empty outlet).
 * - `wizard`       — the activation wizard (guarded by
 *                    `fiscalManagementGuard` so only owner/super_admin
 *                    with the right permission can mutate fiscal
 *                    status).
 * - `activation`   — dedicated view for the activation panel only
 *                    (reuses the same panel that the shell renders
 *                    inline when the org has no active fiscal areas).
 * - `dashboard`/`obligations`/... — the 7 operation tabs.
 */
export const fiscalOperationsRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'dashboard',
  },
  {
    path: '',
    component: FiscalCoreShellComponent,
    children: [
      {
        path: 'wizard',
        canActivate: [fiscalManagementGuard],
        loadComponent: () =>
          import(
            '../../../shared/components/fiscal-activation-wizard/fiscal-activation-wizard.component'
          ).then((c) => c.FiscalActivationWizardComponent),
      },
      {
        path: 'activation',
        loadComponent: () =>
          import(
            '../../../shared/components/fiscal-management-panel/fiscal-management-panel.component'
          ).then((c) => c.FiscalManagementPanelComponent),
      },
      {
        path: 'dashboard',
        loadComponent: () => Promise.resolve(FiscalOperationsComponent),
        data: { tab: 'dashboard' },
      },
      {
        path: 'obligations',
        loadComponent: () => Promise.resolve(FiscalOperationsComponent),
        data: { tab: 'obligations' },
      },
      {
        path: 'declarations',
        loadComponent: () => Promise.resolve(FiscalOperationsComponent),
        data: { tab: 'declarations' },
      },
      {
        path: 'close',
        loadComponent: () => Promise.resolve(FiscalOperationsComponent),
        data: { tab: 'close' },
      },
      {
        path: 'evidence',
        loadComponent: () => Promise.resolve(FiscalOperationsComponent),
        data: { tab: 'evidence' },
      },
      {
        path: 'history',
        loadComponent: () => Promise.resolve(FiscalOperationsComponent),
        data: { tab: 'history' },
      },
      {
        path: 'rules',
        loadComponent: () => Promise.resolve(FiscalOperationsComponent),
        data: { tab: 'rules' },
      },
    ],
  },
];
