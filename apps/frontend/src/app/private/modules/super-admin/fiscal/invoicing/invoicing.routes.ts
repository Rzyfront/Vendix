import { Routes } from '@angular/router';

import { ModuleTabsShellComponent } from '../../../../../shared/components/module-tabs-shell/module-tabs-shell.component';
import { PlatformInvoicingStore } from './platform-invoicing.store';

/**
 * Facturación electrónica de la plataforma — mismo patrón que el módulo de
 * facturación de tiendas (`store/invoicing/invoicing.routes.ts`): un
 * `ModuleTabsShellComponent` con las secciones como pestañas del sticky-header,
 * no como nietos del sidebar.
 *
 * Cuelga de Fiscal y no de Suscripciones: emitir ante la DIAN es una operación
 * fiscal, no un detalle del cobro de planes. Estaba en Suscripciones por
 * accidente histórico, lo que dejaba la configuración DIAN de la plataforma
 * lejos del resto del Centro Fiscal.
 *
 * `PlatformInvoicingStore` se provee AQUÍ y no en `root`: las 4 pestañas
 * comparten `status` y `resolutions` mientras se navega entre ellas, y todo se
 * descarta al salir del módulo.
 */
export const PLATFORM_INVOICING_ROUTES: Routes = [
  {
    path: '',
    component: ModuleTabsShellComponent,
    data: {
      moduleTitle: 'Facturación',
      moduleIcon: 'file-text',
      moduleBackRoute: '/super-admin/fiscal',
      moduleTabs: [
        {
          id: 'invoices',
          label: 'Facturas',
          icon: 'receipt',
          route: '/super-admin/fiscal/invoicing/invoices',
        },
        {
          id: 'resolutions',
          label: 'Resoluciones',
          icon: 'file-check',
          route: '/super-admin/fiscal/invoicing/resolutions',
        },
        {
          id: 'dian-config',
          label: 'Configuración DIAN',
          shortLabel: 'DIAN',
          icon: 'shield',
          route: '/super-admin/fiscal/invoicing/dian-config',
        },
        {
          id: 'support-document',
          label: 'Documento soporte',
          shortLabel: 'Doc. sop.',
          icon: 'file-input',
          route: '/super-admin/fiscal/invoicing/support-document',
        },
      ],
    },
    providers: [PlatformInvoicingStore],
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'invoices',
      },
      {
        path: 'invoices',
        loadComponent: () =>
          import('./pages/invoices/platform-invoices.component').then(
            (c) => c.PlatformInvoicesComponent,
          ),
      },
      {
        path: 'resolutions',
        loadComponent: () =>
          import('./pages/resolutions/platform-resolutions.component').then(
            (c) => c.PlatformResolutionsComponent,
          ),
      },
      {
        path: 'dian-config',
        loadComponent: () =>
          import('./pages/dian-config/platform-dian-config.component').then(
            (c) => c.PlatformDianConfigComponent,
          ),
      },
      {
        path: 'support-document',
        loadComponent: () =>
          import(
            './pages/support-document/platform-support-document.component'
          ).then((c) => c.PlatformSupportDocumentComponent),
      },
    ],
  },
];
