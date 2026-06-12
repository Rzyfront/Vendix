import { Routes } from '@angular/router';

import { FiscalCoreShellComponent } from '../../fiscal-operations/fiscal-core-shell.component';
import { FiscalOperationsComponent } from '../../fiscal-operations/fiscal-operations.component';
import { fiscalManagementGuard } from '../../../../core/guards/fiscal-management.guard';

/**
 * Super-admin fiscal module — base IDÉNTICA al módulo fiscal de tenants.
 *
 * Misma jerarquía: un shell (`FiscalCoreShellComponent`) que decide
 * capa operación (siempre, la plataforma nunca está "sin activar") +
 * 7 tabs hijos (dashboard/identity/obligations/declarations/close/audit/
 * rules) con `data.fiscalApiScope = 'platform'` para que el service
 * rutee a `/super-admin/fiscal/*`.
 *
 * Complemento: submódulo "Contabilidad" (PUC, asientos, mapeos, reportes)
 * accesible desde rutas no-fiscales (`/super-admin/fiscal/accounting/*`)
 * — son el equivalente del módulo Contabilidad, no de Operación fiscal.
 */
export const FISCAL_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'dashboard',
  },
  {
    path: '',
    component: FiscalCoreShellComponent,
    data: { fiscalApiScope: 'platform' },
    children: [
      {
        path: 'wizard',
        canActivate: [fiscalManagementGuard],
        loadComponent: () =>
          import(
            '../../../../shared/components/fiscal-activation-wizard/fiscal-activation-wizard.component'
          ).then((c) => c.FiscalActivationWizardComponent),
      },
      {
        path: 'activation',
        loadComponent: () =>
          import(
            '../../../../shared/components/fiscal-management-panel/fiscal-management-panel.component'
          ).then((c) => c.FiscalManagementPanelComponent),
      },
      {
        path: 'dashboard',
        loadComponent: () => Promise.resolve(FiscalOperationsComponent),
        data: { tab: 'dashboard' },
      },
      {
        path: 'identity',
        loadComponent: () =>
          import(
            '../../fiscal-operations/components/fiscal-identity-panel.component'
          ).then((c) => c.FiscalIdentityPanelComponent),
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
        path: 'audit',
        loadComponent: () => Promise.resolve(FiscalOperationsComponent),
        data: { tab: 'audit' },
      },
      {
        path: 'rules',
        loadComponent: () => Promise.resolve(FiscalOperationsComponent),
        data: { tab: 'rules' },
      },
    ],
  },
  // -------------------------------------------------------------------
  // Submódulo "Contabilidad" — Plan Único de Cuentas, asientos,
  // mapeos y reportes contables de la plataforma. No forma parte del
  // Centro Fiscal (Operación fiscal) del tenant; es el equivalente
  // directo del módulo Contabilidad de la plataforma, conservado tal
  // cual con fixes de tipado para que el build no se rompa.
  // -------------------------------------------------------------------
  {
    path: 'accounting/chart-of-accounts',
    loadComponent: () =>
      import('./pages/chart-of-accounts/chart-of-accounts.component').then(
        (m) => m.ChartOfAccountsComponent,
      ),
  },
  {
    path: 'accounting/journal-entries',
    loadComponent: () =>
      import('./pages/journal-entries/journal-entries.component').then(
        (m) => m.JournalEntriesComponent,
      ),
  },
  {
    path: 'accounting/account-mappings',
    loadComponent: () =>
      import('./pages/account-mappings/account-mappings.component').then(
        (m) => m.AccountMappingsComponent,
      ),
  },
  {
    path: 'accounting/reports',
    loadComponent: () =>
      import('./pages/reports/reports.component').then(
        (m) => m.ReportsComponent,
      ),
  },
  // -------------------------------------------------------------------
  // Páginas sueltas conservadas (dashboard KPI suelto + obligations
  // standalone) — fuera del routing del shell, pero conservadas en el
  // árbol de archivos para referencia histórica. Se mantienen
  // accesibles vía deep-link para no romper integraciones externas
  // que apunten a las URLs previas al rework.
  // -------------------------------------------------------------------
  {
    path: 'legacy/dashboard',
    loadComponent: () =>
      import('./pages/dashboard/dashboard.component').then(
        (m) => m.DashboardComponent,
      ),
  },
  {
    path: 'legacy/obligations',
    loadComponent: () =>
      import('./pages/obligations/obligations.component').then(
        (m) => m.ObligationsComponent,
      ),
  },
];
