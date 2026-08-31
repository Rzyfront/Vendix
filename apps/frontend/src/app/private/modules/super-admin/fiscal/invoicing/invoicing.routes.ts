import { Routes } from '@angular/router';

import { ModuleTabsShellComponent } from '../../../../../shared/components/module-tabs-shell/module-tabs-shell.component';
import { providePlatformDianApi } from './platform-dian-context.factory';
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
        {
          id: 'profiles',
          label: 'Perfiles',
          icon: 'file-stack',
          route: '/super-admin/fiscal/invoicing/profiles',
        },
      ],
    },
    // `providePlatformDianApi()` reapunta `DIAN_API_CONTEXT` a
    // `superadmin/subscriptions/fiscal` y re-declara `DianConfigApiService` en
    // esta rama. Sin la segunda parte el singleton de raíz seguiría resolviendo
    // el token contra el injector RAÍZ y los componentes DIAN compartidos
    // pegarían a `store/invoicing` — la tienda del operador, no la plataforma.
    providers: [PlatformInvoicingStore, ...providePlatformDianApi()],
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
        // Orden importa: `invoices/new` antes que `invoices/:id` porque
        // Angular matchea first-match-wins. Si dejas `:id` primero, la URL
        // `invoices/new` captura `:id='new'`, Number('new')===NaN, y el detail
        // renderiza "Identificador de factura inválido". Cubre tanto SaaS
        // como platform-invoices (la creación es por el builder compartido).
        path: 'invoices/new',
        loadComponent: () =>
          import(
            './pages/invoices/platform-invoice-create.component'
          ).then((c) => c.PlatformInvoiceCreateComponent),
      },
      {
        path: 'invoices/:id',
        data: { kind: 'subscription' },
        loadComponent: () =>
          import(
            './pages/invoices/platform-invoice-detail.component'
          ).then((c) => c.PlatformInvoiceDetailComponent),
      },
      {
        // Ruta discriminada: las platform-invoices reciben su id de
        // `fiscal_transmissions.id` (no de `subscription_invoices.id`).
        // Sin esta ruta separada, las dos secuencias compartían
        // `/invoices/:id` y un id colisionado (SaaS #42 = platform #42)
        // mostraba el documento equivocado al abrir la URL.
        path: 'platform-invoices/:id',
        data: { kind: 'platform' },
        loadComponent: () =>
          import(
            './pages/invoices/platform-invoice-detail.component'
          ).then((c) => c.PlatformInvoiceDetailComponent),
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
      {
        path: 'profiles',
        loadComponent: () =>
          import('./pages/profiles/platform-profiles.component').then(
            (c) => c.PlatformProfilesComponent,
          ),
      },
      {
        path: 'profiles/new',
        loadComponent: () =>
          import('./pages/profiles/platform-profile-editor.component').then(
            (c) => c.PlatformProfileEditorComponent,
          ),
      },
      {
        path: 'profiles/:id/edit',
        loadComponent: () =>
          import('./pages/profiles/platform-profile-editor.component').then(
            (c) => c.PlatformProfileEditorComponent,
          ),
      },
    ],
  },
];
